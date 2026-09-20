/**
 * 外部作业源统一入口：按凭据组装已配置的源。
 *
 * 用法（desktop）：
 *   const sources = createExternalSources({ creds, fetchLike: universalFetch, http });
 *   const results = await Promise.allSettled(sources.map((s) => s.fetch()));
 *
 * 设计：core 不碰 localStorage / DOM；失败隔离由调用方负责（这里只组装）。
 * TUOJ 系（AI / 经典）优先走带 CookieJar 的 HttpClient（清华统一认证漫游建立的会话在 jar 里）；
 * 雨课堂 / Tyche / DSA 仍走裸 FetchLike。
 */
import type { FetchLike, HttpClient } from "../http.js";
import type {
  ExtHwCreds,
  ExtHwSourceId,
  ExternalHomework,
  HomeworkSource,
  RegisteredHomeworkSource,
  TuojCreds,
  TuojSourceId,
} from "./types.js";
import { SOURCE_CATEGORIES, SOURCE_NAMES } from "./types.js";
import { createYuketangSource } from "./yuketang.js";
import { BASE as TUOJ_BASE, CLASSIC_BASE as TUOJ_CLASSIC_BASE, createTuojSource, isTuojSessionError } from "./tuoj.js";
import { createTycheSource } from "./tyche.js";
import { createDsaSource } from "./dsa.js";

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

/** TUOJ 系单源组装（AI 版 / 经典版共用）：优先带 CookieJar 的 HttpClient——
 *  CAS 漫游（tuojRoam）把会话写进 jar，后续拉取自动携带；缺省退回显式 Cookie 串。
 *  强制直连（TUOJ 是公网域，绝不 WebVPN 包装）。 */
function buildTuojSource(
  id: TuojSourceId,
  base: string,
  cred: TuojCreds,
  fetchLike: FetchLike,
  days: number,
  http?: HttpClient,
): RegisteredHomeworkSource {
  if (http) {
    const jarCookie = http.cookieHeaderFor(`${base}/api/course/list`);
    const cookie = (jarCookie ?? cred.cookie ?? "").trim();
    return withCategory(
      createTuojSource({ cookie, username: cred.username }, (u, i) => http.request(u, { ...i, direct: true }), days, {
        base,
        id,
        name: SOURCE_NAMES[id],
      }),
    );
  }
  return withCategory(
    createTuojSource({ cookie: cred.cookie ?? "", username: cred.username }, fetchLike, days, {
      base,
      id,
      name: SOURCE_NAMES[id],
    }),
  );
}

export function createExternalSources({ creds, fetchLike, http }: CreateExternalSourcesDeps): RegisteredHomeworkSource[] {
  const days = typeof creds.days === "number" && creds.days > 0 ? creds.days : 30;
  const sources: RegisteredHomeworkSource[] = [];
  if (creds.yuketang?.cookie?.trim()) sources.push(withCategory(createYuketangSource(creds.yuketang, fetchLike, days)));
  // TUOJ 系：显式 Cookie 串（账号密码路径）或 CAS 漫游标记（via="cas"）任一存在即组装
  const tuoj = creds.tuoj;
  if (tuoj && (tuoj.cookie?.trim() || tuoj.via === "cas")) {
    sources.push(buildTuojSource("tuoj", TUOJ_BASE, tuoj, fetchLike, days, http));
  }
  const classic = creds.tuojClassic;
  if (classic && (classic.cookie?.trim() || classic.via === "cas")) {
    sources.push(buildTuojSource("tuojClassic", TUOJ_CLASSIC_BASE, classic, fetchLike, days, http));
  }
  if (creds.tyche?.cookie?.trim()) sources.push(withCategory(createTycheSource(creds.tyche, fetchLike, days)));
  if (creds.dsa?.cookie?.trim()) sources.push(withCategory(createDsaSource(creds.dsa, fetchLike, days)));
  return sources;
}

