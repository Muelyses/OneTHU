/** Causal per-record state. Compatible changes merge; genuinely competing fields
 * await a choice. Device-owned files avoid shared-file read/modify/write races. */
import type { CardDoc, ContactCard, OrgCard, PersonalCard } from "./nameCard.js";
import type { Org, OrgDoc } from "./org.js";

export type ProfileValue = PersonalCard | ContactCard | OrgCard | Org;
export interface ProfileRecord { at: number; by: string; value: ProfileValue | null; seen?: Record<string, number>; base?: ProfileValue | null; parent?: {by: string; at: number} }
export interface ProfileConflict { key: string; local: ProfileRecord; remote: ProfileRecord }
export const profileConflictId = (c: ProfileConflict): string => `${c.key}|${c.local.by}|${c.local.at}|${c.remote.by}|${c.remote.at}`;
export interface ProfileState { v: 1; owner: string; device: string; clock: number; records: Record<string, ProfileRecord> }
export const PROFILE_MAX_BYTES = 12 * 1024 * 1024;
export function newProfileState(owner: string, device: string): ProfileState {
  return { v: 1, owner: owner.toLowerCase(), device, clock: 0, records: {} };
}
function object(v: unknown): v is Record<string, any> { return !!v && typeof v === "object" && !Array.isArray(v); }
function personal(v: unknown): v is PersonalCard {
  return object(v) && ["name", "avatar", "website", "social", "phone", "bio"].every(k => typeof v[k] === "string")
    && Number.isFinite(v.updatedAt) && (!v.cover || (object(v.cover) && typeof v.cover.src === "string"));
}
function orgCard(v: unknown): v is OrgCard {
  return object(v) && ["id","name","brief","joinUrl"].every(k=>typeof v[k] === "string") && Number.isFinite(v.updatedAt);
}
function validValue(key: string, v: unknown): v is ProfileValue {
  if (key === "personal") return personal(v);
  if (!object(v) || typeof v.id !== "string" || key.slice(key.indexOf(":") + 1) !== v.id || typeof v.name !== "string") return false;
  if (key.startsWith("contact:")) return typeof v.note === "string" && Number.isFinite(v.addedAt)
    && (v.kind === "personal" ? personal(v.card) : v.kind === "organization" && orgCard(v.card));
  if (key.startsWith("cardorg:")) return orgCard(v);
  return key.startsWith("org:") && typeof v.brief === "string" && typeof v.joinUrl === "string"
    && typeof v.cloudRepoId === "string" && typeof v.cloudPath === "string" && Number.isFinite(v.updatedAt)
    && Number.isFinite(v.createdAt)
    && Array.isArray(v.members) && v.members.every((m: unknown) => object(m) && typeof m.id === "string" && typeof m.name === "string" && typeof m.email === "string" && ["owner","member","guest"].includes(m.role) && Number.isFinite(m.joinedAt))
    && (v.libraries === undefined || Array.isArray(v.libraries) && v.libraries.every((r: unknown)=>object(r) && typeof r.repoId === "string" && typeof r.name === "string"))
    && (v.gitlabRepos === undefined || Array.isArray(v.gitlabRepos) && v.gitlabRepos.every((r: unknown)=>object(r) && Number.isSafeInteger(r.id) && typeof r.name === "string" && typeof r.path === "string"))
    && (v.projects === undefined || Array.isArray(v.projects) && v.projects.every((r: unknown)=>object(r) && ["id","name","description","owner"].every(k=>typeof r[k] === "string") && ["planned","active","done"].includes(r.status)))
    && (v.announcements === undefined || Array.isArray(v.announcements) && v.announcements.every((r: unknown)=>object(r) && ["id","title","body"].every(k=>typeof r[k] === "string") && typeof r.pinned === "boolean"))
    && (v.collaboration === undefined || object(v.collaboration) && Number.isSafeInteger(v.collaboration.groupId) && Number.isSafeInteger(v.collaboration.projectId) && typeof v.collaboration.adminBranch === "string" && typeof v.collaboration.contentBranch === "string");
}
export function parseProfileState(text: string, owner: string): ProfileState {
  if (new TextEncoder().encode(text).length > PROFILE_MAX_BYTES) throw new Error("Profile document too large");
  const v: unknown = JSON.parse(text);
  if (!object(v) || v.v !== 1 || v.owner !== owner.toLowerCase() || typeof v.device !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(v.device)
    || !Number.isSafeInteger(v.clock) || v.clock < 0 || !object(v.records) || Object.keys(v.records).length > 10000) throw new Error("Invalid profile document");
  for (const [key, r] of Object.entries(v.records)) {
    if (!/^(personal|(?:contact|cardorg|org):[a-zA-Z0-9._:-]{1,160})$/.test(key) || !object(r)
      || !Number.isSafeInteger(r.at) || r.at < 1 || r.at > v.clock || typeof r.by !== "string"
      || !/^[a-zA-Z0-9-]{8,80}$/.test(r.by) || (r.value !== null && !validValue(key, r.value))
      || (r.base !== undefined && r.base !== null && !validValue(key, r.base))
      || (r.parent !== undefined && (!object(r.parent) || typeof r.parent.by !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(r.parent.by)
        || !Number.isSafeInteger(r.parent.at) || r.parent.at < 1 || r.parent.at >= r.at))
      || (r.seen !== undefined && (!object(r.seen) || Object.keys(r.seen).length > 100
        || Object.entries(r.seen).some(([by, at]) => !/^[a-zA-Z0-9-]{8,80}$/.test(by) || !Number.isSafeInteger(at) || Number(at) < 0 || Number(at) >= r.at)))) throw new Error("Invalid profile record");
  }
  return v as ProfileState;
}
export function flattenProfile(cards: CardDoc, orgs: OrgDoc): Record<string, ProfileValue> {
  return Object.fromEntries([
    ["personal", cards.personal],
    ...cards.orgs.map(v => ["cardorg:" + v.id, v]),
    ...cards.contacts.map(v => ["contact:" + v.id, v]),
    ...orgs.orgs.map(v => ["org:" + v.id, { ...v, ...(v.collaboration ? { collaboration: {
      groupId: v.collaboration.groupId, projectId: v.collaboration.projectId,
      adminBranch: v.collaboration.adminBranch, contentBranch: v.collaboration.contentBranch,
      status: "initializing" as const,
    } } : {}) }]),
  ]);
}
export function captureProfile(state: ProfileState, current: Record<string, ProfileValue>, previous?: Record<string, ProfileValue>): ProfileState {
  const next: ProfileState = { ...state, records: { ...state.records } };
  for (const key of new Set([...Object.keys(current), ...Object.keys(previous ?? {})])) {
    const value = current[key] ?? null;
    const semantic = (v: unknown) => JSON.stringify(v, (k, item) => ["updatedAt", "lastReadAt"].includes(k) ? undefined : item);
    if (previous && semantic(value) === semantic(previous[key] ?? null)) continue;
    // A brand new device's blank card is not an edit and must not erase a real card.
    if (!previous && key === "personal" && value && !["name", "avatar", "website", "social", "phone", "bio", "cover"].some(k => Boolean((value as any)[k]))) continue;
    if (!previous && !value) continue;
    const rawTime = value && ("updatedAt" in value ? value.updatedAt : value.addedAt);
    const at = previous ? Math.max(Date.now(), next.clock + 1) : Math.max(1, Number(rawTime) || 1);
    next.clock = Math.max(next.clock, at);
    const old = state.records[key];
    next.records[key] = { at, by: state.device, value: value ? JSON.parse(JSON.stringify(value)) : null,
      ...(old ? { seen: { ...old.seen, [old.by]: old.at }, ...(value ? {
        base: old.by === state.device && old.base !== undefined ? old.base : old.value,
        parent: old.by === state.device && old.base !== undefined && old.parent ? old.parent : {by:old.by,at:old.at},
      } : {}) } : {}) };
  }
  return next;
}
export function profileConflicts(local: ProfileState, remote: ProfileState): ProfileConflict[] {
  if (local.owner !== remote.owner) throw new Error("Profile account mismatch");
  return Object.entries(remote.records).flatMap(([key, incoming]) => {
    const old = local.records[key];
    if (!old || old.by === incoming.by || JSON.stringify(old.value) === JSON.stringify(incoming.value)
      || (old.seen?.[incoming.by] ?? 0) >= incoming.at || (incoming.seen?.[old.by] ?? 0) >= old.at) return [];
    return [{ key, local: old, remote: incoming }];
  });
}
function mergeValue(local: any, remote: any, base: any, preference: "local" | "remote" | "merge" = "merge"): any {
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (equal(local, base)) return remote;
  if (equal(remote, base) || equal(local, remote)) return local;
  if (base === undefined && local === "") return remote;
  if (base === undefined && remote === "") return local;
  // A selected merge keeps a record edited on one side rather than deleting it.
  if (local == null || remote == null) return preference === "merge" ? local ?? remote : preference === "local" ? local : remote;
  if (Array.isArray(local) && Array.isArray(remote) && [...local, ...remote].every(v => object(v) && typeof (v.id ?? v.repoId) !== "undefined")) {
    const map = (values: any[]) => Object.fromEntries(values.map(v => [v.id ?? v.repoId, v]));
    const l = map(local), r = map(remote), b = map(Array.isArray(base) ? base : []);
    return [...new Set([...Object.keys(l), ...Object.keys(r), ...Object.keys(b)])].map(k => mergeValue(l[k], r[k], b[k], preference)).filter(v => v !== undefined);
  }
  if (Array.isArray(local) && Array.isArray(remote) && [...local,...remote].every(v=>typeof v === "string" || typeof v === "number")) {
    const original = new Set(Array.isArray(base) ? base : []);
    return [...new Set([...local,...remote])].filter(v=>!original.has(v)||(local.includes(v)&&remote.includes(v)));
  }
  if (object(local) && object(remote)) return Object.fromEntries([...new Set([...Object.keys(local), ...Object.keys(remote)])]
    .map(k => [k, mergeValue(local[k], remote[k], base?.[k], preference)]).filter(([,v]) => v !== undefined));
  return preference === "remote" ? remote : local;
}
function commonBase(conflict: ProfileConflict): ProfileValue | null | undefined {
  const candidates = [
    {record:conflict.local,other:conflict.remote}, {record:conflict.remote,other:conflict.local},
  ].filter(({record,other})=>record.parent && (other.seen?.[record.parent.by]??0)>=record.parent.at)
    .sort((a,b)=>b.record.parent!.at-a.record.parent!.at);
  return candidates.length ? candidates[0]!.record.base : JSON.stringify(conflict.local.base) === JSON.stringify(conflict.remote.base) ? conflict.local.base : undefined;
}
export function mergedProfileConflict(conflict: ProfileConflict): ProfileValue | null {
  return resolvedProfileValue(conflict, "merge");
}
export function resolvedProfileValue(conflict: ProfileConflict, choice: "local" | "remote" | "merge"): ProfileValue | null {
  return mergeValue(conflict.local.value, conflict.remote.value, commonBase(conflict), choice);
}
/** Ignore bookkeeping timestamps. Only incompatible user fields need a prompt;
 * independent object fields and id-keyed array changes merge automatically. */
