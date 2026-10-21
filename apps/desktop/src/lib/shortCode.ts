import { t as i18n } from "../i18n/index.js";
/** 清华云盘分享凭据的无损短写；不存放内容，也不截断凭据。 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ORIGIN = 'https://cloud.tsinghua.edu.cn';

/**
 * 目录分享是 /d/<token>/，单文件分享是 /f/<token>/（目录分享被云盘策略拒绝时的兜底）。
 * 两者 token 用法相同，读取端按 /d/<token>/ 重建即可（Rust 侧对两种分享都能读）。
 */
export function shortCodeForLink(link: string): string {
  const url = new URL(link);
  const token = url.pathname.match(/^\/(?:d|f)\/([A-Za-z0-9_-]{8,128})\/?$/)?.[1];
  if (url.origin !== ORIGIN || !token || url.search || url.hash) throw new Error(i18n("lib.shortcode.378968f3ae7e"));
  if (!/^[0-9a-f]{20}$/.test(token)) return `ONX.${token}`;
  let value = BigInt('0x' + token), body = '';
  for (let i = 0; i < 16; i++) { body = ALPHABET[Number(value & 31n)] + body; value >>= 5n; }
  return 'ON-' + body.match(/.{4}/g)!.join('-');
}

export function isShortCode(code: string): boolean {
  return /^ON(?:[-\s]|X\.)/i.test(code.trim());
}

export function linkForShortCode(code: string): { link: string; token: string } {
  const raw = code.trim();
  if (/^ONX\./i.test(raw)) {
    const token = raw.slice(4);
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) throw new Error(i18n("lib.shortcode.aef75cc315e1"));
    return { token, link: `${ORIGIN}/d/${token}/` };
  }
  const compact = raw.toUpperCase().replace(/[\s-]/g, '');
  if (!compact.startsWith('ON')) throw new Error(i18n("lib.shortcode.67ab8f79df50"));
  const body = compact.slice(2).replace(/O/g, '0').replace(/[IL]/g, '1');
  if (body.length !== 16) throw new Error(i18n("lib.shortcode.bf3d8cf6fe66"));
  let value = 0n;
  for (const c of body) {
    const digit = ALPHABET.indexOf(c);
    if (digit < 0) throw new Error(i18n("lib.shortcode.8421942a683e"));
    value = (value << 5n) | BigInt(digit);
  }
  const token = value.toString(16).padStart(20, '0');
  return { token, link: `${ORIGIN}/d/${token}/` };
}
