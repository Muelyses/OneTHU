/**
 * 荷塘雨课堂（pro.yuketang.cn）只读客户端。
 *
 * 实测（2026-09-18）：
 * - 课程列表 GET /v2/api/web/courses/list?identity=2 → data.list[].classroom_id / name
 * - 学习日志 GET /v2/api/web/logs/learn/{classroom_id}?page=0&offset=200&sort=0&actype=-1
 *   → data.activities[]，type 19=作业 20=试卷（14=课件 5=投票，忽略）
 * - DDL = activity.content.score_d（**毫秒时间戳**）
 * - 提交状态：作业（type 19）走 get_exercise_list；试卷（type 20）走 GET /v/exam/cover
 *   （2026-09-19 实测攻克，判定见 docs 十三节）
 * - 已批改（R16 21.1，2026-09-19 实测判别器）：作业 `problems[].user.status` 4=已批改 /
 *   3=已交未批，`user.my_score` -1 为未批占位；试卷复用 /v/exam/cover 的已出分条件。
 *   已批改作业分数（R20-B3）：同响应已含全部数据，status 4 题的 my_score 合计 +
 *   content.score 合计（卷面满分），仅整卷已批改时透出（入口显示「已批改 · 30/40」）。
 * - 详情链接（R16b，学生端深链，无头浏览器实测 2026-09-19）：作业
 *   `…/ai-workspace/lms-graph/{classroom_id}/exercise/{leaf_id}?is_chapter=1`，
 *   试卷 `…/ai-workspace/lms-graph/{classroom_id}/quiz/{leaf_id}?is_chapter=1`；
 *   仅需 leaf_id，sku_id/node_id/exercise_id 不需要；缺 leaf_id 时回退
 *   `…/v2/web/studentLog/{classroom_id}`（旧链，2026-09-18 带 cookie 实测 200）。
 *   ⚠️ R16 21.2 的 `/subject?type=5|6&…` 是教师批改入口（学生打开 302 /forbidden），已弃用。
 * - 作业详情（R20-B1，docs 28.4 实测）：get_exercise_detail 复用 get_exercise_list 端点取整卷明细，
 *   data.font 即该次作业的加密字体文件（题干 <span class="xuetangx-com-encrypted-font"> 靠它渲染）；
 *   归一化 YkExerciseDetail / YkProblem，判定口径见 getExerciseDetail。
 * - 会话失效 → errcode=401000
 * ⚠️ host 必须是 pro.yuketang.cn（www. / changjiang. 会 401）
 * ⚠️ 服务端地址硬编码，凭据不再携带 base
 *
 * R21-B（会话失效保活/续期，2026-09-20）：
 * - 侦查结论（真连 + 三份前端 bundle 全量端点挖掘，docs 三十节）：pro.yuketang.cn
 *   **没有**会话续期/刷新端点（/pc/login/* 与 /api/v3/user/login/* 全家族仅
 *   web_login / web_logout / app-web-pre-info / app-web-login / send_sms_login_code /
 *   verify_pwd_login 六个；bundle 里的 heartbeat 是课堂视频心跳，与会话无关）。
 *   sessionid 由 Django 服务端管理，客户端无从「续命」→ 保活=周期性轻量已授权请求。
 * - 失效特征归一 `YktSessionError`（isYktSessionError 判定）：HTTP 401/403、
 *   errcode=401000、v3 系 code=50000 UNAUTHENTICATED、非 JSON（跳登录壳）四种；
 *   其余错误（网络断 / 5xx / 字段异常）不误判为会话失效。
 * - `checkSession()`：会话健康检查（GET /api/v3/user/basic-info，最轻的已授权请求），
 *   网络错误返回 alive=null（未知，不谎报「已失效」）。
 * - Cookie 轮换回写：传输层若透传 Set-Cookie（x-onethu-set-cookie 通道），按白名单
 *   （sessionid/csrftoken/uv_id 等）合并进会话串并经 onCookieRefresh 钩子交 desktop
 *   持久化（AES-GCM 信封）。侦查未见 GET 轮换证据，属「服务端若轮换则不丢」的兜底。
 * - Cookie 导出/导入：`buildYktCookieExportJson` / `parseYktCookieExportJson`
 *   （多设备迁移缓解；导出文件自带敏感标注）。
 */
import type { FetchLike } from "../http.js";
import type { ExternalHomework, HomeworkSource } from "./types.js";

const BASE = "https://pro.yuketang.cn";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36";

interface YktCred {
  cookie: string;
  uvId?: string;
}

/* ── R21-B：会话失效归一 + 健康检查 + Cookie 轮换回写 / 导出导入 ── */

/**
 * 雨课堂会话失效（R21-B）。四种实测/约定特征统一归一：
 * ① HTTP 401/403（网关拒绝）；② errcode=401000「Session not exists」（2026-09-20 死会话实测）；
 * ③ v3 系 code=50000「UNAUTHENTICATED」（basic-info 死会话实测）；④ 非 JSON（跳登录壳 HTML）。
 * 其余错误（网络断 / 5xx / 字段异常）**不**归入——避免误导用户重登。
 */
export class YktSessionError extends Error {
  constructor(message = "雨课堂会话已失效，请重新登录（扫码 / 官方网页 / 导入 Cookie）") {
    super(message);
    this.name = "YktSessionError";
  }
}

/** 是否雨课堂会话失效错误（设置页 / 心跳 / 条幅据此提示重登） */
export function isYktSessionError(e: unknown): e is YktSessionError {
  return e instanceof YktSessionError;
}

/** 毫秒时间戳 → "YYYY-MM-DD HH:MM"（本地时区） */
function fmtLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Cookie 补齐：uv_id/university_id/platform_id/xtbz/django_language 缺失时按清华默认补 */
function authCookie(c: YktCred): string {
  const cookie = (c.cookie ?? "").trim();
  const has = (name: string) => new RegExp(`(?:^|;\\s*)${name}=`).test(cookie);
  const uv = (c.uvId ?? "").trim() || "2598";
  const extras: string[] = [];
  if (!has("uv_id")) extras.push(`uv_id=${uv}`);
  if (!has("university_id")) extras.push(`university_id=${uv}`);
  if (!has("platform_id")) extras.push("platform_id=3");
  if (!has("xtbz")) extras.push("xtbz=ykt");
  if (!has("django_language")) extras.push("django_language=zh-cn");
  return extras.length ? `${cookie}; ${extras.join("; ")}` : cookie;
}

