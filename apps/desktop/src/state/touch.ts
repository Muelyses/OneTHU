/**
 * 「碰一碰」分享组合（Phase 5 地基，当前用口令/二维码代替 NFC）：
 * 发出者可选：当前暂存箱口令 + 个人名片 + 组织名片（邀请）三者任意组合；
 * 后两者较长时统一编码进一个 ONTOUCH1 口令。NFC 落地后 NDEF 只带这个短口令。
 */
import { publishExchangeCode, resolveExchangeCode } from "./cloudExchange.js";
import { addContact, cardsSnapshot, type OrgCard, type PersonalCard } from "./nameCard.js";
import { acceptOrgInvite, orgInviteCode, orgSnapshot } from "./org.js";
import { checksum, importShareCodeAsCurrent, shareCodeForBox } from "./vaultShare.js";
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

/** 组装组合口令：暂存箱复用未失效的短码；名片/组织只带摘要。 */
export async function buildTouchCode(opts: TouchOptions): Promise<{ code: string; payload: TouchPayload }> {
  const payload: TouchPayload = { v: 1, kind: "onethu-touch", issuedAt: Date.now(), from: opts.from };
  if (opts.withVault) {
    const box = activeVault();
    if (box.items.length > 0) {
      const minted = await shareCodeForBox(box);
      payload.vaultCode = minted.code;
      payload.vaultName = box.name;
    }
  }
  if (opts.withPersonal) {
    /* 空名片（没填名字）不发：接收方通讯录里会多一条没有名字的卡片。 */
    const personal = cardsSnapshot().personal;
    if (personal.name.trim()) payload.personal = personal;
  }
  if (opts.withOrgId) {
    const org = orgSnapshot().orgs.find((o) => o.id === opts.withOrgId);
    if (org) {
      payload.orgName = org.name;
      /* 没生成过邀请就地生成（云盘上传后拿短码）；已有邀请原样复用。 */
      payload.orgCode = await orgInviteCode(org);
    }
  }
  /* issuedAt 不进内容键：同样的选择再点一次，复用同一个短码而不是又上传一份。 */
  const contentKey = JSON.stringify([payload.from, payload.vaultCode, payload.vaultName, payload.personal, payload.orgCode, payload.orgName]);
  return { code: await publishExchangeCode(encodeTouch(payload), contentKey), payload };
}

export interface TouchImportResult {
  ok: boolean;
  reason?: string;
  vault?: boolean;
  contact?: boolean;
  org?: boolean;
  /** 内容识别成功，但本地已有（重复接收不会重复添加，也不是失败） */
  duplicate?: boolean;
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
  let duplicate = false;
  if (p.vaultCode) {
    const r = await importShareCodeAsCurrent(p.vaultCode, vaultTarget);
    if (!r.ok) return { ok: false, reason: r.reason ?? "暂存箱口令无法导入" };
    vault = true;
  }
  if (p.personal) {
    const r = addContact("personal", p.personal, p.from ? `来自 ${p.from}` : "");
    if (r.ok) contact = true;
    else if (r.reason === "duplicate") duplicate = true;
  }
  if (p.orgCode && p.orgName) {
    const r = await acceptOrgInvite(p.orgCode, myName);
    if (r.ok) org = true;
  }
  if (!vault && !contact && !org) {
    /* 重复接收要说明白：内容认出来了，只是本地已经有，不是口令坏。 */
    if (duplicate) return { ok: true, duplicate: true, reason: "名片已在通讯录里（重复接收不会重复添加）" };
    return { ok: false, reason: "这个碰一碰口令里没有可导入的内容" };
  }
  return { ok: true, vault, contact, org, duplicate };
}

/** 可选组织列表（UI 用；不 import React，保持纯 store 读取）。 */
export function orgOptions(): TouchOrgBrief[] {
  return orgSnapshot().orgs.map((o) => ({ id: o.id, name: o.name }));
}
