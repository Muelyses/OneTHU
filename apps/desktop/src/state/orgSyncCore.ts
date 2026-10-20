import { t as i18n } from "../i18n/index.js";
/** Pure, testable collaboration protocol. GitLab is the authority; browser storage is a cache. */
import type { OrgAnnouncement, OrgLibrary, OrgProject, OrgRepo, OrgRole } from "./org.js";

export interface OrgRemoteRef { groupId: number; projectId: number; adminBranch: string; contentBranch: string }
export interface OrgRemoteBinding { userId: number; username: string; name: string; email: string }
export interface OrgPermissionIntent {
  id: string; label: string; createdAt: number;
  target?: OrgRemoteBinding & { role: OrgRole };
  removeUserId?: number;
  bindings: OrgRemoteBinding[];
  previousBindings: OrgRemoteBinding[];
  removedLibraries?: OrgLibrary[]; removedRepos?: OrgRepo[];
  errors?: string[];
}
export interface OrgRemoteAdmin {
  v: 1; kind: "onethu-org-admin"; orgId: string; name: string; brief: string; joinUrl: string;
  legacyMembers?: Array<{id:string;name:string;email:string;role:OrgRole}>;
  bindings: OrgRemoteBinding[]; libraries: OrgLibrary[]; gitlabRepos: OrgRepo[];
  pending?: OrgPermissionIntent;
  permissionsVerified?: 1;
}
export interface OrgRemoteContent { v: 1; kind: "onethu-org-content"; projects: OrgProject[]; announcements: OrgAnnouncement[] }
export interface OrgRemoteMember { id: number; username: string; name: string; access_level: number }
export interface OrgRemoteFile<T> { value: T; revision: string }
export interface OrgRemoteSnapshot { ref: OrgRemoteRef; admin: OrgRemoteFile<OrgRemoteAdmin>; content: OrgRemoteFile<OrgRemoteContent>; members: OrgRemoteMember[]; me: OrgRemoteMember; group?: {id:number;name:string;path:string;webUrl:string} }
export const ADMIN_FILE = "organization.json";
export const CONTENT_FILE = "collaboration.json";
export const roleLevel = (role: OrgRole): number => role === "owner" ? 50 : role === "member" ? 30 : 20;
export const levelRole = (level: number): OrgRole => level >= 50 ? "owner" : level >= 30 ? "member" : "guest";
export const missingRemote = (e: unknown): boolean => /(?:\b404\b|404 Not Found)/i.test(e instanceof Error ? e.message : String(e));
export class OrgConflictError extends Error { constructor() { super(i18n("state.orgsynccore.conflict")); this.name = "OrgConflictError"; } }
export const errorText = (e: unknown): string => e instanceof Error ? e.message : String(e);

export function decodeOrgFile<T>(file: {content: string; encoding: string; last_commit_id: string; size: number}, kind: string): OrgRemoteFile<T> {
  if (file.size > 2_000_000 || !file.last_commit_id || file.encoding !== "base64") throw new Error(i18n("state.orgsynccore.9715a0f9152f"));
  const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, "")), c => c.charCodeAt(0));
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (value?.v !== 1 || value.kind !== kind) throw new Error(i18n("state.orgsynccore.4368a8b9ff92"));
  if (kind === "onethu-org-admin" && (!Array.isArray(value.bindings) || !Array.isArray(value.libraries) || !Array.isArray(value.gitlabRepos) || typeof value.orgId !== "string")) throw new Error(i18n("state.orgsynccore.716bc0e42213"));
  if (kind === "onethu-org-content" && (!Array.isArray(value.projects) || !Array.isArray(value.announcements))) throw new Error(i18n("state.orgsynccore.181c794c590b"));
  return { value, revision: file.last_commit_id };
}

