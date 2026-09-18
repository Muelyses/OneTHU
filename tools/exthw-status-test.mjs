/**
 * 三源「提交状态」判定单测（离线，mock 响应，不打真实平台）。
 *
 * 运行：node tools/exthw-status-test.mjs
 * 覆盖：
 *  - 雨课堂：answer_count>0 / my_answer.content 非空 → 已提交；空壳（试卷 No permissions）→ 保守未提交
 *  - TUOJ：ranklist 里按 _id/username 找到自己且 details 非空 → 已提交；找不到 / details 空 → 未提交
 *  - Tyche：task/Status（不带 all=true）submissionCount>0 → 已提交；0 / 报错 → 未提交
 *  - 附带校验：雨课堂状态请求带 XTBZ: ykt；TUOJ lookup 用 POST
 */
import { createYuketangSource } from "../packages/core/src/exthw/yuketang.ts";
import { createTuojSource } from "../packages/core/src/exthw/tuoj.ts";
import { createTycheSource } from "../packages/core/src/exthw/tyche.ts";

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
    { match: (u) => u.includes("/v2/api/web/courses/list"), body: { errcode: 0, data: { list: [{ classroom_id: 1, name: "线代" }] } } },
    {
      match: (u) => u.includes("/v2/api/web/logs/learn/1"),
      body: {
        errcode: 0,
        data: {
          activities: [
            { type: 19, id: 10, title: "已交作业", classroom_id: 1, content: { leaf_type_id: 100, leaf_id: 5, score_d: FUTURE } },
            { type: 19, id: 11, title: "未交作业", classroom_id: 1, content: { leaf_type_id: 101, leaf_id: 6, score_d: FUTURE } },
            { type: 20, id: 12, title: "试卷（无权限）", classroom_id: 1, content: { leaf_type_id: 102, leaf_id: 7, score_d: FUTURE } },
          ],
        },
      },
    },
    {
      match: (u) => u.includes("/get_exercise_list/100/"),
      body: { data: { answer_count: 3, problems: [{ user: { my_answer: { content: "<p>x</p>" } } }, { user: { my_answer: { content: "" } } }] } },
    },
    { match: (u) => u.includes("/get_exercise_list/101/"), body: { data: { answer_count: 0, problems: [{ user: { my_answer: { content: "" } } }, { user: { my_answer: {} } }] } } },
    { match: (u) => u.includes("/get_exercise_list/102/"), body: { msg: "No permissions", error_code: 20009, data: {}, success: false } },
  ]);
  const src = createYuketangSource({ cookie: "sessionid=x", uvId: "2598" }, fetchLike, 30);
  const items = await src.fetch();
  eq(items.length, 3, "拉到 3 条作业");
  const byTitle = new Map(items.map((i) => [i.title, i]));
  eq(byTitle.get("已交作业")?.submitted, true, "answer_count>0 → 已提交");
  eq(byTitle.get("已交作业")?.submittedCount, 1, "已交作业 submittedCount=1（有内容的题目数）");
  eq(byTitle.get("已交作业")?.totalCount, 2, "已交作业 totalCount=2");
  eq(byTitle.get("未交作业")?.submitted, false, "answer_count=0 且无作答 → 未提交");
  eq(byTitle.get("试卷（无权限）")?.submitted, false, "试卷空壳（No permissions）→ 保守未提交");
  const statusCalls = fetchLike.calls.filter((c) => c.url.includes("/get_exercise_list/"));
  ok(statusCalls.length >= 3, "对每个作业都发了状态请求");
  ok(
    statusCalls.every((c) => c.headers["xtbz"] === "ykt"),
    "状态请求均带 XTBZ: ykt",
  );
  ok(
    statusCalls.every((c) => c.url.includes("classroom_id=") && c.url.includes("uv_id=")),
    "状态请求均带 classroom_id / uv_id",
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

/* ───────────────────────── 汇总 ───────────────────────── */
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
