/**
 * 分享口令台账（本地）。
 *
 * 为什么要有它：`box.lastShareCode` 只记「这个箱子最后一次的口令」，
 * 发出去的口令既没有列表，也没有「这条口令能取到什么」的快照——
 * 想撤销只能现场重新解码，用户根本看不到自己发过哪些、各自授权了什么。
 *
 * 边界：
 * - **只存台账**：口令原文、箱子名、授权范围摘要、云盘引用（撤销要用 shareToken）。
 * - 不复制箱子内容；`scope.titles` 只留前若干条标题做提示。
 * - 撤销动作仍走 `vaultShare.revokeShare`（云盘适配器），这里只负责记账。
 * - 全部本地持久化在 `onethu.vault.shares.v1`，最多保留 MAX_ENTRIES 条。
 */
import type { VaultBox, VaultItemType } from "./vault.js";
import { VAULT_TYPE_LABEL } from "./vault.js";
import type { VaultCloudRef, VaultSharePayload } from "./vaultShare.js";

const KEY = "onethu.vault.shares.v1";
const MAX_ENTRIES = 50;
const MAX_TITLES = 6;

export interface IssuedShare {
  id: string;
  /** 口令原文（短码 ON-…；旧版为 ONV1/ONV2 长口令） */
  code: string;
  boxId: string;
  boxName: string;
  issuedAt: number;
  /** 0/缺省 = 不过期 */
  expiresAt?: number;
  /** 授权范围快照：这条口令能取到的内容 */
  scope: { total: number; types: Partial<Record<VaultItemType, number>>; titles: string[] };
  /** 云盘引用（撤销用；旧版 inline 口令没有） */
  cloud?: VaultCloudRef;
  /** 口令名（发送方自己起的名字；缺省用箱子名展示） */
  label?: string;
  /** 限定接收邮箱（空 = 不限制） */
  allowEmail?: string;
  revokedAt?: number;
}

export type IssuedShareState = "active" | "revoked" | "expired";

interface LogDoc {
  v: 1;
  entries: IssuedShare[];
}

function load(): LogDoc {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error("empty");
    const p = JSON.parse(raw) as Partial<LogDoc>;
    if (p.v !== 1 || !Array.isArray(p.entries)) throw new Error("bad");
    return { v: 1, entries: p.entries.filter((e): e is IssuedShare => !!e && typeof e.code === "string") };
  } catch {
    return { v: 1, entries: [] };
  }
}

let doc: LogDoc = load();
const listeners = new Set<() => void>();

function commit(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    /* 配额满：内存态仍可用 */
  }
  listeners.forEach((f) => f());
}

export function subscribeIssuedShares(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function issuedSharesSnapshot(): LogDoc {
  return doc;
}

export function issuedShareState(e: IssuedShare): IssuedShareState {
  if (e.revokedAt) return "revoked";
  if (e.expiresAt && Date.now() > e.expiresAt) return "expired";
  return "active";
}

/** 授权范围一行字：`3 项 · 文件 2、文字 1` */
export function scopeLabel(e: IssuedShare): string {
  const parts = Object.entries(e.scope.types)
    .map(([k, n]) => `${VAULT_TYPE_LABEL[k as VaultItemType] ?? k} ${n}`)
    .join("、");
  return `${e.scope.total} 项${parts ? " · " + parts : ""}`;
}

function scopeOf(box: VaultBox): IssuedShare["scope"] {
  const types: Partial<Record<VaultItemType, number>> = {};
  for (const it of box.items) types[it.type] = (types[it.type] ?? 0) + 1;
  return {
    total: box.items.length,
    types,
    titles: box.items.slice(0, MAX_TITLES).map((it) => it.title),
  };
}

/** 记账（同一口令只留一条：复用旧码时不重复记）。 */
export function recordIssuedShare(box: VaultBox, code: string, payload: VaultSharePayload): void {
  if (doc.entries.some((e) => e.code === code)) return;
  const entry: IssuedShare = {
    id: "sh." + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    code,
    boxId: box.id,
    boxName: box.name,
    issuedAt: Date.now(),
    ...(payload.expiresAt ?? payload.cloud?.expiresAt
      ? { expiresAt: payload.expiresAt ?? payload.cloud?.expiresAt }
      : {}),
    scope: scopeOf(box),
    ...(payload.cloud ? { cloud: payload.cloud } : {}),
    ...(payload.label ? { label: payload.label } : {}),
    ...(payload.allowEmail ? { allowEmail: payload.allowEmail } : {}),
  };
  doc = { v: 1, entries: [entry, ...doc.entries].slice(0, MAX_ENTRIES) };
  commit();
}

/** 口令改名 / 限定邮箱后就地更新台账（同一条口令只有一条记录）。 */
export function updateIssuedShareMeta(code: string, patch: { label?: string; allowEmail?: string }): void {
  doc = {
    v: 1,
    entries: doc.entries.map((e) => {
      if (e.code !== code) return e;
      const next: IssuedShare = { ...e };
      if (patch.label !== undefined) {
        if (patch.label) next.label = patch.label;
        else delete next.label;
      }
      if (patch.allowEmail !== undefined) {
        if (patch.allowEmail) next.allowEmail = patch.allowEmail;
        else delete next.allowEmail;
      }
      return next;
    }),
  };
  commit();
}

/** 台账展示名：口令名优先，没起名就用箱子名。 */
export function issuedShareTitle(e: IssuedShare): string {
  return e.label?.trim() || e.boxName;
}

export function markIssuedShareRevoked(id: string): void {
  doc = { v: 1, entries: doc.entries.map((e) => (e.id === id ? { ...e, revokedAt: Date.now() } : e)) };
  commit();
}

/** 只删台账记录，不动云盘（已撤销/已过期的清理用）。 */
export function forgetIssuedShare(id: string): void {
  doc = { v: 1, entries: doc.entries.filter((e) => e.id !== id) };
  commit();
}

/** 台账里这条口令对应的可撤销 payload。 */
export function payloadOfIssuedShare(e: IssuedShare): VaultSharePayload {
  return { v: 1, kind: "vault-share", issuedAt: e.issuedAt, name: e.boxName, ...(e.cloud ? { cloud: e.cloud } : {}) };
}

/** Rotation is recorded only after the old server share has been revoked. */
export function replaceIssuedShareCode(oldCode:string,code:string,payload:VaultSharePayload):void{
 const old=doc.entries.find(e=>e.code===oldCode);if(!old)return;
 const entry={...old,id:"sh."+crypto.randomUUID(),code,issuedAt:Date.now(),cloud:payload.cloud,label:payload.label,allowEmail:payload.allowEmail,expiresAt:payload.cloud?.expiresAt,revokedAt:undefined};
 doc={v:1,entries:[entry,...doc.entries.map(e=>e.code===oldCode?{...e,revokedAt:Date.now()}:e)].slice(0,MAX_ENTRIES)};commit();
}
