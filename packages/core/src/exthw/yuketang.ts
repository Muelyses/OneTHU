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
 * - 详情链接（R16b，学生端深链，无头浏览器实测 2026-09-19）：作业
 *   `…/ai-workspace/lms-graph/{classroom_id}/exercise/{leaf_id}?is_chapter=1`，
 *   试卷 `…/ai-workspace/lms-graph/{classroom_id}/quiz/{leaf_id}?is_chapter=1`；
 *   仅需 leaf_id，sku_id/node_id/exercise_id 不需要；缺 leaf_id 时回退
 *   `…/v2/web/studentLog/{classroom_id}`（旧链，2026-09-18 带 cookie 实测 200）。
 *   ⚠️ R16 21.2 的 `/subject?type=5|6&…` 是教师批改入口（学生打开 302 /forbidden），已弃用。
 * - 会话失效 → errcode=401000
 * ⚠️ host 必须是 pro.yuketang.cn（www. / changjiang. 会 401）
 * ⚠️ 服务端地址硬编码，凭据不再携带 base
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
    throw new Error(`雨课堂会话已失效（HTTP ${res.status}），请在设置页更新 Cookie`);
  }
  const body = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error("雨课堂返回非 JSON（会话可能已失效），请更新 Cookie");
  }
  return (json ?? {}) as Record<string, unknown>;
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

/** 单条提交状态查询结果（作业与试卷共用；score/totalScore 仅试卷已出分时给） */
interface YktStatusResult {
  submitted: boolean;
  submittedCount?: number;
  totalCount?: number;
  score?: number;
  totalScore?: number;
  /** 是否已批改（R16 21.1）；无法判定时不设（调用方按 false 处理） */
  graded?: boolean;
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
  }
  const submitted = answerCount > 0 || answered > 0;
  const submittedCount = answered > 0 ? answered : answerCount;
  return {
    submitted,
    submittedCount: submittedCount > 0 ? submittedCount : undefined,
    totalCount: problems.length > 0 ? problems.length : undefined,
    // 无题目明细（problems 为空）时无法判定批改状态 → 保守 false
    graded: submitted && problems.length > 0 && !answeredUngraded,
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

export function createYuketangSource(cred: YktCred, fetchLike: FetchLike, days: number): HomeworkSource {
  const base = BASE;
  const cookie = authCookie(cred);
  const uv = (cred.uvId ?? "").trim() || "2598";
  return {
    id: "yuketang",
    name: "雨课堂",
    async fetch(): Promise<ExternalHomework[]> {
      const coursesBody = await getJson(fetchLike, `${base}/v2/api/web/courses/list?identity=2`, cookie);
      const errcode = coursesBody["errcode"];
      if (typeof errcode === "number" && errcode !== 0) {
        const msg = typeof coursesBody["errmsg"] === "string" ? ` ${coursesBody["errmsg"]}` : "";
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
            fetchLike,
            `${base}/v2/api/web/logs/learn/${cid}?page=0&offset=200&sort=0&actype=-1`,
            cookie,
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
            ? await fetchYktExamStatus(fetchLike, base, cookie, it.classroomId, it.leafTypeId, it.skuId ?? "")
            : await fetchYktStatus(fetchLike, base, cookie, uv, it.classroomId, it.leafTypeId);
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
  };
}
