/**
 * TUOJ 清华统一认证（CAS）漫游 —— 单测 / 联调脚本。
 *
 * 运行：node tools/tuoj-cas-test.mjs
 * 可选：source ~/.onethu-creds.env（提供 TYCHE_BASIC 时额外跑 Tyche 验证码探针）
 *
 * ⚠️ 本机没有清华统一认证会话，无法端到端跑通漫游；本脚本覆盖：
 *   ① oauth/info 能取到 CAS 漫游 url；② 表单 url 返回 200 且是 CAS 登录页；
 *   ③ 锚点提取 / 登录页判定 纯函数；④ 无会话时 tuojRoam 抛出可读错误（真实网络）。
 * 说明：core 源码内部用 `.js` 扩展名互引（TS bundler 解析），Node 直引需把
 * `.js` 重解析到 `.ts`——见下方 registerHooks（与 tools/exthw-smoke.mjs 同款限制）。
 */
import * as nodeModule from "node:module";

if (typeof nodeModule.registerHooks !== "function") {
  console.log(`本脚本需要 Node ≥ 22.15（module.registerHooks）以把 .js 直引重解析到 .ts；当前 ${process.version}，跳过。`);
  process.exit(0);
}

nodeModule.registerHooks({
  resolve(specifier, context, next) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js")) {
      try {
        return next(specifier.slice(0, -3) + ".ts", context);
      } catch {
        /* 落回原样 */
      }
    }
    return next(specifier, context);
  },
});

const { tuojRoam, TuojCasError, extractTicketAnchor, isCasLoginPage } = await import(
  "../packages/core/src/exthw/tuojCas.ts"
);

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? "  " + extra : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? "  " + extra : ""}`);
  }
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36";

/* ── 最小 HttpClient 替身（真实 fetch + 按域 CookieJar），供 tuojRoam 联调 ── */
function makeFakeHttp() {
  const jar = new Map(); // host → Map(name → value)
  const put = (host, name, value) => {
    if (!jar.has(host)) jar.set(host, new Map());
    jar.get(host).set(name, value);
  };
  const getCookies = (url) => {
    const host = new URL(url).hostname.toLowerCase();
    const out = [];
    for (const [h, m] of jar) {
      if (host === h || host.endsWith("." + h)) for (const [name, value] of m) out.push({ name, value });
    }
    return out;
  };
  const cookieHeader = (url) => {
    const c = getCookies(url);
    return c.length ? c.map((x) => `${x.name}=${x.value}`).join("; ") : null;
  };
  return {
    lastFinalUrl: "",
    jar: { getCookies },
    cookieHeaderFor: cookieHeader,
    async request(url, init = {}) {
      const { direct: _direct, ...rest } = init;
      const headers = new Headers(rest.headers ?? {});
      const ck = cookieHeader(url);
      if (ck && !headers.has("Cookie")) headers.set("Cookie", ck);
      if (!headers.has("User-Agent")) headers.set("User-Agent", UA);
      const res = await fetch(url, { ...rest, headers, redirect: "follow" });
      const host = new URL(res.url || url).hostname.toLowerCase();
      const lines = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      for (const line of lines) {
        const m = /^([^=;]+)=([^;]*)/.exec(line);
        if (m) put(host, m[1].trim(), m[2]);
      }
      this.lastFinalUrl = res.url || url;
      return res;
    },
  };
}

console.log("① oauth/info（真实网络）");
const infoRes = await fetch("https://ai.tuoj.thusaac.com/api/user/oauth/info", { headers: { "User-Agent": UA } });
const info = await infoRes.json();
check("HTTP 200", infoRes.status === 200, `status=${infoRes.status}`);
check("tsinghua.enable === true", info?.tsinghua?.enable === true, JSON.stringify(info?.tsinghua?.enable));
check(
  "url 是 CAS 漫游表单地址",
  typeof info?.tsinghua?.url === "string" &&
    info.tsinghua.url.startsWith("https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/") &&
    info.tsinghua.url.includes("/api/user/tsinghua/roaming/AI-TUOJ"),
  info?.tsinghua?.url,
);

console.log("\n② 表单 url → 无会话时是 CAS 登录页（真实网络）");
const formUrl = info.tsinghua.url;
const formRes = await fetch(formUrl, { headers: { "User-Agent": UA }, redirect: "follow" });
const formHtml = await formRes.text();
check("HTTP 200", formRes.status === 200, `status=${formRes.status}`);
check("isCasLoginPage(html) === true", isCasLoginPage(formHtml) === true, `body=${formHtml.length}B`);
check("登录页锚点不含 ticket（不会误跟）", !String(extractTicketAnchor(formHtml) ?? "").includes("ticket="), String(extractTicketAnchor(formHtml)));

console.log("\n③ 纯函数单测（构造页）");
const successPage =
  '<html><body>登录成功<script>x</script><a href="https://ai.tuoj.thusaac.com/api/user/tsinghua/roaming/AI-TUOJ?ticket=ST-123456-abc">跳转</a></body></html>';
check(
  "成功页锚点提取",
  extractTicketAnchor(successPage) ===
    "https://ai.tuoj.thusaac.com/api/user/tsinghua/roaming/AI-TUOJ?ticket=ST-123456-abc",
  String(extractTicketAnchor(successPage)),
);
check("相对锚点提取", extractTicketAnchor('<a href="/x?ticket=ST-1">go</a>') === "/x?ticket=ST-1");
check("无锚点 → null", extractTicketAnchor("<html>no link</html>") === null);
check("isCasLoginPage: sm2publicKey", isCasLoginPage('<input id="sm2publicKey" value="aa">') === true);
check("isCasLoginPage: i_pass", isCasLoginPage('<input name="i_pass">') === true);
check("isCasLoginPage: 业务页 → false", isCasLoginPage("<html><body>TUOJ</body></html>") === false);

console.log("\n④ tuojRoam 无统一认证会话 → 可读错误（真实网络，最小 HttpClient 替身）");
try {
  await tuojRoam(makeFakeHttp());
  check("应抛错但未抛", false);
} catch (e) {
  check("抛 TuojCasError", e instanceof TuojCasError, e?.constructor?.name);
  check(
    "错误消息含「需先登录清华统一认证」",
    e instanceof TuojCasError && e.message.includes("需先登录清华统一认证"),
    e?.message,
  );
}

/* ── Tyche 验证码探针（可选：需 TYCHE_BASIC） ── */
if (process.env.TYCHE_BASIC) {
  console.log("\n⑤ Tyche vcode 探针（真实网络）");
  const basic = `Basic ${Buffer.from(process.env.TYCHE_BASIC).toString("base64")}`;
  const tRes = await fetch("http://166.111.236.164:6080/tyche/user/GetToken?username=root", {
    headers: { Authorization: basic, "User-Agent": UA },
  });
  const tJson = await tRes.json().catch(() => null);
  check("GetToken 可用（status=success）", tJson?.status === "success", JSON.stringify(tJson));
  check("GetToken 返回 vcode 字段", typeof tJson?.vcode === "boolean", `vcode=${tJson?.vcode}`);
} else {
  console.log("\n⑤ Tyche vcode 探针：跳过（未设置 TYCHE_BASIC）");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败。`);
process.exit(fail === 0 ? 0 : 1);