async function getJson(
  fetchLike: FetchLike,
  url: string,
  cookie: string,
  extraHeaders: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const res = await fetchLike(url, {
    method: "GET",
    headers: { Cookie: cookie, "User-Agent": UA, Accept: "application/json, text/plain, */*", ...extraHeaders },
  });
  if (res.status === 401 || res.status === 403) {
    // R21-B：401/403 = 网关拒绝 → 会话失效（原样文案，改归一类型）
    throw new YktSessionError(`雨课堂会话已失效（HTTP ${res.status}），请在设置页重新登录`);
  }
  const body = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    // R21-B：非 JSON = 登录壳 HTML（v2 接口死会话的另一表现）→ 会话失效
    throw new YktSessionError("雨课堂返回非 JSON（会话可能已失效被跳到登录页），请重新登录");
  }
  const obj = (json ?? {}) as Record<string, unknown>;
  // R21-B：v3 系（如 /api/v3/user/basic-info）死会话实测返回 200 + code=50000 UNAUTHENTICATED
  if (obj["code"] === 50000) {
    throw new YktSessionError("雨课堂会话已失效（UNAUTHENTICATED），请在设置页重新登录");
  }
  return obj;
}

/** Cookie 轮换回写白名单：只合并会话相关字段，杜绝把服务端下的杂项（统计/广告位）带进凭据 */
const COOKIE_MERGE_ALLOW = new Set([
  "sessionid",
  "csrftoken",
  "uv_id",
  "university_id",
  "platform_id",
  "platform_type",
  "xtbz",
  "django_language",
]);

/**
 * 读取传输层透传的 Set-Cookie 通道（与 login.captureCookies 同口径：数组头 + 逐跳头）。
 * ⚠️ 故意不复用 login.captureCookies：yuketang.ts 必须保持「零相对导入」——离线 Node
 * 单测（tools/exthw-status-test.mjs）靠原生 type-stripping 静态导入本模块，`.js`→`.ts`
 * 重写钩子注册在静态图解析之后。两处实现需同步维护。
 */
function yktCaptureSetCookies(res: Response): Map<string, string> {
  const raws: string[] = [];
  for (const key of ["x-onethu-set-cookie", "x-onethu-set-cookie-hops"]) {
    const raw = res.headers.get(key);
    if (!raw) continue;
    try {
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) continue;
      for (const x of arr) {
        if (typeof x === "string") raws.push(x);
        else if (x !== null && typeof x === "object" && typeof (x as { l?: unknown }).l === "string") {
          raws.push((x as { l: string }).l);
        }
      }
    } catch {
      /* 容忍非法 JSON */
    }
  }
  const pairs = new Map<string, string>();
  for (const line of raws) {
    const first = line.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const k = first.slice(0, eq).trim();
    const v = first.slice(eq + 1).trim();
    if (k) pairs.set(k, v);
  }
  return pairs;
}

/**
 * 把传输层捕获到的 Set-Cookie 键值对合并进现有 Cookie 串（R21-B，纯函数）。
 * 只认白名单字段；同名后者覆盖；原有顺序保持，新字段追加在尾部。
 */
export function mergeYktCookiePairs(cookie: string, pairs: Map<string, string>): string {
  const order: string[] = [];
  const vals = new Map<string, string>();
  for (const part of (cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    if (!vals.has(k)) order.push(k);
    vals.set(k, v);
  }
  let changed = false;
  for (const [k, v] of pairs) {
    if (!COOKIE_MERGE_ALLOW.has(k) || !v) continue;
    if (vals.get(k) !== v) {
      if (!vals.has(k)) order.push(k);
      vals.set(k, v);
      changed = true;
    }
  }
  if (!changed) return cookie;
  return order.map((k) => `${k}=${vals.get(k)}`).join("; ");
}

/** R21-B：会话健康检查结果。alive=null 表示「未知」（网络断等，不谎报失效） */
export interface YktSessionHealth {
  alive: boolean | null;
  /** alive=false 时的判定依据（http401 / http403 / errcode=401000 / unauthenticated / non-json）；
   *  alive=null 时为 "network" */
  reason?: string;
  /** 会话归属人姓名（basic-info 的宽松字段探测；取不到不设，仅展示用） */
  userName?: string;
  /** 检查完成时间（ms） */
  checkedAt: number;
}

/** 提交状态查询的并发上限（11 门课 × 若干作业；避免打爆服务端） */
const STATUS_CONCURRENCY = 4;

/** 待查提交状态的作业条目（已通过时间窗过滤） */
interface YktItem {
  hw: ExternalHomework;
  classroomId: string;
  leafTypeId: string;
  /** type 20（试卷）标记：走 /v/exam/cover 而非 get_exercise_list */
  isExam: boolean;
  /** type 20 试卷封面接口所需的 sku_id（activity.content.sku_id，可能缺失） */
  skuId?: string;
}

/** 单条提交状态查询结果（作业与试卷共用）。
 *  score/totalScore：试卷已出分时给（R9）；作业仅整卷已批改时给（R20-B3，已批题有效分合计）。
 *  未出分 / 未批改一律不设（避免 0 分误导）。 */
interface YktStatusResult {
  submitted: boolean;
  submittedCount?: number;
  totalCount?: number;
  score?: number;
  totalScore?: number;
  /** 是否已批改（R16 21.1）；无法判定时不设（调用方按 false 处理） */
  graded?: boolean;
}

/** 分数求和去浮点尾差（0.1+0.2 型；分数量级实测最多两位小数，round 到百分位安全） */
function roundScore(n: number): number {
  return Math.round(n * 100) / 100;
}

/** `user.my_score` 是否为「未批改」占位（-1 / -1.00 / "-1.00" 等，R16 21.1 实测） */
function isUnscoredPlaceholder(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v) && v === -1;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return false;
    const n = Number(t);
    return Number.isFinite(n) && n === -1;
  }
  return false;
}

/* ───────────────── R20-B1：作业详情归一化的宽松取值（缺字段不崩） ───────────────── */

