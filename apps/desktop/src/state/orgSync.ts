import { gitlabCreateGroup, gitlabOrganizationApi } from "./gitlab.js";
import { assertRepoAccountAcl, repoOwnerEmail, listRepoUserShares, setRepoUserPermission, removeRepoUserShare } from "./seafile.js";
import { cacheRemoteOrg, currentOrgEmail, markOrgRemote, orgSnapshot, type Org, type OrgAnnouncement, type OrgProject } from "./org.js";
import { ADMIN_FILE, CONTENT_FILE, OrgConflictError, applyPermissionIntent, auditOrgResources, decodeOrgFile, errorText, levelRole, roleLevel, missingRemote, replaceSharedItem,
  type OrgPermissionGateway, type OrgPermissionIntent, type OrgRemoteAdmin, type OrgRemoteBinding, type OrgRemoteContent, type OrgRemoteRef, type OrgRemoteSnapshot } from "./orgSyncCore.js";
import type { GitOrgProtection } from "@onethu/info-lib";

const snapshots = new Map<string, OrgRemoteSnapshot>();
const initializing = new Map<string, Promise<void>>();
const newId = () => crypto.randomUUID();
async function permissionGateway(): Promise<OrgPermissionGateway> {
  return {...await gitlabOrganizationApi(), listCloud:listRepoUserShares, cloudOwner:repoOwnerEmail, auditCloud:assertRepoAccountAcl, setCloud:setRepoUserPermission, removeCloud:removeRepoUserShare};
}
const keepBindings = (bindings: OrgRemoteBinding[]) => [...new Map(bindings.map(b=>[`${b.userId}:${b.email}`,b])).values()];
const requireLocal = (id: string): Org => { const org = orgSnapshot().orgs.find(o => o.id === id); if (!org) throw new Error("找不到组织"); return org; };
function assertRef(ref: OrgRemoteRef): void {
  if (!Number.isSafeInteger(ref.groupId) || ref.groupId <= 0 || !Number.isSafeInteger(ref.projectId) || ref.projectId <= 0 || ref.adminBranch !== "onethu-admin" || ref.contentBranch !== "onethu-content") throw new Error("组织协作地址不合法");
}
function checkProtection(protections: GitOrgProtection[], name: string, minimum: number): void {
  if (protections.length >= 100) throw new Error("分支保护规则过多，无法完整验证组织配置");
  const matching = protections.filter(p => new RegExp("^" + p.name.split("*").map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join(".*") + "$").test(name));
  if (!matching.some(p => p.name === name) || matching.some(p => p.allow_force_push || [...p.push_access_levels, ...p.merge_access_levels].some(a => (a.access_level > 0 && a.access_level < minimum) || a.user_id != null || a.group_id != null || a.deploy_key_id != null))) throw new Error(`组织分支 ${name} 的服务器保护不满足要求，请负责人检查 GitLab 分支保护`);
}
async function readSnapshot(ref: OrgRemoteRef): Promise<OrgRemoteSnapshot> {
  assertRef(ref);
  const api = await gitlabOrganizationApi();
  const [me, group, project, members, protections, af, cf] = await Promise.all([
    api.me(), api.group(ref.groupId), api.project(ref.projectId), api.members("groups", ref.groupId, true), api.protections(ref.projectId),
    api.file(ref.projectId, ref.adminBranch, ADMIN_FILE), api.file(ref.projectId, ref.contentBranch, CONTENT_FILE),
  ]);
  if (group.visibility !== "private" || group.parent_id || project.visibility !== "private" || project.namespace.id !== ref.groupId) throw new Error("组织资料必须位于对应 GitLab 私有群组的私有项目内");
  if (!members.some(m => m.id === me.id && m.access_level >= 20)) throw new Error("当前 GitLab 账号尚未获得这个组织的访问权限，请让负责人先添加你的 GitLab 账号");
  if (members.some(m=>m.access_level===40)) throw new Error("组织中存在 GitLab Maintainer 特殊权限，无法保证只有负责人能改管理资料；请先在 GitLab 调整为负责人或普通成员");
  if (project.shared_with_groups?.length) throw new Error("组织元数据项目被共享给其他群组，请先在 GitLab 移除额外群组授权");
  const direct = await api.members("projects",ref.projectId,false);
  if (direct.some(m=>!members.some(g=>g.id===m.id && g.access_level===50))) throw new Error("组织元数据项目存在额外直接成员授权，请先在 GitLab 移除");
  checkProtection(protections, ref.adminBranch, 40); checkProtection(protections, ref.contentBranch, 30);
  return { ref, me, members, group:{id:group.id,name:group.name,path:group.full_path,webUrl:group.web_url}, admin: decodeOrgFile<OrgRemoteAdmin>(af, "onethu-org-admin"), content: decodeOrgFile<OrgRemoteContent>(cf, "onethu-org-content") };
}
function cache(snapshot: OrgRemoteSnapshot, localId?: string): Org {
  const {admin: {value: config}, content: {value: content}, ref, members, me} = snapshot;
  const previous = localId ? orgSnapshot().orgs.find(o => o.id === localId) : orgSnapshot().orgs.find(o => o.collaboration?.projectId === ref.projectId);
  const id = previous?.id ?? `org.gitlab:${ref.projectId}`;
  const org: Org = { ...(previous ?? {}), id, name: config.name, brief: config.brief, joinUrl: config.joinUrl,
    cloudRepoId: previous?.cloudRepoId ?? "", cloudPath: previous?.cloudPath ?? "", createdAt: previous?.createdAt ?? Date.now(), updatedAt: Date.now(),
    gitlabGroup:snapshot.group, legacyMembers:config.legacyMembers,
    libraries: config.libraries, gitlabRepos: config.gitlabRepos, projects: content.projects, announcements: content.announcements,
    members: members.map(m => ({ id: `gitlab:${m.id}`, gitlabUserId: m.id, username: m.username, name: m.name, email: config.bindings.find(b => b.userId === m.id)?.email ?? "", role: levelRole(m.access_level), joinedAt: previous?.members.find(p => p.gitlabUserId === m.id)?.joinedAt ?? Date.now() })),
    collaboration: { ...ref, status: "ready", accountId: me.id, accessLevel: members.find(m => m.id === me.id)!.access_level, lastReadAt: Date.now(), pending: Boolean(config.pending) || config.permissionsVerified !== 1, error: config.pending?.errors?.join("；") ?? (config.permissionsVerified !== 1 ? "关联资源权限尚未核对，请负责人完成权限核对" : undefined) },
  };
  cacheRemoteOrg(org); snapshots.set(id, snapshot); return org;
}
export async function refreshRemoteOrg(id: string): Promise<Org> {
  const org = requireLocal(id); if (!org.collaboration) throw new Error("这个组织尚未启用多人协作");
  try { return cache(await readSnapshot(org.collaboration), id); }
  catch (e) { markOrgRemote(id, {...org.collaboration, status: "error", error: errorText(e), accessLevel: undefined}); throw e; }
}
export async function joinRemoteOrg(ref: OrgRemoteRef): Promise<string> {
  const snapshot = await readSnapshot(ref);
  const previous = orgSnapshot().orgs.find(o => o.collaboration?.projectId === ref.projectId);
  return cache(snapshot, previous?.id).id;
}
async function requireSnapshot(id: string, access: number, pendingAllowed = false): Promise<OrgRemoteSnapshot> {
  const org = await refreshRemoteOrg(id); const snapshot = snapshots.get(id)!;
  if ((org.collaboration?.accessLevel ?? 0) < access) throw new Error(access >= 50 ? "只有服务器上的组织负责人可以执行此操作" : "当前账号没有编辑组织内容的权限");
  if ((snapshot.admin.value.pending || snapshot.admin.value.permissionsVerified !== 1) && !pendingAllowed) throw new Error("上一次权限变更尚未完成，请先重试并完成它");
  return snapshot;
}
async function writeAdmin(snapshot: OrgRemoteSnapshot, value: OrgRemoteAdmin): Promise<void> {
  const api = await gitlabOrganizationApi();
  try { await api.updateFile(snapshot.ref.projectId, snapshot.ref.adminBranch, ADMIN_FILE, JSON.stringify(value, null, 2), snapshot.admin.revision); }
  catch (e) {
    const current = await api.file(snapshot.ref.projectId, snapshot.ref.adminBranch, ADMIN_FILE).catch(() => null);
    if (current && current.last_commit_id !== snapshot.admin.revision) throw new OrgConflictError();
    throw e;
  }
}

