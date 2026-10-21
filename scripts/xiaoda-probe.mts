/**
 * 最小验证（v3 直连独立版）：清小搭（www.xiaoda.tsinghua.edu.cn）免微信全链路。
 * 纯直连、零 webvpn 依赖、零既有会话依赖（照搬 demoEnterLearn 的「完整登录」配方）：
 * ① GET ITS 服务表单（xiaoda service d982b7…）→ 提取 #sm2publicKey
 * ② POST /do/off/ui/auth/login/check（learn-lib 字段集：i_user / i_pass(SM2密文) /
 *    fingerPrint / fingerGenPrint / fingerGenPrint3 / i_captcha，不发 singleLogin）
 *    → 成功页锚点（…/login.html?ticket=…）→ 漫游 ticket
 * ③ GET xiaoda /api/token/login?ticket=… → 内部 token
 * ④ /api/token/getUserInfo（token 头）身份核验
 * ⑤ /api/dadou/balance（token 头）业务接口验证
 * ⑥ POST /v1/chat/completions 试探（澄清该串是否真实端点；i18n 文案疑云）
 * v1/v2 教训：ITS 漫游不进 webvpn 隧道；demoLogin 尾串的 JSESSIONID 不足以直连出票
 *           ——正解 = 对目标 service 表单做完整登录（fresh 会话 + trusted fingerPrint）。
 * 用法：pnpm exec tsx scripts/xiaoda-probe.mts
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_USER_AGENT } from "../packages/core/src/index.js";
import { encryptPassword } from "../packages/core/src/crypto/sm2.js";

const XIAODA = "https://www.xiaoda.tsinghua.edu.cn";
const ITS_LOGIN_SVC = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/d982b795884e882abfa8ff3167aeb03e/0?/login.html";
const CAS_CHECK = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/check";

const STATE = join(homedir(), "Library/Application Support/app.onethu.desktop/state");
const SECRET_MAGIC = "onethu-secret-v1:";

function deobfuscate(stored: string, username: string): string {
  if (!stored.startsWith(SECRET_MAGIC)) return "";
  const bin = atob(stored.slice(SECRET_MAGIC.length));
  const key = new TextEncoder().encode(`OneTHU|${username}|remember`);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ key[i % key.length]!;
  return new TextDecoder().decode(bytes);
}

/** mini webvpnRequest（字符串 cookie 模型，手动跟跳 ≤14，Set-Cookie 同名覆盖） */
async function req(
  method: "GET" | "POST",
  url: string,
  opts: { cookies?: string; data?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<{ url: string; html: string; cookies: string; status: number }> {
  let cookies = opts.cookies ?? "";
  let currentUrl = url;
  let m = method;
  let body: string | undefined = opts.data ? new URLSearchParams(opts.data).toString() : undefined;
  for (let hop = 0; hop < 14; hop++) {
    const headers: Record<string, string> = { "User-Agent": DEFAULT_USER_AGENT, ...(opts.headers ?? {}) };
    if (cookies) headers.Cookie = cookies;
    if (body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/x-www-form-urlencoded";
    const res = await fetch(currentUrl, { method: m, body, headers, redirect: "manual" });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const mm = /^([^=]+)=([^;]*)/.exec(sc);
      if (mm?.[1]) {
        const name = mm[1].trim();
        const rest = cookies.split("; ").filter((p) => p && !p.startsWith(name + "="));
        rest.push(`${name}=${mm[2] ?? ""}`);
        cookies = rest.join("; ");
      }
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (loc && loc !== "null") {
        console.log(`    → ${res.status} ${loc.slice(0, 100)}`);
        currentUrl = new URL(loc, currentUrl).toString();
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && m === "POST")) { m = "GET"; body = undefined; }
        continue;
      }
    }
    return { url: currentUrl, html: await res.text(), cookies, status: res.status };
  }
  throw new Error("重定向超限（probe）");
}

const cred = JSON.parse(readFileSync(join(STATE, "credentials.json"), "utf8")) as { username: string; secret: string };
const password = deobfuscate(cred.secret, cred.username);
if (!password) throw new Error("凭据解不出");
const sess = JSON.parse(readFileSync(join(STATE, "session.json"), "utf8")) as { fingerprint?: string; finger3?: string };
const fingerprint = sess.fingerprint ?? "";
const finger3 = sess.finger3 ?? "";
console.log(`[xd] 账号=${cred.username} fingerPrint=${fingerprint ? fingerprint.slice(0, 10) + "…" : "(空)"}`);

