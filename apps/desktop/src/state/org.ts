/**
 * 轻量组织（Phase 4 地基）：组织、成员、邀请口令。
 *
 * 口径（计划 §1/§6）：
 * - 不自建后端：组织首先是一个可分享的名片 + 成员清单；资源落在清华云盘/GitLab，路径后续由
 *   vaultCloud/orgCloud 填（cloudRepoId/cloudPath）。
 * - 邀请口令是「组织名片」的编码封装（ONORG1），接收方可先加入本地成员清单，再按 joinUrl
 *   去云盘/GitLab 加入真正的共享空间。
 */
import { useSyncExternalStore } from "react";
import { checksum } from "./vaultShare.js";

export type OrgRole = "owner" | "member" | "guest";

export interface OrgMember {
  id: string;
  name: string;
  role: OrgRole;
  joinedAt: number;
}

export interface Org {
  id: string;
  name: string;
  brief: string;
  /** 加入方式（GitLab 组织 / 云盘共享文件夹链接） */
  joinUrl: string;
  /** 云盘落点（后续由 orgCloud 填） */
  cloudRepoId: string;
  cloudPath: string;
  members: OrgMember[];
  /** 最近一次生成的邀请口令（仅提示） */
  lastInviteCode?: string;
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
    return { v: 1, orgs: p.orgs.filter((o): o is Org => !!o && typeof o.id === "string" && Array.isArray(o.members)) };
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

export function createOrg(input: { name: string; brief?: string; joinUrl?: string; ownerName?: string }): Org {
  const now = Date.now();
  const org: Org = {
    id: newId("org."),
    name: String(input.name ?? "").trim().slice(0, 60) || "未命名组织",
    brief: String(input.brief ?? "").trim().slice(0, 200),
    joinUrl: String(input.joinUrl ?? "").trim().slice(0, 300),
    cloudRepoId: "",
    cloudPath: "",
    members: [{ id: newId("mem."), name: String(input.ownerName ?? "我").slice(0, 40), role: "owner", joinedAt: now }],
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

export function addOrgMember(id: string, name: string, role: OrgRole = "member"): { ok: boolean; reason?: "duplicate" | "no-org" } {
  const org = doc.orgs.find((o) => o.id === id);
  if (!org) return { ok: false, reason: "no-org" };
  const n = String(name ?? "").trim().slice(0, 40);
  if (!n) return { ok: false, reason: "no-org" };
  if (org.members.some((m) => m.name === n)) return { ok: false, reason: "duplicate" };
  doc = {
    ...doc,
    orgs: doc.orgs.map((o) => (o.id === id ? { ...o, members: [...o.members, { id: newId("mem."), name: n, role, joinedAt: Date.now() }], updatedAt: Date.now() } : o)),
  };
  commit();
  return { ok: true };
}

export function removeOrgMember(id: string, memberId: string): void {
  doc = {
    ...doc,
    orgs: doc.orgs.map((o) => (o.id === id ? { ...o, members: o.members.filter((m) => m.id !== memberId), updatedAt: Date.now() } : o)),
  };
  commit();
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

export function orgInviteCode(org: Org, inviter = "我"): string {
  const payload: OrgInvitePayload = {
    v: 1, kind: "org-invite", orgId: org.id, name: org.name, brief: org.brief, joinUrl: org.joinUrl,
    inviter, issuedAt: Date.now(),
  };
  const json = JSON.stringify(payload);
  const code = `${ORG_CODE_PREFIX}.${toB64Url(new TextEncoder().encode(json))}.${checksum(json)}`;
  doc = { ...doc, orgs: doc.orgs.map((o) => (o.id === org.id ? { ...o, lastInviteCode: code, updatedAt: Date.now() } : o)) };
  commit();
  return code;
}

export function decodeOrgInvite(code: string): { ok: boolean; payload?: OrgInvitePayload; reason?: string } {
  const raw = String(code ?? "").trim();
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== ORG_CODE_PREFIX) return { ok: false, reason: "不是 OneTHU 组织邀请口令（应以 ONORG1. 开头）" };
  let json: string;
  try { json = new TextDecoder().decode(fromB64Url(parts[1]!)); } catch { return { ok: false, reason: "口令内容损坏" }; }
  if (checksum(json) !== parts[2]) return { ok: false, reason: "口令校验失败（可能复制不完整）" };
  try {
    const p = JSON.parse(json) as OrgInvitePayload;
    if (p?.v !== 1 || p.kind !== "org-invite") return { ok: false, reason: "口令版本不受支持" };
    return { ok: true, payload: p };
  } catch { return { ok: false, reason: "口令内容不是合法 JSON" }; }
}

/** 接受邀请：创建/合并本地组织，加入者为 member（不重复同名成员）。 */
export function acceptOrgInvite(code: string, myName = "我"): { ok: boolean; orgId?: string; reason?: string } {
  const dec = decodeOrgInvite(code);
  if (!dec.ok || !dec.payload) return { ok: false, reason: dec.reason ?? "口令无法解析" };
  const p = dec.payload;
  const exist = doc.orgs.find((o) => o.name === p.name && o.joinUrl === p.joinUrl);
  const org = exist ?? createOrg({ name: p.name, brief: p.brief, joinUrl: p.joinUrl, ownerName: p.inviter || "邀请人" });
  if (exist && !exist.members.some((m) => m.name === String(myName))) {
    addOrgMember(exist.id, String(myName), "member");
  }
  return { ok: true, orgId: org.id };
}
