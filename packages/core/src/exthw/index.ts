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
   *  缺省（未注入）时不做任何重漫游，行为同旧版。 */
  rerouteTuoj?: (source: TuojSourceId) => Promise<boolean>;
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
 *  ⚠️ 防循环：单次调用每个源至多触发一次重漫游，重试仍失败不再进入第二轮。永不抛出。 */
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
  if (deps.rerouteTuoj) {
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      if (!src || !isTuojFamily(src.id)) continue;
      const r = results[i];
      if (r?.status !== "rejected" || !isTuojSessionError(r.reason)) continue;
      let ok = false;
      try {
        ok = await deps.rerouteTuoj(src.id);
      } catch {
        ok = false; // 漫游失败分支绝不抛出：保留原 401 错误与设置页引导
      }
      if (!ok) continue;
      reroutedSources.push(src.id);
      const retry = createExternalSources({
        creds: deps.getCreds(),
        fetchLike: deps.fetchLike,
        http: deps.http,
      }).find((s) => s.id === src.id);
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
    else errors[src.id] = r.reason instanceof Error ? r.reason.message : String(r.reason);
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
export { tuojRoam, TuojCasError, extractTicketAnchor, isCasLoginPage, isTuojNoCoursesError } from "./tuojCas.js";
export type { TuojRoamResult, TuojRoamDeps } from "./tuojCas.js";
export { TuojSessionError, isTuojSessionError, CLASSIC_BASE as TUOJ_CLASSIC_BASE } from "./tuoj.js";
export type { TuojSourceConfig } from "./tuoj.js";
export { DsaSessionError, isDsaSessionError, dsaCheckLogin, parseDsaDate, BASE as DSA_BASE } from "./dsa.js";
