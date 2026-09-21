/**
 * R20-C2 P1b 真机侦查（只读，零写请求）。
 *
 * 用法：source ~/.onethu-creds.env && node tools/ykt-c2-recon.mjs [课程名过滤]
 *
 * 做什么：
 *  1) GET /v2/api/web/courses/list —— 课程清单
 *  2) 逐课程 GET /v2/api/web/logs/learn/{cid} —— 捞作业活动（type 19=作业, 20=试卷）
 *  3) 对作业（type 19）GET /mooc-api/v1/lms/exercise/get_exercise_list/{leaf_type_id}/
 *     —— 原样打印每题的题型 / max_retry / score_deadline / user.count / my_count /
 *     submit_time / submission_status / 是否已有 my_answer（ground truth，不依赖 core 归一）
 *  4) 汇总「适合写端点实测」的主观题候选：题型 5、未提交、(count<=0 缺失=不限次 或
 *     max_retry>1)——写实测优先挑这类（交错也不吃次数），且最好不计分（霖人工确认）
 *
 * 绝不打印 Cookie；响应字段只挑展示，不落盘。
 */
const cookie = process.env.YKT_COOKIE ?? "";
if (!cookie.trim()) {
  console.log("未设置 YKT_COOKIE——先 source 凭据文件再运行。");
  process.exit(1);
}
const base = "https://pro.yuketang.cn";
const uv = process.env.YKT_UV || "2598";
const filter = process.argv[2] || "";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36";

async function getJson(url) {
  const res = await fetch(url, { headers: { Cookie: cookie, "User-Agent": UA, Accept: "application/json, text/plain, */*", XTBZ: "ykt" } });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _nonJson: true, status: res.status };
  }
}

const TYPE_NAME = { 1: "单选", 2: "多选", 3: "投票", 4: "填空", 5: "★主观", 6: "判断", 9: "外链OJ", 10: "材料" };

// 1) 课程
const courses = await getJson(`${base}/v2/api/web/courses/list?identity=2`);
const list = courses?.data?.list ?? [];
console.log(`课程数：${list.length}`);
const targets = [];
for (const c of list) {
  const cid = c.classroom_id;
  const cname = c.name || c.course?.name || "?";
  if (filter && !cname.includes(filter)) continue;
  // 2) 活动日志
  const logs = await getJson(`${base}/v2/api/web/logs/learn/${cid}?page=0&offset=200&sort=0&actype=-1`);
  const acts = logs?.data?.activities ?? [];
  for (const a of acts) {
    if (a.type !== 19) continue; // 只要作业
    const content = a.content ?? {};
    const leafTypeId = content.leaf_type_id ?? a.leaf_type_id;
    if (leafTypeId === undefined || leafTypeId === null) continue;
    targets.push({ cid: String(cid), cname, leafTypeId: String(leafTypeId), title: a.title ?? content.title ?? "?" });
  }
}
console.log(`作业候选：${targets.length}\n`);

// 3) 逐作业详情（并发 3）
const candidates = [];
let idx = 0;
async function one(t) {
  const url = `${base}/mooc-api/v1/lms/exercise/get_exercise_list/${encodeURIComponent(t.leafTypeId)}/?classroom_id=${t.cid}&term=latest&uv_id=${uv}`;
  const body = await getJson(url);
  if (body._nonJson) return;
  // 该端点成功响应无 errcode 字段：只在「明确非 0 数字」时跳过
  const ec = body.errcode;
  if (typeof ec === "number" && ec !== 0) return;
  const d = body.data ?? {};
  const probs = Array.isArray(d.problems) ? d.problems : [];
  console.log(`── [${t.cname}] ${t.title}`);
  console.log(`   max_retry=${d.max_retry} late_submission=${JSON.stringify(d.late_submission)} is_allowed_late=${d.is_allowed_late_submission} answer_count=${d.answer_count} score_deadline=${d.score_deadline ?? "?"}`);
  for (const p of probs) {
    const content = p.content ?? {};
    const ptype = content.ProblemType ?? content.Type;
    const u = p.user ?? {};
    const c = u.count, mc = u.my_count;
    const leftTimes = typeof c === "number" && c > 0 ? c - (typeof mc === "number" ? mc : 0) : 999;
    const hasAns = !!(u.my_answer && ((u.my_answer.content ?? "").length > 0 || (u.my_answer.attachment ?? []).length > 0));
    console.log(`   题${p.index ?? "?"} 类型${ptype}(${TYPE_NAME[ptype] ?? "?"}) max_retry=${p.max_retry} count=${c} my_count=${mc} left=${leftTimes} submit_time=${u.submit_time ?? "无"} sub_status=${p.submission_status ?? "?"} 已有答案=${hasAns} AllowResults=${JSON.stringify(content.AllowResults ?? [])} Score=${content.Score ?? "?"}`);
    // 4) 写实测候选：主观 + 未提交 + 宽松次数
    if (ptype === 5 && !hasAns && (typeof c !== "number" || c <= 0 || leftTimes > 0)) {
      candidates.push({ course: t.cname, title: t.title, order: p.index ?? "?", problemId: p.problem_id, leafTypeId: t.leafTypeId, classroomId: t.cid, leftTimes, maxRetry: p.max_retry, subStatus: p.submission_status });
    }
  }
}
const queue = [...targets];
const workers = Array.from({ length: 3 }, async () => {
  while (queue.length) {
    const t = queue.shift();
    if (!t) break;
    try { await one(t); } catch (e) { console.log(`── [${t.cname}] ${t.title} 详情失败：${e.message}`); }
  }
});
await Promise.all(workers);

console.log(`\n══ 写实测候选（主观+未提交+剩余次数>0）：${candidates.length} 处`);
for (const c of candidates) {
  console.log(`   [${c.course}] ${c.title} 题${c.order} problemId=${c.problemId} left=${c.leftTimes} max_retry=${c.maxRetry} 截止=${c.scoreDeadline ?? "无"}`);
}
console.log("\n下一步：霖从上面挑一道『不计入总分』的作业题号，我再对它发 problem_apply 实测。");
