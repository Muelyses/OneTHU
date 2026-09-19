/**
 * 三源「提交状态」判定单测（离线，mock 响应，不打真实平台）。
 *
 * 运行：node tools/exthw-status-test.mjs
 * 覆盖：
 *  - 雨课堂作业（type 19）：answer_count>0 / my_answer.content 非空 → 已提交；空壳 → 保守未提交
 *  - 雨课堂试卷（type 20）：/v/exam/cover 的 result.unfinished_count<problem_count → 已提交；
 *    result 缺失 / 请求失败 → 保守未提交
 *  - TUOJ：ranklist 里按 _id/username 找到自己且 details 非空 → 已提交；找不到 / details 空 → 未提交
 *  - Tyche：task/Status（不带 all=true）submissionCount>0 → 已提交；0 / 报错 → 未提交
 *  - 附带校验：雨课堂状态请求带 XTBZ: ykt；TUOJ lookup 用 POST
 */
import { createYuketangSource } from "../packages/core/src/exthw/yuketang.ts";
import { createTuojSource } from "../packages/core/src/exthw/tuoj.ts";
import { createTycheSource } from "../packages/core/src/exthw/tyche.ts";
import * as nodeModule from "node:module";

/* R12 17.1：编排层 `exthw/index.ts` 内部用 `.js` 相对导入（TS bundler 解析），
 * Node 直引需经 registerHooks 重解析到 `.ts`（与 tools/tuoj-cas-test.mjs 同款）。
 * 静态 import 在本文件加载时已解析完毕，故编排层用动态 import（见文末）。 */
const canResolveTs = typeof nodeModule.registerHooks === "function";
if (canResolveTs) {
  nodeModule.registerHooks({
    resolve(specifier, context, next) {
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js")) {
        try {
          return next(specifier.slice(0, -3) + ".ts", context);
        } catch {
          /* 落回原样 */
        }
      }
      return next(specifier, context);
    },
  });
}

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.log(`  ✗ ${msg}`);
  }
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
}