/** 是否 TUOJ 系源（tuoj / tuojClassic）——会话失效自动重漫游只对这两者生效 */
function isTuojFamily(id: ExtHwSourceId): id is TuojSourceId {
  return id === "tuoj" || id === "tuojClassic";
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
  /** TUOJ 系（tuoj / tuojClassic）已配置但会话失效（401/403）时的强制重漫游钩子，
   *  参数为具体源 id。返回 true = 漫游成功且凭据/会话已更新，随后自动重试该源**一次**；
   *  返回 false（含频控拦截）/ 抛出 = 放弃重试，保留原 401 错误。
   *  缺省（未注入）时不做任何重漫游，行为同旧版。
   *  R19 27.1：本钩子的调用已被进程级频控（同源 ≥10min / 每源 ≤3 次）与同源
   *  in-flight 去重包裹——并发 401 只会让钩子对同一源执行一次。 */
  rerouteTuoj?: (source: TuojSourceId) => Promise<boolean>;
}

/* ── R19 27.1：TUOJ 会话失效（401/403）自动重漫游的进程级频控与并发去重 ──
 * 旧频控（desktop 的 24h TUOJ_AUTO_THROTTLE_MS）对「已配置但 cookie 失效」这条最常见
 * 路径过于苛刻：一次失败（退后台 / 网络抖动）就把 24h 内的自动恢复全烧掉。401 触发的
 * 自动重漫游改用放宽策略：同一源两次自动重试间隔 ≥ 10 分钟、每进程每源最多 3 次；
 * AI 版 / 经典版各自独立计数。状态存本模块（= 进程级），跨多次 refresh 累计。 */

/** 同一源两次自动重漫游的最小间隔（R19 27.1） */
export const TUOJ_SESSION_RETRY_MIN_INTERVAL_MS = 10 * 60 * 1000;
/** 每进程每源自动重漫游次数上限（含失败尝试；R19 27.1） */
export const TUOJ_SESSION_RETRY_MAX_PER_PROCESS = 3;

/** 会话失效触发过自动重漫游、但该源最终仍失败时的错误前缀（作业页 / 设置页文案，
 *  让用户知道系统已自动尝试过重新登录，而非首次失败） */
const TUOJ_REROUTE_FAILED_PREFIX = "已尝试自动重新登录，仍失败：";

const tuojSessionRetryState: Record<TuojSourceId, { count: number; lastAt: number }> = {
  tuoj: { count: 0, lastAt: 0 },
  tuojClassic: { count: 0, lastAt: 0 },
};
/** 同一源并发 401 共享一次重漫游（in-flight Promise 去重；R19 27.1） */
const tuojSessionInflight: Partial<Record<TuojSourceId, Promise<boolean>>> = {};

function tuojSessionRetryAllowed(source: TuojSourceId, now = Date.now()): boolean {
  const st = tuojSessionRetryState[source];
  return st.count < TUOJ_SESSION_RETRY_MAX_PER_PROCESS && now - st.lastAt >= TUOJ_SESSION_RETRY_MIN_INTERVAL_MS;
}

/** 清空进程级重漫游频控 / 去重状态（仅离线测试用；应用内无需调用） */
export function resetTuojSessionRetryState(): void {
  tuojSessionRetryState.tuoj = { count: 0, lastAt: 0 };
  tuojSessionRetryState.tuojClassic = { count: 0, lastAt: 0 };
  delete tuojSessionInflight.tuoj;
  delete tuojSessionInflight.tuojClassic;
}

export interface RefreshExternalHomeworkResult {
  items: ExternalHomework[];
  errors: Partial<Record<ExtHwSourceId, string>>;
  /** 是否因 TUOJ 系会话失效触发过强制重漫游（诊断/测试用；任一系列源命中即 true） */
  reroutedTuoj: boolean;
  /** 实际触发过重漫游的 TUOJ 系源（R15 20.2；诊断用） */
  reroutedSources: TuojSourceId[];
}

/** 各源并发拉取（allSettled，单源失败隔离）；TUOJ 系 401/403 → 强制重漫游一次并重试该源。
 *  ⚠️ 防循环：单次调用每个源至多触发一次重漫游，重试仍失败不再进入第二轮。永不抛出。
 *  R19 27.1：重漫游动作套进程级频控（同源 ≥10min、每源每进程 ≤3 次）+ 同源 in-flight
 *  去重（并发 401 只发起一次漫游，后来者共享其结果）；发起过漫游而该源最终仍失败的，
 *  错误文案加「已尝试自动重新登录，仍失败：」前缀。 */