/** Explicit migration creates isolated server resources; existing local data stays until readback. */
export function enableOrgCollaboration(id: string): Promise<void> {
  const running = initializing.get(id); if (running) return running;
  const task = initializeOrgCollaboration(id).finally(()=>initializing.delete(id));
  initializing.set(id,task); return task;
}
async function initializeOrgCollaboration(id: string): Promise<void> {
  const org = requireLocal(id);
  if (org.collaboration?.lastReadAt) { await refreshRemoteOrg(id); if (snapshots.get(id)!.admin.value.permissionsVerified !== 1) await retryOrgPermissions(id); return; }
  const api = await gitlabOrganizationApi(); const me = await api.me();
  const email = await currentOrgEmail();
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(org.id));
  const suffix = Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("").slice(0,20);
  const groupPath = `onethu-org-${suffix}`, projectPath = `onethu-data-${suffix}`;
  let group = org.gitlabGroup;
  if (!group) {
    const lookup = async () => { const g = await api.group(groupPath); return {id:g.id,name:g.name,path:g.full_path,webUrl:g.web_url}; };
    try { group = await lookup(); }
    catch (e) {
      if (!missingRemote(e)) throw e;
      try { group = await gitlabCreateGroup({name:org.name,path:groupPath,description:org.brief,visibility:"private"}); }
      catch (created) { group = await lookup().catch(()=>{throw created;}); }
    }
    cacheRemoteOrg({...org, gitlabGroup:group});
  }
  const [remoteGroup, members] = await Promise.all([api.group(group.id), api.members("groups", group.id, true)]);
  if (remoteGroup.visibility !== "private" || remoteGroup.parent_id) throw new Error("多人协作需要你拥有的独立私有 GitLab 群组，不能使用公开群组或继承权限的子群组");
  if (members.some(m=>m.access_level===40)) throw new Error("请先把群组中的 Maintainer 调整为负责人或普通成员，再初始化协作");
  if (!members.some(m => m.id === me.id && m.access_level === 50)) throw new Error("当前 GitLab 账号不是这个群组的负责人");
  let project;
  if (org.collaboration) project = await api.project(org.collaboration.projectId);
  else {
    const lookup = () => api.project(`${remoteGroup.full_path}/${projectPath}`);
    try { project = await lookup(); }
    catch (e) {
      if (!missingRemote(e)) throw e;
      try { project = await api.createMetadataProject(group.id,projectPath); }
      catch (created) { project = await lookup().catch(()=>{throw created;}); }
    }
  }
  if (project.visibility !== "private" || project.namespace.id !== group.id || project.shared_with_groups?.length) throw new Error("元数据项目必须是该组织内未向其他群组共享的私有项目");
  const ref: OrgRemoteRef = {groupId: group.id, projectId: project.id, adminBranch: "onethu-admin", contentBranch: "onethu-content"};
  markOrgRemote(id, {...ref, status: "initializing"});
  try {
    const bindings: OrgRemoteBinding[] = members.map(m => ({userId: m.id, username: m.username, name: m.name, email: m.id === me.id ? email : (org.members.find(old => old.gitlabUserId === m.id || old.username === m.username)?.email ?? "")}));
    const admin: OrgRemoteAdmin = {v:1, kind:"onethu-org-admin", orgId: org.id, name: org.name, brief: org.brief, joinUrl: org.joinUrl, bindings, legacyMembers:org.members.filter(m=>!bindings.some(b=>b.userId===m.gitlabUserId || b.email && b.email===m.email)).map(m=>({id:m.id,name:m.name,email:m.email,role:m.role})), libraries: org.libraries ?? [], gitlabRepos: org.gitlabRepos ?? []};
    const content: OrgRemoteContent = {v:1, kind:"onethu-org-content", projects: org.projects ?? [], announcements: org.announcements ?? []};
    for (const [branch, file, value, minimum] of [[ref.adminBranch, ADMIN_FILE, admin, 40], [ref.contentBranch, CONTENT_FILE, content, 30]] as const) {
      try { await api.createBranch(project.id, branch, project.default_branch || "main"); }
      catch (e) { if (!/already exists/i.test(errorText(e))) throw e; }
      const protections = await api.protections(project.id);
      if (!protections.some(p => p.name === branch)) await api.protect(project.id, branch, minimum);
      checkProtection(await api.protections(project.id), branch, minimum);
      let existing;
      try { existing = await api.file(project.id,branch,file); }
      catch (e) { if (!missingRemote(e)) throw e; }
      if (existing) {
        const parsed = decodeOrgFile<OrgRemoteAdmin|OrgRemoteContent>(existing,value.kind);
        if (parsed.value.kind === "onethu-org-admin" && parsed.value.orgId !== org.id) throw new Error("此协作项目已经属于另一个组织，不能用本机资料覆盖");
        // A previous initializer may have completed remotely; never overwrite its accepted edits.
      } else await api.createFile(project.id, branch, file, JSON.stringify(value, null, 2));
    }
    await refreshRemoteOrg(id);
    if (snapshots.get(id)!.admin.value.permissionsVerified !== 1) await retryOrgPermissions(id);
  } catch (e) {
    const latest = requireLocal(id).collaboration;
    markOrgRemote(id, {...latest, ...ref, status:"error", error:errorText(e)}); throw e;
  }
}

