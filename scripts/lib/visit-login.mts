/**
 * 行在清华访客系统（visit.tsinghua.edu.cn）登录助手：完整 ITS 登录 → SSO 换 token（含会话 cookie）。
 * 供 scripts/visit-*.mts 复用（探针工具，不进应用运行时）。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_USER_AGENT } from "../../packages/core/src/index.js";
import { encryptPassword } from "../../packages/core/src/crypto/sm2.js";

export const VISIT_SITE = "https://visit.tsinghua.edu.cn";
export const VISIT_API = `${VISIT_SITE}/visitor/mbpm`;
export const VISIT_CLIENT_ID = "04655f71b042b9d2d8d10cd566bd9c39";
const ITS_SVC = `https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/${VISIT_CLIENT_ID}/0?/visitor/mobile/sso`;
const CAS_CHECK = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/check";
const STATE = join(homedir(), "Library/Application Support/app.onethu.desktop/state");

function deobfuscate(stored: string, username: string): string {
  const bin = atob(stored.slice("onethu-secret-v1:".length));
  const key = new TextEncoder().encode(`OneTHU|${username}|remember`);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ key[i % key.length]!;
  return new TextDecoder().decode(bytes);
}

export interface VisitHttp {
  get(url: string): Promise<{ status: number; text: string }>;
  post(path: string, body: string | URLSearchParams, contentType?: string): Promise<{ status: number; text: string }>;
  readonly token: string;
  readonly cookies: string;
}

export async function visitLogin(): Promise<VisitHttp> {
  let cookies = "";
  const raw = async (method: string, url: string, body?: string, ct?: string) => {
    const headers: Record<string, string> = { "User-Agent": DEFAULT_USER_AGENT };
    if (cookies) headers.Cookie = cookies;
    if (body !== undefined) headers["Content-Type"] = ct ?? "application/x-www-form-urlencoded";
    const res = await fetch(url, { method, body, headers, redirect: "manual" });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const mm = /^([^=]+)=([^;]*)/.exec(sc);
      if (mm?.[1]) {
        const name = mm[1].trim();
        const rest = cookies.split("; ").filter((p) => p && !p.startsWith(name + "="));
        rest.push(`${name}=${mm[2] ?? ""}`);
        cookies = rest.join("; ");
      }
    }
    return res;
  };
  const follow = async (method: "GET" | "POST", url: string, body?: string) => {
    let cur = url;
    let m = method;
    let b = body;
    for (let hop = 0; hop < 14; hop++) {
      const res = await raw(m, cur, b);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (loc && loc !== "null") {
          cur = new URL(loc, cur).toString();
          if (res.status === 303 || ((res.status === 301 || res.status === 302) && m === "POST")) { m = "GET"; b = undefined; }
          continue;
        }
      }
      return { status: res.status, text: await res.text(), url: cur };
    }
    throw new Error("重定向超限");
  };

  const cred = JSON.parse(readFileSync(join(STATE, "credentials.json"), "utf8")) as { username: string; secret: string };
  const sess = JSON.parse(readFileSync(join(STATE, "session.json"), "utf8")) as { fingerprint?: string; finger3?: string };
  const form = await follow("GET", ITS_SVC);
  const key = /id="sm2publicKey"[^>]*>\s*([0-9a-fA-F]{100,})\s*</.exec(form.text)?.[1] ?? "";
  const check = await follow("POST", CAS_CHECK, new URLSearchParams({
    i_user: cred.username,
    i_pass: key ? encryptPassword(deobfuscate(cred.secret, cred.username), key) : "",
    fingerPrint: sess.fingerprint ?? "",
    fingerGenPrint: sess.finger3 ?? "",
    fingerGenPrint3: "",
    i_captcha: "",
  }).toString());
  const anchor = /<a[^>]+href="([^"]+)"/i.exec(check.text)?.[1] ?? "";
  const ticket = (anchor ? new URL(anchor.startsWith("http") ? anchor : new URL(anchor, check.url).toString()) : new URL(check.url)).searchParams.get("ticket") ?? "";
  if (!ticket) throw new Error(`未取到 ticket（status=${check.status}）`);

  const login = await raw("POST", `${VISIT_API}/identity/ssoLogin?clientId=${VISIT_CLIENT_ID}&code=${encodeURIComponent(ticket)}`, "");
  const parsed = JSON.parse(await login.text()) as { code: number; data?: { token?: string } };
  const token = parsed.data?.token ?? "";
  if (!token) throw new Error("换 token 失败");

  const withAuth = (headers: Record<string, string>) => ({ ...headers, token, ...(cookies ? { Cookie: cookies } : {}) });
  return {
    token,
    cookies,
    async get(url: string) {
      const u = url.startsWith("http") ? url : `${VISIT_API}${url}`;
      const res = await fetch(u, { headers: withAuth({ "User-Agent": DEFAULT_USER_AGENT }) });
      return { status: res.status, text: await res.text() };
    },
    async post(path: string, body: string | URLSearchParams, contentType = "application/x-www-form-urlencoded") {
      const u = path.startsWith("http") ? path : `${VISIT_API}${path}`;
      const res = await fetch(u, { method: "POST", body: body as string, headers: withAuth({ "User-Agent": DEFAULT_USER_AGENT, "Content-Type": contentType }) });
      return { status: res.status, text: await res.text() };
    },
  };
}