export async function refreshExternalHomework(
  deps: RefreshExternalHomeworkDeps,
): Promise<RefreshExternalHomeworkResult> {
  const sources = createExternalSources({
    creds: deps.getCreds(),
    fetchLike: deps.fetchLike,
    http: deps.http,
  });
  const results = await Promise.allSettled(sources.map((s) => s.fetch()));

  const reroutedSources: TuojSourceId[] = [];
  /** 本轮发起（或共享）过自动重漫游的源——最终仍失败时用于加文案前缀（仅 TUOJ 系源会加入） */
  const rerouteAttempted = new Set<ExtHwSourceId>();
  const rerouteTuoj = deps.rerouteTuoj;
  if (rerouteTuoj) {
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      if (!src || !isTuojFamily(src.id)) continue;
      const sid: TuojSourceId = src.id;
      const r = results[i];
      if (r?.status !== "rejected" || !isTuojSessionError(r.reason)) continue;
      // R19 27.1：同源已有 in-flight 重漫游 → 直接共享其结果（不再计数、不受频控拦截）
      let inflight = tuojSessionInflight[sid];
      if (!inflight) {
        // 新发起一次漫游前先过进程级频控（间隔 / 次数；AI 版 / 经典版独立）
        if (!tuojSessionRetryAllowed(sid)) continue;
        const st = tuojSessionRetryState[sid];
        st.count += 1;
        st.lastAt = Date.now();
        inflight = (async (): Promise<boolean> => {
          try {
            return await rerouteTuoj(sid);
          } finally {
            delete tuojSessionInflight[sid];
          }
        })();
        tuojSessionInflight[sid] = inflight;
      }
      rerouteAttempted.add(sid);
      let ok = false;
      try {
        ok = await inflight;
      } catch {
        ok = false; // 漫游失败分支绝不抛出：保留原 401 错误与设置页引导
      }
      if (!ok) continue;
      reroutedSources.push(sid);
      const retry = createExternalSources({
        creds: deps.getCreds(),
        fetchLike: deps.fetchLike,
        http: deps.http,
      }).find((s) => s.id === sid);
      if (retry) {
        try {
          results[i] = { status: "fulfilled", value: await retry.fetch() };
        } catch (e) {
          results[i] = { status: "rejected", reason: e };
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
    else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors[src.id] = rerouteAttempted.has(src.id) ? `${TUOJ_REROUTE_FAILED_PREFIX}${reason}` : reason;
    }
  });
  items.sort((a, b) => a.deadline.localeCompare(b.deadline));
  return { items, errors, reroutedTuoj: reroutedSources.length > 0, reroutedSources };
}

export { SOURCE_NAMES, SOURCE_CATEGORIES, SOURCE_CATEGORY_NAMES } from "./types.js";
export type { ExtHwCategory, ExtHwCreds, ExtHwSourceId, TuojSourceId, TuojCreds, ExternalHomework, HomeworkSource, RegisteredHomeworkSource } from "./types.js";
export {
  yuketangSendSmsCode,
  yuketangVerifyLogin,
  tuojLogin,
  dsaLogin,
  tycheLogin,
  captureCookies,
  yuketangBuildCookie,
} from "./login.js";
export type { ExtHwLoginResult } from "./login.js";
export { yuketangQrStart, yuketangQrPoll, runYuketangQrLogin, yuketangCookieFromHeader } from "./yuketangQr.js";
export type { YktQrStart, YktQrPollResult, YktQrPhase, RunYuketangQrLoginDeps } from "./yuketangQr.js";
/* R20-B1：雨课堂作业详情（归一化类型；实例经 createYuketangSource(...).getExerciseDetail 取）。
 * R20-B2 增补 YkAttachment（我的作答附件，只读展示）。 */
export type { YkExerciseDetail, YkProblem, YkComment, YkAttachment, YkMyStatus, YuketangSource } from "./yuketang.js";
export { tuojRoam, TuojCasError, extractTicketAnchor, isCasLoginPage, isTuojNoCoursesError } from "./tuojCas.js";
export type { TuojRoamResult, TuojRoamDeps } from "./tuojCas.js";
export { TuojSessionError, isTuojSessionError, CLASSIC_BASE as TUOJ_CLASSIC_BASE } from "./tuoj.js";
export type { TuojSourceConfig } from "./tuoj.js";
export { DsaSessionError, isDsaSessionError, dsaCheckLogin, parseDsaDate, BASE as DSA_BASE } from "./dsa.js";
