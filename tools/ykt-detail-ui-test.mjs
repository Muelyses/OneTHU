/**
 * R20-B2：雨课堂原生作业详情页 —— 纯判定/展示函数 + core 新透出字段 单测（离线，mock，不打真实平台）。
 *
 * 运行：node tools/ykt-detail-ui-test.mjs
 *
 * 覆盖：
 *  [1] 入口分流 pickYktDetailEntry（apps/desktop/src/lib/yktDetail.ts）：
 *      Android 宿主 + yuketang + 参数齐备 → native；桌面 / 浏览器 / 非雨课堂 / 缺参数 → external（R20-A 现状）
 *  [2] 展示口径（同文件）：yktStatusChip 三态徽标（真实 0 分也显示）/ yktScoreText /
 *      yktTypeText（typeText 缺失时按 ProblemType 兜底）/ yktIsExternalLinkProblem（题型 9 红线）/
 *      yktAttachmentsText（空 → ""；无名附件回退 url / 占位）
 *  [3] 整卷汇总 yktExerciseSummary：answered / graded / scoreSum（无一题有分 → undefined）/
 *      整卷批改徽标（未作答·已交未批·部分已批·已批改·无题目）
 *  [4] core R20-B2 新透出字段（packages/core/src/exthw/yuketang.ts）：
 *      - 列表项 leaf_type_id → leafTypeId（String 化）、classroom_id → classroomId
 *      - 详情 late_submission → lateDeadline（毫秒 → 本地 "YYYY-MM-DD HH:MM"；缺失/0 → 不设）
 *      - my_answer.attachment（非对象元素过滤、空白名过滤、空数组 → 不设）
 *      - 题型 9 content.data.answer_problem_url → externalUrl（仅 http(s)；非题型 9 / 非法 url 不设）
 *
 * 覆盖边界：toHomework 的 externalLeafTypeId/externalClassroomId 两行映射与
 * state/exthw.ts fetchYktExerciseDetail 依赖 @tauri-apps / localStorage（Node 无法加载），
 * 由 pnpm typecheck + 真机烟测覆盖（docs 28.8）。
 */
import { registerHooks } from "node:module";
import { createYuketangSource } from "../packages/core/src/exthw/yuketang.ts";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.endsWith(".js") && context.parentURL?.endsWith(".ts")) {
        try {
          return next(specifier.slice(0, -3) + ".ts", context);
        } catch {
          /* 继续抛原始错误 */
        }
      }
      throw err;
    }
  },
});

