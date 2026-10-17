/**
 * OneTHU 分享口令（Phase 1）：紧凑编码 + 校验 + 云盘适配位。
 *
 * 口令不是把内容全文塞进长文本，而是：
 *   ONV1.<base64url(payload)>.<checksum>
 * payload 里可以是「清单本身」（小箱子，离线可用）或「云盘清单引用」（正式分享，指向
 * 清华云盘分享文件夹里的 manifest）。适配层没注册时走 inline；注册后 mintShareCode
 * 优先云盘上传并只把引用写进口令。
 */
import type { VaultBox, VaultCatch, VaultItem } from "./vault.js";
import { markVaultShared, replaceVaultItems, vaultSnapshot } from "./vault.js";

export const SHARE_PREFIX = "ONV1";

/* 体积/字段上限：口令是不可信输入（可能被伪造/截断），解码时按此净化后再进暂存箱。 */
const MAX_CODE_CHARS = 96 * 1024;
const MAX_ITEMS = 300;
const MAX_TITLE = 160;
const MAX_SUB = 240;
const MAX_TEXT = 4096;
const MAX_PAYLOAD_CHARS = 4096;

export interface VaultCloudRef {
  provider: "seafile";
  /** 云盘仓库 id / 共享路径（由适配层填） */
  repoId?: string;
  path: string;
  /** 分享链接（用户可手动打开，非必需） */
  shareUrl?: string;
  /** 过期时间（epoch ms；0/缺省 = 不过期） */
  expiresAt?: number;
}

export interface VaultSharePayload {
  v: 1;
  kind: "vault-share";
  issuedAt: number;
  /** 箱子名字（导入时给用户看） */
  name: string;
  /** 清单内联（小箱子）或云盘引用二选一；云盘存在时 items 可省略。 */
  items?: VaultCatch[];
  cloud?: VaultCloudRef;
  /** 过期时间（epoch ms；缺省 = 不过期；decode 会拒绝过期口令） */
  expiresAt?: number;
  /** 发送者显示名（可选，不包含敏感信息） */
  from?: string;
}

/** 已注册的云盘适配器（清华云盘；未注册 = 本地 inline 模式）。 */
export interface VaultCloudAdapter {
  /** 把清单 JSON 上传到独立分享文件夹；返回引用。 */
  upload(payload: VaultSharePayload): Promise<VaultCloudRef>;
  /** 读取口令指向的清单 JSON；过期/撤销抛错。 */
  resolve(ref: VaultCloudRef): Promise<VaultSharePayload>;
  /** 撤销分享文件夹（口令过期/撤销后的清理）。 */
  revoke(ref: VaultCloudRef): Promise<void>;
}

let adapter: VaultCloudAdapter | null = null;
export function registerVaultCloudAdapter(a: VaultCloudAdapter | null): void {
  adapter = a;
}
export function hasVaultCloudAdapter(): boolean {
  return adapter !== null;
}

