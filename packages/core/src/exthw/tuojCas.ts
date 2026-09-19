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

export interface TuojRoamDeps {
  /** 「确保直连 id 会话」前置（方案 A）：无直连统一认证会话时按账密直登 id
   *  （桌面端注入 `InfoClient.ensureDirectIdLogin`，凭据来自 CampusSession，零用户输入）。
   *  返回 true = id 直连会话已建立，tuojRoam 会重走漫游表单。缺省时只走方案 B 文案。 */
  ensureIdSession?: (casFormUrl: string) => Promise<boolean>;
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

/** id 直连桶 cookie **名单**（只取 name，绝不外泄 value；诊断 12.1-1 用） */
function idCookieNames(http: HttpClient): string {
  try {
    const names = http.jar
      .getCookies(new URL("https://id.tsinghua.edu.cn/"))
      .map((c) => c.name)
      .filter(Boolean);
    return names.length ? names.join(",") : "(none)";
  } catch {
    return "(jar-error)";
  }
}

/** 失败路径诊断（复用 HttpClient debug 通道 → 桌面端 /tmp/onethu-debug.log）。
 *  只打 cookie 名单与页面特征，绝不含 cookie 值 / 账密。 */
function emitCasDiag(http: HttpClient, phase: string, body: string, finalUrl: string): string {
  const feats =
    [
      isCasLoginPage(body) ? "cas-login-page" : "",
      /sm2publicKey/.test(body) ? "sm2publicKey" : "",
      /name="i_pass"/.test(body) ? "i_pass" : "",
    ]
      .filter(Boolean)
      .join("+") || "none";
  const line =
    `[TUOJ-CAS] ${phase} final=${finalUrl.slice(0, 160)} ` +
    `idCookies=${idCookieNames(http)} lastCookieNames=${http.lastCookieNames || "(none)"} ` +
    `feats=${feats} body=${body.slice(0, 160).replace(/\s+/g, " ")}`;
  http.debug?.(line);
  return line;
}

/** TUOJ 是公网域，一律直连（绝不 WebVPN 包装）；用 HttpClient.request 以复用 CookieJar */
const JSON_HEADERS = { Accept: "application/json, text/plain, */*" } as const;

/**
 * 走清华统一认证漫游登录 TUOJ（零用户凭据）。
 * 成功返回 jar 里的 TUOJ 会话串；失败抛 `TuojCasError`（消息可直接展示给用户）。
 */
export async function tuojRoam(http: HttpClient, deps: TuojRoamDeps = {}): Promise<TuojRoamResult> {
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
  let casDiag = "";
  let ensureTried = false;
  let ensureOk = false;

  if (isCasLoginPage(body) || /\/do\/off\/ui\/auth\/login\/form\//.test(finalUrl)) {
    // 诊断（12.1-1）：id 桶 cookie 名单 / lastFinalUrl / CAS 页面特征
    casDiag = emitCasDiag(http, "no-direct-id-session", body, finalUrl);

    // 方案 A：前置「确保直连 id 会话」——账密直登 id（凭据从会话取，零用户输入）→
    // 重走漫游表单（CAS 用新会话重新发票并 302 到 TUOJ 回调）。
    if (deps.ensureIdSession) {
      ensureTried = true;
      try {
        ensureOk = await deps.ensureIdSession(tsinghua.url);
        emitCasDiag(http, `ensure-direct-id=${ensureOk ? "ok" : "fail"}`, body, finalUrl);
      } catch (e) {
        // 2FA 等底层可操作错误：记录后统一转方案 B 文案（不得静默失败）
        ensureOk = false;
        casDiag += ` | ensure-error=${e instanceof Error ? e.message : String(e)}`;
        http.debug?.(`[TUOJ-CAS] ensure-direct-id threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (ensureOk) {
      const retryRes = await http.request(tsinghua.url);
      body = await retryRes.text();
      finalUrl = http.lastFinalUrl || retryRes.url || tsinghua.url;
      emitCasDiag(http, "after-ensure-direct-id", body, finalUrl);
    }

    if (isCasLoginPage(body) || /\/do\/off\/ui\/auth\/login\/form\//.test(finalUrl)) {
      // 方案 B（兜底）：可操作文案——引导重新输入清华密码建立直连会话，或回退 TUOJ 账密。
      throw new TuojCasError(
        ensureTried
          ? "TUOJ：需先登录清华统一认证（直连会话建立后仍未通过 CAS 校验）。请在 OneTHU 重新登录清华账号（重新输入密码）后重试，或改用「TUOJ 账号密码登录」。"
          : "TUOJ：需先登录清华统一认证（未检测到有效的统一认证会话）。请在 OneTHU 重新登录清华账号（输入密码以建立直连会话），或改用「TUOJ 账号密码登录」。",
        (casDiag + " | " + finalUrl + " | " + body.slice(0, 300)).slice(0, 800),
      );
    }
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
