/**
 * TUOJ 走**清华统一身份认证（CAS 漫游）**——用户无需输入任何 TUOJ 凭据。
 *
 * 实测链路（2026-09-18）：
 * 1. `GET https://ai.tuoj.thusaac.com/api/user/oauth/info`（无需登录）返回
 *    `{ tsinghua: { enable: true, url: "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/<appid>/0?/api/user/tsinghua/roaming/AI-TUOJ" } }`
 *    —— 该 url 就是 CAS 漫游表单地址（app id = 929e496594c7a63203fb03e457a43c6b，
 *    漫游回调 = `https://ai.tuoj.thusaac.com/api/user/tsinghua/roaming/AI-TUOJ`）。
 * 2. 带**已有的 id.tsinghua.edu.cn 会话**（HttpClient 的 CookieJar 里就有，与 learn/info
 *    漫游同一套机制）GET 该表单地址：会话有效时 CAS 直接发票并 302 到 TUOJ 漫游回调，
 *    HttpClient 逐跳跟随重定向、把每一跳的 Set-Cookie 记入 jar → TUOJ 会话 cookie 落罐。
 *    无有效会话时 CAS 返回登录表单页（`id="sm2publicKey"`）→ 抛可读错误，由上层回退账号密码。
 * 3. 校验：`GET /api/course/list` 成功即视为登录完成。
 *
 * ⚠️ 本模块只做**只读**漫游（不提交任何 TUOJ 业务数据）；凭据（清华账密）不经过本模块。
 */
import type { HttpClient } from "../http.js";
import { BASE as TUOJ_BASE } from "./tuoj.js";

/** 统一认证漫游失败（UI 据此提示「需先登录清华统一认证」并回退账号密码） */
export class TuojCasError extends Error {
  /** 服务端页面片段，供诊断 */
  detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = "TuojCasError";
    this.detail = detail;
  }
}

export interface TuojRoamResult {
  /** 漫游后 jar 里的 TUOJ 会话 Cookie 串（供持久化 / 备选路径复用） */
  cookie: string;
  /** 漫游后可见的课程数（校验用） */
  courseCount: number;
}

/** CAS「登录成功 / 自动跳转」中间页里的回调锚点（demoLogin.casServiceLogin 同款写法） */
export function extractTicketAnchor(html: string): string | null {
  return /<a[^>]+href="([^"]+)"/i.exec(html)?.[1] ?? null;
}

/** 是否 CAS 登录表单页（= 当前没有有效统一认证会话） */
export function isCasLoginPage(html: string): boolean {
  return /id="sm2publicKey"/.test(html) || /name="i_pass"/.test(html);
}

/** jar 里某域当前的 Cookie 串（无则空串） */
function jarCookieString(http: HttpClient, url: string): string {
  try {
    return http.jar
      .getCookies(new URL(url))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  } catch {
    return "";
  }
}

/** TUOJ 是公网域，一律直连（绝不 WebVPN 包装）；用 HttpClient.request 以复用 CookieJar */
const JSON_HEADERS = { Accept: "application/json, text/plain, */*" } as const;

/**
 * 走清华统一认证漫游登录 TUOJ（零用户凭据）。
 * 成功返回 jar 里的 TUOJ 会话串；失败抛 `TuojCasError`（消息可直接展示给用户）。
 */
export async function tuojRoam(http: HttpClient): Promise<TuojRoamResult> {
  // ① 问 TUOJ 要 CAS 漫游入口
  const infoRes = await http.request(`${TUOJ_BASE}/api/user/oauth/info`, {
    direct: true,
    headers: { ...JSON_HEADERS },
  });
  const infoBody = await infoRes.text();
  let info: { tsinghua?: { enable?: boolean; url?: string } } | null = null;
  try {
    info = JSON.parse(infoBody) as { tsinghua?: { enable?: boolean; url?: string } };
  } catch {
    info = null;
  }
  const tsinghua = info?.tsinghua;
  if (!tsinghua || tsinghua.enable !== true || !tsinghua.url) {
    throw new TuojCasError(
      "TUOJ：清华统一认证入口不可用（TUOJ 可能已关闭该登录方式）",
      infoBody.slice(0, 300),
    );
  }

  // ② 带 id 会话 GET 漫游表单（路由交给 HttpClient：直连模式下 id 本就直连；
  //    WebVPN 模式下与 learn/info 漫游同轨——不强制 direct，避免通道分裂）
  const formRes = await http.request(tsinghua.url);
  let body = await formRes.text();
  let finalUrl = http.lastFinalUrl || formRes.url || tsinghua.url;

  if (isCasLoginPage(body) || /\/do\/off\/ui\/auth\/login\/form\//.test(finalUrl)) {
    throw new TuojCasError(
      "TUOJ：需先登录清华统一认证（未检测到有效的统一认证会话，请先在 OneTHU 登录清华账号）",
      (finalUrl + " | " + body.slice(0, 300)).slice(0, 600),
    );
  }

  // ③ CAS 返回「登录成功」中间页（带票据锚点）时手动跟一跳——demoLogin 同款兜底；
  //    会话有效时 CAS 通常已 302 直落回调（此步不触发）。
  const anchor = extractTicketAnchor(body);
  if (anchor && /ticket=/.test(anchor)) {
    const next = anchor.startsWith("http")
      ? anchor
      : new URL(anchor, "https://id.tsinghua.edu.cn/").toString();
    const landRes = await http.request(next, { direct: true });
    body = await landRes.text();
    finalUrl = http.lastFinalUrl || landRes.url || next;
  }

  // ④ 校验：能拉到课程列表即视为登录完成（会话 cookie 已落 jar）
  const listRes = await http.request(`${TUOJ_BASE}/api/course/list`, {
    direct: true,
    headers: { ...JSON_HEADERS },
  });
  const listBody = await listRes.text();
  let list: { courses?: unknown[] } | null = null;
  try {
    list = JSON.parse(listBody) as { courses?: unknown[] };
  } catch {
    list = null;
  }
  if (!list || !Array.isArray(list.courses)) {
    throw new TuojCasError(
      listRes.status === 401 || listRes.status === 403
        ? `TUOJ：统一认证漫游后仍未取得会话（HTTP ${listRes.status}）`
        : "TUOJ：统一认证漫游返回异常（课程列表非 JSON）",
      (finalUrl + " | " + listBody.slice(0, 300)).slice(0, 600),
    );
  }

  return { cookie: jarCookieString(http, TUOJ_BASE), courseCount: list.courses.length };
}
