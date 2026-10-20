import { t as i18n } from "../i18n/index.js";
/**
 * OneTHU 分享口令（联网短口令阶段）：云盘清单 + 固定长度短码。
 *
 * 口令不再把内容全文塞进长文本：
 *   - 新分享一律上传清华云盘清单，口令是分享凭据的短写（ON-XXXX-XXXX-XXXX-XXXX，
 *     见 lib/shortCode.ts；非标准凭据退化为 ONX.<token>），长度与内容大小无关。
 *   - ONV1.<base64url(payload)>.<checksum> / ONV2.<base64url(payload)>.<sha256>
 *     仍然完整可解码（旧口令兼容），但不再生成新的 inline 长口令。
 * 接收方联网匿名读取云盘清单即可，不必先连接自己的云盘。
 */
import { isShortCode, shortCodeForLink } from "../lib/shortCode.js";
import type { VaultBox, VaultCatch, VaultItem } from "./vault.js";
import { createVault, markVaultShared, replaceVaultItems, vaultSnapshot } from "./vault.js";
import { fullModeReceiveSession } from "../lib/fullModeReceive.js";
import { recordIssuedShare } from "./vaultShareLog.js";

export const SHARE_PREFIX = "ONV1";
export const SHARE_PREFIX_V2 = "ONV2";

/* 体积/字段上限：口令是不可信输入（可能被伪造/截断），解码时按此净化后再进暂存箱。 */
const MAX_CODE_CHARS = 96 * 1024;
const MAX_ITEMS = 300;
const MAX_TITLE = 160;
const MAX_SUB = 240;
const MAX_TEXT = 4096;
const MAX_PAYLOAD_CHARS = 4096;

export interface VaultCloudRef {
  provider: "seafile";
  /** Private key library for server-authorized encrypted sharing. */
  keyRepoId?: string;
  /** 云盘仓库 id / 共享路径（由适配层填） */
  repoId?: string;
  path: string;
  /** 分享链接（用户可手动打开，非必需） */
  shareUrl?: string;
  /** 分享 token（撤销时用；云盘适配器填） */
  shareToken?: string;
  /** 分享根目录里的清单文件名（目录分享时读取；缺省 manifest.json） */
  manifestName?: string;
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
  /** 口令名（发送方自己起的名字，接收方也能看到；台账/面板展示用） */
  label?: string;
  /** 限定接收邮箱：设置了就只有该清华云盘账号能打开（接收端校验） */
  allowEmail?: string;
}

