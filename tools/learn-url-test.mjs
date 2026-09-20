/**
 * learn 页面 href → 可请求 URL 的判读（纯函数）。
 *
 * 真机事故：通知附件下载地址变成
 *   https://webvpn.tsinghua.edu.cn/https/<hexLearn>/https/<hexLearn>/b/wlxt/kcgg/…
 * 也就是**双重 webvpn 包装** → 404，预览与下载全废。
 * 原因：learn 页面是经 webvpn 取回的，wengine 已把页面里的链接改写成 `/https/<hex>/…`，
 * 而 LEARN_PREFIX 本身就是包装后的 learn 根，再拼一次就套了两层。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/learn-url-test.mjs
 */
const { learnAbsoluteUrl, LEARN_PREFIX } = await import("../packages/core/src/learn/urls.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const GATEWAY_PATH = "/https/77726476706e69737468656265737421fcf2408e297e7c4377068ea48d546d30ca8cc97bcc";

/* ① 网关相对路径（已被 wengine 改写）：只补域名，绝不再拼一次前缀 */
{
  const href = `${GATEWAY_PATH}/b/wlxt/kcgg/wlkc_ggb/student/kcggFjxz?wlkcid=1&ggid=2&wjid=3`;
  const out = learnAbsoluteUrl(href);
  eq("网关相对路径：只补域名", out, `https://webvpn.tsinghua.edu.cn${href}`);
  eq("不再出现双重包装", (out.match(/\/https\//g) ?? []).length, 1);
  ok("前缀本身就是包装后的 learn 根", LEARN_PREFIX.startsWith("https://webvpn.tsinghua.edu.cn/https/"));
}

/* ② 普通相对路径：仍按 LEARN_PREFIX 拼（单层包装） */
{
  eq("普通路径", learnAbsoluteUrl("/b/wlxt/kj/wlkc_kjxxb/student/downloadFile?wjid=1"),
     `${LEARN_PREFIX}/b/wlxt/kj/wlkc_kjxxb/student/downloadFile?wjid=1`);
  eq("不带前导斜杠也认", learnAbsoluteUrl("b/wlxt/x"), `${LEARN_PREFIX}/b/wlxt/x`);
  eq("包装路径出现两次也不会重复拼", (learnAbsoluteUrl(`${GATEWAY_PATH}/b/x`).match(/\/https\//g) ?? []).length, 1);
}

/* ③ 已是绝对地址：原样返回（可能自己就是包装好的） */
{
  const abs = `https://webvpn.tsinghua.edu.cn${GATEWAY_PATH}/b/wlxt/x`;
  eq("绝对包装地址原样", learnAbsoluteUrl(abs), abs);
  eq("裸 learn 绝对地址原样", learnAbsoluteUrl("https://learn.tsinghua.edu.cn/b/x"), "https://learn.tsinghua.edu.cn/b/x");
  eq("空串原样", learnAbsoluteUrl(""), "");
}

/* ④ 自愈网：任何来源的双重包装地址都归一成单层（真机事故那条 URL 的回归） */
{
  const { normalizeWebvpnUrl } = await import("../packages/core/src/crypto/webvpn.ts");
  const hex = "77726476706e69737468656265737421fcf2408e297e7c4377068ea48d546d30ca8cc97bcc";
  const doubled = `https://webvpn.tsinghua.edu.cn/https/${hex}/https/${hex}/b/wlxt/kcgg/wlkc_ggb/student/kcggFjxz?wlkcid=1&wjid=2`;
  eq("双重包装归一成单层", normalizeWebvpnUrl(doubled), `https://webvpn.tsinghua.edu.cn/https/${hex}/b/wlxt/kcgg/wlkc_ggb/student/kcggFjxz?wlkcid=1&wjid=2`);
  eq("单层包装原样", normalizeWebvpnUrl(`https://webvpn.tsinghua.edu.cn/https/${hex}/b/x`), `https://webvpn.tsinghua.edu.cn/https/${hex}/b/x`);
  eq("非 webvpn 地址原样", normalizeWebvpnUrl("https://learn.tsinghua.edu.cn/b/x"), "https://learn.tsinghua.edu.cn/b/x");
  const { webvpnWrap } = await import("../packages/core/src/crypto/webvpn.ts");
  eq("webvpnWrap 也自愈", webvpnWrap(doubled).includes(`/https/${hex}/https/`), false);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
