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
import type {
  ExtHwCreds,
  ExtHwSourceId,
  ExternalHomework,
  HomeworkSource,
  RegisteredHomeworkSource,
} from "./types.js";
import { SOURCE_CATEGORIES } from "./types.js";
import { createYuketangSource } from "./yuketang.js";
import { BASE as TUOJ_BASE, createTuojSource, isTuojSessionError } from "./tuoj.js";
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

/** R13 18.1：按 `SOURCE_CATEGORIES` 给组装出的源附上大类元数据（courseware / oj）。
 *  纯信息架构字段，不改变凭据、拉取与展示。 */
const withCategory = (s: HomeworkSource): RegisteredHomeworkSource => ({
  ...s,
  category: SOURCE_CATEGORIES[s.id],
});

export function createExternalSources({ creds, fetchLike, http }: CreateExternalSourcesDeps): RegisteredHomeworkSource[] {
  const days = typeof creds.days === "number" && creds.days > 0 ? creds.days : 30;
  const sources: RegisteredHomeworkSource[] = [];
  if (creds.yuketang?.cookie?.trim()) sources.push(withCategory(createYuketangSource(creds.yuketang, fetchLike, days)));
  // TUOJ：显式 Cookie 串（账号密码路径）或 CAS 漫游标记（via="cas"）任一存在即组装
  const tuoj = creds.tuoj;
  if (tuoj && (tuoj.cookie?.trim() || tuoj.via === "cas")) {
    if (http) {
      // jar 里已有 TUOJ 会话（CAS 漫游落下的）→ 用它（比持久化的串更新鲜）；
      // 没有则退回凭据里的显式 Cookie 串。强制直连（TUOJ 是公网域，绝不 WebVPN 包装）。
      const jarCookie = http.cookieHeaderFor(`${TUOJ_BASE}/api/course/list`);
      const cookie = (jarCookie ?? tuoj.cookie ?? "").trim();
      sources.push(withCategory(createTuojSource({ cookie, username: tuoj.username }, (u, i) => http.request(u, { ...i, direct: true }), days)));
    } else {
      sources.push(withCategory(createTuojSource({ cookie: tuoj.cookie ?? "", username: tuoj.username }, fetchLike, days)));
    }
  }
  if (creds.tyche?.cookie?.trim()) sources.push(withCategory(createTycheSource(creds.tyche, fetchLike, days)));
  return sources;
}

/* ── R12 17.1：三源并发拉取 + TUOJ 会话失效自动重漫游一次 ──
 * 桌面端此前在 state 层自行 allSettled；把编排下沉到 core 后，重试路径可用
 * 纯 mock 离线验收（tools/exthw-status-test.mjs）。core 仍不碰 localStorage：
 * 凭据经 `getCreds()` 每次现读（重漫游会改写它），重漫游动作经 `rerouteTuoj` 注入。 */

export interface RefreshExternalHomeworkDeps {
  /** 每次组装源时读取当前凭据（重漫游成功后凭据已更新，重试必须重新读取） */
  getCreds: () => ExtHwCreds;
  /** 裸 fetch（desktop 传 universalFetch，Node 测试传 mock） */
  fetchLike: FetchLike;
  /** 可选：带 CookieJar 的 core HttpClient（桌面端注入） */
  http?: HttpClient;
  /** TUOJ 已配置但会话失效（401/403）时的强制重漫游钩子。
   *  返回 true = 漫游成功且凭据/会话已更新，随后自动重试 TUOJ 源**一次**；
   *  返回 false（含频控拦截）/ 抛出 = 放弃重试，保留原 401 错误。
   *  缺省（未注入）时不做任何重漫游，行为同旧版。 */
  rerouteTuoj?: () => Promise<boolean>;
}

export interface RefreshExternalHomeworkResult {
  items: ExternalHomework[];
  errors: Partial<Record<ExtHwSourceId, string>>;
  /** 是否因 TUOJ 会话失效触发过一次强制重漫游（诊断/测试用） */
  reroutedTuoj: boolean;
}

/** 三源并发拉取（allSettled，单源失败隔离）；TUOJ 401/403 → 强制重漫游一次并重试该源。
 *  ⚠️ 防循环：单次调用至多触发一次重漫游，重试仍失败不再进入第二轮。永不抛出。 */
export async function refreshExternalHomework(
  deps: RefreshExternalHomeworkDeps,
): Promise<RefreshExternalHomeworkResult> {
  let sources = createExternalSources({
    creds: deps.getCreds(),
    fetchLike: deps.fetchLike,
    http: deps.http,
  });
  const results = await Promise.allSettled(sources.map((s) => s.fetch()));

  let reroutedTuoj = false;
  const tuojIdx = sources.findIndex((s) => s.id === "tuoj");
  const tuojResult = tuojIdx >= 0 ? results[tuojIdx] : undefined;
  if (
    tuojIdx >= 0 &&
    deps.rerouteTuoj &&
    tuojResult?.status === "rejected" &&
    isTuojSessionError(tuojResult.reason)
  ) {
    let ok = false;
    try {
      ok = await deps.rerouteTuoj();
    } catch {
      ok = false; // 漫游失败分支绝不抛出：保留原 401 错误与设置页引导
    }
    if (ok) {
      reroutedTuoj = true;
      const retry = createExternalSources({
        creds: deps.getCreds(),
        fetchLike: deps.fetchLike,
        http: deps.http,
      }).find((s) => s.id === "tuoj");
      if (retry) {
        try {
          results[tuojIdx] = { status: "fulfilled", value: await retry.fetch() };
        } catch (e) {
          results[tuojIdx] = { status: "rejected", reason: e };
        }
      }
    }
  }

  const items: ExternalHomework[] = [];
  const errors: Partial<Record<ExtHwSourceId, string>> = {};
  results.forEach((r, i) => {
    const src = sources[i];
    if (!src) return;
    if (r.status === "fulfilled") items.push(...r.value);
    else errors[src.id] = r.reason instanceof Error ? r.reason.message : String(r.reason);
  });
  items.sort((a, b) => a.deadline.localeCompare(b.deadline));
  return { items, errors, reroutedTuoj };
}

export { SOURCE_NAMES, SOURCE_CATEGORIES, SOURCE_CATEGORY_NAMES } from "./types.js";
export type { ExtHwCategory, ExtHwCreds, ExtHwSourceId, ExternalHomework, HomeworkSource, RegisteredHomeworkSource } from "./types.js";
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
export { TuojSessionError, isTuojSessionError } from "./tuoj.js";
