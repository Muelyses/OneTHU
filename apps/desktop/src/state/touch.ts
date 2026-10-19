/**
 * 「碰一碰」分享组合（Phase 5 地基，当前用口令/二维码代替 NFC）：
 * 发出者可选：当前暂存箱口令 + 个人名片 + 组织名片（邀请）三者任意组合；
 * 后两者较长时统一编码进一个 ONTOUCH1 口令。NFC 落地后 NDEF 只带这个短口令。
 */
import { publishExchangeCode, resolveExchangeCode } from "./cloudExchange.js";
import { addContact, type OrgCard, type PersonalCard } from "./nameCard.js";
import { acceptOrgInvite } from "./org.js";
import { importShareCodeAsCurrent, mintShareCode, checksum } from "./vaultShare.js";
import { activeVault } from "./vault.js";

export const TOUCH_PREFIX = "ONTOUCH1";

export interface TouchPayload {
  v: 1;
  kind: "onethu-touch";
  issuedAt: number;
  from?: string;
  /** 当前暂存箱的 ONV1/ONV2 口令（可为空） */
  vaultCode?: string;
  vaultName?: string;
  personal?: PersonalCard;
  /** ONORG1 组织邀请口令 */
  orgCode?: string;
  orgName?: string;
}

export interface TouchOptions {
  from?: string;
  withVault: boolean;
  withPersonal: boolean;
  withOrgId?: string;
}

export interface TouchOrgBrief {
  id: string;
  name: string;
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

export function encodeTouch(p: TouchPayload): string {
  const json = JSON.stringify(p);
  return `${TOUCH_PREFIX}.${toB64Url(new TextEncoder().encode(json))}.${checksum(json)}`;
}

export function decodeTouch(code: string): { ok: boolean; payload?: TouchPayload; reason?: string } {
  const raw = String(code ?? "").trim();
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== TOUCH_PREFIX) return { ok: false, reason: "不是 OneTHU 碰一碰口令（应以 ONTOUCH1. 开头）" };
  let json: string;
  try { json = new TextDecoder().decode(fromB64Url(parts[1]!)); } catch { return { ok: false, reason: "口令内容损坏" }; }
  if (checksum(json) !== parts[2]) return { ok: false, reason: "口令校验失败（可能复制不完整）" };
  try {
    const p = JSON.parse(json) as TouchPayload;
    if (p?.v !== 1 || p.kind !== "onethu-touch") return { ok: false, reason: "口令版本不受支持" };
    return { ok: true, payload: p };
  } catch { return { ok: false, reason: "口令内容不是合法 JSON" }; }
}

/** 组装组合口令：暂存箱走完整分享口令（云盘可用时只带云引用）；名片/组织只带摘要。 */
export async function buildTouchCode(opts: TouchOptions): Promise<{ code: string; payload: TouchPayload }> {
  const payload: TouchPayload = { v: 1, kind: "onethu-touch", issuedAt: Date.now(), from: opts.from };
  if (opts.withVault) {
    const box = activeVault();
    if (box.items.length > 0) {
      const minted = await mintShareCode(box, opts.from);
      payload.vaultCode = minted.code;
      payload.vaultName = box.name;
    }
  }
  if (opts.withPersonal) {
    const raw = localStorage.getItem("onethu.cards.v1");
    if (raw) {
      const card = (JSON.parse(raw) as { personal?: PersonalCard }).personal;
      if (card) payload.personal = card;
    }
  }
  if (opts.withOrgId) {
    const raw = localStorage.getItem("onethu.orgs.v1");
    if (raw) {
      const orgs = (JSON.parse(raw) as { orgs?: Array<{ id: string; name: string; lastInviteCode?: string }> }).orgs ?? [];
      const org = orgs.find((o) => o.id === opts.withOrgId);
      if (org) {
        payload.orgName = org.name;
        payload.orgCode = org.lastInviteCode;
      }
    }
  }
  return { code: await publishExchangeCode(encodeTouch(payload)), payload };
}

export interface TouchImportResult {
  ok: boolean;
  reason?: string;
  vault?: boolean;
  contact?: boolean;
  org?: boolean;
}

/** 接收方：暂存箱按 vaultTarget 落库；名片进通讯录；组织邀请合并成员。 */
export async function importTouchCode(code: string, myName = "我", vaultTarget: "current" | "new" = "current"): Promise<TouchImportResult> {
  let resolved: string;
  try { resolved = await resolveExchangeCode(code); }
  catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
  const dec = decodeTouch(resolved);
  if (!dec.ok || !dec.payload) return { ok: false, reason: dec.reason ?? "口令无法解析" };
  const p = dec.payload;
  let vault = false;
  let contact = false;
  let org = false;
  if (p.vaultCode) {
    const r = await importShareCodeAsCurrent(p.vaultCode, vaultTarget);
    if (!r.ok) return { ok: false, reason: r.reason ?? "暂存箱口令无法导入" };
    vault = true;
  }
  if (p.personal) {
    const r = addContact("personal", p.personal, p.from ? `来自 ${p.from}` : "");
    if (r.ok) contact = true;
  }
  if (p.orgCode && p.orgName) {
    const r = await acceptOrgInvite(p.orgCode, myName);
    if (r.ok) org = true;
  }
  if (!vault && !contact && !org) return { ok: false, reason: "这个碰一碰口令里没有可导入的内容" };
  return { ok: true, vault, contact, org };
}

/** 可选组织列表（UI 用；不 import React，保持纯 store 读取）。 */
export function orgOptions(): TouchOrgBrief[] {
  try {
    const raw = localStorage.getItem("onethu.orgs.v1");
    if (!raw) return [];
    const orgs = (JSON.parse(raw) as { orgs?: Array<{ id: string; name: string; lastInviteCode?: string }> }).orgs ?? [];
    return orgs.map((o) => ({ id: o.id, name: o.name }));
  } catch {
    return [];
  }
}