export function profileConflictPaths(conflict: ProfileConflict): string[] {
  const base = commonBase(conflict);
  function walk(l: any, r: any, b: any, path: string): string[] {
    const same = (a: unknown, c: unknown) => JSON.stringify(a) === JSON.stringify(c);
    if (same(l,r) || same(l,b) || same(r,b) || /(?:^|\.)(?:updatedAt|addedAt|lastReadAt|createdAt)$/.test(path)) return [];
    if (l == null || r == null) return [path];
    if (Array.isArray(l) && Array.isArray(r) && [...l,...r].every(v=>object(v) && (v.id ?? v.repoId) !== undefined)) {
      const map = (values: any[]) => Object.fromEntries(values.map(v=>[v.id??v.repoId,v]));
      const lm=map(l),rm=map(r),bm=map(Array.isArray(b)?b:[]);
      return [...new Set([...Object.keys(lm),...Object.keys(rm),...Object.keys(bm)])].flatMap(k=>walk(lm[k],rm[k],bm[k],path+"."+k));
    }
    if (Array.isArray(l) && Array.isArray(r) && [...l,...r].every(v=>typeof v === "string" || typeof v === "number")) return [];
    if (object(l) && object(r)) return [...new Set([...Object.keys(l),...Object.keys(r)])].flatMap(k=>walk(l[k],r[k],b?.[k],path+"."+k));
    // A legacy device without a shared baseline may still safely fill an empty field.
    if (b === undefined && (l === "" || r === "")) return [];
    return [path];
  }
  return walk(conflict.local.value,conflict.remote.value,base,conflict.key);
}
export function resolveProfileConflict(state: ProfileState, conflict: ProfileConflict, choice: "local" | "remote" | "merge"): ProfileState {
  const at = Math.max(Date.now(), state.clock + 1, conflict.local.at + 1, conflict.remote.at + 1);
  const seen = { ...conflict.local.seen };
  for (const [by, version] of Object.entries(conflict.remote.seen ?? {})) seen[by] = Math.max(seen[by] ?? 0, version);
  for (const row of [conflict.local, conflict.remote]) seen[row.by] = Math.max(seen[row.by] ?? 0, row.at);
  const value = resolvedProfileValue(conflict, choice);
  return { ...state, clock: at, records: { ...state.records, [conflict.key]: { at, by: state.device, seen, value,
    ...(value ? {base:conflict.local.value,parent:{by:conflict.local.by,at:conflict.local.at}} : {}),
  } } };
}
export function mergeProfile(local: ProfileState, remote: ProfileState): ProfileState {
  if (local.owner !== remote.owner) throw new Error("Profile account mismatch");
  const next = { ...local, clock: Math.max(local.clock, remote.clock), records: { ...local.records } };
  for (const [key, incoming] of Object.entries(remote.records)) {
    const old = next.records[key];
    if (!old || incoming.at > old.at || (incoming.at === old.at
      && ((incoming.value === null && old.value !== null) || ((incoming.value === null) === (old.value === null) && incoming.by > old.by)))) next.records[key] = incoming;
  }
  return next;
}
export function materializeProfile(state: ProfileState, fallback: PersonalCard): { cards: CardDoc; orgs: OrgDoc } {
  const cards: CardDoc = { v: 1, personal: fallback, contacts: [], orgs: [] };
  const orgs: OrgDoc = { v: 1, orgs: [] };
  for (const [key, record] of Object.entries(state.records)) {
    if (!record.value) continue;
    if (key === "personal") cards.personal = record.value as PersonalCard;
    else if (key.startsWith("contact:")) cards.contacts.push(record.value as ContactCard);
    else if (key.startsWith("cardorg:")) cards.orgs.push(record.value as OrgCard);
    else if (key.startsWith("org:")) orgs.orgs.push(record.value as Org);
  }
  cards.contacts.sort((a, b) => b.addedAt - a.addedAt || a.id.localeCompare(b.id));
  orgs.orgs.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  return { cards, orgs };
}
