import { t as i18n } from "../i18n/index.js";
import { fullModeReceiveSession } from "../lib/fullModeReceive.js";
/**
 * 组织：成员（真实邮箱）、共享资料库（清华云盘资料库/libraries）、GitLab 仓库、项目、公告。
 *
 * 口径（2026-10-19 重构）：
 * - 不自建后端：组织是「本地组织架构 + 云端真实资源」的组合。成员以清华云盘邮箱为准
 *   （资料库共享走 seafile_share_folder_to_user），GitLab 仓库只存 id/path 引用。
 * - 组织主页是完整页面（pages/Organization.tsx）：概览 / 成员 / 资料库 / GitLab / 项目 / 公告。
 * - 邀请口令是组织资料的编码封装（ONORG1），可带口令名与限定接收邮箱；接收方过邮箱校验后
 *   加入本地成员清单，再按 joinUrl 去云盘/GitLab 加入真正的共享空间。
 */
import { useSyncExternalStore } from "react";
import type { OrgRemoteRef } from "./orgSyncCore.js";
import { checksum } from "./vaultShare.js";

export type OrgRole = "owner" | "member" | "guest";

export interface OrgMember {
  id: string;
  name: string;
  /** 清华云盘/统一认证邮箱：组织成员靠邮箱关联真实资源（空 = 历史成员，待补） */
  email: string;
  role: OrgRole;
  joinedAt: number;
  gitlabUserId?: number;
  username?: string;
}

/** 组织关联的清华云盘「资料库」（repo，不是文件夹）。 */
export interface OrgLibrary {
  repoId: string;
  name: string;
  /** 已共享给哪些成员邮箱（小写，成功共享后记） */
  sharedWith?: string[];
  addedAt: number;
}

/** 组织关联的 GitLab 仓库（只存引用，不镜像内容）。 */
export interface OrgRepo {
  id: number;
  name: string;
  path: string;
  webUrl?: string;
  addedAt: number;
}

export interface OrgProject { id: string; name: string; description: string; status: "planned" | "active" | "done"; owner: string; updatedAt: number }
export interface OrgAnnouncement { id: string; title: string; body: string; pinned: boolean; updatedAt: number }
export interface Org {
  id: string;
  name: string;
  brief: string;
  /** 加入方式（GitLab 组织 / 云盘共享文件夹链接） */
  joinUrl: string;
  /** 云盘落点（后续由 orgCloud 填） */
  cloudRepoId: string;
  cloudPath: string;
  /** 已创建的组织共享空间（云盘目录 + 分享链接） */
  shared?: { repoId: string; path: string; shareUrl: string; shareToken: string; expiresAt: number; createdAt: number };
  members: OrgMember[];
  /** 关联的云盘资料库（组织资料真正落地的地方） */
  libraries?: OrgLibrary[];
  /** 关联/创建的 GitLab 仓库 */
  gitlabRepos?: OrgRepo[];
  /** 组织的 GitLab 组织（群组）：成员按邮箱邀请进来，仓库建在它下面 */
  gitlabGroup?: { id: number; name: string; path: string; webUrl: string };
  projects?: OrgProject[];
  announcements?: OrgAnnouncement[];
  /** 最近一次生成的邀请口令（含口令名/限定邮箱） */
  lastInviteCode?: string;
  invite?: { code: string; label?: string; allowEmail?: string; issuedAt: number; expiresAt?: number };
  legacyMembers?: Array<{id:string;name:string;email:string;role:OrgRole}>;
  collaboration?: OrgRemoteRef & { status: "initializing" | "ready" | "error"; accountId?: number; accessLevel?: number; lastReadAt?: number; error?: string; pending?: boolean };
  createdAt: number;
  updatedAt: number;
}

export interface OrgDoc {
  v: 1;
  orgs: Org[];
}

const KEY = "onethu.orgs.v1";

