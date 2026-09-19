/**
 * 外部作业源统一入口：按凭据组装已配置的源。
 *
 * 用法（desktop）：
 *   const sources = createExternalSources({ creds, fetchLike: universalFetch, http });
 *   const results = await Promise.allSettled(sources.map((s) => s.fetch()));
 *
 * 设计：core 不碰 localStorage / DOM；失败隔离由调用方负责（这里只组装）。
 * TUOJ 优先走带 CookieJar 的 HttpClient（清华统一认证漫游建立的会话在 jar 里）；
 * 雨课堂 / Tyche 仍走裸 FetchLike。
 */
import type { FetchLike, HttpClient } from "../http.js";
import type { ExtHwCreds, HomeworkSource } from "./types.js";
import { createYuketangSource } from "./yuketang.js";
import { BASE as TUOJ_BASE, createTuojSource } from "./tuoj.js";
import { createTycheSource } from "./tyche.js";

export interface CreateExternalSourcesDeps {
  creds: ExtHwCreds;
  /** 裸 fetch（desktop 传 universalFetch，Node 冒烟脚本传原生 fetch） */
  fetchLike: FetchLike;
  /** 可选：带 CookieJar 的 core HttpClient（桌面端注入）。TUOJ 走它——
   *  清华统一认证漫游（tuojRoam）把会话写进 jar，后续拉取自动携带。
   *  缺省时退回 `fetchLike` + 凭据里的显式 Cookie 串。 */
  http?: HttpClient;
}

export function createExternalSources({ creds, fetchLike, http }: CreateExternalSourcesDeps): HomeworkSource[] {
  const days = typeof creds.days === "number" && creds.days > 0 ? creds.days : 30;
  const sources: HomeworkSource[] = [];
  if (creds.yuketang?.cookie?.trim()) sources.push(createYuketangSource(creds.yuketang, fetchLike, days));
  // TUOJ：显式 Cookie 串（账号密码路径）或 CAS 漫游标记（via="cas"）任一存在即组装
  const tuoj = creds.tuoj;
  if (tuoj && (tuoj.cookie?.trim() || tuoj.via === "cas")) {
    if (http) {
      // jar 里已有 TUOJ 会话（CAS 漫游落下的）→ 用它（比持久化的串更新鲜）；
      // 没有则退回凭据里的显式 Cookie 串。强制直连（TUOJ 是公网域，绝不 WebVPN 包装）。
      const jarCookie = http.cookieHeaderFor(`${TUOJ_BASE}/api/course/list`);
      const cookie = (jarCookie ?? tuoj.cookie ?? "").trim();
      sources.push(createTuojSource({ cookie, username: tuoj.username }, (u, i) => http.request(u, { ...i, direct: true }), days));
    } else {
      sources.push(createTuojSource({ cookie: tuoj.cookie ?? "", username: tuoj.username }, fetchLike, days));
    }
  }
  if (creds.tyche?.cookie?.trim()) sources.push(createTycheSource(creds.tyche, fetchLike, days));
  return sources;
}

export { SOURCE_NAMES } from "./types.js";
export type { ExtHwCreds, ExtHwSourceId, ExternalHomework, HomeworkSource } from "./types.js";
export {
  yuketangSendSmsCode,
  yuketangVerifyLogin,
  tuojLogin,
  tycheLogin,
  captureCookies,
  yuketangBuildCookie,
} from "./login.js";
export type { ExtHwLoginResult } from "./login.js";
export { yuketangQrStart, yuketangQrPoll, runYuketangQrLogin } from "./yuketangQr.js";
export type { YktQrStart, YktQrPollResult, YktQrPhase, RunYuketangQrLoginDeps } from "./yuketangQr.js";
export { tuojRoam, TuojCasError, extractTicketAnchor, isCasLoginPage, isTuojNoCoursesError } from "./tuojCas.js";
export type { TuojRoamResult, TuojRoamDeps } from "./tuojCas.js";