console.log("\n[xd] ① GET ITS 服务表单（xiaoda service）…");
const form = await req("GET", ITS_LOGIN_SVC);
const key = /id="sm2publicKey"[^>]*>\s*([0-9a-fA-F]{100,})\s*</.exec(form.html)?.[1] ?? "";
const formAction = /<form[^>]+action="([^"]+)"/i.exec(form.html)?.[1] ?? "";
console.log(`[xd] 表单页 ${form.url.slice(0, 120)} status=${form.status}`);
console.log(`[xd] sm2publicKey=${key ? key.slice(0, 20) + "…(" + key.length + " hex)" : "(无!)"} action=${formAction || "(默认)"} cookies=[${form.cookies.split("; ").map((c) => c.split("=")[0]).join(",")}]`);
if (!key) {
  console.log(`[xd] ❌ 表单页无公钥。body 前 400 字：${form.html.slice(0, 400).replace(/\s+/g, " ")}`);
  process.exit(1);
}

console.log("\n[xd] ② POST 完整登录（demoEnterLearn 字段集，硬编码 CAS_CHECK——表单页首个 form 是语言切换表单，登录表单由 JS 提交到 check）…");
const enc = encryptPassword(password, key);
const check = await req("POST", CAS_CHECK, {
  cookies: form.cookies,
  data: {
    i_user: cred.username,
    i_pass: enc,
    fingerPrint: fingerprint,
    fingerGenPrint: finger3,
    fingerGenPrint3: "",
    i_captcha: "",
  },
});
console.log(`[xd] CHECK 终=${check.url.slice(0, 160)} status=${check.status}`);

let ticket = "";
let ticketUrl = "";
const anchor = /<a[^>]+href="([^"]+)"/i.exec(check.html)?.[1] ?? "";
if (anchor) {
  ticketUrl = anchor.startsWith("http") ? anchor : new URL(anchor, check.url).toString();
  try { ticket = new URL(ticketUrl).searchParams.get("ticket") ?? ""; } catch { /* ignore */ }
  if (!ticket) ticket = anchor.split("=").slice(-1)[0] ?? "";
}
if (!ticket) {
  try { ticket = new URL(check.url).searchParams.get("ticket") ?? ""; ticketUrl = check.url; } catch { /* ignore */ }
}
console.log(`[xd] 锚点=${anchor ? anchor.slice(0, 110) : "(none)"} → ticket=${ticket ? ticket.slice(0, 24) + "…(" + ticket.length + ")" : "(无)"}`);
if (!ticket && /二次认证|doubleauth|双因素/i.test(check.html) && !/登录成功|正在重定向/.test(check.html)) {
  console.log("[xd] ❌ 触发二次认证（2FA）——受信指纹未生效，需人工过一次或检查 session.json 指纹");
  process.exit(1);
}
if (!ticket) {
  console.log(`[xd] ❌ 未取到 ticket。CHECK body 前 500 字：${check.html.slice(0, 500).replace(/\s+/g, " ")}`);
  process.exit(1);
}

console.log("\n[xd] ③ /api/token/login 兑换内部 token…");
const tokenRes = await req("GET", `${XIAODA}/api/token/login?ticket=${encodeURIComponent(ticket)}`);
console.log(`[xd] HTTP ${tokenRes.status} → ${tokenRes.html.slice(0, 420)}`);
let token = "";
try { const j = JSON.parse(tokenRes.html); token = j?.data?.token ?? j?.token ?? ""; } catch { /* ignore */ }
if (!token) token = /"token"\s*:\s*"([^"]+)"/.exec(tokenRes.html)?.[1] ?? "";
if (!token) {
  console.log("[xd] ❌ 未取到内部 token");
  process.exit(1);
}
console.log(`[xd] ✅ token=${token.slice(0, 18)}…(${token.length} chars)`);

console.log("\n[xd] ④ /api/token/getUserInfo 身份核验…");
const ui = await req("GET", `${XIAODA}/api/token/getUserInfo`, { headers: { token } });
console.log(`[xd] HTTP ${ui.status} → ${ui.html.slice(0, 500)}`);

console.log("\n[xd] ⑤ /api/dadou/balance 业务接口（token 头）…");
const beans = await req("GET", `${XIAODA}/api/dadou/balance`, { headers: { token } });
console.log(`[xd] HTTP ${beans.status} → ${beans.html.slice(0, 400)}`);

console.log("\n[xd] ⑥ POST /v1/chat/completions 端点澄清试探…");
const chatRes = await fetch(`${XIAODA}/v1/chat/completions`, {
  method: "POST",
  headers: { "User-Agent": DEFAULT_USER_AGENT, token, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "xiaoda", stream: false, messages: [{ role: "user", content: "1+1=?" }] }),
});
console.log(`[xd] HTTP ${chatRes.status} → ${(await chatRes.text()).slice(0, 300)}`);