/* ── 编码工具（无依赖，浏览器可用） ── */

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 内容校验（32-bit FNV-1a，足够发现口令复制截断，不是安全签名）。 */
export function checksum(s: string): string {
  let h = 0x811c9dc5;
  for (const b of utf8Bytes(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function encodeShare(payload: VaultSharePayload): string {
  const json = JSON.stringify(payload);
  const body = toBase64Url(utf8Bytes(json));
  return `${SHARE_PREFIX}.${body}.${checksum(json)}`;
}

export interface DecodeResult {
  ok: boolean;
  payload?: VaultSharePayload;
  reason?: string;
}

export function decodeShare(code: string): DecodeResult {
  const raw = String(code ?? "").trim();
  if (raw.length > MAX_CODE_CHARS) return { ok: false, reason: "口令过大（超过 96KB），不是本应用的正常口径" };
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== SHARE_PREFIX) return { ok: false, reason: "不是 OneTHU 分享口令（应以 ONV1. 开头）" };
  const [, body, sum] = parts;
  let json: string;
  try {
    json = new TextDecoder().decode(fromBase64Url(body!));
  } catch {
    return { ok: false, reason: "口令内容损坏（base64 解码失败）" };
  }
  if (checksum(json) !== sum) return { ok: false, reason: "口令校验失败（可能复制不完整）" };
  try {
    const p = JSON.parse(json) as VaultSharePayload;
    if (p?.v !== 1 || p.kind !== "vault-share" || typeof p.name !== "string") return { ok: false, reason: "口令版本或结构不受支持" };
    if (p.expiresAt && Date.now() > p.expiresAt) return { ok: false, reason: "口令已过期；请让分享者重新生成" };
    if (p.items !== undefined) {
      if (!Array.isArray(p.items) || p.items.length > MAX_ITEMS) return { ok: false, reason: "口令清单超过上限（300 项）" };
      const items = p.items.map(sanitizeCatch).filter((x): x is VaultCatch => x !== null);
      p.items = items;
      p.name = p.name.slice(0, MAX_TITLE) || "分享的暂存箱";
    }
    return { ok: true, payload: p };
  } catch {
    return { ok: false, reason: "口令内容不是合法 JSON" };
  }
}

/** 对不可信口令里的条目做白名单/长度净化；不认识的类型直接丢弃。 */
function sanitizeCatch(raw: unknown): VaultCatch | null {
  if (!raw || typeof raw !== "object") return null;
  const x = raw as Record<string, unknown>;
  const type = x.type;
  if (type !== "atom" && type !== "text" && type !== "file" && type !== "board-item" && type !== "payload") return null;
  const title = String(x.title ?? "").slice(0, MAX_TITLE);
  if (!title) return null;
  const out: VaultCatch = { type, title } as VaultCatch;
  if (typeof x.sub === "string") out.sub = x.sub.slice(0, MAX_SUB);
  if (typeof x.source === "string") out.source = x.source.slice(0, MAX_SUB);
  if (x.atom && typeof x.atom === "object") {
    const a = x.atom as Record<string, unknown>;
    if (typeof a.kind === "string" && typeof a.key === "string" && a.kind.length <= 80 && a.key.length <= 2000) out.atom = { kind: a.kind, key: a.key };
  }
  if (typeof x.text === "string") out.text = x.text.slice(0, MAX_TEXT);
  if (x.file && typeof x.file === "object") {
    const f = x.file as Record<string, unknown>;
    if (typeof f.name === "string") {
      out.file = {
        name: f.name.slice(0, 240),
        ...(typeof f.size === "number" ? { size: f.size } : {}),
        ...(typeof f.mime === "string" ? { mime: f.mime.slice(0, 120) } : {}),
        ...(typeof f.hash === "string" ? { hash: f.hash.slice(0, 64) } : {}),
        cloudPath: null,
      };
    }
  }
  if (x.board && typeof x.board === "object") {
    const b = x.board as Record<string, unknown>;
    if (typeof b.boardId === "string" && typeof b.itemId === "string") out.board = { boardId: b.boardId.slice(0, 120), itemId: b.itemId.slice(0, 120) };
  }
  if (x.payload !== undefined) {
    try {
      if (JSON.stringify(x.payload).length <= MAX_PAYLOAD_CHARS) out.payload = x.payload;
    } catch { /* 不可序列化就丢掉 */ }
  }
  return out;
}

/** 从一个箱子生成清单 payload（items 只含引用/摘要，不含文件字节）。 */
export function payloadFromVault(box: VaultBox, from = "OneTHU 用户"): VaultSharePayload {
  return {
    v: 1,
    kind: "vault-share",
    issuedAt: Date.now(),
    name: box.name,
    items: box.items.map(stripItem),
    from,
  };
}

/** 去掉本地 id/时间（导入方重新生成；口令稳定、可跨版本）。 */
function stripItem(it: VaultItem): VaultCatch {
  return {
    type: it.type,
    title: it.title,
    ...(it.sub ? { sub: it.sub } : {}),
    ...(it.atom ? { atom: it.atom } : {}),
    ...(it.text ? { text: it.text } : {}),
    /* cloudPath 是发送者的私有云盘路径，跨账号无意义/有泄露风险：分享清单不带它。 */
    ...(it.file ? { file: { name: it.file.name, size: it.file.size, mime: it.file.mime, hash: it.file.hash, cloudPath: null } } : {}),
    ...(it.board ? { board: it.board } : {}),
    ...(it.payload !== undefined ? { payload: it.payload } : {}),
    ...(it.source ? { source: it.source } : {}),
  };
}

/** 生成口令：有云盘适配器时上传清单并只编码引用；否则 inline（离线/未接云盘）。 */
export async function mintShareCode(box: VaultBox, from?: string): Promise<{ code: string; payload: VaultSharePayload }> {
  const payload = payloadFromVault(box, from);
  let final = payload;
  if (adapter) {
    const cloud = await adapter.upload(payload);
    final = { ...payload, items: undefined, cloud };
  }
  const code = encodeShare(final);
  markVaultShared(box.id, code);
  return { code, payload: final };
}

/** 解析并把口令内容导入为**当前暂存箱**（未收录内容即时消失）。 */
export async function importShareCodeAsCurrent(code: string): Promise<{ ok: boolean; imported?: number; reason?: string }> {
  const dec = decodeShare(code);
  if (!dec.ok || !dec.payload) return { ok: false, reason: dec.reason ?? "口令无法解析" };
  let payload = dec.payload;
  if (!payload.items && payload.cloud) {
    if (!adapter) return { ok: false, reason: "这条口令需要连接清华云盘才能读取" };
    try {
      payload = await adapter.resolve(payload.cloud);
    } catch (e) {
      return { ok: false, reason: `云盘读取失败：${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const items = payload.items ?? [];
  const box = vaultSnapshot().boxes.find((b) => b.id === vaultSnapshot().activeId);
  if (!box) return { ok: false, reason: "当前没有暂存箱" };
  replaceVaultItems(box.id, items);
  return { ok: true, imported: items.length };
}

/** 过期/撤销清理：交给适配器；没有引用后文件删除也由适配器按引用计数处理。 */
export async function revokeShare(payload: VaultSharePayload): Promise<boolean> {
  if (!payload.cloud || !adapter) return false;
  await adapter.revoke(payload.cloud);
  return true;
}