/** 已注册的云盘适配器（清华云盘；未注册 = 本地 inline 模式）。 */
export interface VaultCloudAdapter {
  /** 把清单 JSON 上传到独立分享文件夹；返回引用。 */
  upload(payload: VaultSharePayload): Promise<VaultCloudRef>;
  /** 读取口令指向的清单 JSON；过期/撤销抛错。 */
  resolve(ref: VaultCloudRef): Promise<VaultSharePayload>;
  /** 撤销分享文件夹（口令过期/撤销后的清理）。 */
  revoke(ref: VaultCloudRef): Promise<void>;
  /** 就地覆盖同一个分享里的清单：改名 / 限定邮箱时用（口令不变，对方读到的就是新清单）。 */
  update?(ref: VaultCloudRef, payload: VaultSharePayload): Promise<void>;
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

async function sha256Hex(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error(i18n("state.vaultshare.af175fd37c73"));
  const bytes = utf8Bytes(text);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** ONV2：SHA-256 截断摘要（防截断/篡改；仍不是签名，云盘分享才是权限边界）。 */
export async function encodeShareV2(payload: VaultSharePayload): Promise<string> {
  const json = JSON.stringify(payload);
  const body = toBase64Url(utf8Bytes(json));
  const sum = (await sha256Hex(json)).slice(0, 32);
  return `${SHARE_PREFIX_V2}.${body}.${sum}`;
}

export interface DecodeResult {
  ok: boolean;
  payload?: VaultSharePayload;
  reason?: string;
}

/** 共享的 payload 校验/净化（v1/v2 同口径）。 */
function validatePayload(p: VaultSharePayload): DecodeResult {
  if (p?.v !== 1 || p.kind !== "vault-share" || typeof p.name !== "string") return { ok: false, reason: i18n("state.vaultshare.b2e333bd5624") };
  if (p.expiresAt && Date.now() > p.expiresAt) return { ok: false, reason: i18n("state.vaultshare.00b9a4acaf92") };
  /* 口令名 / 限定邮箱是不可信输入：截断 + 只接受像邮箱的值。 */
  if (p.label !== undefined) {
    const label = typeof p.label === "string" ? p.label.trim().slice(0, 60) : "";
    if (label) p.label = label; else delete p.label;
  }
  if (p.allowEmail !== undefined) {
    const email = typeof p.allowEmail === "string" ? p.allowEmail.trim().toLowerCase().slice(0, 120) : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) delete p.allowEmail;
    else p.allowEmail = email;
  }
  if (p.items !== undefined) {
    if (!Array.isArray(p.items) || p.items.length > MAX_ITEMS) return { ok: false, reason: i18n("state.vaultshare.b37b72a03e7d") };
    const items = p.items.map(sanitizeCatch).filter((x): x is VaultCatch => x !== null);
    p.items = items;
    p.name = p.name.slice(0, MAX_TITLE) || "分享的暂存箱";
  }
  return { ok: true, payload: p };
}

/** 异步解码：ONV2 用 SHA-256 校验；ONV1 兼容旧口令。 */
export async function decodeShareAsync(code: string): Promise<DecodeResult> {
  const raw = String(code ?? "").trim();
  if (isShortCode(raw)) {
    try { return decodeShareAsync(await (await import("./cloudExchange.js")).resolveExchangeCode(raw)); }
    catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
  }
  if (!raw.startsWith(SHARE_PREFIX_V2 + ".")) return decodeShare(raw);
  if (raw.length > MAX_CODE_CHARS) return { ok: false, reason: i18n("state.vaultshare.ae3ba9170d2f") };
  const parts = raw.split(".");
  if (parts.length !== 3) return { ok: false, reason: i18n("state.vaultshare.9ae3c2acf2c1") };
  let json: string;
  try { json = new TextDecoder().decode(fromBase64Url(parts[1]!)); } catch { return { ok: false, reason: i18n("state.vaultshare.09cc0bb41763") }; }
  try {
    const sum = (await sha256Hex(json)).slice(0, 32);
    if (sum !== parts[2]) return { ok: false, reason: i18n("state.vaultshare.63205c669579") };
    return validatePayload(JSON.parse(json) as VaultSharePayload);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : i18n("state.vaultshare.2fb90783488d") };
  }
}

