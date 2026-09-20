/** ts SDK 分流规则测试：HttpClient.resolveUrl 与 request 的单一真源验证 */
import { HttpClient, MemoryCookieJar } from "../packages/core/src/http.ts";
import { webvpnWrap } from "../packages/core/src/crypto/webvpn.ts";

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return; }
  fail++; console.error(`✗ ${label}\n  期望: ${expected}\n  实际: ${actual}`);
}

function makeClient(webVPN) {
  const c = new HttpClient({
    jar: new MemoryCookieJar(),
    fetch: async () => new Response("ok"),
    webVPN,
  });
  c.webVPNEncoder = webvpnWrap;
  return c;
}

const INNER = "https://nautilus.tsinghua.edu.cn/api/list";     // 校内网关域（需包装）
const PUBLIC = "https://ai.tuoj.thusaac.com/api/user";        // 直连白名单（公网）
const LOGIN = "https://id.tsinghua.edu.cn/do/off/out.html";   // 登录链公共域
const LEARN = "https://learn.tsinghua.edu.cn/f/index";

// 直连模式实例（桌面直连桶）
const direct = makeClient(false);
// auto：白名单与登录域直连原样
eq(direct.resolveUrl(PUBLIC), PUBLIC, "auto 白名单域直连");
eq(direct.resolveUrl(LOGIN), LOGIN, "auto 登录域直连");
// auto：内网域包装（encodeUrl 会改写 host，仅校验前缀）
eq(direct.resolveUrl(INNER).startsWith("https://webvpn.tsinghua.edu.cn/"), true, "auto 内网域包装");
// auto：webvpn 物理域不再二次包装
eq(direct.resolveUrl("https://webvpn.tsinghua.edu.cn/x/y"), "https://webvpn.tsinghua.edu.cn/x/y", "auto webvpn 域免二次包装");

// webvpn 模式实例（移动端包装桶）：白名单语义不变，learn 例外
const wrapped = makeClient(true);
eq(wrapped.resolveUrl(LEARN), LEARN, "webvpn 模式 learn 仍直连");
eq(wrapped.resolveUrl(INNER).startsWith("https://webvpn.tsinghua.edu.cn/"), true, "webvpn 模式内网域包装");

// 强制模式：direct 恒直连；webvpn 强制包装（白名单域不受影响）
eq(direct.resolveUrl(INNER, { mode: "direct" }), INNER, "direct 强制直连");
// 白名单域（TUOJ 公网直连是 2026-09-18 实证定案：包装会坏 CAS 会话）即便强制
// webvpn 也保持直连——实证边界优先于模式参数，SDK 文档需同步说明
eq(direct.resolveUrl(PUBLIC, { mode: "webvpn" }), PUBLIC, "webvpn 强制下白名单域仍直连（实证例外）");
eq(direct.resolveUrl(LOGIN, { mode: "webvpn" }), LOGIN, "webvpn 强制不二次包装登录域");

// request 与 resolveUrl 行为一致：direct 标志经 request 走同一真源
{
  let seen = null;
  const c = new HttpClient({
    jar: new MemoryCookieJar(),
    fetch: async (url) => { seen = String(url); return new Response("ok"); },
  });
  c.webVPNEncoder = webvpnWrap;
  await c.request(INNER, { direct: true });
  eq(seen, INNER, "request direct 标志与 resolveUrl direct 一致");
  await c.request(INNER, {});
  eq(seen?.startsWith("https://webvpn.tsinghua.edu.cn/"), true, "request auto 与 resolveUrl auto 一致");
}

// 畸形 URL 原样返回不抛
eq(direct.resolveUrl("not-a-url"), "not-a-url", "畸形 URL 原样返回");

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
