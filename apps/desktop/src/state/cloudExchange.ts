import { isSealed, readSharedJson } from './sealedShare.js';
import { invoke } from '@tauri-apps/api/core';
import { assertRepoOwner, ensureSeafileLoaded, getSeafileToken } from './seafile.js';
import { isShortCode, linkForShortCode, shortCodeForLink } from '../lib/shortCode.js';
import { seafileShareDelete, seafileShareRead } from './seafile.js';
import { updateExchangeManifest, uploadExchangeManifest } from './vaultCloud.js';
import { checksum, encodeShareV2, type VaultSharePayload } from './vaultShare.js';

/* ── 发布去重 ──────────────────────────────────────────────────────────────
 * 同一份内容再次分享时不重复上传，否则点一次「复制名片口令」就在云盘堆一个目录，
 * 用户看着像「无限生成口令」。两层机制：
 *   ① 内容摘要缓存：内容没变 → 直接复用旧短码（先回读确认还活着）；
 *   ② 稳定分享位（slot）：名片/组织这类「会更新」的内容复用同一个云盘目录，
 *      就地覆盖 manifest——口令不变、内容永远最新，改一次名片也不多一个目录。
 * 暂存箱/碰一碰组合是快照语义（箱子改了就换口令），只用第①层。 */
const CACHE_KEY = 'onethu.exchange.publish.v1';
const SLOT_KEY = 'onethu.exchange.slots.v1';
const CACHE_TTL = 6 * 24 * 3600 * 1000; /* 云盘分享 7 天，留一天余量 */

interface CacheEntry { code: string; at: number }
interface Slot { allowEmail?:string;keyRepoId?:string;repoId: string; dir: string; shareUrl: string; expiresAt: number; code: string }

function readJson<T>(key: string): Record<string, T> {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, T>; }
  catch { return {}; }
}
function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 配额满：放弃缓存，不影响分享本身 */ }
}
function cachePut(key: string, code: string): void {
  const all = readJson<CacheEntry>(CACHE_KEY);
  all[key] = { code, at: Date.now() };
  for (const [k, v] of Object.entries(all)) if (Date.now() - v.at > CACHE_TTL) delete all[k];
  writeJson(CACHE_KEY, all);
}
async function cacheKeyOf(contentKey: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(contentKey);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).slice(0, 16).join('');
  } catch {
    return checksum(contentKey) + ':' + contentKey.length;
  }
}
/** 口令还能不能匿名读出来（防「分享被手动删了却还复用旧码」）。 */
async function stillReadable(code: string): Promise<boolean> {
  try { await resolveExchangeCode(code); return true; } catch { return false; }
}

/** 发布时可选项：有效期（天，0/缺省 = 7 天；显式传 0 表示不过期）与强制重建分享。 */
export interface PublishOptions {
  /** 有效期天数：>0 按天；0 = 不过期（缺省 7 天） */
  expireDays?: number;
  allowEmail?:string;
  /** true = 不复用稳定位，撤销旧分享后重新建（改有效期/换接收范围用） */
  forceNew?: boolean;
}

/** 发布内容全文到云盘，用户只拿到固定长度的分享凭据。
 *  contentKey：内容摘要键——同一份内容再次分享时复用旧短码，不重复上传。
 *  slotName：稳定分享位——名片/组织用；就地覆盖 manifest，口令不变、内容最新。
 *  opts.forceNew：有效期/范围变了必须重建分享（云盘分享的过期时间不可改），
 *  先撤旧分享再建新的，短码随之更新。 */
export async function publishExchangeCode(
  code: string,
  contentKey?: string,
  slotName?: string,
  opts: PublishOptions = {},
): Promise<string> {
  if (isShortCode(code)) return code;
  const expireDays = opts.expireDays === 0 ? 0 : (opts.expireDays ?? 7);
  // Generated organization payloads carry their recipient; always apply it at publication.
  let embeddedEmail="";
  try{const body=code.split(".")[1];if(body)embeddedEmail=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0)))).allowEmail??"";}catch{}
  const allowEmail=(opts.allowEmail??embeddedEmail).trim().toLowerCase();
  if(allowEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(allowEmail))throw new Error("接收邮箱格式不正确");
  const slots = readJson<Slot>(SLOT_KEY);
  const slot = slotName ? slots[slotName] : undefined;
  if(slot)await assertRepoOwner(slot.repoId);
  const key = contentKey ? await cacheKeyOf(contentKey+':recipient:'+allowEmail) : '';
  if(slot && ((slot.allowEmail??'')!==allowEmail || Boolean(slot.keyRepoId)!==Boolean(allowEmail)))opts={...opts,forceNew:true};
  if (!opts.forceNew) {
    if (key) {
      const hit = readJson<CacheEntry>(CACHE_KEY)[key];
      if (hit && Date.now() - hit.at < CACHE_TTL && await stillReadable(hit.code)) return hit.code;
    }
    if (slotName && slot && (slot.expiresAt === 0 || slot.expiresAt > Date.now()) && slot.dir) {
      try {
        await updateExchangeManifest(slot.repoId, slot.dir, code,slot.keyRepoId);
        if (await stillReadable(slot.code)) {
          if (key) cachePut(key, slot.code);
          return slot.code;
        }
        throw new Error("原分享暂时无法读回，请重试或选择重新生成");
      } catch (error) { throw new Error(`原分享更新未完成：${error instanceof Error?error.message:String(error)}`); }
    }
  } else if (slot && slotName) {
    /* 改有效期/范围：旧分享必须撤掉，否则它按旧有效期继续活着。 */
    if(!await revokeShareSlot(slotName))throw new Error("旧分享撤销未完成，请重试");
  }
  const ref = await uploadExchangeManifest(code, expireDays,allowEmail||undefined);
  if (!ref.shareUrl) throw new Error('云盘没有返回分享链接');
  const short = shortCodeForLink(ref.shareUrl);
  if (slotName) {
    /* /f/ 兜底时 ref.path 是 manifest 文件本身；稳定位要的是目录。 */
    const dir = (ref.path ?? '').replace(/\/manifest\.json$/, '');
    writeJson(SLOT_KEY, { ...readJson<Slot>(SLOT_KEY), [slotName]: { allowEmail,keyRepoId:ref.keyRepoId,repoId: ref.repoId ?? '', dir, shareUrl: ref.shareUrl, expiresAt: ref.expiresAt ?? 0, code: short } });
  }
  if (key) cachePut(key, short);
  return short;
}