/** 字符串字段：非字符串（含缺失）一律 "" */
function toStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** 数字字段：数字 / 数字串（如 "30.00"）→ number；其余（含空串 / NaN / null）→ undefined */
function toNum(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** 数字字段带默认值（缺失 → dft，保守口径由调用方定） */
function toNumOr(v: unknown, dft: number): number {
  return toNum(v) ?? dft;
}

/** 并发映射（有界并发，失败在回调内自行捕获） */
async function mapLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      if (item === undefined) continue;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * 查单个作业的提交状态：
 * GET /mooc-api/v1/lms/exercise/get_exercise_list/{leaf_type_id}/?classroom_id=…&term=latest&uv_id=…
 * ⚠️ 必须带请求头 `XTBZ: ykt`，否则报「XTBZ IS REQUIRED」。
 * 判定：`data.answer_count > 0` 或任一 `problems[].user.my_answer.content` 非空 → 已提交。
 * 已批改（R16 21.1，保守）：已提交且不存在「已作答但未批改」的题；
 * 「已作答」= `user.my_answer.content` 非空或整卷 `answer_count>0`；
 * 「未批改」= `user.status === 3` 或 `user.my_score` 为 -1 占位（含 "-1.00"）。
 * 分数（R20-B3，霖需求：已批改作业像考试一样在入口显示分数）：与详情同一响应里就有
 * 全部数据，零额外请求 —— score = 已批改题（status 4 且非 -1 占位，真实 0 分照算）的
 * my_score 合计，totalScore = 题面 content.score 合计；**仅整卷已批改（graded）时透出**
 * （对齐试卷「已出分才给分」口径，未批改不显示）；无一题有有效分 → 不设 score（缺数据
 * 不谎报 0）；卷面满分合计为 0（content.score 全缺失）→ 只给 score 不给 totalScore。
 * 仅用于作业（type 19）；试卷（type 20）改用 fetchYktExamStatus。
 */
async function fetchYktStatus(
  fetchLike: FetchLike,
  base: string,
  cookie: string,
  uv: string,
  classroomId: string,
  leafTypeId: string,
): Promise<YktStatusResult> {
  const url =
    `${base}/mooc-api/v1/lms/exercise/get_exercise_list/${encodeURIComponent(leafTypeId)}/` +
    `?classroom_id=${encodeURIComponent(classroomId)}&term=latest&uv_id=${encodeURIComponent(uv)}`;
  const body = await getJson(fetchLike, url, cookie, { XTBZ: "ykt" });
  const data = (body["data"] ?? {}) as Record<string, unknown>;
  const problems = Array.isArray(data["problems"])
    ? (data["problems"] as Array<Record<string, unknown>>)
    : [];
  if (problems.length === 0 && !("answer_count" in data)) {
    // 空壳响应（如 No permissions 落到 data:{}）→ 视为不可判定
    throw new Error("雨课堂作业状态响应为空");
  }
  const ac = data["answer_count"];
  const answerCount = typeof ac === "number" && Number.isFinite(ac) ? ac : 0;
  let answered = 0;
  let answeredUngraded = false;
  // R20-B3：分数合计 —— score = 已批改题有效分求和；totalScore = 题面分值求和
  let scoreSum = 0;
  let scoreSeen = false;
  let totalScoreSum = 0;
  for (const p of problems) {
    const user = (p["user"] ?? {}) as Record<string, unknown>;
    const my = (user["my_answer"] ?? {}) as Record<string, unknown>;
    const content = my["content"];
    const hasContent = typeof content === "string" && content.trim().length > 0;
    if (hasContent) answered++;
    const answeredThis = hasContent || answerCount > 0;
    if (answeredThis && (user["status"] === 3 || isUnscoredPlaceholder(user["my_score"]))) {
      answeredUngraded = true;
    }
    // 题面分值（content.score；缺失/非数字不计入卷面满分）
    const pcScore = toNum((p["content"] as Record<string, unknown> | undefined)?.["score"]);
    if (pcScore !== undefined) totalScoreSum += pcScore;
    // 已批改题的有效分：status 4 且非 -1 占位（真实 0 分照算）
    if (user["status"] === 4) {
      const ms = toNum(user["my_score"]);
      if (ms !== undefined && !isUnscoredPlaceholder(user["my_score"])) {
        scoreSum += ms;
        scoreSeen = true;
      }
    }
  }
  const submitted = answerCount > 0 || answered > 0;
  const submittedCount = answered > 0 ? answered : answerCount;
  // 无题目明细（problems 为空）时无法判定批改状态 → 保守 false
  const graded = submitted && problems.length > 0 && !answeredUngraded;
  return {
    submitted,
    submittedCount: submittedCount > 0 ? submittedCount : undefined,
    totalCount: problems.length > 0 ? problems.length : undefined,
    graded,
    // R20-B3：仅整卷已批改透分（未批改不显示，入口 UI 口径与考试一致）
    ...(graded && scoreSeen ? { score: roundScore(scoreSum) } : {}),
    ...(graded && scoreSeen && totalScoreSum > 0 ? { totalScore: roundScore(totalScoreSum) } : {}),
  };
}

/**
 * 查单个「试卷」（type 20）的提交状态：
 * GET /v/exam/cover?exam_id={leaf_type_id}&classroom_id=…&sku_id=…
 * ⚠️ 必须带请求头 `XTBZ: ykt`（与习题路径一致）。
 * 判定（docs 13.2）：`result` 非空且 `result.unfinished_count < problem_count` → 已提交；
 * `result` 缺失/null 或字段不可解析 → 保守未提交。
 * 进度：submittedCount = problem_count - unfinished_count，totalCount = problem_count。
 * 请求失败（HTTP 非 2xx / 非 JSON）会 throw，由调用方跳过并保持未提交。
 */
async function fetchYktExamStatus(
  fetchLike: FetchLike,
  base: string,
  cookie: string,
  classroomId: string,
  leafTypeId: string,
  skuId: string,
): Promise<YktStatusResult> {
  const skuQs = skuId ? `&sku_id=${encodeURIComponent(skuId)}` : "";
  const url =
    `${base}/v/exam/cover?exam_id=${encodeURIComponent(leafTypeId)}` +
    `&classroom_id=${encodeURIComponent(classroomId)}${skuQs}`;
  const body = await getJson(fetchLike, url, cookie, { XTBZ: "ykt" });
  const data = (body["data"] ?? {}) as Record<string, unknown>;
  const pcRaw = data["problem_count"];
  const problemCount = typeof pcRaw === "number" && Number.isFinite(pcRaw) ? pcRaw : undefined;
  const totalCount = problemCount !== undefined && problemCount > 0 ? problemCount : undefined;
  const tsRaw = data["total_score"];
  const totalScore = typeof tsRaw === "number" && Number.isFinite(tsRaw) ? tsRaw : undefined;
  const result = data["result"];
  if (result === null || result === undefined || typeof result !== "object") {
    // result 缺失/null（未作答或未出分）→ 保守未提交
    return { submitted: false, totalCount, graded: false };
  }
  const r = result as Record<string, unknown>;
  const unfinishedRaw = r["unfinished_count"];
  const unfinished = typeof unfinishedRaw === "number" && Number.isFinite(unfinishedRaw) ? unfinishedRaw : undefined;
  if (problemCount === undefined || unfinished === undefined) {
    return { submitted: false, totalCount, graded: false };
  }
  const done = Math.max(0, problemCount - unfinished);
  const submitted = unfinished < problemCount;
  const out: YktStatusResult = {
    submitted,
    submittedCount: done > 0 ? done : undefined,
    totalCount,
    // R16 21.1：试卷「已批改」= 已提交且已出分（下方复用 R9 score 条件置 true）
    graded: false,
  };
  // 分数仅「已提交 且 已出分 且 score/total_score 均为数字」时给（避免 0 分误导）
  const scoreRaw = r["score"];
  const scoreFinish = r["score_finish"];
  if (
    submitted &&
    scoreFinish !== false &&
    typeof scoreRaw === "number" &&
    Number.isFinite(scoreRaw) &&
    totalScore !== undefined
  ) {
    out.score = scoreRaw;
    out.totalScore = totalScore;
    // R16 21.1：试卷「已批改」复用 R9 已出分条件（有分数即已出分）
    out.graded = true;
  }
  return out;
}

/* ───────────────── R20-B1：作业详情（get_exercise_list 整卷明细，只读） ───────────────── */

/** 单题「我的作答」三态：docs 28.4 实测 user.status 4=已批改 / 3=已交未批；
 *  无 user、或无显式 status 且无作答痕迹（my_answer.content 非空 / 整卷 answer_count>0）→ 未答（保守） */
export type YkMyStatus = "unanswered" | "submitted" | "graded";

/** 老师批注（源字段名是单数 comment[]） */
export interface YkComment {
  content: string;
  /** 批注人姓名 */
  name?: string;
  /** 子批注序号 */
  index?: number;
}

/** 我的作答附件（R20-B2）：user.my_answer.attachment[] 里能确认的字段只有
 *  name / url（实测快照形如 {id:7, name:"fig.png"}；id 等其余字段 B2 不透出）。
 *  B2 只读展示文件名；下载 / 上传属 R20-C。 */
export interface YkAttachment {
  name?: string;
  url?: string;
}

/** 归一化后的单题。题面缺字段不崩（0 / "" / [] 兜底）；「我的作答」仅在有值时设 */
export interface YkProblem {
  /** problems[].problem_id（String 化，供 React key / 逐题提交） */
  problemId: string;
  /** 题号（原样透传；缺失按数组序 1 起） */
  index: number;
  /** content.ProblemType（1 单选 2 多选 3 判断 4 填空 5 主观 6 试卷 9 外链 OJ；缺失 0） */
  type: number;
  typeText: string;
  /** 题面分值（content.score；缺失 0） */
  score: number;
  /** 题干 HTML（含 xuetangx-com-encrypted-font 加密 span，需配 fontUrl 渲染） */
  bodyHtml: string;
  /** content.Options（形状随题型各异，B2/C1 再定） */
  options?: unknown[];
  /** content.AllowResults（["text","pic","file"]，主观题可提交形式；缺失 []） */
  allowResults: string[];
  /** 本题重交上限（content.max_retry / problems[].max_retry；缺失 0=不可重交，保守） */
  maxRetry: number;
  /** R20-C1：本题剩余可提交次数（web 端 `left_times` 同口径，R20-C1 侦查）——
   *  `user.count - user.my_count`，仅 `count>0`（有明确次数上限）时给；`count<=0`/缺失
   *  = 不限次（web 端置 999），此时**不设**（undefined = 不限/未知，调用方不得当作 0）。
   *  仅用于「未超 max_retry」资格判定；真实拦截仍以官方作答页为准。 */
  remainingRetries?: number;
  /** R20-C2：user.count 原值（官方 `left_times = count − my_count` 的被减数；缺失不设，
   *  0 / 负值也原样透出——「不限次」判定口径见 remainingRetries） */
  totalCount?: number;
  /** R20-C2：user.my_count 原值（已用重交次数；缺失按 0 参与计算但**字段仅在存在时设置**，
   *  与 remainingRetries 同款写法） */
  usedCount?: number;
  /** R20-C2：user.submit_time（毫秒时间戳 → "YYYY-MM-DD HH:MM" 本地时区）。官方提交器
   *  （docs §28.11）单题「已提交」判定 = `!!user.submit_time`，不看 submission_status；
   *  缺失 / 非数字 / <=0（0 与官方 falsy 口径一致）不设 */
  submitTime?: string;
  /** R20-C2：user.submission_status 原样透传（存在且可解析为数字才设；官方提交器**不**用它
   *  判定已提交，仅透出供 UI 参考） */
  submissionStatus?: number;
  myStatus: YkMyStatus;
  /** 仅「已批改」且为有效数字（非 -1 占位）时给——避免未出分显示 0 */
  myScore?: number;
  /** user.my_answer.content（非空时才设） */
  myAnswerHtml?: string;
  /** user.my_answer.attachment 归一化（非空数组时才设；B2 只读展示，下载属 R20-C） */
  myAnswerAttachments?: YkAttachment[];
  /** 题型 9（外链 OJ）的作答外链（content.data.answer_problem_url，docs 28.4；
   *  仅 type 9 且取到 http(s) 串时设。红线：此类题不在雨课堂站内提交） */
  externalUrl?: string;
  /** 老师总评（user.remark，非空时才设） */
  remark?: string;
  /** 老师批注（user.comment[]，滤掉空 content；全空不设） */
  comments?: YkComment[];
}

/** 归一化后的作业详情 */
export interface YkExerciseDetail {
  name: string;
  description: string;
  /** 整卷重交上限（data.max_retry；缺失 0） */
  maxRetry: number;
  /** 是否允许补交（data.is_allowed_late_submission，仅显式 true；红线：仅允许时开放提交） */
  lateAllowed: boolean;
  /** 补交口径（⚠️ 双口径容错，不下结论）：`data.late_submission` 逆向发现是**对象**
   *  （含 `deduct_score` 补交扣分，docs §28.11），而 §28.1/28.4 曾记录它是毫秒时间戳——
   *  两种口径冲突，待 P1b 真机复核定稿。当前实现：数字（>0）→ `lateDeadline`（毫秒 →
   *  "YYYY-MM-DD HH:MM" 本地时区）；对象且含可解析 `deduct_score` → `lateDeductScore`，
   *  此时 lateDeadline 不设；两者都不是 → 都不设。 */
  lateDeadline?: string;
  /** R20-C2：补交扣分（late_submission 为对象形态且 deduct_score 可解析时给；数字形态
   *  或缺失不设。单位待 P1b 真机复核：官方文案「补交扣分：{deduct_score}」） */
  lateDeductScore?: number;
  /** 已作答题数（data.answer_count；缺失 0） */
  answerCount: number;
  /** data.font：该次作业的加密字体文件 URL（docs 28.4 实测，下载后 @font-face 应用） */
  fontUrl?: string;
  problems: YkProblem[];
}

/** 雨课堂源：在 HomeworkSource 之上附作业详情拉取（R20-B1；B2 详情页用） */
export interface YuketangSource extends HomeworkSource {
  /** 拉单份作业详情（只读）。uvId 缺省回落凭据里的 uvId，再回落清华默认 "2598"。
   *  响应结构异常（errcode≠0 / 缺 data）抛带上下文的错误；单字段缺失不崩。 */
  getExerciseDetail(leafTypeId: string, classroomId: string, uvId?: string): Promise<YkExerciseDetail>;
  /** R21-B：会话健康检查（GET /api/v3/user/basic-info，最轻的已授权请求）。
   *  保活心跳与设置页「检查会话」都走它；网络错误返回 alive=null（不谎报失效）。 */
  checkSession(): Promise<YktSessionHealth>;
}

/** R21-B：createYuketangSource 可选钩子（既有调用方零改动） */
export interface YuketangSourceHooks {
  /** 会话 Cookie 因服务端轮换（Set-Cookie 白名单字段变化）而更新时回调（新 Cookie 串）。
   *  侦查未见 GET 轮换证据——此钩子是「服务端若轮换则凭据不丢」的兜底；desktop 把
   *  新 Cookie 用 AES-GCM 信封存回凭据。回调内不得打印 Cookie。 */
  onCookieRefresh?: (cookie: string) => void;
}

/** 单题三态（保守）：显式 status 优先（4=已批 / 3=已交未批）；否则看作答痕迹，
 *  整卷 answer_count=0 且无内容 → 未答（与 fetchYktStatus 的「已提交」口径一致） */
function toMyStatus(user: Record<string, unknown> | undefined, answerCount: number): YkMyStatus {
  if (!user || Object.keys(user).length === 0) return "unanswered";
  const status = user["status"];
  if (status === 4) return "graded";
  if (status === 3) return "submitted";
  const my = (user["my_answer"] ?? {}) as Record<string, unknown>;
  const hasContent = typeof my["content"] === "string" && my["content"].trim().length > 0;
  return hasContent || answerCount > 0 ? "submitted" : "unanswered";
}

/** user.comment[] → YkComment[]（滤空 content / 非对象项；结果为空 → undefined） */
function toComments(raw: unknown): YkComment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: YkComment[] = [];
  for (const c of raw) {
    if (c === null || typeof c !== "object") continue;
    const m = c as Record<string, unknown>;
    const content = m["content"];
    if (typeof content !== "string" || !content.trim()) continue;
    out.push({
      content,
      ...(typeof m["name"] === "string" && m["name"] ? { name: m["name"] } : {}),
      ...(typeof m["index"] === "number" && Number.isFinite(m["index"]) ? { index: m["index"] } : {}),
    });
  }
  return out.length ? out : undefined;
}

