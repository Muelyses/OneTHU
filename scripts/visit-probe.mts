/**
 * 行在清华「临时来访人员报备」拆解探针（visit.tsinghua.edu.cn，2026-10-15）。
 *
 * 来源：行在清华小程序（wx3cfa534a23db4039）解包后首页卡片
 *   { title:"临时来访人员报备", path:"https://visit.tsinghua.edu.cn/visitor/mobile/login" }
 * 配方与清小搭同一套（scripts/xiaoda-probe.mts）：
 *   ① GET ITS 服务表单（clientId = 04655f71b042b9d2d8d10cd566bd9c39，取自 SPA 的 ssoProps.js）
 *   ② POST /do/off/ui/auth/login/check（完整登录字段集 + 受信指纹）
 *   ③ 取漫游 ticket
 *   ④ POST /visitor/mbpmApi/mbpm/identity/ssoLogin {clientId, ticket} → 内部 token
 *   ⑤ token 头逐个打业务端点，摸清「临时来访报备」的读取/写入面
 *
 * 用法：pnpm exec tsx scripts/visit-probe.mts
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_USER_AGENT } from "../packages/core/src/index.js";
import { encryptPassword } from "../packages/core/src/crypto/sm2.js";

const SITE = "https://visit.tsinghua.edu.cn";
const API = `${SITE}/visitor/mbpmApi/mbpm`;
const CLIENT_ID = "04655f71b042b9d2d8d10cd566bd9c39";
const ITS_SVC = `https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/${CLIENT_ID}/0?/visitor/mobile/sso`;
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

async function req(
  method: "GET" | "POST",
  url: string,
  opts: { cookies?: string; data?: Record<string, string>; body?: string; headers?: Record<string, string>; json?: boolean } = {},
): Promise<{ url: string; html: string; cookies: string; status: number }> {
  let cookies = opts.cookies ?? "";
  let currentUrl = url;
  let m = method;
  let body: string | undefined = opts.body ?? (opts.data ? new URLSearchParams(opts.data).toString() : undefined);
  for (let hop = 0; hop < 14; hop++) {
    const headers: Record<string, string> = { "User-Agent": DEFAULT_USER_AGENT, ...(opts.headers ?? {}) };
    if (cookies) headers.Cookie = cookies;
    if (body !== undefined && !headers["Content-Type"]) {
      headers["Content-Type"] = opts.json ? "application/json" : "application/x-www-form-urlencoded";
    }
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
        console.log(`    → ${res.status} ${loc.slice(0, 140)}`);
        currentUrl = new URL(loc, currentUrl).toString();
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && m === "POST")) {
          m = "GET";
          body = undefined;
        }
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
console.log(`[visit] 账号=${cred.username} fingerPrint=${sess.fingerprint ? sess.fingerprint.slice(0, 10) + "..." : "(空)"}`);

/** 完整登录一次，返回新 ticket（票据多为一次性，故每个候选各取一张） */
async function freshTicket(): Promise<string> {
  const form = await req("GET", ITS_SVC);
  const key = /id="sm2publicKey"[^>]*>\s*([0-9a-fA-F]{100,})\s*</.exec(form.html)?.[1] ?? "";
  if (key) {
    const enc = encryptPassword(password, key);
    const check = await req("POST", CAS_CHECK, {
      cookies: form.cookies,
      data: {
        i_user: cred.username,
        i_pass: enc,
        fingerPrint: sess.fingerprint ?? "",
        fingerGenPrint: sess.finger3 ?? "",
        fingerGenPrint3: "",
        i_captcha: "",
      },
    });
    const anchor = /<a[^>]+href="([^"]+)"/i.exec(check.html)?.[1] ?? "";
    if (anchor) {
      const ticketUrl = anchor.startsWith("http") ? anchor : new URL(anchor, check.url).toString();
      const t = new URL(ticketUrl).searchParams.get("ticket");
      if (t) return t;
    }
    const t2 = new URL(check.url).searchParams.get("ticket");
    if (t2) return t2;
    throw new Error(`完整登录未取到 ticket（status=${check.status}）`);
  }
  const action = /<form[^>]+action="([^"]+)"/i.exec(form.html)?.[1] ?? "/do/off/ui/auth/login/checkSingle";
  const hidden: Record<string, string> = {};
  for (const m of form.html.matchAll(/<input[^>]+type="hidden"[^>]*>/gi)) {
    const name = /name="([^"]+)"/i.exec(m[0])?.[1];
    const value = /value="([^"]*)"/i.exec(m[0])?.[1] ?? "";
    if (name) hidden[name] = value;
  }
  const check = await req("POST", new URL(action, form.url).toString(), {
    cookies: form.cookies,
    data: { ...hidden, i_rememberme: "on", fingerPrint: sess.fingerprint ?? "", fingerGenPrint: sess.finger3 ?? "" },
  });
  const anchor = /<a[^>]+href="([^"]+)"/i.exec(check.html)?.[1] ?? "";
  const ticketUrl = anchor ? (anchor.startsWith("http") ? anchor : new URL(anchor, check.url).toString()) : check.url;
  const t = new URL(ticketUrl).searchParams.get("ticket");
  if (!t) throw new Error(`checkSingle 未取到 ticket（status=${check.status}）`);
  return t;
}