function newId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function load(): OrgDoc {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { v: 1, orgs: [] };
    const p = JSON.parse(raw) as Partial<OrgDoc>;
    if (p?.v !== 1 || !Array.isArray(p.orgs)) return { v: 1, orgs: [] };
    /* 旧存档升级：成员补 email 字段、资料库/GitLab/邀请元数据补默认值（只加不改，不丢历史）。 */
    const orgs = p.orgs
      .filter((o): o is Org => !!o && typeof o.id === "string" && Array.isArray(o.members))
      .map((o): Org => ({
        ...o,
        members: o.members.map((m) => ({ ...m, email: typeof m.email === "string" ? m.email : "" })),
        libraries: Array.isArray(o.libraries) ? o.libraries : [],
        gitlabRepos: Array.isArray(o.gitlabRepos) ? o.gitlabRepos : [],
      }));
    return { v: 1, orgs };
  } catch {
    return { v: 1, orgs: [] };
  }
}

let doc: OrgDoc = load();
const listeners = new Set<() => void>();
function commit(): void {
  try { localStorage.setItem(KEY, JSON.stringify(doc)); } catch { /* 配额满保持内存态 */ }
  listeners.forEach((f) => f());
}

export function subscribeOrgs(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
export function orgSnapshot(): OrgDoc {
  return doc;
}
export function useOrgs(): OrgDoc {
  return useSyncExternalStore(subscribeOrgs, orgSnapshot, orgSnapshot);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeOrgEmail(email: string): string {
  return String(email ?? "").trim().toLowerCase().slice(0, 120);
}

export function createOrg(input: { name: string; brief?: string; joinUrl?: string; ownerName?: string; ownerEmail?: string }): Org {
  const now = Date.now();
  const org: Org = {
    id: newId("org."),
    name: String(input.name ?? "").trim().slice(0, 60) || "未命名组织",
    brief: String(input.brief ?? "").trim().slice(0, 200),
    joinUrl: String(input.joinUrl ?? "").trim().slice(0, 300),
    cloudRepoId: "",
    cloudPath: "",
    libraries: [],
    gitlabRepos: [],
    members: [{
      id: newId("mem."),
      name: String(input.ownerName ?? "我").slice(0, 40),
      email: normalizeOrgEmail(input.ownerEmail ?? ""),
      role: "owner",
      joinedAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  };
  doc = { ...doc, orgs: [org, ...doc.orgs] };
  commit();
  return org;
}

export function updateOrg(id: string, patch: Partial<Pick<Org, "name" | "brief" | "joinUrl" | "cloudRepoId" | "cloudPath">>): void {
  doc = {
    ...doc,
    orgs: doc.orgs.map((o) => (o.id === id ? {
      ...o,
      name: patch.name !== undefined ? String(patch.name).trim().slice(0, 60) || o.name : o.name,
      brief: patch.brief !== undefined ? String(patch.brief).trim().slice(0, 200) : o.brief,
      joinUrl: patch.joinUrl !== undefined ? String(patch.joinUrl).trim().slice(0, 300) : o.joinUrl,
      cloudRepoId: patch.cloudRepoId !== undefined ? patch.cloudRepoId : o.cloudRepoId,
      cloudPath: patch.cloudPath !== undefined ? patch.cloudPath : o.cloudPath,
      updatedAt: Date.now(),
    } : o)),
  };
  commit();
}

export function deleteOrg(id: string): void {
  doc = { ...doc, orgs: doc.orgs.filter((o) => o.id !== id) };
  commit();
}

export function addOrgMember(
  id: string,
  name: string,
  email = "",
  role: OrgRole = "member",
): { ok: boolean; reason?: "duplicate" | "no-org" | "bad-email" } {
  const org = doc.orgs.find((o) => o.id === id);
  if (!org) return { ok: false, reason: "no-org" };
  const n = String(name ?? "").trim().slice(0, 40);
  if (!n) return { ok: false, reason: "bad-email" };
  const mail = normalizeOrgEmail(email);
  if (mail && !EMAIL_RE.test(mail)) return { ok: false, reason: "bad-email" };
  if (org.members.some((m) => (mail ? m.email === mail : m.name === n))) return { ok: false, reason: "duplicate" };
  doc = {
    ...doc,
    orgs: doc.orgs.map((o) => (o.id === id ? { ...o, members: [...o.members, { id: newId("mem."), name: n, email: mail, role, joinedAt: Date.now() }], updatedAt: Date.now() } : o)),
  };
  commit();
  return { ok: true };
}

/** 改成员邮箱/名字（邮箱是组织资源关联键，改它 = 以后资料库共享发给新邮箱）。 */
export function updateOrgMember(
  id: string,
  memberId: string,
  patch: { name?: string; email?: string },
): { ok: boolean; reason?: "duplicate" | "no-org" | "bad-email" } {
  const org = doc.orgs.find((o) => o.id === id);
  const member = org?.members.find((m) => m.id === memberId);
  if (!org || !member) return { ok: false, reason: "no-org" };
  const name = patch.name !== undefined ? String(patch.name).trim().slice(0, 40) : member.name;
  if (!name) return { ok: false, reason: "bad-email" };
  const email = patch.email !== undefined ? normalizeOrgEmail(patch.email) : member.email;
  if (email && !EMAIL_RE.test(email)) return { ok: false, reason: "bad-email" };
  if (email && org.members.some((m) => m.id !== memberId && m.email === email)) return { ok: false, reason: "duplicate" };
  doc = {
    ...doc,
    orgs: doc.orgs.map((o) => (o.id === id
      ? { ...o, members: o.members.map((m) => (m.id === memberId ? { ...m, name, email } : m)), updatedAt: Date.now() }
      : o)),
  };
  commit();
  return { ok: true };
}

/* ── 资料库（清华云盘 repo）与 GitLab 仓库 ── */

export function addOrgLibrary(id: string, lib: { repoId: string; name: string }): { ok: boolean; reason?: "duplicate" | "no-org" } {
  const org = doc.orgs.find((o) => o.id === id);
  if (!org) return { ok: false, reason: "no-org" };
  const repoId = String(lib.repoId ?? "").trim();
  if (!repoId) return { ok: false, reason: "no-org" };
  if ((org.libraries ?? []).some((l) => l.repoId === repoId)) return { ok: false, reason: "duplicate" };
  changeOrg(id, (o) => ({
    ...o,
    libraries: [...(o.libraries ?? []), { repoId, name: String(lib.name ?? "").trim().slice(0, 120) || repoId, addedAt: Date.now() }],
  }));
  return { ok: true };
}

export function removeOrgLibrary(id: string, repoId: string): void {
  changeOrg(id, (o) => ({ ...o, libraries: (o.libraries ?? []).filter((l) => l.repoId !== repoId) }));
}

/** 记录某资料库已经共享给哪些成员邮箱（共享动作由 UI 调云盘 API 成功后回写）。 */
export function markOrgLibraryShared(id: string, repoId: string, emails: string[]): void {
  const norm = Array.from(new Set(emails.map(normalizeOrgEmail).filter(Boolean)));
  changeOrg(id, (o) => ({
    ...o,
    libraries: (o.libraries ?? []).map((l) => (l.repoId === repoId
      ? { ...l, sharedWith: Array.from(new Set([...(l.sharedWith ?? []), ...norm])) }
      : l)),
  }));
}

export function linkOrgGitlab(id: string, repo: Omit<OrgRepo, "addedAt">): { ok: boolean; reason?: "duplicate" | "no-org" } {
  const org = doc.orgs.find((o) => o.id === id);
  if (!org) return { ok: false, reason: "no-org" };
  if ((org.gitlabRepos ?? []).some((r) => r.id === repo.id)) return { ok: false, reason: "duplicate" };
  changeOrg(id, (o) => ({
    ...o,
    gitlabRepos: [...(o.gitlabRepos ?? []), { ...repo, addedAt: Date.now() }],
  }));
  return { ok: true };
}

export function setOrgGitlabGroup(id: string, group: NonNullable<Org["gitlabGroup"]>): void {
  changeOrg(id, (o) => ({ ...o, gitlabGroup: group }));
}

export function unlinkOrgGitlab(id: string, gitlabId: number): void {
  changeOrg(id, (o) => ({ ...o, gitlabRepos: (o.gitlabRepos ?? []).filter((r) => r.id !== gitlabId) }));
}

export function setOrgShare(id: string, shared: NonNullable<Org["shared"]>): void {
  doc = { ...doc, orgs: doc.orgs.map((o) => (o.id === id ? { ...o, shared, cloudRepoId: shared.repoId, cloudPath: shared.path, updatedAt: Date.now() } : o)) };
  commit();
}

export function removeOrgMember(id: string, memberId: string): boolean {
  const org=doc.orgs.find(o=>o.id===id), member=org?.members.find(m=>m.id===memberId);
  if(!org || !member || (member.role==="owner" && org.members.filter(m=>m.role==="owner").length===1)) return false;
  doc = {
    ...doc,
    orgs: doc.orgs.map((o) => (o.id === id ? { ...o, members: o.members.filter((m) => m.id !== memberId), updatedAt: Date.now() } : o)),
  };
  commit();
  return true;
}

/* ── 邀请口令：ONORG1.<base64url(json)>.<checksum> ── */

export const ORG_CODE_PREFIX = "ONORG1";

interface OrgInvitePayload {
  v: 1;
  kind: "org-invite";
  orgId: string;
  name: string;
  brief: string;
  joinUrl: string;
  inviter: string;
  issuedAt: number;
  /** 邀请口令名（发送方自己起的名字） */
  label?: string;
  /** 限定接收邮箱：只有这个清华云盘账号能接受邀请 */
  allowEmail?: string;
  collaboration?: OrgRemoteRef;
}

function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function orgInviteCode(
  org: Org,
  inviter = "我",
  meta?: { label?: string; allowEmail?: string; expireDays?: number },
): Promise<string> {
  const label = String(meta?.label ?? "").trim().slice(0, 60);
  const allowEmail = normalizeOrgEmail(meta?.allowEmail ?? "");
  const expireDays = meta?.expireDays === 0 ? 0 : (meta?.expireDays ?? 7);
  const wantExpires = expireDays > 0 ? Date.now() + expireDays * 86400_000 : 0;
  const payload: OrgInvitePayload = {
    v: 1, kind: "org-invite", orgId: org.id, name: org.name, brief: org.brief, joinUrl: org.joinUrl,
    inviter, issuedAt: Date.now(),
    ...(org.collaboration?.status === "ready" ? { collaboration: { groupId: org.collaboration.groupId, projectId: org.collaboration.projectId, adminBranch: org.collaboration.adminBranch, contentBranch: org.collaboration.contentBranch } } : {}),
    ...(label ? { label } : {}),
    ...(allowEmail ? { allowEmail } : {}),
  };
  const json = JSON.stringify(payload);
  /* 内容键不含 issuedAt：同一个组织重复点「邀请」复用旧短码，不重复上传。
   *  稳定分享位按组织 id 分：组织资料改了就地更新同一个目录，口令不变；
   *  改口令名/限定邮箱也走这里 —— 短码不换，manifest 内容就地更新。 */
  const contentKey = JSON.stringify([org.id, org.name, org.brief, org.joinUrl, inviter, label, allowEmail, payload.collaboration]);
  /* 云盘分享的有效期是创建时定死的：有效期变了只能撤旧分享重建（短码随之更新），
     没变则继续复用同一个稳定位（同一条短码）。2 小时容差避免每次都重建。 */
  const forceNew = Boolean(org.invite) && Math.abs((org.invite?.expiresAt ?? 0) - wantExpires) > 2 * 3600_000;
  const code = await (await import("./cloudExchange.js")).publishExchangeCode(
    `${ORG_CODE_PREFIX}.${toB64Url(new TextEncoder().encode(json))}.${checksum(json)}`,
    contentKey,
    `org:${org.id}`,
    { expireDays, forceNew },
  );
  doc = {
    ...doc,
    orgs: doc.orgs.map((o) => (o.id === org.id ? {
      ...o,
      lastInviteCode: code,
      invite: { code, issuedAt: Date.now(), expiresAt: wantExpires, ...(label ? { label } : {}), ...(allowEmail ? { allowEmail } : {}) },
      updatedAt: Date.now(),
    } : o)),
  };
  commit();
  return code;
}

/** 删除组织邀请口令：撤销云盘分享 + 清掉本地记录。 */
export async function revokeOrgInvite(id: string): Promise<{ ok: boolean; reason?: string }> {
  const org = doc.orgs.find((o) => o.id === id);
  if (!org?.invite?.code) return { ok: false, reason: i18n("state.org.22f86a2a8ff2") };
  const { revokeShareSlot } = await import("./cloudExchange.js");
  const ok = await revokeShareSlot(`org:${id}`);
  doc = {
    ...doc,
    orgs: doc.orgs.map((o) => (o.id === id ? { ...o, invite: undefined, lastInviteCode: undefined, updatedAt: Date.now() } : o)),
  };
  commit();
  return ok ? { ok: true } : { ok: true, reason: i18n("state.org.c6b6912e4bd5") };
}

export function decodeOrgInvite(code: string): { ok: boolean; payload?: OrgInvitePayload; reason?: string } {
  const raw = String(code ?? "").trim();
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== ORG_CODE_PREFIX) return { ok: false, reason: i18n("state.org.1f5874fd9b2a") };
  let json: string;
  try { json = new TextDecoder().decode(fromB64Url(parts[1]!)); } catch { return { ok: false, reason: i18n("state.org.3dc0aa93b10c") }; }
  if (checksum(json) !== parts[2]) return { ok: false, reason: i18n("state.org.989f1cde10a3") };
  try {
    const p = JSON.parse(json) as OrgInvitePayload;
    if (p?.v !== 1 || p.kind !== "org-invite") return { ok: false, reason: i18n("state.org.1e4404a53a1d") };
    /* 不可信输入：口令名截断，限定邮箱只接受像邮箱的值。 */
    if (p.label !== undefined) {
      const label = typeof p.label === "string" ? p.label.trim().slice(0, 60) : "";
      if (label) p.label = label; else delete p.label;
    }
    if (p.allowEmail !== undefined) {
      const email = typeof p.allowEmail === "string" ? normalizeOrgEmail(p.allowEmail) : "";
      if (email && EMAIL_RE.test(email)) p.allowEmail = email; else delete p.allowEmail;
    }
    return { ok: true, payload: p };
  } catch { return { ok: false, reason: i18n("state.org.7aa0c43fe053") }; }
}

/** 接受邀请：创建/合并本地组织，加入者为 member（不重复同名成员）。 */
/** 当前清华云盘账号邮箱（组织成员/资料库共享的身份锚点；未连接云盘返回空串）。 */
export async function currentOrgEmail(): Promise<string> {
  const seafile = await import("./seafile.js");
  await seafile.ensureSeafileLoaded();
  let account = seafile.getSeafileAccount();
  if (!account) {
    try {
      await seafile.refreshSeafileAccount();
    } catch {
      /* 未连接：返回空 */
    }
    account = seafile.getSeafileAccount();
  }
  return normalizeOrgEmail(account?.email ?? "");
}

export async function acceptOrgInvite(code: string, myName = "我"): Promise<{ ok: boolean; orgId?: string; reason?: string }> {
  const receiving = fullModeReceiveSession();
  if (!receiving.isCurrent()) return { ok: false, reason: i18n("friends.modeChanged") };
  let resolved: string;
  try { resolved = await (await import("./cloudExchange.js")).resolveExchangeCode(code); }
  catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
  if (!receiving.isCurrent()) return { ok: false, reason: i18n("friends.modeChanged") };
  const dec = decodeOrgInvite(resolved);
  if (!dec.ok || !dec.payload) return { ok: false, reason: dec.reason ?? i18n("state.org.c4591b5b1fe8") };
  const p = dec.payload;
  if (p.collaboration) {
    try {
      const remote = await import("./orgSync.js");
      receiving.assertCurrent();
      const orgId = await remote.joinRemoteOrg(p.collaboration);
      receiving.assertCurrent();
      return { ok: true, orgId };
    }
    catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
  }
  /* 限定邮箱：组织邀请也能只让某个云盘账号接受。 */
  const email = await currentOrgEmail();
  if (!receiving.isCurrent()) return { ok: false, reason: i18n("friends.modeChanged") };
  const denied = await (await import("./vaultShare.js")).shareAccessReason(p.allowEmail);
  if (!receiving.isCurrent()) return { ok: false, reason: i18n("friends.modeChanged") };
  if (denied) return { ok: false, reason: denied };
  const exist = doc.orgs.find((o) => o.name === p.name && o.joinUrl === p.joinUrl);
  const org = exist ?? createOrg({ name: p.name, brief: p.brief, joinUrl: p.joinUrl, ownerName: p.inviter || "邀请人", ownerEmail: "" });
  if (!org.members.some((m) => (email ? m.email === email : m.name === String(myName)))) {
    addOrgMember(org.id, String(myName), email, "member");
  }
  return { ok: true, orgId: org.id };
}

/** Organization record is the only source of its card. */
export function orgIdentityCard(org: Org) { return {id:org.id,name:org.name,brief:org.brief,joinUrl:org.joinUrl || org.shared?.shareUrl || "",updatedAt:org.updatedAt}; }
function changeOrg(id:string, change:(o:Org)=>Org):void {doc={...doc,orgs:doc.orgs.map(o=>o.id===id?{...change(o),updatedAt:Date.now()}:o)};commit();}
export function setOrgMemberRole(id:string,memberId:string,role:OrgRole):boolean {
 const org=doc.orgs.find(o=>o.id===id), m=org?.members.find(m=>m.id===memberId);
 if(!org||!m||(!["owner","member","guest"].includes(role)))return false;
 if(m.role==="owner"&&role!=="owner"&&org.members.filter(m=>m.role==="owner").length===1)return false;
 changeOrg(id,o=>({...o,members:o.members.map(m=>m.id===memberId?{...m,role}:m)}));return true;
}
export function saveOrgProject(id:string,input:Omit<OrgProject,"id"|"updatedAt"> & {id?:string}):void {
 if(!input.name.trim())return;
 const project:OrgProject={...input,id:input.id??newId("project."),name:input.name.trim().slice(0,120),description:input.description.slice(0,4000),updatedAt:Date.now()};
 changeOrg(id,o=>({...o,projects:[...(o.projects??[]).filter(p=>p.id!==project.id),project]}));
}
export function deleteOrgProject(id:string,projectId:string):void{changeOrg(id,o=>({...o,projects:(o.projects??[]).filter(p=>p.id!==projectId)}));}
export function saveOrgAnnouncement(id:string,input:Omit<OrgAnnouncement,"id"|"updatedAt"> & {id?:string}):void {
 if(!input.title.trim())return;
 const item:OrgAnnouncement={...input,id:input.id??newId("notice."),title:input.title.trim().slice(0,120),body:input.body.slice(0,10000),updatedAt:Date.now()};
 changeOrg(id,o=>({...o,announcements:[item,...(o.announcements??[]).filter(p=>p.id!==item.id)]}));
}
export function deleteOrgAnnouncement(id:string,noticeId:string):void{changeOrg(id,o=>({...o,announcements:(o.announcements??[]).filter(p=>p.id!==noticeId)}));}

/** Only a server-verified snapshot may replace the collaboration cache. */
export function cacheRemoteOrg(org: Org): void {
  const existing = doc.orgs.find(o => o.id === org.id);
  doc = { ...doc, orgs: existing ? doc.orgs.map(o => o.id === org.id ? org : o) : [org, ...doc.orgs] };
  commit();
}
export function markOrgRemote(id: string, collaboration: NonNullable<Org["collaboration"]>): void {
  doc = {...doc, orgs: doc.orgs.map(o => o.id === id ? {...o, collaboration} : o)};
  commit();
}