/** user.my_answer.attachment[] → YkAttachment[]（R20-B2）。
 *  实测项形如 {id:7, name:"fig.png"}，也有 avatar/attachment 位给空串的脏数据；
 *  保守只取对象项里的 name / url 字符串字段，无 name 且无 url 的项丢弃；
 *  结果为空 → undefined（UI 按无附件渲染）。 */
function toMyAttachments(raw: unknown): YkAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: YkAttachment[] = [];
  for (const a of raw) {
    if (a === null || typeof a !== "object") continue;
    const m = a as Record<string, unknown>;
    const name = typeof m["name"] === "string" && m["name"].trim() ? m["name"].trim() : undefined;
    const url = typeof m["url"] === "string" && m["url"].trim() ? m["url"].trim() : undefined;
    if (name || url) out.push({ ...(name ? { name } : {}), ...(url ? { url } : {}) });
  }
  return out.length ? out : undefined;
}

/** 题型 9（外链 OJ）→ 作答外链：content.data.answer_problem_url（docs 28.4 pc.js 逆向）。
 *  data 形状实测为对象（也可能缺省/非对象），保守取 answer_problem_url 字符串字段；
 *  仅接受 http(s)（与 R20-A isHttpUrl 同口径），其余一律不设。 */
function toProblemExternalUrl(content: Record<string, unknown>): string | undefined {
  const data = content["data"];
  if (data === null || typeof data !== "object") return undefined;
  const u = (data as Record<string, unknown>)["answer_problem_url"];
  return typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u.trim() : undefined;
}

