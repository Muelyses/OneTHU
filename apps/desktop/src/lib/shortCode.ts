/** 清华云盘分享凭据的无损短写；不存放内容，也不截断凭据。 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ORIGIN = 'https://cloud.tsinghua.edu.cn';

export function shortCodeForLink(link: string): string {
  const url = new URL(link);
  const token = url.pathname.match(/^\/d\/([A-Za-z0-9_-]{8,128})\/?$/)?.[1];
  if (url.origin !== ORIGIN || !token || url.search || url.hash) throw new Error('云盘返回了不支持的分享链接');
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
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) throw new Error('短口令格式不完整');
    return { token, link: `${ORIGIN}/d/${token}/` };
  }
  const compact = raw.toUpperCase().replace(/[\s-]/g, '');
  if (!compact.startsWith('ON')) throw new Error('不是 OneTHU 短口令');
  const body = compact.slice(2).replace(/O/g, '0').replace(/[IL]/g, '1');
  if (body.length !== 16) throw new Error('短口令应有四组、每组四个字符，请完整复制');
  let value = 0n;
  for (const c of body) {
    const digit = ALPHABET.indexOf(c);
    if (digit < 0) throw new Error('短口令含有无法识别的字符');
    value = (value << 5n) | BigInt(digit);
  }
  const token = value.toString(16).padStart(20, '0');
  return { token, link: `${ORIGIN}/d/${token}/` };
}