/** Check the object the editor started from, then CAS the whole file; never silently overwrite. */
export function replaceSharedItem<T extends {id: string}>(items: T[], before: T | undefined, after: T | undefined): T[] {
  const id = before?.id ?? after?.id;
  if (!id) throw new Error(i18n("state.orgsynccore.b150bcce1fc7"));
  const remote = items.find(item => item.id === id);
  if (JSON.stringify(remote) !== JSON.stringify(before)) throw new OrgConflictError();
  return after ? [...items.filter(item => item.id !== id), after] : items.filter(item => item.id !== id);
}

export interface OrgPermissionGateway {
  project(id: number): Promise<{visibility: string; namespace: {id: number}; shared_with_groups?: Array<{group_id: number}>}>;
  members(kind: "groups" | "projects", id: number, inherited?: boolean): Promise<OrgRemoteMember[]>;
  setMember(kind: "groups" | "projects", id: number, userId: number, level: number, exists: boolean): Promise<unknown>;
  removeMember(kind: "groups" | "projects", id: number, userId: number): Promise<unknown>;
  listCloud(repoId: string): Promise<Array<{email: string; permission: string}>>;
  auditCloud(repoId:string): Promise<void>;
  cloudOwner(repoId: string): Promise<string>;
  setCloud(repoId: string, email: string, permission: "r" | "rw"): Promise<unknown>;
  removeCloud(repoId: string, email: string): Promise<unknown>;
}

/** Idempotent desired-state permission transition, including inherited grant verification. */
export async function setGitPermission(api: OrgPermissionGateway, kind: "groups" | "projects", id: number, userId: number, desired: number | null): Promise<void> {
  const matches = (level?: number): boolean => level === desired || (kind === "projects" && desired === 50 && level === 40);
  const direct = (await api.members(kind, id, false)).find(m => m.id === userId);
  const effectiveBefore = (await api.members(kind, id, true)).find(m => m.id === userId);
  if (desired === null) {
    if (direct) await api.removeMember(kind, id, userId);
  } else if (!matches(effectiveBefore?.access_level) || (direct && direct.access_level > desired)) {
    // A project's inherited group membership already grants the right role; avoid redundant grants.
    if (direct && direct.access_level > desired) {
      await api.removeMember(kind, id, userId);
      const inherited = (await api.members(kind, id, true)).find(m => m.id === userId);
      if (!inherited || inherited.access_level < desired) await api.setMember(kind, id, userId, Math.min(desired, kind === "projects" ? 40 : 50), false);
    } else if (!effectiveBefore || effectiveBefore.access_level < desired || direct) {
      await api.setMember(kind, id, userId, Math.min(desired, kind === "projects" ? 40 : 50), Boolean(direct));
    }
  }
  const actual = (await api.members(kind, id, true)).find(m => m.id === userId);
  if (desired === null ? Boolean(actual) : !matches(actual?.access_level)) {
    throw new Error(i18n("state.orgsynccore.79361f44af76", { value: String(kind === "groups" ? i18n("state.orgsynccore.gitlabGroup") : i18n("state.orgsynccore.gitlabProject")), id: String(id) }));
  }
}

/** Managed resources must not have a separate public, group, or unknown direct grant. */
export async function auditOrgResources(api: OrgPermissionGateway, snapshot: OrgRemoteSnapshot, intent: OrgPermissionIntent): Promise<void> {
  const config = snapshot.admin.value;
  for (const repoId of new Set([...config.libraries,...(intent.removedLibraries??[])].map(lib=>lib.repoId))) await api.auditCloud(repoId);
  const known = new Set([...snapshot.members.map(m=>m.id),...intent.previousBindings.map(b=>b.userId),...intent.bindings.map(b=>b.userId)]);
  for (const id of new Set([...config.gitlabRepos,...(intent.removedRepos??[])].map(repo=>repo.id))) {
    if (id === snapshot.ref.projectId) throw new Error(i18n("state.orgsynccore.3ecab27b438e"));
    const project = await api.project(id);
    if (project.visibility !== "private" || project.namespace.id !== snapshot.ref.groupId) throw new Error(i18n("state.orgsynccore.26e81e5f3e41", { id: String(id) }));
    if (project.shared_with_groups?.length) throw new Error(i18n("state.orgsynccore.75a0431ba7fe", { id: String(id) }));
    if ((await api.members("projects",id,false)).some(m=>!known.has(m.id))) throw new Error(i18n("state.orgsynccore.35d481d1c9b2", { id: String(id) }));
  }
}

