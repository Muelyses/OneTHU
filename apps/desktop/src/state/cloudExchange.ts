import { isShortCode, linkForShortCode, shortCodeForLink } from '../lib/shortCode.js';
import { seafileShareRead } from './seafile.js';
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
interface Slot { repoId: string; dir: string; shareUrl: string; expiresAt: number; code: string }

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

/** 发布内容全文到云盘，用户只拿到固定长度的分享凭据。
 *  contentKey：内容摘要键——同一份内容再次分享时复用旧短码，不重复上传。
 *  slotName：稳定分享位——名片/组织用；就地覆盖 manifest，口令不变、内容最新。 */
export async function publishExchangeCode(code: string, contentKey?: string, slotName?: string): Promise<string> {
  if (isShortCode(code)) return code;
  const key = contentKey ? await cacheKeyOf(contentKey) : '';
  if (key) {
    const hit = readJson<CacheEntry>(CACHE_KEY)[key];
    if (hit && Date.now() - hit.at < CACHE_TTL && await stillReadable(hit.code)) return hit.code;
  }
  if (slotName) {
    const slot = readJson<Slot>(SLOT_KEY)[slotName];
    if (slot && slot.expiresAt > Date.now() && slot.dir) {
      try {
        await updateExchangeManifest(slot.repoId, slot.dir, code);
        if (await stillReadable(slot.code)) {
          if (key) cachePut(key, slot.code);
          return slot.code;
        }
      } catch { /* 目录/分享已不可用：落到下面新建 */ }
    }
  }
  const ref = await uploadExchangeManifest(code);
  if (!ref.shareUrl) throw new Error('云盘没有返回分享链接');
  const short = shortCodeForLink(ref.shareUrl);
  if (slotName) {
    /* /f/ 兜底时 ref.path 是 manifest 文件本身；稳定位要的是目录。 */
    const dir = (ref.path ?? '').replace(/\/manifest\.json$/, '');
    writeJson(SLOT_KEY, { ...readJson<Slot>(SLOT_KEY), [slotName]: { repoId: ref.repoId ?? '', dir, shareUrl: ref.shareUrl, expiresAt: ref.expiresAt ?? 0, code: short } });
  }
  if (key) cachePut(key, short);
  return short;
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
  try { payload = JSON.parse(text); }
  catch { throw new Error('分享内容损坏，无法读取'); }
  if (payload?.v !== 1) throw new Error('分享版本不受支持');
  if (payload.kind === 'onethu-exchange' && typeof payload.code === 'string' && /^(ONTOUCH1|ONORG1)\./.test(payload.code)) return payload.code;
  if (payload.kind === 'vault-share' && Array.isArray(payload.items)) {
    // 撤销/文件引用仍需分享链接；私有仓库ID、目录路径不用传给接收方。
    return encodeShareV2({ v: 1, kind: 'vault-share', name: String(payload.name ?? '收到的暂存箱'), issuedAt: Number(payload.issuedAt) || 0, cloud: { provider: 'seafile', path: '', shareUrl: link, shareToken: token, manifestName: 'manifest.json' } } as VaultSharePayload);
  }
  throw new Error('这份分享不包含可接收的 OneTHU 内容');
}
