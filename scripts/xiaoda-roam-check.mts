/**
 * 验证「已认证 id 会话随要随发票」形态（= OneTHU 应用内真实场景，2026-10-15 登录失败根因）。
 *
 * 关键点：本脚本直接驱动 packages/core 的 **XiaodaClient 上线代码**，并用一个模拟
 * nativeFetch 语义的 fetch 包装（自带 cookie jar + 自动跟跳 + x-onethu-final-url /
 * x-onethu-set-cookie 响应头）复刻 Rust 桥的行为——这样测的就是应用里真跑的那条路。
 *
 * 断言：
 *  ① 空 jar + 不给凭据 → 表单页（带 SM2 公钥）→ 应报「需要账号密码…」
 *  ② 给凭据 → 出票 → 换 token（同时把已认证 id 会话养进 jar）
 *  ③ jar 里已有 id 会话 + 不给凭据 → 应直接出票换 token（漫游路径，不吃密码）
 * 用法：pnpm exec tsx scripts/xiaoda-roam-check.mts
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { XiaodaClient, XiaodaLoginError } from "../packages/core/src/xiaoda/client.js";

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

/* ── 模拟 nativeFetch：cookie jar + 自动跟跳 + 两个 x-onethu-* 头 ── */
const jar = new Map<string, Map<string, string>>();
function jarFor(url: string): string {
  try {
    const host = new URL(url).hostname;
    const m = jar.get(host);
    return m ? [...m].map(([k, v]) => `${k}=${v}`).join("; ") : "";
  } catch {
    return "";
  }
}
function storeCookies(url: string, lines: string[]): void {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  for (const line of lines) {
    const mm = /^ *([^=;]+)=([^;]*)/.exec(line);
    if (!mm?.[1]) continue;
    const m = jar.get(host) ?? new Map<string, string>();
    m.set(mm[1].trim(), mm[2] ?? "");
    jar.set(host, m);
  }
}
const nativeLikeFetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
  let currentUrl = url;
  let method = init.method ?? "GET";
  let body = init.body as string | undefined;
  const allSetCookies: string[] = [];
  for (let hop = 0; hop < 12; hop++) {
    const headers = new Headers(init.headers as HeadersInit);
    const jc = jarFor(currentUrl);
    if (jc) headers.set("Cookie", jc);
    const res = await fetch(currentUrl, { method, body, headers, redirect: "manual" });
    const scs = res.headers.getSetCookie?.() ?? [];
    storeCookies(currentUrl, scs);
    allSetCookies.push(...scs);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (loc && loc !== "null") {
        currentUrl = new URL(loc, currentUrl).toString();
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
          method = "GET";
          body = undefined;
        }
        continue;
      }
    }
    const out = new Headers(res.headers);
    out.set("x-onethu-final-url", currentUrl);
    out.set("x-onethu-set-cookie", JSON.stringify(allSetCookies));
    return new Response(await res.text(), { status: res.status, headers: out });
  }
  throw new Error("hop 超限");
};

const cred = JSON.parse(readFileSync(join(STATE, "credentials.json"), "utf8")) as { username: string; secret: string };
const password = deobfuscate(cred.secret, cred.username);
const sess = JSON.parse(readFileSync(join(STATE, "session.json"), "utf8")) as { fingerprint?: string; finger3?: string };
if (!password) throw new Error("凭据解不出");
console.log(`[roam] 账号=${cred.username}`);

/* ① 空 jar + 无凭据：应卡在「需要账号密码」（表单页形态） */
const c1 = new XiaodaClient({ fetch: nativeLikeFetch, log: (l) => console.log("  [c1]", l) });
try {
  await c1.login();
  console.log("① ❌ 竟然成功了（预期应报需要账号密码）");
} catch (e) {
  const msg = e instanceof XiaodaLoginError ? e.message : String(e);
  console.log(`① ${/需要账号密码/.test(msg) ? "✅" : "⚠️"} ${msg.slice(0, 140)}`);
}

/* ② 给凭据：出票 + 换 token，同时把已认证 id 会话养进 jar */
const c2 = new XiaodaClient({ fetch: nativeLikeFetch, log: (l) => console.log("  [c2]", l) });
const u2 = await c2.login(cred.username, password, sess.fingerprint ?? "", sess.finger3 ?? "");
console.log(`② ${u2.name && c2.getToken() ? "✅" : "❌"} 登录成功 name=${u2.name} zjh=${u2.zjh} token=${c2.getToken().length} chars`);

/* ③ 关键断言：jar 里已有 id 会话 → 无凭据 login() 应直接出票（应用内形态） */
const c3 = new XiaodaClient({ fetch: nativeLikeFetch, log: (l) => console.log("  [c3]", l) });
try {
  const u3 = await c3.login();
  console.log(`③ ${u3.name && c3.getToken() ? "✅ 漫游出票成功（不吃密码）" : "❌"} name=${u3.name} token=${c3.getToken().length} chars`);
} catch (e) {
  console.log(`③ ❌ 漫游失败：${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
}