/** Called only after the permission intent was committed to the protected admin branch. */
export async function applyPermissionIntent(api: OrgPermissionGateway, snapshot: OrgRemoteSnapshot, intent: OrgPermissionIntent): Promise<string[]> {
  const {ref, admin} = snapshot;
  const errors: string[] = [];
  const attempt = async (label: string, action: () => Promise<unknown>) => { try { await action(); } catch (e) { errors.push(`${label}：${errorText(e)}`); } };
  const acting = (await api.members("groups", ref.groupId, true)).find(m => m.id === snapshot.me.id);
  if (!acting || acting.access_level < 50) throw new Error(i18n("state.orgsynccore.dffb811b78bd"));
  await auditOrgResources(api, snapshot, intent);
  const membersBefore = await api.members("groups", ref.groupId, true);
  const changingId = intent.removeUserId ?? intent.target?.userId;
  const old = membersBefore.find(m => m.id === changingId);
  if (old?.access_level === 50 && (intent.removeUserId || intent.target?.role !== "owner") && membersBefore.filter(m => m.access_level === 50).length <= 1) throw new Error(i18n("state.orgsynccore.15f11e1c75da"));
  if (changingId === snapshot.me.id && (intent.removeUserId || intent.target?.role !== "owner")) throw new Error(i18n("state.orgsynccore.8e43c3815f47"));
  const changedBinding = intent.previousBindings.find(b=>b.userId===changingId);
  if (changedBinding?.email && (intent.removeUserId || intent.target?.role === "guest" || intent.target?.email !== changedBinding.email)) {
    for (const lib of admin.value.libraries) if ((await api.cloudOwner(lib.repoId)).toLowerCase() === changedBinding.email) throw new Error(i18n("state.orgsynccore.34320f02cd8e", { name: String(lib.name) }));
  }
  if (intent.removeUserId) await attempt(i18n("state.orgsynccore.removeMember"), () => setGitPermission(api, "groups", ref.groupId, intent.removeUserId!, null));
  if (intent.target) await attempt(i18n("state.orgsynccore.updateMember"), () => setGitPermission(api, "groups", ref.groupId, intent.target!.userId, roleLevel(intent.target!.role)));
  if (errors.length) return errors; // No secondary grants when the authoritative membership change failed.
  // Detached resources must stop carrying grants that this organization managed.
  for (const lib of intent.removedLibraries ?? []) for (const binding of intent.previousBindings) {
    if (!binding.email) continue;
    await attempt(i18n("state.orgsynccore.detachLibrary", {name:lib.name,email:binding.email}), async () => {
      if ((await api.cloudOwner(lib.repoId)).toLowerCase() === binding.email) return; // intrinsic ownership is not an org grant
      if ((await api.listCloud(lib.repoId)).some(s=>s.email===binding.email)) await api.removeCloud(lib.repoId,binding.email);
      if ((await api.listCloud(lib.repoId)).some(s=>s.email===binding.email)) throw new Error(i18n("state.orgsynccore.22d16e7c98ba"));
    });
  }
  for (const repo of intent.removedRepos ?? []) for (const binding of intent.previousBindings) {
    await attempt(i18n("state.orgsynccore.detachProject", {name:repo.name,username:binding.username}), async () => {
      const direct = (await api.members("projects",repo.id,false)).find(m=>m.id===binding.userId);
      if (direct) await api.removeMember("projects",repo.id,binding.userId);
      if ((await api.members("projects",repo.id,false)).some(m=>m.id===binding.userId)) throw new Error(i18n("state.orgsynccore.f4efde7b447c"));
      // Group-inherited access belongs to the group itself, not this resource link.
    });
  }
  const members = await api.members("groups", ref.groupId, true);
  const active = intent.bindings.filter(b => members.some(m => m.id === b.userId));
  const removed = intent.previousBindings.filter(b => !active.some(n => n.userId === b.userId && n.email === b.email));
  // Revoke old email first, including changed-email transitions. Never claim a partial transition succeeded.
  for (const lib of admin.value.libraries) {
    for (const binding of removed) if (binding.email && !active.some(b => b.email === binding.email)) {
      await attempt(i18n("state.orgsynccore.revokeCloud", {name:lib.name,email:binding.email}), async () => {
        if ((await api.cloudOwner(lib.repoId)).toLowerCase() === binding.email) throw new Error(i18n("state.orgsynccore.d2a3a9ac759a"));
        if ((await api.listCloud(lib.repoId)).some(s => s.email === binding.email)) await api.removeCloud(lib.repoId, binding.email);
        if ((await api.listCloud(lib.repoId)).some(s => s.email === binding.email)) throw new Error(i18n("state.orgsynccore.9eb8904e9896"));
      });
    }
  }
  // Every independent revocation/reduction is attempted even if another service is unavailable.
  const allIds = new Set([...intent.previousBindings.map(b=>b.userId), ...intent.bindings.map(b=>b.userId), ...members.map(m=>m.id)]);
  for (const repo of admin.value.gitlabRepos) for (const userId of allIds) {
    const member = members.find(m=>m.id===userId);
    await attempt(i18n("state.orgsynccore.revokeProject", {name:repo.name,userId}), async () => {
      const actual = (await api.members("projects",repo.id,true)).find(m=>m.id===userId);
      if (actual && (!member || actual.access_level > Math.min(member.access_level,40))) await setGitPermission(api,"projects",repo.id,userId,member ? member.access_level : null);
    });
  }
  for (const lib of admin.value.libraries) for (const binding of active) {
    const member = members.find(m=>m.id===binding.userId)!;
    if (binding.email && member.access_level < 30) await attempt(i18n("state.orgsynccore.reduceCloud", {name:lib.name,email:binding.email}), async () => {
      const existing = (await api.listCloud(lib.repoId)).find(s=>s.email===binding.email);
      if (existing && existing.permission !== "r") {
        await api.setCloud(lib.repoId,binding.email,"r");
        if ((await api.listCloud(lib.repoId)).find(s=>s.email===binding.email)?.permission !== "r") throw new Error(i18n("state.orgsynccore.13447b8f6ab6"));
      }
    });
  }
  for (const member of members) if (!intent.bindings.some(b=>b.userId===member.id && b.email) && admin.value.libraries.length) errors.push(i18n("state.orgsynccore.missingEmail", {username:member.username}));
  if (errors.length) return errors; // Failed revocation blocks every new grant, after all reductions ran.
  for (const lib of admin.value.libraries) {
    for (const binding of active) {
      const member = members.find(m => m.id === binding.userId)!;
      if (!binding.email) { errors.push(i18n("state.orgsynccore.libraryMissingEmail", {name:lib.name,username:binding.username})); continue; }
      const permission = member.access_level >= 30 ? "rw" : "r";
      await attempt(i18n("state.orgsynccore.grantCloud", {name:lib.name,email:binding.email}), async () => {
        if ((await api.cloudOwner(lib.repoId)).toLowerCase() === binding.email) {
          if (permission !== "rw") throw new Error(i18n("state.orgsynccore.5c00ac7e88bb"));
          return;
        }
        if ((await api.listCloud(lib.repoId)).find(s => s.email === binding.email)?.permission !== permission) await api.setCloud(lib.repoId, binding.email, permission);
        if ((await api.listCloud(lib.repoId)).find(s => s.email === binding.email)?.permission !== permission) throw new Error(i18n("state.orgsynccore.a6f0f050b88e"));
      });
    }
  }
  for (const repo of admin.value.gitlabRepos) for (const userId of allIds) {
    const member = members.find(m => m.id === userId);
    await attempt(i18n("state.orgsynccore.verifyProject", {name:repo.name,userId}), () => setGitPermission(api, "projects", repo.id, userId, member ? member.access_level : null));
  }
  return errors;
}