/** problems[] 单项 → YkProblem。review_detail / content_score / appeal_info 等字段
 *  实测存在但归一化暂不透出（如需再加）；R20-C2 已透出 user.{count, my_count,
 *  submit_time, submission_status}（官方命名映射，见 YkProblem 注释）；缺字段不崩。 */
function toYkProblem(p: Record<string, unknown>, pos: number, answerCount: number): YkProblem {
  const content = (p["content"] ?? {}) as Record<string, unknown>;
  const userRaw = p["user"];
  const user = userRaw !== null && typeof userRaw === "object" ? (userRaw as Record<string, unknown>) : undefined;
  const myStatus = toMyStatus(user, answerCount);
  const problem: YkProblem = {
    problemId: p["problem_id"] === undefined || p["problem_id"] === null ? "" : String(p["problem_id"]),
    index: toNumOr(p["index"], pos + 1),
    // 28.4 实测字段为 ProblemType（28.1 旧记录写作 Type，做兼容回退）
    type: toNumOr(content["ProblemType"] ?? content["Type"], 0),
    typeText: toStr(content["TypeText"]),
    score: toNumOr(content["score"], 0),
    bodyHtml: toStr(content["Body"]),
    allowResults: Array.isArray(content["AllowResults"])
      ? (content["AllowResults"] as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
    maxRetry: toNumOr(content["max_retry"] ?? p["max_retry"], 0),
    myStatus,
  };
  const options = content["Options"];
  if (Array.isArray(options)) problem.options = options as unknown[];
  // R20-C1：剩余重交次数（web `left_times` 同口径）——count>0 才给（count<=0 = 不限次，
  // web 端置 999；这里不设，避免把「不限」误判成 0 次）。my_count 缺失按 0（尚未提交）。
  // R20-C2：totalCount / usedCount 把 left_times 的两个操作数原值透传（缺失不设）。
  const retryCount = user ? toNum(user["count"]) : undefined;
  const usedRaw = user ? toNum(user["my_count"]) : undefined;
  if (retryCount !== undefined) problem.totalCount = retryCount;
  if (usedRaw !== undefined) problem.usedCount = usedRaw;
  if (retryCount !== undefined && retryCount > 0) {
    problem.remainingRetries = retryCount - (usedRaw ?? 0);
  }
  // 得分仅「已批改」且为有效数字（非 -1 占位，R16 21.1）时给
  const myScoreRaw = user ? user["my_score"] : undefined;
  const myScore = toNum(myScoreRaw);
  if (myStatus === "graded" && myScore !== undefined && !isUnscoredPlaceholder(myScoreRaw)) {
    problem.myScore = myScore;
  }
  const myAnswer = ((user ?? {})["my_answer"] ?? {}) as Record<string, unknown>;
  if (typeof myAnswer["content"] === "string" && myAnswer["content"].trim()) {
    problem.myAnswerHtml = myAnswer["content"];
  }
  // R20-B2：作答附件归一化（只读展示；下载/上传属 R20-C）
  const atts = toMyAttachments(myAnswer["attachment"]);
  if (atts) problem.myAnswerAttachments = atts;
  // 题型 9（外链 OJ）：透出作答外链（红线：不在雨课堂站内提交）
  if (problem.type === 9) {
    const extUrl = toProblemExternalUrl(content);
    if (extUrl) problem.externalUrl = extUrl;
  }
  if (user) {
    if (typeof user["remark"] === "string" && user["remark"].trim()) problem.remark = user["remark"];
    const comments = toComments(user["comment"]);
    if (comments) problem.comments = comments;
    // R20-C2：单题提交时间（官方「已提交」判定 = !!submit_time，docs §28.11）。
    // 毫秒时间戳 → fmtLocal；缺失 / 非数字 / <=0（0 与官方 falsy 口径一致）不设。
    const submitMs = toNum(user["submit_time"]);
    if (submitMs !== undefined && submitMs > 0) problem.submitTime = fmtLocal(submitMs);
    // R20-C2：submission_status 原样透传（官方提交器不用它判定已提交，仅参考）
    const subStatus = toNum(user["submission_status"]);
    if (subStatus !== undefined) problem.submissionStatus = subStatus;
  }
  return problem;
}

/**
 * 拉单份作业详情并归一化（R20-B1，只读）：
 * GET /mooc-api/v1/lms/exercise/get_exercise_list/{leaf_type_id}/?classroom_id=…&term=latest&uv_id=…
 * ⚠️ 必须带请求头 `XTBZ: ykt`（同 fetchYktStatus）。
 * 字段映射（docs 28.4 实测）：exercise 级 name / description / max_retry /
 * is_allowed_late_submission / answer_count / font；R20-B2 增补 late_submission → lateDeadline；
 * R20-C2 改双口径容错（数字毫秒 → lateDeadline / 对象含 deduct_score → lateDeductScore，
 * ⚠️ 28.11 与 28.1 口径冲突待 P1b 真机定稿）；
 * problems[].content{ ProblemType, TypeText,
 * Body, Options, AllowResults, score, max_retry }、problems[].user{ my_answer{content, attachment},
 * remark, comment[], my_score, status, count, my_count, submit_time, submission_status }（后四者
 * R20-C2 透出为 totalCount/usedCount/submitTime/submissionStatus）；题型 9 透出
 * content.data.answer_problem_url。
 * 异常保守口径：errcode≠0 / 缺 data → throw 带上下文；单字段缺失 → 默认值不崩。
 */
async function fetchExerciseDetail(
  fetchLike: FetchLike,
  base: string,
  cookie: string,
  uv: string,
  classroomId: string,
  leafTypeId: string,
): Promise<YkExerciseDetail> {
  const leaf = String(leafTypeId ?? "").trim();
  if (!leaf) throw new Error("雨课堂作业详情失败：leafTypeId 为空");
  const url =
    `${base}/mooc-api/v1/lms/exercise/get_exercise_list/${encodeURIComponent(leaf)}/` +
    `?classroom_id=${encodeURIComponent(String(classroomId))}&term=latest&uv_id=${encodeURIComponent(uv)}`;
  const body = await getJson(fetchLike, url, cookie, { XTBZ: "ykt" });
  const errcode = body["errcode"];
  if (typeof errcode === "number" && errcode !== 0) {
    const msg = typeof body["errmsg"] === "string" ? ` ${body["errmsg"]}` : "";
    // R21-B：401000 = 死会话（实测特征）→ 归一为会话错误；其余 errcode 保持通用报错
    if (errcode === 401000) throw new YktSessionError(`雨课堂会话已失效（errcode=401000${msg}），请在设置页重新登录`);
    throw new Error(`雨课堂作业详情失败：errcode=${errcode}${msg}`);
  }
  const dataRaw = body["data"];
  if (dataRaw === null || typeof dataRaw !== "object") {
    throw new Error("雨课堂作业详情响应异常：缺 data（会话可能已失效）");
  }
  const data = dataRaw as Record<string, unknown>;
  const answerCount = toNumOr(data["answer_count"], 0);
  const problemsRaw = Array.isArray(data["problems"]) ? (data["problems"] as Array<Record<string, unknown>>) : [];
  const font = data["font"];
  // R20-C2：补交口径**双容错**（不下结论，待 P1b 真机复核——docs §28.11 逆向纪要称
  // late_submission 是对象（含 deduct_score 补交扣分），而 §28.1/28.4 旧记录称毫秒时间戳，
  // 两种口径冲突）：
  //  - 数字（毫秒时间戳）→ lateDeadline（R20-B2 行为不变；对象时 toNum 天然取不到 → 不设）；
  //  - 对象且 deduct_score 可解析 → lateDeductScore（该口径下 lateDeadline 不设）；
  //  - 都不是 → 两者都不设。
  const lateRaw = data["late_submission"];
  const lateMs = toNum(lateRaw);
  const lateDeduct =
    lateRaw !== null && typeof lateRaw === "object"
      ? toNum((lateRaw as Record<string, unknown>)["deduct_score"])
      : undefined;
  return {
    name: toStr(data["name"]),
    description: toStr(data["description"]),
    maxRetry: toNumOr(data["max_retry"], 0),
    lateAllowed: data["is_allowed_late_submission"] === true,
    ...(lateMs !== undefined && lateMs > 0 ? { lateDeadline: fmtLocal(lateMs) } : {}),
    ...(lateDeduct !== undefined ? { lateDeductScore: lateDeduct } : {}),
    answerCount,
    ...(typeof font === "string" && font.trim() ? { fontUrl: font } : {}),
    problems: problemsRaw.map((p, i) => toYkProblem(p, i, answerCount)),
  };
}

export function createYuketangSource(cred: YktCred, fetchLike: FetchLike, days: number, hooks?: YuketangSourceHooks): YuketangSource {
  const base = BASE;
  // R21-B：会话串可变——服务端轮换（Set-Cookie 白名单字段）时原地更新，后续请求即用新值
  let curCookie = authCookie(cred);
  const uv = (cred.uvId ?? "").trim() || "2598";
  /** 传输层包装：每次已授权请求后捕获 Set-Cookie（OneTHU 传输层自定义头通道），
   *  白名单字段有变化 → 更新 curCookie 并回调 onCookieRefresh（desktop 负责加密存回）。
   *  浏览器原生 fetch 读不到这些头 → 捕获结果恒空 = 零行为变化。 */
  const yktFetch: FetchLike = async (url, init) => {
    const res = await fetchLike(url, init);
    try {
      const pairs = yktCaptureSetCookies(res);
      if (pairs.size > 0) {
        const merged = mergeYktCookiePairs(curCookie, pairs);
        if (merged !== curCookie) {
          curCookie = merged;
          hooks?.onCookieRefresh?.(merged);
        }
      }
    } catch {
      /* 头解析失败不影响主流程 */
    }
    return res;
  };
  return {
    id: "yuketang",
    name: "雨课堂",
    /** R21-B：会话健康检查 + 保活心跳载体。GET /api/v3/user/basic-info 是全部已授权
     *  端点里最轻的（无 XTBZ 要求、无列表遍历）。alive=null 仅网络断等未知态。 */
    async checkSession(): Promise<YktSessionHealth> {
      const checkedAt = Date.now();
      try {
        const body = await getJson(yktFetch, `${base}/api/v3/user/basic-info`, curCookie);
        // 死会话特征（code=50000）已在 getJson 归一为 YktSessionError，能走到这即 code=0
        const data = (body["data"] ?? {}) as Record<string, unknown>;
        const nameRaw = data["name"] ?? data["username"] ?? data["nickname"];
        const userName = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : undefined;
        return { alive: true, ...(userName ? { userName } : {}), checkedAt };
      } catch (e) {
        if (!isYktSessionError(e)) return { alive: null, reason: "network", checkedAt };
        const m = e.message;
        const reason = /HTTP 401/.test(m)
          ? "http401"
          : /HTTP 403/.test(m)
            ? "http403"
            : /UNAUTHENTICATED/.test(m)
              ? "unauthenticated"
              : /非 JSON/.test(m)
                ? "non-json"
                : "errcode=401000";
        return { alive: false, reason, checkedAt };
      }
    },
    async fetch(): Promise<ExternalHomework[]> {
      const coursesBody = await getJson(yktFetch, `${base}/v2/api/web/courses/list?identity=2`, curCookie);
      const errcode = coursesBody["errcode"];
      if (typeof errcode === "number" && errcode !== 0) {
        const msg = typeof coursesBody["errmsg"] === "string" ? ` ${coursesBody["errmsg"]}` : "";
        // R21-B：401000 = 死会话（2026-09-20 实测特征）→ 归一；其余 errcode 保持通用报错
        if (errcode === 401000) throw new YktSessionError(`雨课堂会话已失效（errcode=401000${msg}），请在设置页重新登录`);
        throw new Error(`雨课堂课程列表失败：errcode=${errcode}${msg}`);
      }
      const data = (coursesBody["data"] ?? {}) as Record<string, unknown>;
      const list = Array.isArray(data["list"]) ? (data["list"] as Array<Record<string, unknown>>) : [];
      // classroom_id → role 映射（R9）：role 5=正式选课、6=旁听；其余未知值不标（保守）
      const roleByClassroom = new Map<string, unknown>();
      for (const c of list) {
        const cid = c["classroom_id"];
        if (cid === undefined || cid === null) continue;
        roleByClassroom.set(String(cid), c["role"]);
      }
      const limit = Date.now() + (days > 0 ? days : 30) * 86400000;
      const items: YktItem[] = [];
      for (const c of list) {
        const cid = c["classroom_id"];
        if (cid === undefined || cid === null) continue;
        const course = (c["course"] ?? {}) as Record<string, unknown>;
        const courseName = String(c["name"] ?? course["name"] ?? "雨课堂课程");
        // 逐课程隔离：单门课失败只跳过，不整体抛
        try {
          const logs = await getJson(
            yktFetch,
            `${base}/v2/api/web/logs/learn/${cid}?page=0&offset=200&sort=0&actype=-1`,
            curCookie,
          );
          const lerr = logs["errcode"];
          if (typeof lerr === "number" && lerr !== 0) throw new Error(`errcode=${lerr}`);
          const ldata = (logs["data"] ?? {}) as Record<string, unknown>;
          const acts = Array.isArray(ldata["activities"])
            ? (ldata["activities"] as Array<Record<string, unknown>>)
            : [];
          for (const a of acts) {
            const type = a["type"];
            if (type !== 19 && type !== 20) continue;
            const content = (a["content"] ?? {}) as Record<string, unknown>;
            const ms = content["score_d"];
            if (typeof ms !== "number" || !Number.isFinite(ms)) continue;
            if (ms > limit) continue; // 只保留未来 N 天（已过期仍保留）
            const id = a["id"] ?? a["courseware_id"] ?? ms;
            const leafTypeId = content["leaf_type_id"];
            const leafTypeStr = leafTypeId === undefined || leafTypeId === null ? "" : String(leafTypeId);
            const leafStr =
              content["leaf_id"] === undefined || content["leaf_id"] === null
                ? ""
                : String(content["leaf_id"]).trim();
            const skuStr =
              content["sku_id"] === undefined || content["sku_id"] === null
                ? ""
                : String(content["sku_id"]).trim();
            const classroomId = String(a["classroom_id"] ?? cid);
            // R16b：学生端深链（无头浏览器实测，2026-09-19；R16 21.2 的 `/subject?type=5|6`
            //   是教师批改入口，学生打开 302 → /v2/web/forbidden，已弃用）：
            //   作业 `${base}/ai-workspace/lms-graph/{cid}/exercise/{leaf_id}?is_chapter=1`
            //   试卷 `${base}/ai-workspace/lms-graph/{cid}/quiz/{leaf_id}?is_chapter=1`
            // 仅需 leaf_id（sku_id/node_id/exercise_id 不需要）；缺 leaf_id → 回退旧课程日志页。
            let url: string;
            if (leafStr) {
              const route = type === 20 ? "quiz" : "exercise";
              url =
                `${base}/ai-workspace/lms-graph/${encodeURIComponent(classroomId)}` +
                `/${route}/${encodeURIComponent(leafStr)}?is_chapter=1`;
            } else {
              url = `${base}/v2/web/studentLog/${cid}`;
            }
            const audited = roleByClassroom.get(classroomId) === 6;
            items.push({
              classroomId,
              leafTypeId: leafTypeStr,
              isExam: type === 20,
              skuId: skuStr || undefined,
              hw: {
                id: `yuketang-${cid}-${id}`,
                source: "yuketang",
                courseName,
                title: String(a["title"] ?? "作业"),
                deadline: fmtLocal(ms),
                kind: type === 20 ? "exam" : "homework",
                url,
                submitted: false,
                audited: audited || undefined,
                // R20-B2：原生详情页拉取参数（leaf_type_id 缺失时不设 → UI 回退网页打开）
                ...(leafTypeStr ? { leafTypeId: leafTypeStr } : {}),
                classroomId,
              },
            });
          }
        } catch {
          /* 单门课失败跳过，继续下一门 */
        }
      }

      // 并发（上限 4）查提交状态；单条失败只跳过（保守 false），不影响整体
      await mapLimited(items, STATUS_CONCURRENCY, async (it) => {
        if (!it.leafTypeId) return;
        try {
          const st = it.isExam
            ? await fetchYktExamStatus(yktFetch, base, curCookie, it.classroomId, it.leafTypeId, it.skuId ?? "")
            : await fetchYktStatus(yktFetch, base, curCookie, uv, it.classroomId, it.leafTypeId);
          it.hw.submitted = st.submitted;
          if (st.submittedCount !== undefined) it.hw.submittedCount = st.submittedCount;
          if (st.totalCount !== undefined) it.hw.totalCount = st.totalCount;
          if (st.score !== undefined) it.hw.score = st.score;
          if (st.totalScore !== undefined) it.hw.totalScore = st.totalScore;
          if (st.graded !== undefined) it.hw.graded = st.graded;
        } catch {
          /* 状态查询失败：保守保持未提交 */
        }
      });

      return items.map((it) => it.hw);
    },
    async getExerciseDetail(leafTypeId: string, classroomId: string, uvId?: string): Promise<YkExerciseDetail> {
      // uvId 参数优先，回落凭据 uvId，再回落清华默认（与 fetch 链路同款兜底）
      const uvFinal = (uvId ?? "").trim() || uv;
      return fetchExerciseDetail(yktFetch, base, curCookie, uvFinal, classroomId, leafTypeId);
    },
  };
}

/* ── R21-B：Cookie 导出 / 导入（多设备迁移缓解） ──
 * 侦查结论：会话无法在服务端续期 → 每台设备都要各自登录一次。缓解：在一台设备登录后
 * 把 Cookie 导出成文件，其余设备导入即用（免挨个扫码/重登）。
 * ⚠️ 导出文件 = 完整登录凭据：文件内自带 sensitive/warn 标注；UI 提醒勿放同步盘/群聊，
 * 用完即删。全程不打印 Cookie 内容，不进日志。 */

/** 导出文件 kind（导入时强校验，防拿错文件） */
export const YKT_COOKIE_EXPORT_KIND = "onethu.yuketang.session";

/** 导出文件结构（v1）。cookie 为完整可用会话串；uvId/phone 可选回填。 */
export interface YktCookieExport {
  kind: typeof YKT_COOKIE_EXPORT_KIND;
  version: 1;
  /** 恒 true：标记本文件含登录凭据 */
  sensitive: true;
  /** 人读警示（写入文件，脱离 UI 也在） */
  warn: string;
  /** ISO 时间 */
  exportedAt: string;
  cookie: string;
  uvId?: string;
  phone?: string;
}

/** 构建导出 JSON 文本。cookie 必须含 sessionid=（否则拒绝导出，防止导出无用文件）。 */
export function buildYktCookieExportJson(cred: { cookie: string; uvId?: string; phone?: string }, now = new Date()): string {
  const cookie = (cred.cookie ?? "").trim();
  if (!/(?:^|;\s*)sessionid=[^\s;]+/.test(cookie)) {
    throw new Error("雨课堂 Cookie 缺少 sessionid，不像有效会话——请先登录再导出");
  }
  const out: YktCookieExport = {
    kind: YKT_COOKIE_EXPORT_KIND,
    version: 1,
    sensitive: true,
    warn: "本文件含雨课堂完整登录会话，等同账号凭据：仅供本人多设备迁移使用，勿放同步盘/群聊/仓库，导入后请删除。",
    exportedAt: now.toISOString(),
    cookie,
    ...(cred.uvId?.trim() ? { uvId: cred.uvId.trim() } : {}),
    ...(cred.phone?.trim() ? { phone: cred.phone.trim() } : {}),
  };
  return JSON.stringify(out, null, 2);
}

/** 解析并校验导出文件文本 → 可直接存进凭据的会话。任何不符都抛带原因的错误。 */
export function parseYktCookieExportJson(text: string): { cookie: string; uvId?: string; phone?: string } {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("导入失败：不是合法 JSON 文件");
  }
  const o = (j ?? {}) as Record<string, unknown>;
  if (o["kind"] !== YKT_COOKIE_EXPORT_KIND) {
    throw new Error("导入失败：文件类型不符（这不是 OneTHU 导出的雨课堂会话文件）");
  }
  if (o["version"] !== 1) {
    throw new Error("导入失败：文件版本不识别");
  }
  const cookie = typeof o["cookie"] === "string" ? o["cookie"].trim() : "";
  if (!/(?:^|;\s*)sessionid=[^\s;]+/.test(cookie)) {
    throw new Error("导入失败：文件里没有有效的 sessionid（会话串不完整）");
  }
  const uvId = typeof o["uvId"] === "string" && o["uvId"].trim() ? o["uvId"].trim() : undefined;
  const phone = typeof o["phone"] === "string" && o["phone"].trim() ? o["phone"].trim() : undefined;
  return { cookie, ...(uvId ? { uvId } : {}), ...(phone ? { phone } : {}) };
}