function slotShareToken(shareUrl: string | undefined): string {
  const m = /\/(?:d|f)\/([A-Za-z0-9_-]+)/.exec(String(shareUrl ?? ''));
  return m ? m[1]! : '';
}

/** 撤销某个稳定分享位的云盘分享并清掉槽位（名片/组织口令的「删除」用）。 */
export async function revokeShareSlot(slotName: string): Promise<boolean> {
  const slots = readJson<Slot>(SLOT_KEY);
  const slot = slots[slotName];
  if (!slot) return false;
  let ok = true;
  const token = slotShareToken(slot.shareUrl);
  if (token) {
    try {
      await assertRepoOwner(slot.repoId);
      if(slot.keyRepoId){await ensureSeafileLoaded();await invoke("seafile_delete_repo",{token:getSeafileToken(),repoId:slot.keyRepoId});}
      await seafileShareDelete(token);
    }
    catch { ok = false; }
  }
  /* 清槽位 + 清掉指向这条短码的内容缓存，避免下次「复用」到已删的分享。 */
  if(!ok)return false;
  delete slots[slotName];
  writeJson(SLOT_KEY, slots);
  const cache = readJson<CacheEntry>(CACHE_KEY);
  for (const [k, v] of Object.entries(cache)) if (v.code === slot.code) delete cache[k];
  writeJson(CACHE_KEY, cache);
  return ok;
}

/** 读稳定分享位（组织口令的有效期展示用）。 */
export function shareSlotOf(slotName: string): { code: string; expiresAt: number } | null {
  const slot = readJson<Slot>(SLOT_KEY)[slotName];
  return slot ? { code: slot.code, expiresAt: slot.expiresAt } : null;
}

/** 保留旧口令兼容；新口令匿名联网取清单后交给各领域已有校验与导入。 */
export async function resolveExchangeCode(code: string): Promise<string> {
  if (!isShortCode(code)) return code.trim();
  const { link, token } = linkForShortCode(code);
  let text: string;
  try { text = await seafileShareRead(link, 'manifest.json'); }
  catch (e) { throw new Error(`无法读取分享，请检查网络或请对方确认口令未过期/撤销：${e instanceof Error ? e.message : String(e)}`); }
  if (text.length > 2 * 1024 * 1024) throw new Error('分享内容超过支持的大小');
  let payload: Record<string, unknown>;
  const outer=JSON.parse(text);
  payload = await readSharedJson(text) as Record<string,unknown>;
  const keyRepoId=isSealed(outer)?outer.keyRepoId:undefined;
  if (payload?.v !== 1) throw new Error('分享版本不受支持');
  if (payload.kind === 'onethu-exchange' && typeof payload.code === 'string' && /^(ONTOUCH1|ONORG1)\./.test(payload.code)) return payload.code;
  if (payload.kind === 'vault-share' && Array.isArray(payload.items)) {
    // 撤销/文件引用仍需分享链接；私有仓库ID、目录路径不用传给接收方。
    return encodeShareV2({
      v: 1,
      kind: 'vault-share',
      name: String(payload.name ?? '收到的暂存箱'),
      issuedAt: Number(payload.issuedAt) || 0,
      /* 口令名 / 限定邮箱必须跟着短码走：接收端要用它做展示与权限校验。 */
      ...(typeof payload.label === 'string' && payload.label.trim() ? { label: payload.label.trim().slice(0, 60) } : {}),
      ...(typeof payload.allowEmail === 'string' && payload.allowEmail.trim() ? { allowEmail: payload.allowEmail.trim().toLowerCase().slice(0, 120) } : {}),
      ...(typeof payload.expiresAt === 'number' && payload.expiresAt > 0 ? { expiresAt: payload.expiresAt } : {}),
      cloud: { provider: 'seafile', path: '', shareUrl: link, shareToken: token, manifestName: 'manifest.json',keyRepoId },
    } as VaultSharePayload);
  }
  throw new Error('这份分享不包含可接收的 OneTHU 内容');
}