export function decodeShare(code: string): DecodeResult {
  const raw = String(code ?? "").trim();
  if (raw.length > MAX_CODE_CHARS) return { ok: false, reason: i18n("state.vaultshare.ae3ba9170d2f") };
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== SHARE_PREFIX) return { ok: false, reason: i18n("state.vaultshare.df690d6050a8") };
  const [, body, sum] = parts;
  let json: string;
  try {
    json = new TextDecoder().decode(fromBase64Url(body!));
  } catch {
    return { ok: false, reason: i18n("state.vaultshare.09cc0bb41763") };
  }
  if (checksum(json) !== sum) return { ok: false, reason: i18n("state.vaultshare.989f1cde10a3") };
  try {
    return validatePayload(JSON.parse(json) as VaultSharePayload);
  } catch {
    return { ok: false, reason: i18n("state.vaultshare.7aa0c43fe053") };
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
        cloudPath: typeof f.cloudPath==="string"&&/^files\/[^/\\]{1,240}$/.test(f.cloudPath)?f.cloudPath:null,
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
export function payloadFromVault(box: VaultBox, from = "OneTHU 用户", includeStaged = false): VaultSharePayload {
  return {
    v: 1,
    kind: "vault-share",
    issuedAt: Date.now(),
    name: box.name,
    items: box.items.map((it) => stripItem(it, includeStaged)),
    from,
  };
}

/** 去掉本地 id/时间（导入方重新生成；口令稳定、可跨版本）。
 *  includeStaged 只给云适配器上传用：stagedPath 由适配器读完文件后必须再次剥掉，
 *  绝不能写进清单或 inline 口令（本机私有路径）。 */
function stripItem(it: VaultItem, includeStaged: boolean): VaultCatch {
  return {
    type: it.type,
    title: it.title,
    ...(it.sub ? { sub: it.sub } : {}),
    ...(it.atom ? { atom: it.atom } : {}),
    ...(it.text ? { text: it.text } : {}),
    /* cloudPath 是发送者的私有云盘路径，跨账号无意义/有泄露风险：分享清单不带它。 */
    ...(it.file ? {
      file: {
        name: it.file.name, size: it.file.size, mime: it.file.mime, hash: it.file.hash, cloudPath: null,
        ...(includeStaged ? {
          stagedPath: it.file.stagedPath,
          cloudPath: it.file.cloudPath,
          cloudRepoId: it.file.cloudRepoId,
          shareUrl: it.file.shareUrl,
          shareKeyRepoId: it.file.shareKeyRepoId,
        } : {}),
      },
    } : {}),
    ...(it.board ? { board: it.board } : {}),
    ...(it.payload !== undefined ? { payload: it.payload } : {}),
    ...(it.source ? { source: it.source } : {}),
  };
}

/** 生成口令时可选项：口令名 / 限定接收邮箱。 */
export interface ShareMeta {
  label?: string;
  allowEmail?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 把口令名/限定邮箱规整后写进 payload（空值 = 不设）。 */
function applyShareMeta(payload: VaultSharePayload, meta?: ShareMeta): VaultSharePayload {
  const out = { ...payload };
  const label = String(meta?.label ?? "").trim().slice(0, 60);
  if (label) out.label = label;
  const email = String(meta?.allowEmail ?? "").trim().toLowerCase();
  if (email && !EMAIL_RE.test(email)) throw new Error(i18n("state.vaultshare.5dec5b6cd859"));
  if (email) out.allowEmail = email;
  return out;
}

/** 生成口令：必须连接清华云盘——上传清单，口令只带分享凭据的短码。 */
export async function mintShareCode(box: VaultBox, from?: string, meta?: ShareMeta): Promise<{ code: string; payload: VaultSharePayload }> {
  if (!adapter) throw new Error(i18n("state.vaultshare.e1b89010df35"));
  const payload = applyShareMeta(payloadFromVault(box, from, true), meta);
  const cloud = await adapter.upload(payload);
  const final = { ...payload, items: undefined, cloud };
  if (!final.cloud?.shareUrl) throw new Error(i18n("state.vaultshare.6e106dfb0757"));
  const code = shortCodeForLink(final.cloud.shareUrl);
  // 上传期间箱子可能已被编辑：旧快照的口令不能冒充当前内容。
  const current = vaultSnapshot().boxes.find(b => b.id === box.id);
  if (current && current.items === box.items && current.name === box.name) markVaultShared(box.id, code);
  recordIssuedShare(box, code, final);
  return { code, payload: final };
}

/** 箱子分享口令：已有未失效的短码原样复用（箱子任何变更都会清掉 lastShareCode）；
 *  旧版云引用口令转成短码；否则上传新清单。 */
export async function shareCodeForBox(box: VaultBox): Promise<{ code: string; payload: VaultSharePayload }> {
  if (box.lastShareCode && isShortCode(box.lastShareCode)) {
    const pending=pendingRotations()[box.lastShareCode];
    const code=pending?await finishRotation(box.lastShareCode,pending):box.lastShareCode;
    const dec = await decodeShareAsync(code);
    if (!dec.ok || !dec.payload) throw new Error(dec.reason ?? i18n("state.vaultshare.b149e6ae5817"));
    const payload = dec.payload;
    if(payload.allowEmail&&!payload.cloud?.keyRepoId){
      const upgraded=await updateShareMeta(code,{allowEmail:payload.allowEmail});
      if(!upgraded.ok||!upgraded.code)throw new Error(upgraded.reason??i18n("state.vaultshare.c97b00b652fa"));
      const secured=await decodeShareAsync(upgraded.code);
      if(!secured.ok||!secured.payload)throw new Error(secured.reason??i18n("state.vaultshare.b713d28a9ae7"));
      return {code:upgraded.code,payload:secured.payload};
    }
    recordIssuedShare(box, code, payload);
    return { code, payload };
  }
  if (box.lastShareCode) {
    const old = await decodeShareAsync(box.lastShareCode);
    if (old.ok && old.payload?.cloud?.shareUrl) {
      const code = shortCodeForLink(old.payload.cloud.shareUrl);
      markVaultShared(box.id, code);
      return { code, payload: old.payload };
    }
  }
  if (!box.items.length) throw new Error(i18n("state.vaultshare.561b8b9a8f82"));
  /* 雷达/名片这些小形态可能没经过暂存箱页（适配器在那儿才装）：这里补一次，
     已连接云盘才会注册；动态 import 避免 vaultCloud ↔ vaultShare 静态环。 */
  const { installVaultCloudAdapter } = await import('./vaultCloud.js');
  await installVaultCloudAdapter();
  if (!adapter) throw new Error(i18n("state.vaultshare.d2880ea01ca6"));
  return mintShareCode(box);
}

/** 解析后导入：旧入口默认替换当前箱；直接交换传 new，完整保留已有箱子。 */
export async function importShareCodeAsCurrent(code: string, target: "current" | "new" = "current"): Promise<{ ok: boolean; imported?: number; reason?: string }> {
  const receiving = fullModeReceiveSession();
  if (!receiving.isCurrent()) return { ok: false, reason: i18n("friends.modeChanged") };
  const dec = await decodeShareAsync(code);
  if (!receiving.isCurrent()) return { ok: false, reason: i18n("friends.modeChanged") };
  if (!dec.ok || !dec.payload) return { ok: false, reason: dec.reason ?? i18n("state.vaultshare.c4591b5b1fe8") };
  let payload = dec.payload;
  const denied = await shareAccessReason(payload.allowEmail);
  if (!receiving.isCurrent()) return { ok: false, reason: i18n("friends.modeChanged") };
  if (denied) return { ok: false, reason: denied };
  if (!payload.items && payload.cloud) {
    try {
      if (adapter) payload = await adapter.resolve(payload.cloud);
      else {
        if (!payload.cloud.shareUrl) return { ok: false, reason: i18n("state.vaultshare.ee75d1a72727") };
        const text = await (await import("./seafile.js")).seafileShareRead(payload.cloud.shareUrl, payload.cloud.manifestName);
        if (!receiving.isCurrent()) return { ok: false, reason: i18n("friends.modeChanged") };
        if (text.length > 2 * 1024 * 1024) throw new Error(i18n("state.vaultshare.388fc6c63ebe"));
        payload = await (await import("./sealedShare.js")).readSharedJson(text) as VaultSharePayload;
      }
      const checked = validatePayload(payload);
      if (!receiving.isCurrent()) return { ok: false, reason: i18n("friends.modeChanged") };
      if (!checked.ok || !checked.payload?.items) return { ok: false, reason: checked.reason || i18n("state.vaultshare.ced6988b78e7") };
      payload = checked.payload;
      /* 云盘清单是权威：发送方后来改过限定邮箱，这里以清单为准再拦一次。 */
      const deniedLate = await shareAccessReason(payload.allowEmail);
      if (!receiving.isCurrent()) return { ok: false, reason: i18n("friends.modeChanged") };
      if (deniedLate) return { ok: false, reason: deniedLate };
    } catch (e) {
      return { ok: false, reason: i18n("state.vaultshare.716036f1e95d", { error: e instanceof Error ? e.message : String(e) }) };
    }
  }
  const items = payload.items ?? [];
  for(const item of items)if(item.file?.cloudPath&&dec.payload?.cloud?.shareUrl){item.file.shareUrl=dec.payload.cloud.shareUrl;item.file.shareKeyRepoId=dec.payload.cloud.keyRepoId;}
  const box = target === "new" ? createVault(payload.name || "收到的暂存箱") : vaultSnapshot().boxes.find((b) => b.id === vaultSnapshot().activeId);
  if (!box) return { ok: false, reason: i18n("state.vaultshare.a473c3b43384") };
  replaceVaultItems(box.id, items);
  return { ok: true, imported: items.length };
}

/** A recipient rotation must survive a key-deleted/link-delete-failed interruption.
 * Only references and metadata are persisted here; never content or encryption keys. */
const ROTATIONS_KEY = "onethu.share.rotations.v1";
interface ShareRotation { old:VaultCloudRef; next:VaultCloudRef; payload:VaultSharePayload }
export function hasPendingShareRotation(code:string):boolean{return Boolean(pendingRotations()[code]);}
function pendingRotations():Record<string,ShareRotation>{
  try{return JSON.parse(localStorage.getItem(ROTATIONS_KEY)??"{}");}catch{return {};}
}
function saveRotation(code:string,rotation?:ShareRotation):void{
  const pending=pendingRotations();if(rotation)pending[code]=rotation;else delete pending[code];
  localStorage.setItem(ROTATIONS_KEY,JSON.stringify(pending));
}
async function finishRotation(code:string,rotation:ShareRotation):Promise<string>{
  if(!adapter)await(await import("./vaultCloud.js")).installVaultCloudAdapter();
  if(!adapter)throw new Error(i18n("state.vaultshare.f6d2148271ab"));
  await adapter.revoke(rotation.old);
  const updated=shortCodeForLink(rotation.next.shareUrl!);
  (await import("./vaultShareLog.js")).replaceIssuedShareCode(code,updated,rotation.payload);
  for(const box of vaultSnapshot().boxes)if(box.lastShareCode===code)markVaultShared(box.id,updated);
  saveRotation(code);
  return updated;
}

/**
 * 改口令名 / 限定接收邮箱（口令本身不变）。
 *
 * 新口令是「云盘清单 + 短码」，所以改授权必须把云盘里的清单就地覆盖：
 * 解出当前清单 → 改字段 → 适配器写回同一个分享目录。旧版本地长口令无法改，
 * 如实让用户重新生成。
 */
export async function updateShareMeta(
  code: string,
  patch: { label?: string | null; allowEmail?: string | null },
): Promise<{ ok: boolean; reason?: string; code?:string }> {
  const pending=pendingRotations()[code];
  if(pending){
    try{
      const updated=await finishRotation(code,pending);
      const result=await updateShareMeta(updated,patch);
      return result.ok?{...result,code:result.code??updated}:result;
    }catch(e){return {ok:false,reason:i18n("state.vaultshare.de371c09cf24", { error: e instanceof Error?e.message:String(e) })};}
  }
  const dec = await decodeShareAsync(code);
  if (!dec.ok || !dec.payload) return { ok: false, reason: dec.reason ?? i18n("state.vaultshare.c4591b5b1fe8") };
  const payload: VaultSharePayload = { ...dec.payload };
  if (patch.label !== undefined) {
    const label = String(patch.label ?? "").trim().slice(0, 60);
    if (label) payload.label = label;
    else delete payload.label;
  }
  if (patch.allowEmail !== undefined) {
    const email = String(patch.allowEmail ?? "").trim().toLowerCase();
    if (email && !EMAIL_RE.test(email)) return { ok: false, reason: i18n("state.vaultshare.c5479cb871fa") };
    if (email) payload.allowEmail = email;
    else delete payload.allowEmail;
  }
  if (!payload.cloud) return { ok: false, reason: i18n("state.vaultshare.b431db21b7df") };
  if (!adapter) {
    const { installVaultCloudAdapter } = await import("./vaultCloud.js");
    await installVaultCloudAdapter();
  }
  if (!adapter) return { ok: false, reason: i18n("state.vaultshare.857b79bf69f3") };
  if (!adapter.update) return { ok: false, reason: i18n("state.vaultshare.65381bdff463") };
  /* 短码解码出的 cloud 引用只有分享链接，缺 repoId/path；从本地台账补全。
     清单必须整份读回来再改：直接拿解码结果写回去会丢 items。 */
  const { issuedSharesSnapshot } = await import("./vaultShareLog.js");
  const entry = issuedSharesSnapshot().entries.find((e) => e.code === code);
  const ref = { ...payload.cloud, ...(entry?.cloud ?? {}) };
  if (!ref.repoId) return { ok: false, reason: i18n("state.vaultshare.9aa4c7ceb155") };
  let full: VaultSharePayload = { ...payload, cloud: ref };
  try {
    const resolved = await adapter.resolve(ref);
    full = { ...resolved, cloud: resolved.cloud ?? ref };
    if (patch.label !== undefined) {
      if (payload.label) full.label = payload.label;
      else delete full.label;
    }
    if (patch.allowEmail !== undefined) {
      if (payload.allowEmail) full.allowEmail = payload.allowEmail;
      else delete full.allowEmail;
    }
  } catch (e) {
    return { ok: false, reason: i18n("state.vaultshare.b8aeb1a1f261", { error: e instanceof Error ? e.message : String(e) }) };
  }
  // Changing recipients rotates the key and shortcode; old recipients must not keep
  // access through a previously public link or an old private key library.
  if(patch.allowEmail!==undefined && ((dec.payload.allowEmail??"")!==(full.allowEmail??"") || Boolean(ref.keyRepoId)!==Boolean(full.allowEmail))){
    let next:VaultCloudRef|undefined;
    try {
      const {materializeSharedFile}=await import("./vaultCloud.js");
      for(const item of full.items??[]){if(item.file?.cloudPath){item.file.stagedPath=await materializeSharedFile(ref,item.file.cloudPath,item.file.name);delete item.file.cloudPath;}}
      delete full.cloud;
      next=await adapter.upload(full);
      if(!next.shareUrl)throw new Error(i18n("state.vaultshare.fab167848c3e"));
      const rotation:ShareRotation={old:ref,next,payload:{...full,items:undefined,cloud:next}};
      saveRotation(code,rotation);
      return {ok:true,code:await finishRotation(code,rotation)};
    }catch(e){
      // Once journaled, preserve the new encrypted share for a retry. A partially
      // revoked old share must never make both copies irrecoverable.
      if(next&&!pendingRotations()[code])await adapter.revoke(next).catch(()=>undefined);
      return {ok:false,reason:i18n("state.vaultshare.cb2fdf85ee42", { error: e instanceof Error?e.message:String(e) })};
    }
  }
  try {
    await adapter.update(ref, full);
  } catch (e) {
    return { ok: false, reason: i18n("state.vaultshare.65841f3a49c8", { error: e instanceof Error ? e.message : String(e) }) };
  }
  const { updateIssuedShareMeta } = await import("./vaultShareLog.js");
  updateIssuedShareMeta(code, { label: payload.label??"", allowEmail: payload.allowEmail??"" });
  return { ok: true };
}

/**
 * 限定邮箱校验：返回 null = 可以接收；否则返回给用户看的原因。
 * 身份唯一事实源 = 当前连接的清华云盘账号邮箱（分享本来就落在云盘上）。
 */
export async function shareAccessReason(allowEmail?: string): Promise<string | null> {
  const want = String(allowEmail ?? "").trim().toLowerCase();
  if (!want) return null;
  const seafile = await import("./seafile.js");
  await seafile.ensureSeafileLoaded();
  let account = seafile.getSeafileAccount();
  if (!account) {
    try {
      await seafile.refreshSeafileAccount();
    } catch {
      /* 未连接云盘：下面统一报错 */
    }
    account = seafile.getSeafileAccount();
  }
  let mine = String(account?.email ?? "").trim().toLowerCase();
  /* 缓存账号可能是切号/重新登录之前的：不匹配时强制刷新一次再判，避免拿旧邮箱误拒。 */
  if (mine && mine !== want) {
    try {
      await seafile.refreshSeafileAccount();
      mine = String(seafile.getSeafileAccount()?.email ?? "").trim().toLowerCase();
    } catch {
      /* 刷新失败：按当前缓存判 */
    }
  }
  if (!mine) return i18n("state.vaultshare.1677a739e1a4", { recipient: want });
  if (mine !== want) return i18n("state.vaultshare.dd39d27f2eaf", { recipient: want, currentAccount: mine });
  return null;
}

/** 过期/撤销清理：交给适配器；没有引用后文件删除也由适配器按引用计数处理。 */
export async function revokeShare(payload: VaultSharePayload): Promise<boolean> {
  if (!payload.cloud || !adapter) return false;
  for(const [code,pending] of Object.entries(pendingRotations()))if(pending.old.shareUrl===payload.cloud.shareUrl){
    await adapter.revoke(pending.next);
    await adapter.revoke(pending.old);
    saveRotation(code);
    return true;
  }
  await adapter.revoke(payload.cloud);
  return true;
}
