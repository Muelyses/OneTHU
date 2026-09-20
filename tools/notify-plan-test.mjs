/**
 * 通知计划内核测试（纯计算）：DDL / 课程 / 早报的触发时刻、去重、静默时段顺延与丢弃规则。
 *
 * 这些规则错一条就是「半夜被吵醒」或「DDL 没提醒」，真机试不出来，所以全部钉成断言。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/notify-plan-test.mjs
 */

/* hwRemind 在模块顶层读 localStorage → 先备内存桩（只读，测试不依赖其内容） */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

const {
  buildNotifyPlan, summarizePlan, channelOf, shiftOutOfQuiet, scheduleStart, fmtDeadline,
  NOTIFY_DEFAULTS, NOTIFY_CHANNEL_NAMES,
} = await import("../apps/desktop/src/state/notifyPlan.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

/** 本地时刻构造（测试全程用本地时区，与内核一致） */
const T = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const hm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const dateOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const NOW = T(2026, 9, 21, 9, 0);                       // 周一 09:00
const REMIND = { default: 120, items: {} };             // 全局默认提前 2 小时
const S = { enabled: true };                            // 其余走 NOTIFY_DEFAULTS

/** 计划里按类型取（早报会与课程/DDL 同时出现，断言必须按类型取，不能按下标猜） */
const of = (plan, kind) => plan.filter((x) => x.kind === kind);

const hw = (extra = {}) => ({ id: "h1", title: "第三章习题", deadline: "2026-09-22 23:59:59", submitted: false, ...extra });
const cls = (extra = {}) => ({ date: "2026-09-22", startTime: "10:00", courseName: "数据结构", location: "六教6A215", category: "课程", ...extra });

/* ── 总闸 ── */
eq("默认总开关为关", NOTIFY_DEFAULTS.enabled, false);
eq("未开启 → 空计划", buildNotifyPlan({ schedule: [cls()], homework: [hw()], remind: REMIND, settings: {}, now: NOW }).length, 0);

/* ── 课程 ── */
{
  const p = buildNotifyPlan({ schedule: [cls()], homework: [], remind: REMIND, settings: S, now: NOW });
  eq("课程只生成一条", of(p, "class").length, 1);
  eq("课程类型", of(p, "class")[0].kind, "class");
  const c = of(p, "class")[0];
  eq("课程触发时刻 = 开课前 15 分钟", hm(c.at), "09:45");
  eq("课程触发日", dateOf(c.at), "2026-09-22");
  eq("课程标题含时间与课名", c.title, "10:00 数据结构");
  ok("课程正文含地点与提前量", c.body.includes("六教6A215") && c.body.includes("15 分钟后上课"));
  eq("课程深链页面", c.page, "schedule");
  eq("稳定 id", c.id, "class:2026-09-22:10:00:15");
  ok("未被静默顺延", c.shifted === undefined);
}
eq("课程提前量为 0 → 不提醒", of(buildNotifyPlan({ schedule: [cls()], homework: [], remind: REMIND, settings: { ...S, classLead: 0 }, now: NOW }), "class").length, 0);
eq("已过去的课程丢弃", of(buildNotifyPlan({ schedule: [cls({ date: "2026-09-20" })], homework: [], remind: REMIND, settings: S, now: NOW }), "class").length, 0);
eq("缺 startTime 丢弃", of(buildNotifyPlan({ schedule: [cls({ startTime: null })], homework: [], remind: REMIND, settings: S, now: NOW }), "class").length, 0);
eq("全角冒号归一", scheduleStart({ date: "2026-09-22", startTime: "10：00" }), T(2026, 9, 22, 10, 0));
eq("非法日期 → null", scheduleStart({ date: "2026/09/22", startTime: "10:00" }), null);
{
  const p = buildNotifyPlan({ schedule: [cls({ category: "考试", courseName: "高等数学" })], homework: [], remind: REMIND, settings: S, now: NOW });
  const e = of(p, "exam")[0];
  eq("考试类型", e.kind, "exam");
  ok("考试正文", e.body.includes("15 分钟后开考"));
  eq("考试 id 前缀", e.id.startsWith("exam:"), true);
}

/* ── 作业 DDL ── */
{
  const p = buildNotifyPlan({ schedule: [], homework: [hw()], remind: REMIND, settings: S, now: NOW });
  const d = of(p, "ddl");
  eq("DDL 一条", d.length, 1);
  eq("DDL 类型", d[0].kind, "ddl");
  eq("DDL 触发 = 截止前 2 小时", dateOf(d[0].at) + " " + hm(d[0].at), "2026-09-22 21:59");
  ok("DDL 正文含截止人话", d[0].body.includes("明天 23:59 截止"));
  eq("DDL id 含提前量", d[0].id, "ddl:h1:120");
  eq("DDL 深链", d[0].page, "learn");
}
{
  const remind = { default: 120, items: { h1: 30 } };
  const dl = "2026-09-22 16:00:00";
  const base = of(buildNotifyPlan({ schedule: [], homework: [hw({ deadline: dl })], remind: { default: 120, items: {} }, settings: S, now: NOW }), "ddl")[0];
  eq("全局默认生效（提前 2 小时）", hm(base.at), "14:00");
  const d2 = of(buildNotifyPlan({ schedule: [], homework: [hw({ deadline: dl })], remind, settings: S, now: NOW }), "ddl")[0];
  eq("单作业覆盖生效（提前 30 分钟）", hm(d2.at), "15:30");
  eq("覆盖后 id 跟随提前量", d2.id, "ddl:h1:30");
}
eq("已提交不提醒", of(buildNotifyPlan({ schedule: [], homework: [hw({ submitted: true })], remind: REMIND, settings: S, now: NOW }), "ddl").length, 0);
eq("截止已过不提醒", of(buildNotifyPlan({ schedule: [], homework: [hw({ deadline: "2026-09-20 12:00:00" })], remind: REMIND, settings: S, now: NOW }), "ddl").length, 0);
eq("ddl 开关关掉即无 DDL", of(buildNotifyPlan({ schedule: [], homework: [hw()], remind: REMIND, settings: { ...S, ddl: false }, now: NOW }), "ddl").length, 0);
eq("同一条作业重复出现只排一次", of(buildNotifyPlan({ schedule: [], homework: [hw(), hw()], remind: REMIND, settings: S, now: NOW }), "ddl").length, 1);
eq("超出时间窗丢弃（7 天窗 / 20 天后截止）", of(buildNotifyPlan({ schedule: [], homework: [hw({ deadline: "2026-10-11 23:59:59" })], remind: REMIND, settings: S, now: NOW }), "ddl").length, 0);

/* ── 静默时段 ── */
eq("不在静默内原样返回", shiftOutOfQuiet(T(2026, 9, 21, 10, 0), "23:00", "07:00").at, T(2026, 9, 21, 10, 0));
eq("跨夜：凌晨 02:00 → 当日 07:00", hm(shiftOutOfQuiet(T(2026, 9, 22, 2, 0), "23:00", "07:00").at), "07:00");
eq("跨夜：23:30 → 次日 07:00", dateOf(shiftOutOfQuiet(T(2026, 9, 21, 23, 30), "23:00", "07:00").at), "2026-09-22");
eq("同日窗口 12:00–14:00：13:00 → 14:00", hm(shiftOutOfQuiet(T(2026, 9, 21, 13, 0), "12:00", "14:00").at), "14:00");
eq("起止相同 = 不静默", shiftOutOfQuiet(T(2026, 9, 21, 23, 30), "00:00", "00:00").at, T(2026, 9, 21, 23, 30));
{
  // 截止 22 日 08:00、提前 2 小时 → 06:00 落在静默里 → 顺延到 07:00（仍在截止前）→ 保留
  const p = buildNotifyPlan({ schedule: [], homework: [hw({ deadline: "2026-09-22 08:00:00" })], remind: REMIND, settings: S, now: NOW });
  eq("静默顺延到时段结束", hm(of(p, "ddl")[0].at), "07:00");
  eq("顺延标记", of(p, "ddl")[0].shifted, true);
}
{
  // 截止 21 日 23:30、提前 30 分钟 → 23:00 落在静默里，顺延到次日 07:00 已晚于截止
  // → DDL 取「静默开始前最后一分钟」，绝不因为静默把提醒吞掉
  const p = buildNotifyPlan({ schedule: [], homework: [hw({ deadline: "2026-09-21 23:30:00" })], remind: { default: 30, items: {} }, settings: S, now: NOW });
  const d = of(p, "ddl")[0];
  eq("静默冲突：DDL 改到静默前最后一分钟", hm(d.at), "22:59");
  eq("静默冲突标记", d.shifted, true);
  ok("仍然早于截止", d.at < T(2026, 9, 21, 23, 30));
}
{
  // 同样冲突但此刻已经 23:10（静默前那一分钟也过去了）→ 只能丢弃
  const p = buildNotifyPlan({
    schedule: [], homework: [hw({ deadline: "2026-09-21 23:30:00" })],
    remind: { default: 30, items: {} }, settings: S, now: T(2026, 9, 21, 23, 10),
  });
  eq("连静默前都来不及 → 丢弃", of(p, "ddl").length, 0);
}
{
  // 清晨 07:10 的课：提醒落在静默里，但顺延到 07:00 仍早于上课 → 保留（顺延即可）
  const p = buildNotifyPlan({ schedule: [cls({ date: "2026-09-22", startTime: "07:10" })], homework: [], remind: REMIND, settings: S, now: NOW });
  eq("清晨课顺延到静默结束", hm(of(p, "class")[0].at), "07:00");
}
{
  // 晚课 23:30 提前 15 分钟 → 静默里，顺延到次日 07:00 已晚于上课 → 课程不做 clamp，丢弃
  const p = buildNotifyPlan({ schedule: [cls({ date: "2026-09-22", startTime: "23:30" })], homework: [], remind: REMIND, settings: S, now: NOW });
  eq("课程顺延晚于事件 → 丢弃", of(p, "class").length, 0);
}

/* ── 每日早报 ── */
{
  const schedule = [
    cls({ date: "2026-09-22", startTime: "10:00" }),
    cls({ date: "2026-09-22", startTime: "14:00", courseName: "线性代数" }),
    cls({ date: "2026-09-23", startTime: "08:00", courseName: "大学物理" }),
  ];
  const p = buildNotifyPlan({ schedule, homework: [hw()], remind: REMIND, settings: S, now: NOW });
  const briefs = p.filter((x) => x.kind === "briefing");
  eq("早报条数（22/23 两日）", briefs.length, 2);
  ok("22 日早报正文", briefs[0].body.includes("2 节课") && briefs[0].body.includes("10:00 起") && briefs[0].body.includes("1 个截止"));
  eq("22 日早报时刻 07:30", hm(briefs[0].at), "07:30");
  ok("明日早报标题带「明天」", briefs[0].title.includes("明天"));
  ok("23 日早报只有课", briefs[1].body.includes("1 节课") && !briefs[1].body.includes("截止"));
  eq("早报渠道", channelOf(briefs[0].kind), "briefing");
}
eq("空日不发早报", buildNotifyPlan({ schedule: [], homework: [], remind: REMIND, settings: S, now: NOW }).length, 0);
eq("早报时刻已过的当天不发", buildNotifyPlan({ schedule: [cls({ date: "2026-09-21", startTime: "20:00" })], homework: [], remind: REMIND, settings: S, now: NOW }).filter((x) => x.kind === "briefing").length, 0);
eq("briefingAt=null → 无早报", buildNotifyPlan({ schedule: [cls()], homework: [], remind: REMIND, settings: { ...S, briefingAt: null }, now: NOW }).filter((x) => x.kind === "briefing").length, 0);

/* ── 排序 / 上限 / 渠道 / 幂等 ── */
{
  const many = Array.from({ length: 100 }, (_, i) => hw({ id: `h${i}`, deadline: `2026-09-2${(i % 3) + 2} 12:00:00` }));
  const p = buildNotifyPlan({ schedule: [], homework: many, remind: REMIND, settings: S, now: NOW });
  eq("条数被 maxItems 截断", p.length, NOTIFY_DEFAULTS.maxItems);
  // 截断口径 = 时间最早的 N 条：与「不设上限」的结果前缀一致
  const full = buildNotifyPlan({ schedule: [], homework: many, remind: REMIND, settings: { ...S, maxItems: 999 }, now: NOW });
  eq("截断取最早的一批", p.map((x) => x.id), full.slice(0, NOTIFY_DEFAULTS.maxItems).map((x) => x.id));
  ok("按时间升序", p.every((x, i) => i === 0 || p[i - 1].at <= x.at));
}
{
  const input = { schedule: [cls()], homework: [hw()], remind: REMIND, settings: S, now: NOW };
  const a = buildNotifyPlan(input);
  const b = buildNotifyPlan({ ...input, now: NOW + 3_600_000 });
  eq("重排幂等（同一输入结果一致）", buildNotifyPlan(input), a);
  eq("时间前移一小时后同一事件的 id 不变", a.map((x) => x.id).filter((id) => b.some((y) => y.id === id)).length, a.length);
}
eq("渠道分档：考试/课程 → course", [channelOf("class"), channelOf("exam")], ["course", "course"]);
eq("渠道分档：DDL → ddl", channelOf("ddl"), "ddl");
eq("渠道名齐备", Object.keys(NOTIFY_CHANNEL_NAMES).sort(), ["briefing", "course", "ddl"]);
{
  const p = buildNotifyPlan({ schedule: [cls()], homework: [hw()], remind: REMIND, settings: S, now: NOW });
  eq("摘要统计", summarizePlan(p), { course: 1, ddl: 1, briefing: 1 });
}
eq("截止人话：今天", fmtDeadline(T(2026, 9, 21, 23, 59), NOW), "今天 23:59");
eq("截止人话：明天", fmtDeadline(T(2026, 9, 22, 9, 0), NOW), "明天 09:00");
eq("截止人话：更远", fmtDeadline(T(2026, 9, 25, 9, 0), NOW), "9月25日 09:00");

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