const { pickYktDetailEntry, yktStatusChip, yktExerciseSummary, yktTypeText, yktIsExternalLinkProblem, yktAttachmentsText, yktScoreText } = await import(
  "../apps/desktop/src/lib/yktDetail.ts"
);

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
function deepEq(actual, expected, msg) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  ok(same, `${msg}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
}

/** 构造按 URL 路由的 mock fetchLike（与 ykt-exercise-detail-test 同款） */
function makeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;
    calls.push({ url, method, headers });
    for (const r of routes) {
      if (r.match(url)) {
        if (r.throw) throw new Error(r.throw);
        return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}), {
          status: r.status ?? 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

/** 毫秒时间戳 → 本地 "YYYY-MM-DD HH:MM"（与 core fmtLocal 同式，仅用于断言） */
function fmtExpect(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const YKT_BASE = "https://pro.yuketang.cn";

/* ───────────────── [1] 入口分流 ───────────────── */
console.log("\n[1] 入口分流 pickYktDetailEntry");
{
  eq(pickYktDetailEntry(true, { source: "yuketang", externalLeafTypeId: "100123", externalClassroomId: "777" }), "native", "Android + 雨课堂 + 参数齐备 → native");
  eq(pickYktDetailEntry(false, { source: "yuketang", externalLeafTypeId: "100123", externalClassroomId: "777" }), "external", "桌面端 → external（R20-A 现状，行为零变化）");
  eq(pickYktDetailEntry(true, { source: "yuketang", externalClassroomId: "777" }), "external", "缺 leafTypeId → external（详情拉不了，别把用户带进死页）");
  eq(pickYktDetailEntry(true, { source: "yuketang", externalLeafTypeId: "100123" }), "external", "缺 classroomId → external");
  eq(pickYktDetailEntry(true, { source: "tuoj", externalLeafTypeId: "1", externalClassroomId: "1" }), "external", "非雨课堂源 → external");
  eq(pickYktDetailEntry(true, {}), "external", "内部作业（无 source）→ external");
  eq(pickYktDetailEntry(true, { source: "yuketang", externalLeafTypeId: "", externalClassroomId: "" }), "external", "空串参数视同缺失 → external");
}

/* ───────────────── [2] 展示口径 ───────────────── */
console.log("\n[2] 展示口径（徽标 / 题型 / 附件文案）");
{
  deepEq(yktStatusChip({ myStatus: "graded", myScore: 2.5 }), { text: "已批 2.5 分", cls: "chip-blue" }, "已批改 + 分数 → 蓝徽标带分");
  deepEq(yktStatusChip({ myStatus: "graded", myScore: 0 }), { text: "已批 0 分", cls: "chip-blue" }, "真实 0 分（core 已剔 -1 占位）→ 照显 0 分");
  deepEq(yktStatusChip({ myStatus: "graded" }), { text: "已批改", cls: "chip-blue" }, "已批改无分 → 蓝徽标不带分");
  deepEq(yktStatusChip({ myStatus: "submitted" }), { text: "已交未批", cls: "chip-green" }, "已交未批 → 绿徽标");
  deepEq(yktStatusChip({ myStatus: "unanswered" }), { text: "未作答", cls: "chip-gray" }, "未作答 → 灰徽标");

  eq(yktScoreText(2), "2", "整数分不带小数尾零");
  eq(yktScoreText(2.5), "2.5", "半分照显");
  eq(yktScoreText(0), "0", "0 分照显");

  eq(yktTypeText({ type: 1, typeText: "单选题" }), "单选题", "typeText 存在 → 直用");
  eq(yktTypeText({ type: 2, typeText: "" }), "多选题", "typeText 空 → ProblemType 兜底（多选）");
  eq(yktTypeText({ type: 3, typeText: "  " }), "判断题", "typeText 纯空白 → 兜底（判断）");
  eq(yktTypeText({ type: 9, typeText: "" }), "外链题", "题型 9 → 外链题");
  eq(yktTypeText({ type: 99, typeText: "" }), "题目", "未知题型 → 中性兜底");

  eq(yktIsExternalLinkProblem({ type: 9 }), true, "题型 9 识别（红线：只给外链跳转）");
  eq(yktIsExternalLinkProblem({ type: 5 }), false, "主观题非外链");
  eq(yktIsExternalLinkProblem({ type: 0 }), false, "缺题型（0）非外链");

  eq(yktAttachmentsText(undefined), "", "无附件字段 → 空串（不渲染附件行）");
  eq(yktAttachmentsText([]), "", "空数组 → 空串");
  eq(yktAttachmentsText([{ name: "fig.png" }, { url: "https://cdn.x/b.pdf" }, { name: "  " }]), "fig.png、https://cdn.x/b.pdf、附件", "无名附件回退 url，再回退占位");
}

/* ───────────────── [3] 整卷汇总 ───────────────── */
console.log("\n[3] 整卷汇总 yktExerciseSummary");
{
  const P = (o) => ({ myStatus: "unanswered", ...o });
  const mixed = [
    P({ myStatus: "unanswered" }),
    P({ myStatus: "submitted" }),
    P({ myStatus: "graded", myScore: 2.5 }),
    P({ myStatus: "graded" }), // 已批但未透分（-1 占位被 core 剔除的形态）→ 不计入 scoreSum
  ];
  let s = yktExerciseSummary(mixed);
  eq(s.total, 4, "total = 题目数");
  eq(s.answered, 3, "answered = 已作答（submitted+graded）");
  eq(s.graded, 2, "graded = 已批改数");
  eq(s.scoreSum, 2.5, "scoreSum 只累加透出的得分（已批未透分不计）");
  deepEq(s.chip, { text: "已批 2/4 题", cls: "chip-blue" }, "部分已批 → 蓝徽标带进度");

  s = yktExerciseSummary([P({ myStatus: "graded", myScore: 8 }), P({ myStatus: "graded", myScore: 2 })]);
  eq(s.scoreSum, 10, "全批 → 合计");
  deepEq(s.chip, { text: "已批改", cls: "chip-blue" }, "全部已批 → 已批改");

  s = yktExerciseSummary([P({ myStatus: "submitted" }), P({ myStatus: "submitted" })]);
  eq(s.scoreSum, undefined, "无一题透分 → scoreSum 不设（避免误导 0 分）");
  deepEq(s.chip, { text: "已交未批", cls: "chip-green" }, "已交全未批 → 绿徽标");

  s = yktExerciseSummary([P({ myStatus: "unanswered" })]);
  deepEq(s.chip, { text: "未作答", cls: "chip-gray" }, "全未作答 → 灰徽标");
  eq(s.answered, 0, "全未作答 answered=0");

  s = yktExerciseSummary([]);
  deepEq(s.chip, { text: "无题目", cls: "chip-gray" }, "空 problems → 无题目（不崩）");
  eq(s.scoreSum, undefined, "空卷无得分");
}

/* ───────────────── [4] core R20-B2 新透出字段 ───────────────── */
console.log("\n[4] core：列表 leafTypeId/classroomId + 详情 lateDeadline/附件/题型9外链");
{
  // 4a. 列表项参数透出（R20-B2 原生详情入口的数据前提）
  const futureMs = Date.now() + 5 * 86400000;
  const fetchLike = makeFetch([
    {
      match: (u) => u.includes("/v2/api/web/courses/list"),
      body: { errcode: 0, data: { list: [{ classroom_id: "777", name: "雨课堂测试课", role: 5 }] } },
    },
    {
      match: (u) => u.includes("/v2/api/web/logs/learn/777"),
      body: {
        errcode: 0,
        data: {
          activities: [
            {
              type: 19,
              id: 901,
              title: "第一章作业",
              classroom_id: "777",
              content: { score_d: futureMs, leaf_type_id: 100123, leaf_id: "abc123", sku_id: "555" },
            },
            {
              // 缺 leaf_type_id（老课堂形态）→ 参数不设，UI 回退网页打开
              type: 19,
              id: 902,
              title: "无 leaf 的作业",
              classroom_id: "777",
              content: { score_d: futureMs, leaf_id: "def456" },
            },
          ],
        },
      },
    },
  ]);
  const src = createYuketangSource({ cookie: "sessionid=abc" }, fetchLike, 30);
  const list = await src.fetch();
  eq(list.length, 2, "列表条数");
  eq(list[0].leafTypeId, "100123", "leaf_type_id → leafTypeId（String 化）");
  eq(list[0].classroomId, "777", "classroom_id → classroomId");
  eq(list[1].leafTypeId, undefined, "缺 leaf_type_id → 不设（入口分流回退 external）");
  eq(list[1].classroomId, "777", "classroomId 仍透出");

  // 4b. 详情新字段：lateDeadline / myAnswerAttachments / 题型9 externalUrl
  const LATE_MS = 1760000000000;
  const DETAIL = {
    errcode: 0,
    data: {
      name: "外链与附件作业",
      max_retry: 1,
      is_allowed_late_submission: false,
      late_submission: LATE_MS,
      answer_count: 2,
      problems: [
        {
          problem_id: 50101,
          index: 1,
          content: {
            ProblemType: 9,
            TypeText: "外链接题",
            Body: "<p>请到 OJ 平台完成本题</p>",
            score: 10,
            data: { answer_problem_url: "https://leetcode.cn/problems/two-sum/" },
          },
          user: { my_answer: { content: "" }, status: 4, my_score: "9.00" },
        },
        {
          problem_id: 50102,
          index: 2,
          content: {
            ProblemType: 9,
            TypeText: "",
            Body: "<p>非法外链形态</p>",
            score: 10,
            data: { answer_problem_url: "javascript:alert(1)" },
          },
          user: { my_answer: { content: "" }, status: 3 },
        },
        {
          problem_id: 50103,
          index: 3,
          content: {
            ProblemType: 5,
            TypeText: "主观题",
            Body: "<p>上传截图</p>",
            score: 5,
          },
          user: {
            my_answer: { content: "<p>见附件</p>", attachment: [{ id: 7, name: "fig.png" }, "junk", {}, { name: "  " }] },
            remark: "记得附源码",
            status: 4,
            my_score: "4.50",
          },
        },
        {
          // 无 attachment / 无 data → 相关字段不设
          problem_id: 50104,
          index: 4,
          content: { ProblemType: 5, TypeText: "主观题", Body: "<p>（脱敏）</p>", score: 5 },
          user: { my_answer: { content: "<p>正文</p>" }, status: 3 },
        },
      ],
    },
  };
  const fetchLike2 = makeFetch([{ match: (u) => u.includes("/get_exercise_list/100123/"), body: DETAIL }]);
  const src2 = createYuketangSource({ cookie: "sessionid=abc" }, fetchLike2, 30);
  const d = await src2.getExerciseDetail("100123", "777");

  eq(d.lateDeadline, fmtExpect(LATE_MS), "late_submission（毫秒）→ lateDeadline（本地 YYYY-MM-DD HH:MM）");
  const p9a = d.problems[0];
  eq(p9a.type, 9, "题型 9 归一化");
  eq(p9a.externalUrl, "https://leetcode.cn/problems/two-sum/", "题型 9 answer_problem_url → externalUrl");
  eq(d.problems[1].externalUrl, undefined, "非 http(s) 外链拒收（红线：不在站内提交）");
  eq(d.problems[2].type, 5, "主观题非外链");
  deepEq(d.problems[2].myAnswerAttachments, [{ name: "fig.png" }], "attachment 非对象/空白名过滤");
  eq(d.problems[3].myAnswerAttachments, undefined, "无 attachment → 不设");
  eq(d.problems[3].externalUrl, undefined, "非题型 9 恒无 externalUrl");
  eq(d.problems[0].myScore, 9, "已批改得分照旧透出（回归）");

  // 4c. late_submission 缺失 / 0 → lateDeadline 不设（回归）
  const fetchLike3 = makeFetch([
    {
      match: (u) => u.includes("/get_exercise_list/9/"),
      body: {
        errcode: 0,
        data: { name: "无补交", max_retry: 0, problems: [], late_submission: 0 },
      },
    },
  ]);
  const src3 = createYuketangSource({ cookie: "sessionid=abc" }, fetchLike3, 30);
  const d3 = await src3.getExerciseDetail("9", "777");
  eq(d3.lateDeadline, undefined, "late_submission=0 → lateDeadline 不设");
  eq(d3.maxRetry, 0, "max_retry=0 照旧透出（UI 显「不可重交」）");
}

console.log(`\n═══ R20-B2 雨课堂原生详情页单测：${pass} 通过 / ${fail} 失败 ═══`);
if (fail > 0) process.exit(1);
