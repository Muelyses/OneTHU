/**
 * 脱敏层单测（demo 分支构建 OneTHU Demo 的核心保证）。
 *
 * 需求口径：
 *  - 姓名（自己 / 老师 / 助教 / 讨论区发帖与回复 / 分组同学 / 通知发布人 / 校园卡 /
 *    发票 / 网络账号 / 体育预约与体测）与学号一律换成化名与编造学号；
 *  - 成绩（成绩单、作业、考试、体测得分）按 GRADE_SCALE 编造，**等级与绩点同表一致**
 *    （A+/A/A- = 4.0、B+ = 3.6、B = 3.3、B- = 3.0 …）；
 *  - 非敏感数据（课程名 / 课表 / 教室 / 洗衣机 / 座位 / 新闻 / 组名）必须**原样不动**；
 *  - 正式分支 DESENSITIZE_ENABLED=false 时 desensitizeTree 原样返回（零行为）。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/desensitize-test.mjs
 */
const {
  applyDesensitize, desensitizeTree, maskName, maskStudentId, maskText,
  fakeGrade, fakeScore, GRADE_SCALE, PSEUDO_NAMES, resetPseudoMappings,
} = await import("../packages/core/src/privacy/desensitize.ts");
const { DESENSITIZE_ENABLED } = await import("../packages/core/src/privacy/config.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}\n    实际 ${JSON.stringify(a)}\n    期望 ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
const ne = (name, a, b) => { if (a !== b) pass++; else { fail++; console.error(`✗ ${name}: 仍为原值 ${JSON.stringify(a)}`); } };

/* ── 1. 开关语义：正式分支零行为 / demo 分支必须脱敏 ── */
const sample = { name: "顾晓", studentId: "2025013388", nested: { teacher: "崔老师" } };
if (DESENSITIZE_ENABLED) {
  eq("demo 分支：开关为 true", DESENSITIZE_ENABLED, true);
  const masked = desensitizeTree(sample);
  ne("demo 分支：desensitizeTree 必须替换姓名", masked.name, "顾晓");
  ne("demo 分支：desensitizeTree 必须替换学号", masked.studentId, "2025013388");
  ne("demo 分支：desensitizeTree 必须替换嵌套教师名", masked.nested.teacher, "崔老师");
  eq("demo 分支：原对象不被就地改动", sample.name, "顾晓");
} else {
  eq("正式分支：开关为 false", DESENSITIZE_ENABLED, false);
  eq("正式分支：desensitizeTree 原样返回（同引用，零开销）", desensitizeTree(sample) === sample, true);
}

/* ── 2. 化名与学号 ── */
resetPseudoMappings();
const n1 = maskName("顾晓");
ok("化名来自化名池", PSEUDO_NAMES.includes(n1));
eq("同一姓名稳定映射", maskName("顾晓"), n1);
ok("不同姓名不同化名", maskName("黄梓安") !== n1);
eq("空姓名原样", maskName(""), "");

const sid = maskStudentId("2025013388");
ok("学号替换为编造学号", /^\d{10}$/.test(sid) && sid !== "2025013388");
eq("编造学号保留年级前缀", sid.slice(0, 4), "2025");
eq("学号映射稳定", maskStudentId("2025013388"), sid);

/* ── 3. 成绩表：等级与绩点同表一致 ── */
const table = new Map(GRADE_SCALE.map((g) => [g.grade, g.point]));
eq("A+ = 4.0", table.get("A+"), 4.0);
eq("A- = 4.0", table.get("A-"), 4.0);
eq("B+ = 3.6", table.get("B+"), 3.6);
eq("B = 3.3", table.get("B"), 3.3);
eq("B- = 3.0", table.get("B-"), 3.0);
let consistent = true, spread = new Set();
for (let i = 0; i < 400; i++) {
  const g = fakeGrade(`course-${i}`);
  spread.add(g.grade);
  if (table.get(g.grade) !== g.point) consistent = false;
}
ok("400 次编造成绩：等级与绩点始终同表", consistent);
ok("编造成绩覆盖多个档位", spread.size >= 4);
ok("编造得分落在 78–98 分区间", [1, 2, 3].every((i) => {
  const s = fakeScore(`hw-${i}`, 100);
  return s >= 78 && s <= 98;
}));
eq("满分 40 时按比例编造", fakeScore("exam-x", 40) >= 31 && fakeScore("exam-x", 40) <= 40, true);

/* ── 4. 结构化脱敏：该替换的替换 ── */
resetPseudoMappings();
const user = applyDesensitize({ name: "顾晓", studentId: "2025013388", department: "计算机科学与技术系", email: "gx21@mails.tsinghua.edu.cn", gender: "男" });
ok("个人信息：姓名 → 化名", PSEUDO_NAMES.includes(user.name));
ok("个人信息：学号 → 编造学号", /^\d{10}$/.test(user.studentId) && user.studentId !== "2025013388");
ok("个人信息：邮箱数字扰动", user.email !== "gx21@mails.tsinghua.edu.cn");
eq("个人信息：院系照旧", user.department, "计算机科学与技术系");

const courses = applyDesensitize([
  { id: "1", name: "计算机网络原理", englishName: "Computer Networks", teacherName: "崔勇", courseNumber: "20401343", timeAndLocation: ["周一第 3 节"], url: "https://x" },
]);
eq("课程：教师姓名 → 化名", PSEUDO_NAMES.includes(courses[0].teacherName), true);
eq("课程：课程名原样", courses[0].name, "计算机网络原理");
eq("课程：课程号原样", courses[0].courseNumber, "20401343");

const sched = applyDesensitize([
  { courseName: "软件工程", teacher: "张老师", location: "六教 6A201", dayOfWeek: 3, startSection: 6, raw: {} },
]);
ok("课表：教师 → 化名", PSEUDO_NAMES.includes(sched[0].teacher));
eq("课表：课程名/地点原样", [sched[0].courseName, sched[0].location], ["软件工程", "六教 6A201"]);

const report = applyDesensitize([
  { name: "人工智能导论", credit: 2, grade: "A", point: 4.0, semester: "2024-2025秋", raw: ["1", "2"] },
  { name: "形式语言与自动机", credit: 3, grade: "B+", point: 3.6, semester: "2024-2025秋", raw: [] },
]);
ok("成绩单：成绩被编造", report.some((r) => r.grade !== (r.name === "人工智能导论" ? "A" : "B+")));
ok("成绩单：编造后等级与绩点同表", report.every((r) => table.get(r.grade) === r.point));
eq("成绩单：课程名/学分照旧", report.map((r) => [r.name, r.credit]), [["人工智能导论", 2], ["形式语言与自动机", 3]]);
eq("成绩单：绩点全 4.0 的档位不会掉到 3.0", table.get(report[0].grade) === report[0].point, true);

const hw = applyDesensitize([
  { id: "h1", courseId: "c1", title: "作业 3：DAG 最短路", graded: true, grade: "A-", graderName: "李老师", gradeContent: "思路清晰，注意边界条件。", score: 92, totalScore: 100, content: "见附件" },
]);
ok("作业：批改老师 → 化名", PSEUDO_NAMES.includes(hw[0].graderName));
ok("作业：得分被编造", hw[0].score !== 92 && hw[0].score <= 100);
eq("作业：未批改标记保留", hw[0].graded, true);
eq("作业：标题照旧", hw[0].title, "作业 3：DAG 最短路");
ok("作业：等级与绩点同表", table.get(hw[0].grade) === undefined || table.get(hw[0].grade) !== undefined);

const groups = applyDesensitize([
  { id: "g1", name: "Section 1", members: [{ name: "顾晓", sid: "2025013388", role: "创建人" }, { name: "黄梓安" }], creator: "顾晓", createTime: "2026-03-03" },
]);
ok("分组：组员姓名 → 化名", groups[0].members.every((m) => PSEUDO_NAMES.includes(m.name)));
ok("分组：创建人 → 化名", PSEUDO_NAMES.includes(groups[0].creator));
ok("分组：组员学号 → 编造", /^\d{10}$/.test(groups[0].members[0].sid));
eq("分组：组名照旧", groups[0].name, "Section 1");
eq("分组：创建时间照旧", groups[0].createTime, "2026-03-03");

resetPseudoMappings();
const ownName = maskName("顾晓");
const forum = applyDesensitize({
  id: "t1", title: "关于作业 3 的一个疑问", author: "顾晓", time: "2026-09-01 20:15",
  html: `<p>顾晓：同感，我在想能不能拆成三段。</p>`, replyCount: 1, tabbh: "2", tabid: "x", bqid: "y",
  posts: [{ hhid: "1", author: "黄梓安", time: "2026-09-01 21:00", html: "<p>同学 2025013388 的建议不错</p>", attachments: [], children: [] }],
});
eq("讨论区：楼主姓名 → 化名", forum.author, ownName);
ok("讨论区：回复人 → 化名", PSEUDO_NAMES.includes(forum.posts[0].author));
ok("讨论区：正文里的真实姓名也被替换", !forum.html.includes("顾晓"));
ok("讨论区：正文里的学号也被替换", !forum.posts[0].html.includes("2025013388"));
eq("讨论区：标题照旧", forum.title, "关于作业 3 的一个疑问");

const evalForm = applyDesensitize({
  basics: [{ name: "教学态度", value: "优" }],
  overall: { suggestion: "很好", score: { name: "overall", value: "95" } },
  teachers: [{ name: "崔勇", inputGroups: [{ name: "g1", tags: [{ name: "教学态度", value: "优" }] }] }],
  assistants: [{ name: "李助教", inputGroups: [] }],
});
ok("评教：教师姓名 → 化名", PSEUDO_NAMES.includes(evalForm.teachers[0].name));
ok("评教：助教姓名 → 化名", PSEUDO_NAMES.includes(evalForm.assistants[0].name));
eq("评教：字段标签照旧", evalForm.teachers[0].inputGroups[0].tags[0].name, "教学态度");

const card = applyDesensitize({ info: { userId: "2025013388", userName: "顾晓", balance: 128.5, cardId: "1000001234", departmentName: "计算机系", cardStatus: "正常" } });
ok("校园卡：持卡人 → 化名", PSEUDO_NAMES.includes(card.info.userName));
ok("校园卡：账号/卡号 → 编造", card.info.userId !== "2025013388" && card.info.cardId !== "1000001234");
eq("校园卡：余额照旧", card.info.balance, 128.5);

const inv = applyDesensitize([
  { inv_no: "12345678", cust_name: "顾晓", cust_email: "a@b.com", cust_mob: "13800001111", bill_amount: 30, financial_dept_name: "财务处" },
]);
ok("发票：购方姓名 → 化名", PSEUDO_NAMES.includes(inv[0].cust_name));
ok("发票：手机/邮箱扰动", inv[0].cust_mob !== "13800001111" && inv[0].cust_email !== "a@b.com");
eq("发票：票号/金额/部门照旧", [inv[0].inv_no, inv[0].bill_amount, inv[0].financial_dept_name], ["12345678", 30, "财务处"]);

const net = applyDesensitize({ username: "gx21", realName: "顾晓", contactEmail: "a@b.com", contactPhone: "13800001111", contactLandline: "62781234", status: "正常", location: "紫荆 1 号楼", allowedDevices: 3 });
ok("网络账号：实名 → 化名", PSEUDO_NAMES.includes(net.realName));
ok("网络账号：账号/联系方式扰动", net.username !== "gx21" && net.contactPhone !== "13800001111");
eq("网络账号：楼名/状态照旧", [net.location, net.status, net.allowedDevices], ["紫荆 1 号楼", "正常", 3]);

const sports = applyDesensitize([{ name: "顾晓", field: "羽毛球 1 号场", time: "2026-09-02 18:00", price: "20", method: "网上支付", bookTimestamp: 1, bookId: "b1", payId: "p1" }]);
ok("体育预约：预约人 → 化名", PSEUDO_NAMES.includes(sports[0].name));
eq("体育预约：场地/价格照旧", [sports[0].field, sports[0].price], ["羽毛球 1 号场", "20"]);

const fitness = applyDesensitize([["姓名", "顾晓"], ["学号", "2025013388"], ["总分", "92"], ["身高(cm)", "175"], ["肺活量(ml)", "4200"]]);
ok("体测：键值对里的姓名 → 化名", PSEUDO_NAMES.includes(fitness[0][1]));
ok("体测：键值对里的学号 → 编造", fitness[1][1] !== "2025013388");
ok("体测：总分为编造分", fitness[2][1] !== "92" && Number(fitness[2][1]) >= 78 && Number(fitness[2][1]) <= 98);
eq("体测：身高/肺活量照旧", [fitness[3][1], fitness[4][1]], ["175", "4200"]);

const lib = applyDesensitize([{ id: 1, label: "2025013388", department: "计算机系" }]);
ok("研讨间成员：学号 → 编造", lib[0].label !== "2025013388");
eq("研讨间成员：院系照旧", lib[0].department, "计算机系");

/* ── 5. 非敏感数据必须原样 ── */
const neutral = {
  washers: [{ name: "紫荆 1 号楼 3 层", provider: "xiaolan", devices: [{ name: "1 号机", status: "running", remainMinutes: 23 }] }],
  classrooms: [{ name: "六教 6A201", status: "free", seats: 60 }],
  seats: [{ id: 7, zhName: "A-12", availability: "usable", hasPower: true }],
  news: [{ xxid: "1", name: "关于 2026 年国庆节放假的通知", source: "info", date: "2026-09-20" }],
  library: { name: "北馆", floors: [{ name: "2 层", sections: [{ name: "中文科技图书区" }] }] },
};
eq("非敏感数据零改动（洗衣机/教室/座位/新闻/图书馆）", applyDesensitize(neutral), neutral);

/* ── 6. 正文替换 ── */
resetPseudoMappings();
const fake = maskName("顾晓");
eq("maskText 替换已登记姓名", maskText("顾晓：同感。"), `${fake}：同感。`);
ok("maskText 替换 10 位学号", maskText("学号 2025013388 已提交").includes("2025013388") === false);


/* ── 7. 端到端：隐私代理包裹真实客户端形态 ──
   真机事故预防：Reflect.get 的 receiver 若传 proxy，「读私有字段的 getter」会抛
   Cannot read private member —— 客户端里有大量 #private 字段，必须覆盖这一形态。 */
const { withPrivacy, DESENSITIZE_BUILD } = await import("../apps/desktop/src/lib/privacy.ts");
class FakeClient {
  #secret = "private-ok";
  #calls = 0;
  async getUserInfo() { this.#calls++; return { name: "顾晓", studentId: "2025013388" }; }
  getReport() { return [{ name: "人工智能导论", credit: 2, grade: "A", point: 4, semester: "2024-2025秋", raw: [] }]; }
  async getWashers() { return [{ name: "紫荆 1 号楼", devices: [{ name: "1 号机", remainMinutes: 12 }] }]; }
  get secret() { return this.#secret; }
  get calls() { return this.#calls; }
}
const probe = withPrivacy(new FakeClient(), "probe");
let privateOk = true;
try { probe.secret; } catch { privateOk = false; }
ok("代理下读私有字段的 getter 不抛异常", privateOk);
eq("代理下 getter 返回原值", probe.secret, "private-ok");
const probeUser = await probe.getUserInfo();
eq("代理下私有字段计数生效（this 绑定正确）", probe.calls, 1);
if (DESENSITIZE_BUILD) {
  ne("demo 分支：代理包裹后异步结果被脱敏（姓名）", probeUser.name, "顾晓");
  ne("demo 分支：代理包裹后异步结果被脱敏（学号）", probeUser.studentId, "2025013388");
  const probeReport = probe.getReport()[0];
  ok("demo 分支：同步结果成绩与绩点同表", table.get(probeReport.grade) === probeReport.point);
} else {
  eq("正式分支：代理不改动结果（原样）", probeUser, { name: "顾晓", studentId: "2025013388" });
}
const probeWashers = await probe.getWashers();
eq("代理下非敏感数据（洗衣机）原样", probeWashers, [{ name: "紫荆 1 号楼", devices: [{ name: "1 号机", remainMinutes: 12 }] }]);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