export async function updateRemoteOrg(id: string, before: Pick<OrgRemoteAdmin, "name"|"brief"|"joinUrl">, patch: Pick<OrgRemoteAdmin, "name"|"brief"|"joinUrl">): Promise<void> {
  const snapshot = await requireSnapshot(id, 50);
  if (["name", "brief", "joinUrl"].some(k => snapshot.admin.value[k as keyof typeof before] !== before[k as keyof typeof before])) throw new OrgConflictError();
  await writeAdmin(snapshot, {...snapshot.admin.value, ...patch}); await refreshRemoteOrg(id);
}
export async function saveRemoteContent(id: string, collection: "projects"|"announcements", before: OrgProject | OrgAnnouncement | undefined, after: OrgProject | OrgAnnouncement | undefined): Promise<void> {
  const snapshot = await requireSnapshot(id, 30, true);
  const content = snapshot.content.value;
  const items = replaceSharedItem<OrgProject | OrgAnnouncement>(content[collection], before, after);
  const next = {...content, [collection]: items}; const api = await gitlabOrganizationApi();
  try { await api.updateFile(snapshot.ref.projectId, snapshot.ref.contentBranch, CONTENT_FILE, JSON.stringify(next, null, 2), snapshot.content.revision); }
  catch (e) {
    const current = await api.file(snapshot.ref.projectId, snapshot.ref.contentBranch, CONTENT_FILE).catch(() => null);
    if (current && current.last_commit_id !== snapshot.content.revision) throw new OrgConflictError();
    throw e;
  }
  await refreshRemoteOrg(id);
}
export async function resolveOrgUser(username: string, email: string): Promise<OrgRemoteBinding> {
  const clean = username.trim().replace(/^@/, "");
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error("请填写准确的 GitLab 用户名和清华云盘邮箱");
  const users = await (await gitlabOrganizationApi()).searchUsers(clean);
  const user = users.find(u => u.username.toLowerCase() === clean.toLowerCase());
  if (!user || user.state === "blocked") throw new Error("找不到可用的 GitLab 用户名，请让对方在 GitLab 个人资料中确认");
  return {userId:user.id, username:user.username, name:user.name, email:email.trim().toLowerCase()};
}
export async function changeRemoteMember(id: string, beforeId: number | undefined, target?: OrgRemoteBinding & {role: "owner"|"member"|"guest"}, expected?: {email:string;role:"owner"|"member"|"guest"}): Promise<void> {
  const snapshot = await requireSnapshot(id, 50, true);
  const existingIntent = snapshot.admin.value.pending;
  if (existingIntent) {
    const member = snapshot.members.find(m=>m.id===beforeId);
    if (!target || !beforeId || !member || target.userId !== beforeId || roleLevel(target.role) !== member.access_level || existingIntent.removeUserId === beforeId) throw new Error("未完成的权限变更期间，只能补充现有成员的云盘邮箱；角色与成员调整请先完成重试");
  }
  if (!beforeId && target && snapshot.members.some(m=>m.id===target.userId)) throw new Error("这个 GitLab 账号已经是组织成员，请使用编辑或角色菜单");
  if (beforeId && expected) {
    const current = snapshot.members.find(m=>m.id===beforeId);
    const email = snapshot.admin.value.bindings.find(b=>b.userId===beforeId)?.email ?? "";
    if (!current || levelRole(current.access_level)!==expected.role || email!==expected.email) throw new OrgConflictError();
  }
  if (target && beforeId && target.userId !== beforeId) throw new Error("更换 GitLab 账号请先移除旧成员，再添加新成员");
  const changing = snapshot.members.find(m=>m.id===(beforeId??target?.userId));
  if (changing?.access_level === 50 && (!target || target.role !== "owner") && snapshot.members.filter(m=>m.access_level===50).length<=1) throw new Error("至少保留一位服务器上的组织负责人");
  if (changing?.id === snapshot.me.id && (!target || target.role !== "owner")) throw new Error("请由另一位负责人执行你的移除或降级");
  const bindings = (existingIntent?.bindings ?? snapshot.admin.value.bindings).filter(b => b.userId !== (beforeId ?? target?.userId));
  if (target) {
    if (bindings.some(b => b.email && b.email === target.email)) throw new Error("这个云盘邮箱已经绑定其他组织成员");
    const {role: _role, ...binding} = target; bindings.push(binding);
  }
  const pending: OrgPermissionIntent = existingIntent
    ? {...existingIntent, id:newId(), errors:undefined, bindings, target:existingIntent.target?.userId===target!.userId ? {...existingIntent.target,email:target!.email} : existingIntent.target,
      previousBindings:keepBindings([...existingIntent.previousBindings,...existingIntent.bindings])}
    : {id:newId(), label:target ? `更新 ${target.username}` : "移除成员", createdAt:Date.now(), target, removeUserId:target ? undefined : beforeId, bindings, previousBindings:snapshot.admin.value.bindings};
  await writeAdmin(snapshot, {...snapshot.admin.value, pending}); await retryOrgPermissions(id);
}
export async function retryOrgPermissions(id: string): Promise<void> {
  let snapshot = await requireSnapshot(id, 50, true);
  if (!snapshot.admin.value.pending) {
    const bindings = snapshot.admin.value.bindings;
    await writeAdmin(snapshot, {...snapshot.admin.value, pending:{id:newId(), label:"核对全部权限", createdAt:Date.now(), bindings, previousBindings:bindings}});
    await refreshRemoteOrg(id); snapshot = snapshots.get(id)!;
  }
  const intent = snapshot.admin.value.pending!;
  let errors: string[];
  try { errors = await applyPermissionIntent(await permissionGateway(), snapshot, intent); }
  catch (e) { errors = [errorText(e)]; }
  // Re-read the protected intent before finishing; another admin cannot be silently overwritten.
  await refreshRemoteOrg(id); const latest = snapshots.get(id)!;
  if (!latest.admin.value.pending && !errors.length && JSON.stringify(latest.admin.value.bindings)===JSON.stringify(intent.bindings)) return;
  if (latest.admin.value.pending?.id !== intent.id) throw new OrgConflictError();
  await writeAdmin(latest, {...latest.admin.value, ...(errors.length ? {pending:{...intent, errors}} : {bindings:intent.bindings, permissionsVerified:1, legacyMembers:latest.admin.value.legacyMembers?.filter(m=>!intent.bindings.some(b=>b.email && b.email===m.email)), pending:undefined})});
  await refreshRemoteOrg(id);
  if (errors.length) throw new Error(`权限变更尚未完成：${errors.join("；")}。修正原因后点击重试，已完成的步骤不会重复授予。`);
}
export async function updateRemoteResources(id: string, collection: "libraries"|"gitlabRepos", before: OrgRemoteAdmin["libraries"]|OrgRemoteAdmin["gitlabRepos"], value: OrgRemoteAdmin["libraries"]|OrgRemoteAdmin["gitlabRepos"]): Promise<void> {
  const snapshot = await requireSnapshot(id, 50, true);
  if (JSON.stringify(snapshot.admin.value[collection]) !== JSON.stringify(before)) throw new OrgConflictError();
  const existing = snapshot.admin.value.pending;
  const key = (resource: OrgRemoteAdmin["libraries"][number] | OrgRemoteAdmin["gitlabRepos"][number]) => "repoId" in resource ? resource.repoId : resource.id;
  if (existing && value.some(resource=>!before.some(old=>key(old)===key(resource)))) throw new Error("未完成的权限变更期间只能解除资源关联，请先完成重试再添加资源");
  const bindings = existing?.bindings ?? snapshot.admin.value.bindings;
  const config = {...snapshot.admin.value, [collection]:value} as OrgRemoteAdmin;
  const pending: OrgPermissionIntent = {...existing, id:newId(), label:"同步关联资源权限", createdAt:Date.now(), errors:undefined, bindings,
    previousBindings:keepBindings([...(existing?.previousBindings ?? bindings),...(existing?.bindings ?? [])]),
    removedLibraries:[...(existing?.removedLibraries??[]),...(collection === "libraries" ? snapshot.admin.value.libraries.filter(old=>!(value as OrgRemoteAdmin["libraries"]).some(n=>n.repoId===old.repoId)) : [])],
    removedRepos:[...(existing?.removedRepos??[]),...(collection === "gitlabRepos" ? snapshot.admin.value.gitlabRepos.filter(old=>!(value as OrgRemoteAdmin["gitlabRepos"]).some(n=>n.id===old.id)) : [])]};
  // Validate new links before committing a blocking intent. Existing pending operations remain repairable.
  if (!existing) {
    if (config.libraries.length && snapshot.members.some(m=>!bindings.some(b=>b.userId===m.id && b.email))) throw new Error("请先给每位组织成员填写云盘邮箱，再关联资料库");
    await auditOrgResources(await permissionGateway(), {...snapshot,admin:{...snapshot.admin,value:config}}, pending);
  }
  await writeAdmin(snapshot, {...config,pending});
  await retryOrgPermissions(id);
}

export async function assertOrgManager(id: string): Promise<void> { await requireSnapshot(id,50); }