/** 构造一个按 URL 路由的 mock fetchLike；记录每次请求 {url, method, headers} */
function makeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;
    calls.push({ url, method, headers });
    for (const r of routes) {
      if (r.match(url, method)) {
        if (r.throw) throw new Error(r.throw);
        const status = r.status ?? 200;
        return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

const FUTURE = Date.now() + 5 * 86400000; // 5 天后（时间窗内）
const pad = (n) => String(n).padStart(2, "0");
const localDT = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/* ───────────────────────── 雨课堂 ───────────────────────── */
console.log("\n[雨课堂]");
{
  const fetchLike = makeFetch([
    {
      match: (u) => u.includes("/v2/api/web/courses/list"),
      body: {
        errcode: 0,
        data: {
          list: [
            { classroom_id: 1, name: "线代", role: 5 },
            { classroom_id: 2, name: "线代-4", role: 6 },
          ],
        },
      },
    },
    {
      match: (u) => u.includes("/v2/api/web/logs/learn/1"),
      body: {
        errcode: 0,
        data: {
          activities: [
            { type: 19, id: 10, title: "已交作业", classroom_id: 1, content: { leaf_type_id: 100, leaf_id: 5, score_d: FUTURE } },
            { type: 19, id: 11, title: "未交作业", classroom_id: 1, content: { leaf_type_id: 101, leaf_id: 6, score_d: FUTURE } },
            { type: 20, id: 12, title: "已交试卷", classroom_id: 1, content: { leaf_type_id: 200, leaf_id: 7, sku_id: 900, score_d: FUTURE } },
            { type: 20, id: 13, title: "未交试卷", classroom_id: 1, content: { leaf_type_id: 201, leaf_id: 8, sku_id: 901, score_d: FUTURE } },
            { type: 20, id: 14, title: "无 result 试卷", classroom_id: 1, content: { leaf_type_id: 202, leaf_id: 9, sku_id: 902, score_d: FUTURE } },
            { type: 20, id: 15, title: "状态报错试卷", classroom_id: 1, content: { leaf_type_id: 203, leaf_id: 10, sku_id: 903, score_d: FUTURE } },
            { type: 20, id: 16, title: "未出分试卷", classroom_id: 1, content: { leaf_type_id: 204, leaf_id: 11, sku_id: 904, score_d: FUTURE } },
            { type: 20, id: 17, title: "缺满分试卷", classroom_id: 1, content: { leaf_type_id: 205, leaf_id: 12, sku_id: 905, score_d: FUTURE } },
            { type: 20, id: 18, title: "零分已出分试卷", classroom_id: 1, content: { leaf_type_id: 206, leaf_id: 13, sku_id: 906, score_d: FUTURE } },
          ],
        },
      },
    },
    {
      match: (u) => u.includes("/v2/api/web/logs/learn/2"),
      body: {
        errcode: 0,
        data: {
          activities: [
            { type: 19, id: 20, title: "旁听作业", classroom_id: 2, content: { leaf_type_id: 300, leaf_id: 14, score_d: FUTURE } },
          ],
        },
      },
    },
    {
      match: (u) => u.includes("/get_exercise_list/100/"),
      body: { data: { answer_count: 3, problems: [{ user: { my_answer: { content: "<p>x</p>" } } }, { user: { my_answer: { content: "" } } }] } },
    },
    { match: (u) => u.includes("/get_exercise_list/101/"), body: { data: { answer_count: 0, problems: [{ user: { my_answer: { content: "" } } }, { user: { my_answer: {} } }] } } },
    { match: (u) => u.includes("/get_exercise_list/300/"), body: { data: { answer_count: 1, problems: [{ user: { my_answer: { content: "<p>y</p>" } } }] } } },
    { match: (u) => u.includes("/v/exam/cover") && u.includes("exam_id=200"), body: { data: { problem_count: 20, total_score: 100, result: { status: 5, unfinished_count: 0, score: 60, score_finish: true } } } },
    { match: (u) => u.includes("/v/exam/cover") && u.includes("exam_id=201"), body: { data: { problem_count: 31, total_score: 100, result: { status: 6, unfinished_count: 31, score: 0, score_finish: true } } } },
    { match: (u) => u.includes("/v/exam/cover") && u.includes("exam_id=202"), body: { data: { problem_count: 10, total_score: 100, result: null } } },
    { match: (u) => u.includes("/v/exam/cover") && u.includes("exam_id=203"), throw: "boom" },
    { match: (u) => u.includes("/v/exam/cover") && u.includes("exam_id=204"), body: { data: { problem_count: 10, total_score: 100, result: { status: 5, unfinished_count: 0, score: 60, score_finish: false } } } },
    { match: (u) => u.includes("/v/exam/cover") && u.includes("exam_id=205"), body: { data: { problem_count: 10, result: { status: 5, unfinished_count: 0, score: 60, score_finish: true } } } },
    { match: (u) => u.includes("/v/exam/cover") && u.includes("exam_id=206"), body: { data: { problem_count: 10, total_score: 100, result: { status: 5, unfinished_count: 0, score: 0, score_finish: true } } } },
  ]);
  const src = createYuketangSource({ cookie: "sessionid=x", uvId: "2598" }, fetchLike, 30);
  const items = await src.fetch();
  eq(items.length, 10, "拉到 10 条作业");
  const byTitle = new Map(items.map((i) => [i.title, i]));
  eq(byTitle.get("已交作业")?.submitted, true, "answer_count>0 → 已提交");
  eq(byTitle.get("已交作业")?.submittedCount, 1, "已交作业 submittedCount=1（有内容的题目数）");
  eq(byTitle.get("已交作业")?.totalCount, 2, "已交作业 totalCount=2");
  eq(byTitle.get("未交作业")?.submitted, false, "answer_count=0 且无作答 → 未提交");
  eq(byTitle.get("已交试卷")?.submitted, true, "试卷 result.unfinished_count<problem_count → 已提交");
  eq(byTitle.get("已交试卷")?.submittedCount, 20, "已交试卷 submittedCount=20（problem_count-unfinished_count）");
  eq(byTitle.get("已交试卷")?.totalCount, 20, "已交试卷 totalCount=20");
  eq(byTitle.get("未交试卷")?.submitted, false, "试卷 unfinished_count==problem_count → 未提交");
  eq(byTitle.get("未交试卷")?.totalCount, 31, "未交试卷 totalCount=31");
  eq(byTitle.get("无 result 试卷")?.submitted, false, "试卷 result 缺失/null → 保守未提交");
  eq(byTitle.get("状态报错试卷")?.submitted, false, "试卷状态请求失败 → 保守未提交");
  // R9：旁听标注（role=6 → audited，role=5/未知不标）
  eq(byTitle.get("旁听作业")?.audited, true, "role=6 课堂 → audited=true");
  eq(byTitle.get("旁听作业")?.submitted, true, "旁听作业照常判提交状态");
  eq(byTitle.get("已交作业")?.audited, undefined, "role=5 课堂 → 不标旁听");
  // R9：考试分数（仅已提交且已出分给 score/totalScore）
  eq(byTitle.get("已交试卷")?.score, 60, "已出分试卷 score=60");
  eq(byTitle.get("已交试卷")?.totalScore, 100, "已出分试卷 totalScore=100");
  eq(byTitle.get("未交试卷")?.score, undefined, "未提交试卷不设 score");
  eq(byTitle.get("未出分试卷")?.submitted, true, "未出分试卷仍按提交判定");
  eq(byTitle.get("未出分试卷")?.score, undefined, "score_finish=false → 不设 score");
  eq(byTitle.get("缺满分试卷")?.score, undefined, "缺 total_score → 不设 score");
  eq(byTitle.get("缺满分试卷")?.totalScore, undefined, "缺 total_score → 不设 totalScore");
  eq(byTitle.get("零分已出分试卷")?.score, 0, "score=0 且已出分 → 照实显示 0");
  eq(byTitle.get("零分已出分试卷")?.totalScore, 100, "score=0 且已出分 → totalScore=100");
  const hwCalls = fetchLike.calls.filter((c) => c.url.includes("/get_exercise_list/"));
  eq(hwCalls.length, 3, "仅作业（type 19）走 get_exercise_list");
  ok(
    hwCalls.every((c) => c.headers["xtbz"] === "ykt"),
    "作业状态请求均带 XTBZ: ykt",
  );
  ok(
    hwCalls.every((c) => c.url.includes("classroom_id=") && c.url.includes("uv_id=")),
    "作业状态请求均带 classroom_id / uv_id",
  );
  const examCalls = fetchLike.calls.filter((c) => c.url.includes("/v/exam/cover"));
  eq(examCalls.length, 7, "试卷（type 20）走 /v/exam/cover");
  ok(
    examCalls.every((c) => c.headers["xtbz"] === "ykt"),
    "试卷状态请求均带 XTBZ: ykt",
  );
  ok(
    examCalls.every((c) => c.url.includes("exam_id=") && c.url.includes("classroom_id=") && c.url.includes("sku_id=")),
    "试卷状态请求均带 exam_id / classroom_id / sku_id",
  );
}

/* ───────────────────────── TUOJ ───────────────────────── */
console.log("\n[TUOJ]");
async function tuojCase(name, { me, players, expectSubmitted, expectDetailsLen }) {
  const fetchLike = makeFetch([
    { match: (u, m) => u.endsWith("/api/user/lookup") && m === "POST", body: me ?? {} },
    { match: (u) => u.endsWith("/api/course/list"), body: { courses: [{ _id: 8, title: "离散数学" }] } },
    { match: (u) => u.endsWith("/api/course/8/rank"), body: { courseRank: { contests: [{ _id: 83, title: "homework 1" }] } } },
    { match: (u) => u.endsWith("/api/course/8/contest/83/context"), body: { context: { metadata: { title: "homework 1" }, schedule: { endAt: FUTURE } } } },
    { match: (u) => u.endsWith("/api/course/8/contest/83/ranklist"), body: { ranklist: { players } } },
  ]);
  const src = createTuojSource({ cookie: "session=x" }, fetchLike, 30);
  const items = await src.fetch();
  eq(items.length, 1, `${name}：拉到 1 条`);
  eq(items[0]?.submitted, expectSubmitted, `${name}：submitted`);
  if (expectDetailsLen !== undefined) eq(items[0]?.submittedCount, expectDetailsLen, `${name}：submittedCount`);
  ok(
    fetchLike.calls.some((c) => c.url.endsWith("/api/user/lookup") && c.method === "POST"),
    `${name}：lookup 用 POST`,
  );
}
await tuojCase("按 _id 命中且有提交", {
  me: { user: { _id: 1001, username: "2026000000" } },
  players: [
    { _id: 999, username: "other", details: { "0": { judgeId: 1 } } },
    { _id: 1001, username: "2026000000", details: { "0": { judgeId: 1 }, "1": { judgeId: 2 } } },
  ],
  expectSubmitted: true,
  expectDetailsLen: 2,
});
await tuojCase("命中但 details 为空", {
  me: { user: { _id: 1001, username: "2026000000" } },
  players: [{ _id: 1001, username: "2026000000", details: {} }],
  expectSubmitted: false,
});
await tuojCase("ranklist 里没有自己", {
  me: { user: { _id: 1001, username: "2026000000" } },
  players: [{ _id: 999, username: "other", details: { "0": { judgeId: 1 } } }],
  expectSubmitted: false,
});
await tuojCase("lookup 失败但按 username 命中", {
  me: {},
  players: [{ _id: 1001, username: "2026000000", details: { "0": { judgeId: 1 } } }],
  expectSubmitted: false, // 无 username 回退 → 找不到自己
});
{
  // 显式提供 fallback username 时应命中
  const fetchLike = makeFetch([
    { match: (u, m) => u.endsWith("/api/user/lookup") && m === "POST", body: {} },
    { match: (u) => u.endsWith("/api/course/list"), body: { courses: [{ _id: 8, title: "C" }] } },
    { match: (u) => u.endsWith("/api/course/8/rank"), body: { courseRank: { contests: [{ _id: 83 }] } } },
    { match: (u) => u.endsWith("/api/course/8/contest/83/context"), body: { context: { metadata: {}, schedule: { endAt: FUTURE } } } },
    { match: (u) => u.endsWith("/api/course/8/contest/83/ranklist"), body: { ranklist: { players: [{ _id: 1, username: "2026000000", details: { "0": {} } }] } } },
  ]);
  const src = createTuojSource({ cookie: "", username: "2026000000" }, fetchLike, 30);
  const items = await src.fetch();
  eq(items[0]?.submitted, true, "lookup 失败但凭据 username 回退命中 → 已提交");
}

/* ───────────────────────── Tyche ───────────────────────── */
console.log("\n[Tyche]");
{
  const fetchLike = makeFetch([
    { match: (u) => u.includes("/group/GroupList"), body: { groupList: [{ gid: 42, name: "程设" }] } },
    {
      match: (u) => u.includes("/group/ShowGroup?gid=42"),
      body: {
        group: {
          gid: 42,
          tasks: [
            { tid: 1406, title: "作业一", endTime: localDT(FUTURE) },
            { tid: 1407, title: "作业二", endTime: localDT(FUTURE) },
            { tid: 1408, title: "作业三（状态接口报错）", endTime: localDT(FUTURE) },
          ],
        },
      },
    },
    { match: (u) => u.includes("/task/Status?tid=1406&gid=42"), body: { submissionCount: 6, submissionList: [{ sid: 1 }, { sid: 2 }] } },
    { match: (u) => u.includes("/task/Status?tid=1407&gid=42"), body: { submissionCount: 0, submissionList: [] } },
    { match: (u) => u.includes("/task/Status?tid=1408&gid=42"), throw: "boom" },
  ]);
  const src = createTycheSource({ cookie: "JSESSIONID=x" }, fetchLike, 30);
  const items = await src.fetch();
  eq(items.length, 3, "拉到 3 条作业");
  const byTitle = new Map(items.map((i) => [i.title, i]));
  eq(byTitle.get("作业一")?.submitted, true, "submissionCount>0 → 已提交");
  eq(byTitle.get("作业一")?.submittedCount, 6, "submittedCount=6");
  eq(byTitle.get("作业二")?.submitted, false, "submissionCount=0 → 未提交");
  eq(byTitle.get("作业三（状态接口报错）")?.submitted, false, "状态接口报错 → 保守未提交");
  const statusCalls = fetchLike.calls.filter((c) => c.url.includes("/task/Status?"));
  ok(
    statusCalls.every((c) => !c.url.includes("all=true")),
    "状态请求不带 all=true（只取本人提交）",
  );
}

/* ───────── R12 17.1：TUOJ「已配置但会话失效」→ force 漫游 → 成功重拉 ───────── */
console.log("\n[TUOJ 失效自动重漫游 R12 17.1]");
if (!canResolveTs) {
  console.log("  跳过：需要 Node ≥ 22.15（module.registerHooks）以解析 core 的 .js→.ts 相对导入");
} else {
  const { refreshExternalHomework, TuojSessionError, isTuojSessionError } = await import(
    "../packages/core/src/exthw/index.ts"
  );

  /** mock fetchLike：`listStatuses` 依次决定第 N 次 /api/course/list 的状态码（末项复用） */
  function makeTuojFetch(listStatuses) {
    let listHits = 0;
    const calls = [];
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const fn = async (url, init = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const headers = {};
      for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;
      calls.push({ url, method, headers });
      if (url.endsWith("/api/course/list")) {
        const status = listStatuses[Math.min(listHits, listStatuses.length - 1)];
        listHits++;
        return status === 200
          ? json({ courses: [{ _id: 8, title: "离散数学" }] })
          : json({ message: "unauthorized" }, status);
      }
      if (url.endsWith("/api/user/lookup")) return json({ user: { _id: 1001, username: "2026000000" } });
      if (url.endsWith("/api/course/8/rank")) return json({ courseRank: { contests: [{ _id: 83 }] } });
      if (url.endsWith("/api/course/8/contest/83/context"))
        return json({ context: { metadata: { title: "hw1" }, schedule: { endAt: FUTURE } } });
      if (url.endsWith("/api/course/8/contest/83/ranklist"))
        return json({ ranklist: { players: [{ _id: 1001, username: "2026000000", details: { "0": {} } }] } });
      return new Response("not found", { status: 404 });
    };
    fn.calls = calls;
    fn.listHits = () => listHits;
    return fn;
  }

  // 类型化判定：401/403 抛 TuojSessionError；其他错误不误判
  ok(isTuojSessionError(new TuojSessionError(401)), "TuojSessionError(401) 判定为会话失效");
  ok(isTuojSessionError(new Error("boom")) === false, "普通 Error 不判会话失效");

  // ① 已配置但 401 → force 漫游成功 → 自动重拉一次 → 恢复
  {
    const creds = { tuoj: { cookie: "old", via: "password" } };
    const fetchLike = makeTuojFetch([401, 200]);
    let roamCalls = 0;
    const r = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike,
      rerouteTuoj: async () => {
        roamCalls++;
        creds.tuoj = { cookie: "new", via: "cas" }; // 模拟 CAS 漫游覆盖凭据
        return true;
      },
    });
    eq(r.reroutedTuoj, true, "①触发了一次 force 重漫游");
    eq(roamCalls, 1, "①漫游恰好一次");
    eq(fetchLike.listHits(), 2, "①课程列表被拉取两次（首发 401 + 重拉）");
    eq(r.items.length, 1, "①重拉成功拉到 1 条作业");
    eq(r.errors.tuoj, undefined, "①重拉成功后不再有 TUOJ 错误");
    const listCalls = fetchLike.calls.filter((c) => c.url.endsWith("/api/course/list"));
    eq(listCalls[0]?.headers["cookie"], "old", "①首发用旧 cookie");
    eq(listCalls[1]?.headers["cookie"], "new", "①重拉用漫游后的新 cookie");
  }

  // ② 重拉仍 401 → 不再进入第二轮漫游（防循环），保留 401 错误
  {
    const creds = { tuoj: { cookie: "old" } };
    const fetchLike = makeTuojFetch([401]);
    let roamCalls = 0;
    const r = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike,
      rerouteTuoj: async () => {
        roamCalls++;
        return true;
      },
    });
    eq(roamCalls, 1, "②防循环：仅漫游一次");
    eq(fetchLike.listHits(), 2, "②重拉一次后停止");
    ok(r.errors.tuoj?.includes("会话已失效"), "②保留原 401 错误");
    eq(r.items.length, 0, "②无作业");
  }

  // ③ 漫游失败（返回 false）→ 维持原 401 错误，不重拉
  {
    const creds = { tuoj: { cookie: "old" } };
    const fetchLike = makeTuojFetch([401, 200]);
    let roamCalls = 0;
    const r = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike,
      rerouteTuoj: async () => {
        roamCalls++;
        return false; // 频控拦截 / 漫游失败
      },
    });
    eq(r.reroutedTuoj, false, "③漫游失败不标记 rerouted");
    eq(roamCalls, 1, "③仍尝试过一次漫游");
    eq(fetchLike.listHits(), 1, "③不重拉");
    ok(r.errors.tuoj?.includes("会话已失效"), "③维持原 401 错误与设置页引导");
  }
}

/* ───────────────────────── 汇总 ───────────────────────── */
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
