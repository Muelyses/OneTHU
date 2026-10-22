/** Anonymous structural fixtures only. Never contacts a school service or mutates account language. */
import assert from "node:assert/strict";
import { LearnClient } from "../packages/core/src/learn/client.ts";
import { parseSelectedCourses, parseXkCatalogPage, parseXkSelectedFull, submitXkCourse, dropXkCourse, changeXkVolunteer } from "../packages/core/src/zhjwxk/client.ts";
import { parsePagerInfo } from "../packages/core/src/zhjwxk/xk-vol.ts";
import { isXkCourseTable, xkRejectionMessage } from "../packages/core/src/zhjwxk/html-language.ts";

let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
globalThis.fetch = async () => { throw Error("School requests are forbidden in this test"); };
const originalTimeout = globalThis.setTimeout;
// Accelerate only the production polling intervals; the mock still observes each request.
globalThis.setTimeout = (callback, _delay, ...args) => originalTimeout(callback, 0, ...args);
const learn = http => { const client = new LearnClient(http); client.applyCsrf("fixture-only"); return client; };
try {
  const courses = await learn({ text: async () => JSON.stringify({ resultList: [{ wlkcid: "course-anon", kcm: "匿名课程", ywkcm: "Anonymous &amp; Example", kch: "TEST123", kxh: 2, jsm: "Example Teacher" }] }) }).getCourseList("2099-2100-1");
  check(courses[0].name === "匿名课程" && courses[0].englishName === "Anonymous & Example", "Course language fields and original data stay distinct");
  check(courses[0].id === "course-anon" && courses[0].courseIndex === 2, "Course identity does not depend on display language");
  for (const payload of [{ result: "error", msg: "Submission failed" }, { result: "failure", msg: "Deadline exceeded" }, { result: "failed" }, { success: false }, { message: "Permission denied" }, {}, null, []]) {
    const client = learn({ postForm: async () => JSON.stringify(payload) });
    check(!(await client.submitHomework("assignment-anon", { content: "Original answer" })).ok, "Unknown or failed JSON cannot claim submission success: " + JSON.stringify(payload));
  }
  let posted;
  const accepted = await learn({ postForm: async (_url, data) => { posted = data; return '{"result":"success","msg":"Submitted"}'; } }).submitHomework("assignment-anon", { content: "<p>Original & 中文</p>" });
  check(accepted.ok && posted.get("zynr") === "<p>Original & 中文</p>", "Explicit success is accepted and the answer is sent unchanged");
  check(posted.get("xszyid") === "assignment-anon" && posted.get("isDeleted") === "0", "Display language never changes machine submission fields");
  const loginClient = learn({ postForm: async () => '<html><title>Login - Tsinghua Web Learning</title><form action="j_spring_security_check"></form></html>' });
  let relogins = 0; loginClient.reloginHook = async () => { relogins++; return false; };
  check(!(await loginClient.submitHomework("assignment-anon", {})).ok && relogins === 1, "English login page is a session failure, not submission success");
  for (const label of ["上交作业内容", "Submitted Homework Content", "Submission Content"]) {
    const view = `<div class="fl left">${label}</div><div class='right'><span>&lt;em&gt;Original answer&lt;/em&gt;</span></div><!--Assignment attachments--><div class="list fujian clearfix"></div>`;
    const client = learn({ text: async url => url.includes("tijiao") ? "<html><p>Submitted assignment</p></html>" : view });
    const detail = await client.getHomeworkPageDetail("course-anon", "assignment-anon");
    check(detail.submittedContent?.includes("<em>Original answer</em>"), label + ": submitted answer is extracted from its label section");
    check(!client.lastPageDetailDebug.includes("Original answer"), label + ": answer content is not copied into diagnostics");
  }
  const textarea = await learn({ text: async url => url.includes("tijiao") ? '<form><textarea name="zynr">&lt;p&gt;Draft content&lt;/p&gt;</textarea><input name="fileupload"></form>' : '<p>The assignment describes submission content.</p>' }).getHomeworkPageDetail("course-anon", "assignment-anon");
  check(textarea.hasSubmitForm && textarea.submittedContent === "<p>Draft content</p>", "Language-neutral actual form controls preserve existing submission text");
  const prose = await learn({ text: async () => "<p>Submission Content is mentioned by the instructor.</p>" }).getHomeworkPageDetail("course-anon", "assignment-anon");
  check(!prose.submittedContent && !prose.hasSubmitForm, "English phrase in assignment prose is not a submitted answer");

  const headers = ["Course Title", "Instructor", "Course Code", "Section", "Credits", "Department", "Undergraduate Capacity", "Undergraduate Vacancies", "Graduate Capacity", "Graduate Vacancies", "Notes", "Time and Location", "Grade", "Features"];
  const values = ["Anonymous Course", "Example Teacher", "TEST123", "01", "3", "Example Department", "80", "12", "20", "5", "Example note", "Tuesday 08:00-09:35 (Weeks 1-16) Room A", "2", "Seminar"];
  const table = (heads, rows) => `<table><tr class="trr1">${heads.map(x => `<th>${x}</th>`).join("")}</tr>${rows.map(row => `<tr class="trr2">${row.map(x => `<td>${x}</td>`).join("")}</tr>`).join("")}</table>`;
  const englishCatalog = table(headers, [values]);
  const catalog = parseXkCatalogPage(englishCatalog);
  check(catalog.length === 1 && catalog[0].code === "TEST123" && catalog[0].name === "Anonymous Course", "Shuffled English catalogue header maps course identity");
  check(catalog[0].teacher === "Example Teacher" && catalog[0].credits === 3 && catalog[0].remaining === 12, "English catalogue maps instructor, credits and undergraduate vacancies");
  check(catalog[0].gradRemaining === 5 && catalog[0].time.startsWith("Tuesday"), "English catalogue distinguishes graduate vacancies and time");
  const selectedHeaders = ["", "Course Type", "Preference", "Course Code", "Course Name", "Section", "Class Time", "Instructor", "Credits"];
  const token = '<input name="token" value="fixture-once">';
  const selected = (seq = "01", priority = 1) => token + table(selectedHeaders, [[`<input value='2099-2100-1;TEST123;${seq};' name='p_del_id'>`, "Required", `${priority}${priority === 1 ? "st" : "nd"} choice`, "TEST123", "Anonymous Course", seq, "Tuesday 08:00-09:35", "Example Teacher", "3"]]);
  const list = parseSelectedCourses(selected());
  check(list[0]?.name === "Anonymous Course" && list[0]?.teacher === "Example Teacher", "Selected English list uses headers instead of Chinese-name heuristics");
  const full = parseXkSelectedFull(selected("01", 2));
  check(full[0]?.code === "TEST123" && full[0]?.seq === "01" && full[0]?.zy === 2, "Selected full row preserves authoritative input identity and English preference");
  check(isXkCourseTable(table(selectedHeaders, [])) && !isXkCourseTable("<html>Temporarily unavailable</html>"), "Empty English result table differs from an error page");
  check(parsePagerInfo("Page 2 of 9 (176 records)").pages === 9 && parsePagerInfo("Page 2 of 9 (176 records)").total === 176, "English pagination is parsed");
  check(parsePagerInfo("共 9 页（共 1,176 条记录）").total === 1176, "Chinese pagination remains compatible");
  for (const message of ["Course selection failed", "Prerequisite not met", "This operation is not allowed", "The class is full", "Credit limit exceeded", "选课失败：时间冲突"]) {
    check(xkRejectionMessage("<script>alert('" + message + "')</script>") === message, "Explicit rejection retained: " + message);
  }
  check(xkRejectionMessage('<script>var genericError="failed";</script><table><tr><td>Normal page</td></tr></table>') === null, "Unused JS error strings do not reject a normal page");
  const session = ({ response = "<p>Request received</p>", readback = selected(), queue = table(selectedHeaders, []) } = {}) => {
    const requests = [];
    return { requests, http: { text: async (url, init) => {
      requests.push({ method: init?.method ?? "GET", url });
      if (url.includes("xklogin.do")) return '<a href="?p_xnxq=2099-2100-1">Course registration</a>';
      if (init?.method === "POST") return response;
      if (url.includes("m=dlSearch")) return queue;
      if (url.includes("m=yxSearchTab")) return readback;
      return token;
    } }, username: "", password: "", fingerprint: "" };
  };
  const opts = { semester: "2099-2100-1", code: "TEST123", seq: "1", zy: 1, flag: "bx" };
  const rejected = session({ response: "<script>alert('Course selection failed: time conflict')</script>" });
  check(!(await submitXkCourse(rejected, opts)).ok, "English refusal cannot be overwritten by a previously selected same course");
  check(!rejected.requests.some(r => r.url.includes("m=yxSearchTab")), "Explicit rejection does not enter success polling");
  check(!(await submitXkCourse(session({ readback: selected("02") }), opts)).ok, "Another section of the same course cannot confirm a selection");
  check((await submitXkCourse(session(), opts)).ok, "Unknown English acknowledgement requires matching code and normalized section read-back");
  const unknownDrop = session({ readback: token + "<html>Unknown upstream response</html>" });
  check(!(await dropXkCourse(unknownDrop, { ...opts, isQueue: false })).ok
    && unknownDrop.requests.some(r => r.method === "POST")
    && unknownDrop.requests.filter(r => r.url.includes("m=yxSearchTab")).length === 4, "Missing code in an unrecognized page cannot confirm withdrawal after POST and three polls");
  check(!(await dropXkCourse(session(), { ...opts, isQueue: false })).ok, "Unchanged selected table cannot report withdrawal success");
  const malformedDrop = session({ readback: selected().replaceAll("p_del_id", "changed_identity_field") });
  check(!(await dropXkCourse(malformedDrop, { ...opts, isQueue: false })).ok, "Unparsed data row cannot turn a selected course into confirmed absence");
  const differentQuoteDrop = session({ readback: selected().replaceAll('class="trr2"', "class='trr2'") });
  check(!(await dropXkCourse(differentQuoteDrop, { ...opts, isQueue: false })).ok, "Unrecognized row markup cannot confirm withdrawal");
  // Token page has the course; only read-back after the POST becomes empty.
  const dropped = session(); let postedDrop = false;
  const textRequest = dropped.http.text;
  dropped.http.text = async (url, init) => {
    if (init?.method === "POST") postedDrop = true;
    if (postedDrop && !init?.method && url.includes("m=yxSearchTab")) return table(selectedHeaders, []);
    return textRequest(url, init);
  };
  check((await dropXkCourse(dropped, { ...opts, isQueue: false })).ok, "Recognized empty English selected table confirms withdrawal");
  check(!(await changeXkVolunteer(session(), { ...opts, zy: 2 })).ok, "Unchanged preference cannot report successful adjustment");
  check((await changeXkVolunteer(session({ readback: selected("01", 2) }), { ...opts, zy: 2 })).ok, "Matching English preference read-back confirms adjustment");
  check(!(await changeXkVolunteer(session({ response: "<p>Operation not permitted</p>" }), opts)).ok, "English rejection is respected by preference changes");
  console.log(`School language parser: ${checks} checks passed (offline anonymous fixtures only).`);
} finally { globalThis.setTimeout = originalTimeout; }
