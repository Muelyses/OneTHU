/**
 * 只为浏览器场景取一张「行在清华访客系统」的漫游票：完整 ITS 登录 → 打印 sso 回跳 URL。
 * 用法：pnpm exec tsx scripts/visit-ticket.mts
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_USER_AGENT } from "../packages/core/src/index.js";
import { encryptPassword } from "../packages/core/src/crypto/sm2.js";

const CLIENT_ID = "04655f71b042b9d2d8d10cd566bd9c39";
const ITS_SVC = `https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/${CLIENT_ID}/0?/visitor/mobile/sso`;
const STATE = join(homedir(), "Library/Application Support/app.onethu.desktop/state");

function deobfuscate(stored: string, username: string): string {
  const bin = atob(stored.slice("onethu-secret-v1:".length));
  const key = new TextEncoder().encode(`OneTHU|${username}|remember`);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ key[i % key.length]!;
  return new TextDecoder().decode(bytes);
}

let cookies = "";
async function req(method: "GET" | "POST", url: string, data?: Record<string, string>) {
  let currentUrl = url;
  let m = method;
  let body = data ? new URLSearchParams(data).toString() : undefined;
  for (let hop = 0; hop < 14; hop++) {
    const headers: Record<string, string> = { "User-Agent": DEFAULT_USER_AGENT };
    if (cookies) headers.Cookie = cookies;
    if (body !== undefined) headers["Content-Type"] = "application/x-www-form-urlencoded";
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
    return { url: currentUrl, text: await res.text(), status: res.status };
  }
  throw new Error("重定向超限");
}

const cred = JSON.parse(readFileSync(join(STATE, "credentials.json"), "utf8")) as { username: string; secret: string };
const sess = JSON.parse(readFileSync(join(STATE, "session.json"), "utf8")) as { fingerprint?: string; finger3?: string };
const form = await req("GET", ITS_SVC);
const key = /id="sm2publicKey"[^>]*>\s*([0-9a-fA-F]{100,})\s*</.exec(form.text)?.[1] ?? "";
const check = await req("POST", "https://id.tsinghua.edu.cn/do/off/ui/auth/login/check", {
  i_user: cred.username,
  i_pass: encryptPassword(deobfuscate(cred.secret, cred.username), key),
  fingerPrint: sess.fingerprint ?? "",
  fingerGenPrint: sess.finger3 ?? "",
  fingerGenPrint3: "",
  i_captcha: "",
});
const anchor = /<a[^>]+href="([^"]+)"/i.exec(check.text)?.[1] ?? "";
const ticket = (anchor ? new URL(anchor.startsWith("http") ? anchor : new URL(anchor, check.url).toString()) : new URL(check.url)).searchParams.get("ticket") ?? "";
if (!ticket) { console.error("未取到 ticket"); process.exit(1); }
console.log(`https://visit.tsinghua.edu.cn/visitor/mobile/sso?ticket=${ticket}`);