console.log("\n[xd] ⑦ 业务端点枚举（新 token 直击）…");
const eps = [
  "/api/group/builtin/list",
  "/api/group/agent/recommend",
  "/api/agent/center/page",
  "/api/namespace/list",
  "/api/skill/plaza/categories",
  "/api/skill/plaza/list",
  "/api/skill/plaza/overview",
  "/api/chats/list",
  "/api/conversation/page",
  "/api/conversation/get",
  "/api/opencoze/customModel/list",
];
for (const ep of eps) {
  const r = await req("GET", `${XIAODA}${ep}`, { headers: { token } });
  console.log(`  ${ep} → HTTP ${r.status} ${r.html.slice(0, 260)}`);
}

console.log("\n[xd] ⑧ chat 请求体实测（agent id vs 模型名）…");
async function tryChat(label: string, payload: unknown) {
  const r = await fetch(`${XIAODA}/v1/chat/completions`, {
    method: "POST",
    headers: { "User-Agent": DEFAULT_USER_AGENT, token, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  console.log(`  [${label}] HTTP ${r.status} → ${text.slice(0, 420)}`);
}
await tryChat("agent模型", { model: "agent:1888922258860593152", stream: false, messages: [{ role: "user", content: "一句话介绍你自己" }] });
await tryChat("agent_id字段", { agent_id: "1888922258860593152", model: "GLM-5.3", stream: false, messages: [{ role: "user", content: "一句话介绍你自己" }] });
await tryChat("裸模型名", { model: "GLM-5.3", stream: false, messages: [{ role: "user", content: "1+1=?" }] });

console.log("\n[xd] ⑨ 默认智能体 9999 实测（UAP 路由）…");
async function tryChat2(label: string, payload: unknown) {
  const r = await fetch(`${XIAODA}/v1/chat/completions`, {
    method: "POST",
    headers: { "User-Agent": DEFAULT_USER_AGENT, token, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  console.log(`  [${label}] HTTP ${r.status} → ${text.slice(0, 400)}`);
  return r.status;
}
await tryChat2("agent:9999 非流式", { model: "agent:9999", stream: false, messages: [{ role: "user", content: "用一句话自我介绍" }] });
const sse = await fetch(`${XIAODA}/v1/chat/completions`, {
  method: "POST",
  headers: { "User-Agent": DEFAULT_USER_AGENT, token, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "agent:9999", stream: true, messages: [{ role: "user", content: "1+1等于几？" }] }),
});
console.log(`  [agent:9999 流式] HTTP ${sse.status} content-type=${sse.headers.get("content-type")}`);
if (sse.ok && sse.body) {
  const rd = sse.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let lines = 0;
  while (lines < 14) {
    const { done, value } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const ln of parts) {
      if (ln.trim()) { console.log(`    | ${ln.slice(0, 150)}`); lines++; }
      if (lines >= 14) break;
    }
  }
  rd.cancel().catch(() => undefined);
}

console.log("\n[xd] ⑩ 广场智能体查询 + conversation/create 实测…");
async function jget(label: string, url: string) {
  const r = await req("GET", url, { headers: { token } });
  console.log(`  [${label}] HTTP ${r.status} → ${r.html.slice(0, 360)}`);
  return r.html;
}
await jget("agent/query 裸", `${XIAODA}/api/namespace/agent/query`);
await jget("agent/query ns", `${XIAODA}/api/namespace/agent/query?namespaceId=2020073574757318656`);
await jget("agent/query page", `${XIAODA}/api/namespace/agent/query?pageNum=1&pageSize=8`);
const createRes = await fetch(`${XIAODA}/api/conversation/create`, {
  method: "POST",
  headers: { "User-Agent": DEFAULT_USER_AGENT, token, "Content-Type": "application/json" },
  body: JSON.stringify({ agentId: "9999", query: "你好" }),
});
console.log(`  [conversation/create] HTTP ${createRes.status} → ${(await createRes.text()).slice(0, 360)}`);
await jget("chats/list 带参", `${XIAODA}/api/chats/list?agentId=9999&pageNum=1&pageSize=5`);

console.log("\n[xd] ⑪ 字段形状全览…");
async function dump(label: string, url: string) {
  const r = await req("GET", url, { headers: { token } });
  try {
    const j = JSON.parse(r.html);
    const d = j?.data;
    const sample = Array.isArray(d?.dataList) ? d.dataList[0] : Array.isArray(d) ? d[0] : d;
    console.log(`  [${label}] keys=${Object.keys(sample ?? {}).join(",")}`);
    console.log(`    样本=${JSON.stringify(sample).slice(0, 500)}`);
  } catch { console.log(`  [${label}] HTTP ${r.status} ${r.html.slice(0, 200)}`); }
}
await dump("会话", `${XIAODA}/api/conversation/page?pageNum=1&pageSize=2`);
await dump("技能", `${XIAODA}/api/skill/plaza/list?pageNum=1&pageSize=2`);
await dump("智能体组", `${XIAODA}/api/group/builtin/list`);
