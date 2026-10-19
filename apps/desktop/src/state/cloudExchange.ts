import { isShortCode, linkForShortCode, shortCodeForLink } from '../lib/shortCode.js';
import { seafileShareRead } from './seafile.js';
import { uploadExchangeManifest } from './vaultCloud.js';
import { encodeShareV2, type VaultSharePayload } from './vaultShare.js';

/** 发布内容全文到云盘，用户只拿到固定长度的分享凭据。 */
export async function publishExchangeCode(code: string): Promise<string> {
  if (isShortCode(code)) return code;
  const ref = await uploadExchangeManifest(code);
  if (!ref.shareUrl) throw new Error('云盘没有返回分享链接');
  return shortCodeForLink(ref.shareUrl);
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
