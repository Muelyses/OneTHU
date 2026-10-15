/**
 * 临时来访报备：把「登录→换 token→带会话调业务接口」的全过程连起来核对。
 * 目的：判断 token 是否与会话 cookie 绑定（先前无 cookie 调用一律回 token过期）。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_USER_AGENT } from "../packages/core/src/index.js";
import { encryptPassword } from "../packages/core/src/crypto/sm2.js";

const SITE = "https://visit.tsinghua.edu.cn";
const BASE = `${SITE}/visitor/mbpm`;
const CLIENT_ID = "04655f71b042b9d2d8d10cd566bd9c39";
const ITS_SVC = `https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/${CLIENT_ID}/0?/visitor/mobile/sso`;
const CAS_CHECK = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/check";
const STATE = join(homedir(), "Library/Application Support/app.onethu.desktop/state");

function deobfuscate(stored: string, username: string): string {
  const bin = atob(stored.slice("onethu-secret-v1:".length));
  const key = new TextEncoder().encode(`OneTHU|${username}|remember`);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ key[i % key.length]!;
  return new TextDecoder().decode(bytes);
}

async function req(
  method: "GET" | "POST",
  url: string,
  opts: { cookies?: string; data?: Record<string, string>; raw?: string; headers?: Record<string, string>; json?: boolean } = {},
) {
  let cookies = opts.cookies ?? "";
  let currentUrl = url;
  let m = method;
  let body: string | undefined = opts.raw ?? (opts.data ? new URLSearchParams(opts.data).toString() : undefined);
  for (let hop = 0; hop < 14; hop++) {
    const headers: Record<string, string> = { "User-Agent": DEFAULT_USER_AGENT, ...(opts.headers ?? {}) };
    if (cookies) headers.Cookie = cookies;
    if (body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = opts.json ? "application/json" : "application/x-www-form-urlencoded";
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
        currentUrl = new URL(loc, currentUrl).toString();
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && m === "POST")) { m = "GET"; body = undefined; }
        continue;
      }
    }
    return { url: currentUrl, text: await res.text(), cookies, status: res.status, setCookie: res.headers.getSetCookie?.() ?? [] };
  }
  throw new Error("重定向超限");
}

const cred = JSON.parse(readFileSync(join(STATE, "credentials.json"), "utf8")) as { username: string; secret: string };
const sess = JSON.parse(readFileSync(join(STATE, "session.json"), "utf8")) as { fingerprint?: string; finger3?: string };
const password = deobfuscate(cred.secret, cred.username);

const form = await req("GET", ITS_SVC);
const key = /id="sm2publicKey"[^>]*>\s*([0-9a-fA-F]{100,})\s*</.exec(form.text)?.[1] ?? "";
const check = await req("POST", CAS_CHECK, {
  cookies: form.cookies,
  data: {
    i_user: cred.username,
    i_pass: encryptPassword(password, key),
    fingerPrint: sess.fingerprint ?? "",
    fingerGenPrint: sess.finger3 ?? "",
    fingerGenPrint3: "",
    i_captcha: "",
  },
});
const anchor = /<a[^>]+href="([^"]+)"/i.exec(check.text)?.[1] ?? "";
const ticket = new URL(anchor.startsWith("http") ? anchor : new URL(anchor, check.url).toString()).searchParams.get("ticket") ?? "";
console.log(`[flow] ticket=${ticket.slice(0, 20)}...${ticket.length}`);

const login = await req("POST", `${BASE}/identity/ssoLogin?${new URLSearchParams({ clientId: CLIENT_ID, code: ticket })}`, { raw: "" });
console.log(`[flow] ssoLogin status=${login.status} setCookie=[${login.setCookie.map((c) => c.split("=")[0]).join(",")}]`);
console.log(`[flow] ssoLogin body=${login.text.slice(0, 500)}`);
let token = "";
try {
  const j = JSON.parse(login.text) as { data?: Record<string, unknown> };
  token = String((j.data?.token as string) ?? "");
  console.log(`[flow] data 全字段：${JSON.stringify(Object.keys(j.data ?? {}))}`);
} catch { /* ignore */ }
if (!token) process.exit(1);
console.log(`[flow] token=${token.slice(0, 16)}...(${token.length})`);

console.log("\n[flow] === 登录后前端真正拉的两个接口 ===");
for (const path of ["/portal/getSecAppInfo", "/function/getAllMobileMenus"]) {
  const r2 = await req("GET", `${BASE}${path}`, { cookies: login.cookies, headers: { token } });
  console.log(`\n--- GET ${path} -> ${r2.status} (${r2.text.length}B)`);
  console.log(r2.text.slice(0, 6000));
}
console.log("\n[flow] JSESSIONID=", login.cookies);
console.log("[flow] TOKEN=", token);