console.log("\n[visit] ① 取票（完整登录 / checkSingle 自动分流）...");
const firstTicket = await freshTicket();
console.log(`[visit] ticket=${firstTicket.slice(0, 24)}...${firstTicket.length}`);

console.log("\n[visit] ② identity/ssoLogin 换内部 token（候选前缀 × 参数名 × 位置矩阵）...");
let token = "";
type Attempt = { prefix: string; param: "code" | "ticket"; where: "query" | "form" | "json" };
const attempts: Attempt[] = [];
for (const prefix of ["/visitor/mbpm", "/visitor/mbpmApi/mbpm"]) {
  for (const param of ["code", "ticket"] as const) {
    for (const where of ["query", "form", "json"] as const) attempts.push({ prefix, param, where });
  }
}
for (const a of attempts) {
  const ticket = await freshTicket();
  const kv = { clientId: CLIENT_ID, [a.param]: ticket } as Record<string, string>;
  const qs = new URLSearchParams(kv).toString();
  const url = a.where === "query" ? `${SITE}${a.prefix}/identity/ssoLogin?${qs}` : `${SITE}${a.prefix}/identity/ssoLogin`;
  const r = await req("POST", url, {
    body: a.where === "query" ? "" : a.where === "json" ? JSON.stringify(kv) : new URLSearchParams(kv).toString(),
    json: a.where === "json",
    headers: { "Content-Type": a.where === "json" ? "application/json" : "application/x-www-form-urlencoded" },
  });
  const head = r.html.slice(0, 150).replace(/\s+/g, " ");
  console.log(`  ${a.prefix} [${a.param}/${a.where}] -> HTTP ${r.status} ${head}`);
  try {
    const j = JSON.parse(r.html) as { code?: number; data?: { token?: string } | string; token?: string };
    const d = j.data;
    token = (typeof d === "string" ? d : d?.token) ?? j.token ?? "";
  } catch { /* ignore */ }
  if (token) { console.log(`  ==> 命中 ${a.prefix} [${a.param}/${a.where}]`); break; }
}
console.log(`[visit] token=${token ? token.slice(0, 20) + "..." + token.length : "(无)"}`);
if (!token) process.exit(1);

const H = { token };
console.log("\n[visit] ④ 业务端点枚举（token 头）...");
const eps = [
  "/identity/getUserInfo",
  "/identity/userInfo",
  "/app/getAppInfo",
  "/app/getAppList",
  "/formModel/getFormModel",
  "/mexform/getFormModel",
  "/electronicForm/getFormList",
  "/query/getQueryList",
  "/index/getIndexData",
  "/visitor/getVisitorList",
  "/visitorRecord/page",
  "/personalCenter/getUserInfo",
  "/onlineservicehall/getServiceList",
];
for (const ep of eps) {
  const r = await req("GET", `${API}${ep}`, { headers: H });
  console.log(`  ${ep} -> HTTP ${r.status} ${r.html.slice(0, 220).replace(/\s+/g, " ")}`);
}

console.log("\n[visit] ⑤ 首页文档（登录态下前端会拉什么清单）...");
const home = await req("GET", `${SITE}/visitor/mobile/`, { headers: H });
console.log(`  GET /visitor/mobile/ -> HTTP ${home.status} (${home.html.length} bytes)`);

console.log("\n[visit] ⑥ TOKEN 输出（供浏览器注入复测，勿外传）...");
console.log(token);
