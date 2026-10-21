/**
 * 联网短口令编解码单测（纯函数，无云盘/浏览器依赖）：
 * ① 20 位十六进制分享凭据 ↔ 16 位 Base32 短码无损往返；② 固定 22 字符、四位一组；
 * ③ 大小写/分隔符/形近字符（O→0、I/L→1）容错；④ 非标准凭据走 ONX 全量保留；
 * ⑤ 旧口令前缀（ONV1/ONV2/ONTOUCH1/ONORG1）不会被误判成短口令；
 * ⑥ 非清华云盘/带查询串/过短 token 的链接拒绝。
 */
import assert from 'node:assert/strict';
import { shortCodeForLink, isShortCode, linkForShortCode } from '../apps/desktop/src/lib/shortCode.ts';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('✓ ' + m); };
const throws = (fn, re, m) => {
  try { fn(); } catch (e) { ok(re.test(e.message), m + '（' + e.message + '）'); return; }
  ok(false, m + '：本应抛错却没有');
};
const link = token => `https://cloud.tsinghua.edu.cn/d/${token}/`;
const TOKENS = [
  '0123456789abcdef0123', 'fedcba9876543210fedc', 'a0b1c2d3e4f5a6b7c8d9', 'ffffffffffffffffffff', '00000000000000000000',
];

for (const token of TOKENS) {
  const code = shortCodeForLink(link(token));
  ok(/^ON(-[0-9A-Z]{4}){4}$/.test(code), `${token} → 短码四位一组、22 字符：${code}`);
  ok(code.length === 22, `${token} → 短码定长 22（与内容大小无关）`);
  ok(linkForShortCode(code).token === token, `${token} → 短码还原出原 token（无损）`);
  ok(linkForShortCode(code).link === link(token), `${token} → 还原链接与云盘口径一致`);
  ok(shortCodeForLink(linkForShortCode(code).link) === code, `${token} → 再编码稳定（确定性）`);
}

/* 大小写、空格、换行、连写都能识别 */
const probe = shortCodeForLink(link('a0b1c2d3e4f5a6b7c8d9'));
ok(linkForShortCode(probe.toLowerCase()).token === 'a0b1c2d3e4f5a6b7c8d9', '全小写短码可用');
ok(linkForShortCode('  ' + probe + '\n').token === 'a0b1c2d3e4f5a6b7c8d9', '首尾空白/换行可容忍');
ok(linkForShortCode(probe.replace(/-/g, ' ')).token === 'a0b1c2d3e4f5a6b7c8d9', '分隔符换成空格仍可识别');
ok(linkForShortCode(probe.replace(/-/g, '')).token === 'a0b1c2d3e4f5a6b7c8d9', '去掉分隔符（连写）仍可识别');

/* Crockford 形近字符：O↔0、I/L↔1 自动纠正 */
ok(linkForShortCode(probe.replace(/0/g, 'O')).token === 'a0b1c2d3e4f5a6b7c8d9', '字母 O 自动按 0 纠正');
ok(linkForShortCode(probe.replace(/1/g, 'L')).token === 'a0b1c2d3e4f5a6b7c8d9', '字母 L 自动按 1 纠正');

/* 坏输入明确失败，不静默产出错误 token */
throws(() => linkForShortCode(probe.replace(/-/g, '').slice(0, 14)), /四组/, '少一组报缺少错误');
throws(() => linkForShortCode('ON-UUUU-UUUU-UUUU-UUUU'), /无法识别的字符/, '字母表外字符报错');
throws(() => linkForShortCode('ONX.short'), /格式不完整/, 'ONX token 过短报错');
throws(() => linkForShortCode('hello world'), /不是 OneTHU 短口令/, '普通文本不会被当成短口令');

/* 非 20 位小写十六进制（非标准凭据）：ONX 全量保留，不截断随机性 */
const odd = 'AbC_x9Qz';
const oddCode = shortCodeForLink(link(odd));
ok(oddCode === 'ONX.AbC_x9Qz', '非标准 token 走 ONX 原样保留：' + oddCode);
ok(linkForShortCode(oddCode).token === odd, 'ONX 往返不丢字符');
ok(linkForShortCode(oddCode).link === link(odd), 'ONX 还原为同一条云盘链接');

/* 链接形态校验 */
throws(() => shortCodeForLink('https://cloud.tsinghua.edu.cn/d/abc/'), /不支持的分享链接/, 'token 过短拒绝');
throws(() => shortCodeForLink('https://cloud.tsinghua.edu.cn/d/0123456789abcdef0123/?p=1'), /不支持的分享链接/, '带查询串拒绝');
throws(() => shortCodeForLink('https://cloud.tsinghua.edu.cn/d/0123456789abcdef0123/#x'), /不支持的分享链接/, '带片段拒绝');
throws(() => shortCodeForLink('https://evil.example.com/d/0123456789abcdef0123/'), /不支持的分享链接/, '非清华云盘源站拒绝');
ok(shortCodeForLink('https://cloud.tsinghua.edu.cn/f/0123456789abcdef0123/').startsWith('ON-'), '文件分享（/f/）同样可短写');

/* 旧口令前缀绝不误判为短口令（旧口令继续走原解码链） */
for (const old of ['ONV1.eyJ2IjoxfQ.01234567', 'ONV2.eyJ2IjoxfQ.' + 'a'.repeat(32), 'ONTOUCH1.eyJ2IjoxfQ.01234567', 'ONORG1.eyJ2IjoxfQ.01234567', 'ON', 'ONX', 'ONE-AAAA-AAAA-AAAA-AAAA', '']) {
  ok(!isShortCode(old), '旧/无关前缀不被识别为短口令：' + JSON.stringify(old.slice(0, 24)));
}
for (const s of [probe, probe.toLowerCase(), ' on-' + probe.slice(3), 'ONX.AbC_x9Q', 'onx.abc_def123']) {
  ok(isShortCode(s), '短码形态被识别：' + JSON.stringify(s.slice(0, 26)));
}

/* 20 位十六进制空间 2^80 → 16×5bit 无损，抽样确认无碰撞 */
const seen = new Set();
for (let i = 0; i < 500; i++) {
  const token = (BigInt(i) * 0x9e3779b97f4a7c15n % (1n << 80n)).toString(16).padStart(20, '0');
  const code = shortCodeForLink(link(token));
  assert.ok(!seen.has(code), '抽样无碰撞');
  seen.add(code);
  assert.equal(linkForShortCode(code).token, token);
}
ok(true, '500 个抽样 token 往返全部无损且无碰撞');

console.log(n + ' short-code assertions passed');
