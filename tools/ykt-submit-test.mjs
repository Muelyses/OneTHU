/**
 * R20-C2 P2：雨课堂主观题提交 + 正文插图上传单测（离线，纯 mock fetchLike，零网络零真实请求）。
 *
 * 运行：node tools/ykt-submit-test.mjs
 * 覆盖：
 *  [1] submitYktProblemSubjective payload 形状：端点 problem_apply/、classroom_id/problem_id
 *      数字化、answer 三字段（content/time/oSubject）、filelist 空数组、attachments/time 透传
 *  [2] 请求头 + CSRF 双提交（§31.6）：XTBZ / Content-Type / Referer；X-CSRFToken ==
 *      Cookie csrftoken 同值——凭据已有 csrftoken → 原值取用；没有 → 32 位 hex 逐请求自签
 *      （无状态、不持久化、不污染凭据）
 *  [3] 成功响应归一（P1b 实测无 errcode 包裹直取 data 层）：my_score -1 / "-1.00" 占位不透出、
 *      submit_time 毫秒 → fmtLocal 本地 "YYYY-MM-DD HH:MM"、my_answer.attachment → attachments
 *  [4] 错误路径：403 CSRF 拦截（Error 非会话错误）/ 401·403 其他 → YktSessionError /
 *      errcode≠0 → 带 errcode 抛错 / errcode=401000 → 会话错误 / 非 JSON → 会话错误 /
 *      errcode=0 不抛
 *  [5] uploadExerciseInlineImage（§31.5-② 逆向 + P1b 实测修正）：token GET（upload_type=ue、
 *      data.token 解包、兼容顶层形状）、multipart 结构（实测字段序 OSSAccessKeyId/policy/
 *      Signature/key/callback/success_action_status/file 最后、key=dir+Date.now()-文件名、
 *      boundary 闭合、Origin/Referer 头、不带 Cookie）、callback 回执校验（success=false /
 *      error_message 非空 / errcode≠0 / 非 JSON / 缺 file_url 均报错，成功提取 data.file_url）
 *
 * 字段依据：docs/外部作业源-需求与实现方案.md §28.11 表 A / §31.5（P1a 逆向）/
 * §31.6（P1b 实发）；插图通道以 P1b 真机实测补记为准（data.token 包裹、
 * success_action_status=200、Origin/Referer 头、success+error_message 校验）。
 * ⚠️ 测试内 Cookie 均为脱敏假值；断言不打印任何 Cookie 头内容。
 */
import { createYuketangSource, isYktSessionError } from "../packages/core/src/exthw/yuketang.ts";

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

/** 构造按 URL 路由的 mock fetchLike；记录 {url, method, headers, bodyRaw}（bodyRaw 含二进制） */
function makeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;
    calls.push({ url, method, headers, bodyRaw: init.body === undefined ? null : init.body });
    for (const r of routes) {
      if (r.match(url)) {
        if (r.throw) throw new Error(r.throw);
        const raw = typeof r.body === "function" ? r.body() : r.body;
        return new Response(typeof raw === "string" ? raw : JSON.stringify(raw ?? {}), {
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

const decoder = new TextDecoder();
/** 请求体 → 文本（Uint8Array 按 UTF-8 解码；测试用 ASCII 字节避免失真） */
function bodyText(call) {
  if (typeof call.bodyRaw === "string") return call.bodyRaw;
  if (call.bodyRaw instanceof Uint8Array) return decoder.decode(call.bodyRaw);
  return "";
}
function jsonBody(call) {
  return JSON.parse(bodyText(call));
}
async function catchError(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

/** 解析手拼 multipart 文本 → [{name, value, filename?, contentType?}]（测试侧同式实现） */
function parseMultipart(text, boundary) {
  const parts = [];
  for (const raw of text.split(`--${boundary}`).slice(1)) {
    if (raw.startsWith("--")) continue; // 结束标记
    const seg = raw.startsWith("\r\n") ? raw.slice(2) : raw;
    const idx = seg.indexOf("\r\n\r\n");
    if (idx < 0) continue;
    const headers = seg.slice(0, idx);
    let value = seg.slice(idx + 4);
    if (value.endsWith("\r\n")) value = value.slice(0, -2);
    const name = (/(?:^|;)\s*name="([^"]*)"/.exec(headers) ?? [])[1] ?? "";
    const filename = (/filename="([^"]*)"/.exec(headers) ?? [])[1];
    const contentType = (/content-type:\s*([^\r\n]+)/i.exec(headers) ?? [])[1];
    parts.push({
      name,
      value,
      ...(filename !== undefined ? { filename } : {}),
      ...(contentType ? { contentType: contentType.trim() } : {}),
    });
  }
  return parts;
}

/** 与 core fmtLocal 同式的本地时间格式化（时区无关，用于生成期望值） */
function fmt(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const SUBMIT_OK = {
  count: 3,
  exercise_is_show_answer: false,
  is_show_answer: false,
  is_show_explain: true,
  my_answer: { content: "<p>x</p>", attachment: null },
  my_count: 1,
  my_score: "-1.00",
  submit_time: 1760000000000,
};

/* ───────────────── [1] 提交 payload 形状 ───────────────── */
console.log("\n[1] submitYktProblemSubjective：payload 形状（P1b 实测 {classroom_id, problem_id, answer 三字段}）");
{
  const fetchLike = makeFetch([{ match: (u) => u.includes("/problem_apply/"), body: SUBMIT_OK }]);
  const src = createYuketangSource({ cookie: "sessionid=abc" }, fetchLike, 30);
  const html = '<div class="custom_ueditor_cn_body"><p>u+v+w=0 → 线性相关 → 共面</p></div>';
  const r = await src.submitYktProblemSubjective({ classroomId: "3201641", problemId: "2973357", contentHtml: html });
  const c = fetchLike.calls[0];
  eq(c.url, "https://pro.yuketang.cn/mooc-api/v1/lms/exercise/problem_apply/", "端点 = {base}/mooc-api/v1/lms/exercise/problem_apply/");
  eq(c.method, "POST", "POST 方法");
  eq(fetchLike.calls.length, 1, "只发一次请求");
  const b = jsonBody(c);
  deepEq(
    Object.keys(b).sort(),
    ["answer", "classroom_id", "problem_id"],
    "顶层仅 classroom_id / problem_id / answer 三键",
  );
  ok(typeof b.classroom_id === "number", "classroom_id 数字化（字符串入参 \"3201641\"）");
  eq(b.classroom_id, 3201641, "classroom_id 值");
  ok(typeof b.problem_id === "number", "problem_id 数字化（字符串入参 \"2973357\"）");
  eq(b.problem_id, 2973357, "problem_id 值");
  ok(b.answer !== null && typeof b.answer === "object", "answer 为对象");
  deepEq(Object.keys(b.answer).sort(), ["content", "oSubject", "time"], "answer 三字段 content/time/oSubject");
  eq(b.answer.content, html, "answer.content 透传正文 HTML");
  eq(b.answer.time, "0", "answer.time 默认 \"0\"（官方 web 端恒定默认值）");
  deepEq(
    b.answer.oSubject,
    { attachments: { filelist: [] } },
    "oSubject = {attachments:{filelist:[]}}（空附件亦显式给空数组，P1b 实测形状）",
  );
  eq(r.count, 3, "返回值可读（归一化细节见 [3]）");
}
{
  // attachments + time 覆盖 + 数字入参
  const att = { fileID: "uid-1", fileName: "证明.pdf", fileSize: 2048, fileType: "pdf", fileUrl: "https://cdn.example.com/att/x.pdf" };
  const fetchLike = makeFetch([{ match: (u) => u.includes("/problem_apply/"), body: SUBMIT_OK }]);
  const src = createYuketangSource({ cookie: "sessionid=abc" }, fetchLike, 30);
  await src.submitYktProblemSubjective({
    classroomId: 3201641,
    problemId: 2973357,
    contentHtml: "<p>2</p>",
    attachments: [att],
    time: "12",
  });
  const b2 = jsonBody(fetchLike.calls[0]);
  eq(b2.classroom_id, 3201641, "classroomId 数字入参 → 原值");
  eq(b2.problem_id, 2973357, "problemId 数字入参 → 原值");
  eq(b2.answer.time, "12", "time 覆盖透传");
  deepEq(b2.answer.oSubject.attachments.filelist, [att], "filelist 条目原样透传（附件兜底通道）");
}
{
  // attachments 缺省 / undefined → 空数组（不透传 undefined）
  const fetchLike = makeFetch([{ match: (u) => u.includes("/problem_apply/"), body: SUBMIT_OK }]);
  const src = createYuketangSource({ cookie: "sessionid=abc" }, fetchLike, 30);
  await src.submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>x</p>", attachments: undefined });
  deepEq(jsonBody(fetchLike.calls[0]).answer.oSubject.attachments.filelist, [], "attachments: undefined → filelist []");
}
{
  // 非法入参：非数字 id → 参数错误（不发请求）
  const fetchLike = makeFetch([{ match: (u) => u.includes("/problem_apply/"), body: SUBMIT_OK }]);
  const src = createYuketangSource({ cookie: "sessionid=abc" }, fetchLike, 30);
  const e1 = await catchError(() => src.submitYktProblemSubjective({ classroomId: "abc", problemId: 2, contentHtml: "<p>x</p>" }));
  ok(e1 !== null && /classroomId/.test(e1.message), "classroomId 非数字 → 抛参数错误");
  const e2 = await catchError(() => src.submitYktProblemSubjective({ classroomId: 1, problemId: "", contentHtml: "<p>x</p>" }));
  ok(e2 !== null && /problemId/.test(e2.message), "problemId 空串（NaN）→ 抛参数错误");
  eq(fetchLike.calls.length, 0, "参数错误时不发请求");
}

/* ───────────────── [2] 请求头 + CSRF 双提交 ───────────────── */
console.log("\n[2] 请求头 + CSRF 双提交（§31.6：X-CSRFToken == Cookie csrftoken 同值）");
{
  // ① 凭据已有 csrftoken → 原值取用，Cookie 不重复追加
  const fixed = "0123456789abcdef0123456789abcdef";
  const fetchLike = makeFetch([{ match: (u) => u.includes("/problem_apply/"), body: SUBMIT_OK }]);
  const src = createYuketangSource({ cookie: `sessionid=abc; csrftoken=${fixed}; uv_id=1` }, fetchLike, 30);
  await src.submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>x</p>" });
  const c = fetchLike.calls[0];
  eq(c.headers["xtbz"], "ykt", "头 XTBZ: ykt");
  eq(c.headers["content-type"], "application/json", "头 Content-Type: application/json");
  eq(c.headers["referer"], "https://pro.yuketang.cn/", "头 Referer: https://pro.yuketang.cn/");
  eq(c.headers["x-csrftoken"], fixed, "X-CSRFToken == 凭据既有 csrftoken（原值）");
  ok((c.headers["cookie"] ?? "").includes(`csrftoken=${fixed}`), "Cookie 保留既有 csrftoken");
  eq(((c.headers["cookie"] ?? "").match(/csrftoken=/g) ?? []).length, 1, "Cookie 中 csrftoken 不重复追加");
  ok((c.headers["cookie"] ?? "").includes("sessionid=abc"), "sessionid 保留");
}
{
  // ② 凭据无 csrftoken → 逐请求自签（无状态、不持久化、不污染凭据）
  const fetchLike = makeFetch([{ match: (u) => u.includes("/problem_apply/"), body: SUBMIT_OK }]);
  const src = createYuketangSource({ cookie: "sessionid=abc" }, fetchLike, 30);
  await src.submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>x</p>" });
  await src.submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>x</p>" });
  const c1 = fetchLike.calls[0];
  const c2 = fetchLike.calls[1];
  const t1 = c1.headers["x-csrftoken"] ?? "";
  const t2 = c2.headers["x-csrftoken"] ?? "";
  ok(/^[0-9a-f]{32}$/.test(t1), "无凭据 csrftoken → 自签 16 字节（32 位 hex）token");
  ok(new RegExp(`(?:^|; )csrftoken=${t1}(?:;|$)`).test(c1.headers["cookie"] ?? ""), "Cookie 头追加自签 csrftoken（与 X-CSRFToken 同值）");
  ok(/^[0-9a-f]{32}$/.test(t2), "第二次提交同样自签 32 位 hex");
  ok(t1 !== t2, "两次提交 token 不同（无状态、逐请求自签，不持久化）");
  ok(!(c2.headers["cookie"] ?? "").includes(t1), "第二次请求不含第一次的 token（凭据未被污染）");
  ok((c2.headers["cookie"] ?? "").includes("sessionid=abc"), "sessionid 保留");
}

/* ───────────────── [3] 成功响应归一 ───────────────── */
console.log("\n[3] 成功响应归一（无 errcode 包裹；my_score 占位不透出；submit_time → fmtLocal）");
{
  const submitMs = 1760000000000;
  const fetchLike = makeFetch([
    {
      match: (u) => u.includes("/problem_apply/"),
      body: {
        count: 3,
        exercise_is_show_answer: false,
        is_show_answer: false,
        is_show_explain: true,
        my_answer: { content: "<p>u+v+w=0，故共面</p>", attachment: null },
        my_count: 1,
        my_score: "-1.00",
        submit_time: submitMs,
      },
    },
  ]);
  const src = createYuketangSource({ cookie: "s=1" }, fetchLike, 30);
  const r = await src.submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>a</p>" });
  eq(r.count, 3, "count 透传");
  eq(r.myCount, 1, "my_count → myCount（P1b：left_times 3→2 的已用端）");
  eq(r.submitTime, fmt(submitMs), "submit_time（毫秒）→ submitTime 本地 YYYY-MM-DD HH:MM（fmtLocal 同式）");
  eq(r.myScore, undefined, 'my_score "-1.00" 占位 → 不透出（对齐 myScore 口径）');
  eq(r.isShowAnswer, false, "is_show_answer → isShowAnswer");
  eq(r.exerciseIsShowAnswer, false, "exercise_is_show_answer → exerciseIsShowAnswer");
  eq(r.isShowExplain, true, "is_show_explain → isShowExplain");
  eq(r.myAnswer?.content, "<p>u+v+w=0，故共面</p>", "my_answer.content → myAnswer.content（P1b：回读逐字一致）");
  eq(r.myAnswer?.attachments, undefined, "my_answer.attachment null → attachments 不设");
}
{
  // 已批改回执：字符串分数 + 附件数组
  const fetchLike = makeFetch([
    {
      match: (u) => u.includes("/problem_apply/"),
      body: {
        count: 3,
        my_count: 2,
        my_score: "8.50",
        submit_time: 1760000000000,
        my_answer: { content: "<p>x</p>", attachment: [{ id: 7, name: "fig.png" }] },
      },
    },
  ]);
  const src = createYuketangSource({ cookie: "s=1" }, fetchLike, 30);
  const r = await src.submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>a</p>" });
  eq(r.myScore, 8.5, 'my_score "8.50"（已批改）→ myScore 8.5');
  deepEq(r.myAnswer?.attachments, [{ id: 7, name: "fig.png" }], "my_answer.attachment[] → attachments 原样数组");
  eq(r.count, 3, "count 透传");
  eq(r.myCount, 2, "my_count 透传");
}
{
  // 占位与缺字段容错
  const fetchLike1 = makeFetch([{ match: (u) => u.includes("/problem_apply/"), body: { my_score: -1 } }]);
  const r1 = await createYuketangSource({ cookie: "s=1" }, fetchLike1, 30).submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>a</p>" });
  eq(r1.myScore, undefined, "my_score -1（数字）占位 → 不透出");
  const fetchLike2 = makeFetch([{ match: (u) => u.includes("/problem_apply/"), body: { submit_time: "0" } }]);
  const r2 = await createYuketangSource({ cookie: "s=1" }, fetchLike2, 30).submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>a</p>" });
  eq(r2.submitTime, undefined, "submit_time 0（官方 falsy 同口径）→ 不设");
  const fetchLike3 = makeFetch([{ match: (u) => u.includes("/problem_apply/"), body: {} }]);
  const r3 = await createYuketangSource({ cookie: "s=1" }, fetchLike3, 30).submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>a</p>" });
  deepEq(r3, {}, "空成功响应 → 全字段不设不崩");
}

/* ───────────────── [4] 错误路径 ───────────────── */
console.log("\n[4] 错误路径（CSRF 拦截 / 会话失效 / errcode / 非 JSON）");
{
  // ① 403 CSRF 拦截 → 普通 Error（非会话失效）
  const fetchLike = makeFetch([{ match: (u) => u.includes("/problem_apply/"), body: "CSRF Failed: CSRF cookie not set", status: 403 }]);
  const src = createYuketangSource({ cookie: "s=1" }, fetchLike, 30);
  const e = await catchError(() => src.submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>x</p>" }));
  ok(e !== null && /CSRF/.test(e.message ?? ""), "403 + body 含 CSRF → 报「提交被 CSRF 拦截」");
  eq(e === null ? null : isYktSessionError(e), false, "CSRF 拦截不归一为会话失效（YktSessionError === false）");
}
{
  // ② 401 / 403（无 CSRF 字样）→ YktSessionError
  const fetchLike = makeFetch([
    { match: (u) => u.includes("/problem_apply/"), body: { detail: "Authentication credentials were not provided." }, status: 401 },
  ]);
  const src = createYuketangSource({ cookie: "s=1" }, fetchLike, 30);
  const e = await catchError(() => src.submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>x</p>" }));
  eq(isYktSessionError(e), true, "HTTP 401（无 CSRF 字样）→ YktSessionError");
  ok(e !== null && /会话已失效/.test(e.message), "错误文案含「会话已失效」");
  const fetchLike2 = makeFetch([{ match: (u) => u.includes("/problem_apply/"), body: { detail: "forbidden" }, status: 403 }]);
  const src2 = createYuketangSource({ cookie: "s=1" }, fetchLike2, 30);
  const e2 = await catchError(() => src2.submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>x</p>" }));
  eq(isYktSessionError(e2), true, "HTTP 403（无 CSRF 字样）→ YktSessionError");
}
{
  // ③ errcode≠0 / 401000 / 非 JSON / errcode=0
  const fetchLike = makeFetch([{ match: (u) => u.includes("/problem_apply/"), body: { errcode: 30001, errmsg: "不能重复提交" } }]);
  const src = createYuketangSource({ cookie: "s=1" }, fetchLike, 30);
  const e = await catchError(() => src.submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>x</p>" }));
  ok(e !== null && /errcode=30001/.test(e.message) && /不能重复提交/.test(e.message), "200 + errcode≠0 → 按 errcode/errmsg 抛错");

  const fetchLike2 = makeFetch([{ match: (u) => u.includes("/problem_apply/"), body: { errcode: 401000, errmsg: "login needed" } }]);
  const src2 = createYuketangSource({ cookie: "s=1" }, fetchLike2, 30);
  const e2 = await catchError(() => src2.submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>x</p>" }));
  eq(isYktSessionError(e2), true, "200 + errcode=401000 → YktSessionError");

  const fetchLike3 = makeFetch([{ match: (u) => u.includes("/problem_apply/"), body: "<html>login</html>" }]);
  const src3 = createYuketangSource({ cookie: "s=1" }, fetchLike3, 30);
  const e3 = await catchError(() => src3.submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>x</p>" }));
  eq(isYktSessionError(e3), true, "200 + 非 JSON（登录壳 HTML）→ YktSessionError");
  ok(e3 !== null && /非 JSON/.test(e3.message), "非 JSON 错误文案可辨");

  const fetchLike4 = makeFetch([{ match: (u) => u.includes("/problem_apply/"), body: { errcode: 0, count: 2 } }]);
  const src4 = createYuketangSource({ cookie: "s=1" }, fetchLike4, 30);
  const r4 = await src4.submitYktProblemSubjective({ classroomId: 1, problemId: 2, contentHtml: "<p>x</p>" });
  eq(r4.count, 2, "errcode=0 不抛（按成功归一）");
}

/* ───────────────── [5] 正文插图上传（OSS 表单直传 + callback） ───────────────── */
console.log("\n[5] uploadExerciseInlineImage：token GET / multipart 结构 / callback 回执");
const TOKEN_HOST = "https://bkt-24061.oss-cn-beijing.aliyuncs.com";
const CALLBACK_B64 =
  "eyJjYWxsYmFja1VybCI6Imh0dHBzOi8vcHJvLnl1a2V0YW5nLmNuL2NhbGxiYWNrL3VlIiwiY2FsbGJhY2tCb2R5Ijoie1wib2JqZWN0XCI6XCIke29iamVjdH1cIn0ifQ==";
const FILE_URL = "https://thu-oplat.xuetangx.com/ue/1760000000000-a.png";
const tokenData = () => ({
  msg: "ok",
  data: {
    token: {
      accessid: "STS.AKIDEXAMPLE",
      bucket: "bkt-24061",
      callback: CALLBACK_B64,
      dir: "ue/",
      expire: 1760003600,
      host: TOKEN_HOST,
      policy: "POLICYBASE64EXAMPLE==",
      signature: "SIGEXAMPLE==",
    },
  },
});
const cbOk = {
  msg: "",
  data: { filename: "ue/1760000000000-a.png", file_url: FILE_URL, error_message: "", size: 26 },
  success: true,
};

{
  const fetchLike = makeFetch([
    { match: (u) => u.includes("/get_aliyun_oss_token/"), body: tokenData() },
    { match: (u) => u.startsWith(TOKEN_HOST), body: cbOk },
  ]);
  const src = createYuketangSource({ cookie: "sessionid=abc" }, fetchLike, 30);
  const bytes = new TextEncoder().encode("BINARYPNGBYTES-0123456789");
  const r = await src.uploadExerciseInlineImage({ classroomId: 3201641, fileName: "a.png", mime: "image/png", bytes });
  eq(r.fileUrl, FILE_URL, "返回 callback 的 data.file_url（P1b 实测：file_url 域非 OSS host 域）");
  eq(fetchLike.calls.length, 2, "共两次请求（token GET + OSS POST）");

  const t = fetchLike.calls[0];
  ok(t.url.includes("/c27/online_courseware/service/get_aliyun_oss_token/?upload_type=ue"), "token GET 路径 + upload_type=ue");
  eq(t.method, "GET", "token GET 方法");
  eq(t.headers["xtbz"], "ykt", "token GET 带 XTBZ: ykt");
  ok((t.headers["cookie"] ?? "").includes("sessionid=abc"), "token GET 带 Cookie");

  const p = fetchLike.calls[1];
  eq(p.url, TOKEN_HOST, "POST 到 token.host（OSS host）");
  eq(p.method, "POST", "OSS POST 方法");
  eq(p.headers["origin"], "https://pro.yuketang.cn", "OSS POST 带 Origin 头（P1b 实测必须）");
  eq(p.headers["referer"], "https://pro.yuketang.cn/", "OSS POST 带 Referer 头");
  eq(p.headers["cookie"], undefined, "OSS POST 不带 ykt Cookie（跨域凭据不外泄）");
  const m = /boundary=(.+)$/.exec(p.headers["content-type"] ?? "");
  ok(!!m, "Content-Type: multipart/form-data; boundary=…");
  ok(p.bodyRaw instanceof Uint8Array && p.bodyRaw.length > 0, "请求体为非空 Uint8Array（二进制 body 交传输层）");
  const text = bodyText(p);
  const parts = parseMultipart(text, m[1]);
  deepEq(
    parts.map((x) => x.name),
    ["OSSAccessKeyId", "policy", "Signature", "key", "callback", "success_action_status", "file"],
    "multipart 字段顺序 = P1b 实测成功序（file 字段最后）",
  );
  const byName = Object.fromEntries(parts.map((x) => [x.name, x]));
  eq(byName.OSSAccessKeyId?.value, "STS.AKIDEXAMPLE", "OSSAccessKeyId = token.accessid");
  eq(byName.policy?.value, "POLICYBASE64EXAMPLE==", "policy 透传");
  eq(byName.Signature?.value, "SIGEXAMPLE==", "Signature = token.signature");
  ok(/^ue\/\d{13}-a\.png$/.test(byName.key?.value ?? ""), "key = {dir}{Date.now()}-{文件名}（dir 自带尾斜杠）");
  eq(byName.callback?.value, CALLBACK_B64, "callback 整段 base64 原样透传（不解包）");
  eq(byName.success_action_status?.value, "200", "success_action_status=200（P1b 实测字段）");
  eq(byName.file?.filename, "a.png", "file 字段带 filename");
  eq(byName.file?.contentType, "image/png", "file 字段 Content-Type = mime");
  ok((byName.file?.value ?? "").includes("BINARYPNGBYTES-0123456789"), "文件字节在 file 段内（原样不编码）");
  ok(text.endsWith(`--${m[1]}--\r\n`), "multipart 以闭合 boundary 结尾");
}
{
  // token 字段顶层的旧形状兼容（无 data 包裹）
  const fetchLike = makeFetch([
    {
      match: (u) => u.includes("/get_aliyun_oss_token/"),
      body: { host: TOKEN_HOST, accessid: "A2", policy: "P2", signature: "S2", dir: "ue/", callback: "CB" },
    },
    { match: (u) => u.startsWith(TOKEN_HOST), body: cbOk },
  ]);
  const src = createYuketangSource({ cookie: "sessionid=abc" }, fetchLike, 30);
  const r = await src.uploadExerciseInlineImage({ classroomId: 1, fileName: "b.jpg", mime: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) });
  eq(r.fileUrl, FILE_URL, "token 顶层形状（无 data 包裹）→ 照常上传");
  const text = bodyText(fetchLike.calls[1]);
  const boundary = /boundary=(.+)$/.exec(fetchLike.calls[1].headers["content-type"])[1];
  const byName = Object.fromEntries(parseMultipart(text, boundary).map((x) => [x.name, x]));
  eq(byName.OSSAccessKeyId?.value, "A2", "顶层形状字段取值正确");
}
{
  // callback 校验：success=false + error_message / 仅 error_message / errcode≠0 / 非 JSON / 缺 file_url
  const mk = (ossBody) =>
    makeFetch([
      { match: (u) => u.includes("/get_aliyun_oss_token/"), body: tokenData() },
      { match: (u) => u.startsWith(TOKEN_HOST), body: ossBody },
    ]);
  const call = (ossBody) =>
    createYuketangSource({ cookie: "s=1" }, mk(ossBody), 30).uploadExerciseInlineImage({
      classroomId: 1,
      fileName: "a.png",
      mime: "image/png",
      bytes: new Uint8Array([1]),
    });

  const e1 = await catchError(() =>
    call({ msg: "x", data: { file_url: "", error_message: "FileTooLarge: 超过大小限制", size: 0 }, success: false }),
  );
  ok(e1 !== null && /success=false/.test(e1.message) && /FileTooLarge/.test(e1.message), "callback success=false → 报错并带 error_message");

  const e2 = await catchError(() => call({ data: { error_message: "bad policy" } }));
  ok(e2 !== null && /bad policy/.test(e2.message), "callback error_message 非空（success 缺失）→ 报错");

  const e3 = await catchError(() => call({ errcode: 40003, errmsg: "denied" }));
  ok(e3 !== null && /errcode=40003/.test(e3.message), "callback errcode≠0（§31.5 旧记录形状兼容）→ 报错");

  const e4 = await catchError(() =>
    call('<?xml version="1.0"?><Error><Code>SignatureDoesNotMatch</Code></Error>'),
  );
  ok(e4 !== null && /非 JSON/.test(e4.message), "OSS 非 JSON（XML 错误）→ 报错（不误判会话失效）");
  eq(e4 === null ? null : isYktSessionError(e4), false, "OSS XML 错误不归一为会话失效");

  const e5 = await catchError(() => call({ msg: "", data: { filename: "x", error_message: "", size: 1 }, success: true }));
  ok(e5 !== null && /file_url/.test(e5.message), "callback 成功但缺 data.file_url → 报错");
}
{
  // token GET 失败路径：errcode 401000 → 会话错误；缺 host/accessid/policy/signature → 报错
  const fetchLike = makeFetch([{ match: (u) => u.includes("/get_aliyun_oss_token/"), body: { errcode: 401000, errmsg: "login needed" } }]);
  const src = createYuketangSource({ cookie: "s=1" }, fetchLike, 30);
  const e = await catchError(() =>
    src.uploadExerciseInlineImage({ classroomId: 1, fileName: "a.png", mime: "image/png", bytes: new Uint8Array([1]) }),
  );
  eq(isYktSessionError(e), true, "token GET errcode=401000 → YktSessionError");

  const fetchLike2 = makeFetch([
    { match: (u) => u.includes("/get_aliyun_oss_token/"), body: { msg: "ok", data: { token: { accessid: "a", policy: "p", signature: "s" } } } },
  ]);
  const src2 = createYuketangSource({ cookie: "s=1" }, fetchLike2, 30);
  const e2 = await catchError(() =>
    src2.uploadExerciseInlineImage({ classroomId: 1, fileName: "a.png", mime: "image/png", bytes: new Uint8Array([1]) }),
  );
  ok(e2 !== null && /host\/accessid\/policy\/signature/.test(e2.message), "token 缺 host 等必填字段 → 报错不发上传");
  eq(fetchLike2.calls.length, 1, "token 异常时不发 OSS POST");

  const fetchLike3 = makeFetch([{ match: (u) => u.includes("/get_aliyun_oss_token/"), body: tokenData() }]);
  const src3 = createYuketangSource({ cookie: "s=1" }, fetchLike3, 30);
  const e3 = await catchError(() =>
    src3.uploadExerciseInlineImage({ classroomId: 1, fileName: "", mime: "image/png", bytes: new Uint8Array([1]) }),
  );
  ok(e3 !== null && /fileName/.test(e3.message), "fileName 空 → 抛参数错误");
  const e4 = await catchError(() =>
    src3.uploadExerciseInlineImage({ classroomId: 1, fileName: "a.png", mime: "image/png", bytes: new Uint8Array(0) }),
  );
  ok(e4 !== null && /文件内容为空/.test(e4.message), "bytes 空 → 抛参数错误");
  eq(fetchLike3.calls.length, 0, "参数错误时不发任何请求");
}

console.log(`\n合计：${pass} 通过 / ${fail} 失败`);
process.exitCode = fail > 0 ? 1 : 0;
if (fail > 0) console.error("存在失败断言，详见上方 ✗");
