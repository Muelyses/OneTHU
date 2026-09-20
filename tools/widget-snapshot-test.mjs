/**
 * 桌面小组件快照测试（纯计算）：三行到底放什么、排序口径、空态与计数脚注。
 *
 * 小组件是「一眼看接下来干什么」，所以排序与截断口径就是产品语义，必须钉住。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/widget-snapshot-test.mjs
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

const { buildWidgetSnapshot, serializeWidgetSnapshot } = await import("../apps/desktop/src/state/widgetSnapshot.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const T = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const NOW = T(2026, 9, 21, 9, 0);
const REMIND = { default: 120, items: {} };

const cls = (extra = {}) => ({ date: "2026-09-21", startTime: "10:00", endTime: "11:35", courseName: "数据结构", location: "六教6A215", category: "课程", ...extra });
const hw = (extra = {}) => ({ id: "h1", title: "第三章习题", deadline: "2026-09-21 23:59:59", submitted: false, courseName: "数据结构", ...extra });

/* 空态 */
{
  const s = buildWidgetSnapshot({ schedule: [], homework: [], remind: REMIND, now: NOW });
  eq("空态无行", s.rows.length, 0);
  eq("空态脚注", s.footer, "今天没有课与截止");
  eq("标题带日期", s.title, "今天 9月21日");
  eq("点击落点默认今日页", s.target, "today");
  eq("快照带生成时间", s.updatedAt, NOW);
  ok("可序列化", typeof serializeWidgetSnapshot(s) === "string" && JSON.parse(serializeWidgetSnapshot(s)).rows.length === 0);
}

/* 排序：正在上的课 → 下一节 → 最近的 DDL；且只放三行 */
{
  const s = buildWidgetSnapshot({
    schedule: [
      cls({ startTime: "08:00", endTime: "09:35", courseName: "高等数学" }),      // 正在上
      cls({ startTime: "14:00", endTime: "15:35", courseName: "大学物理" }),
      cls({ startTime: "22:00", endTime: "22:45", courseName: "晚课" }),          // 晚于 DDL，被截断
    ],
    homework: [hw({ deadline: "2026-09-21 20:00:00" }), hw({ id: "h2", title: "实验报告", deadline: "2026-09-22 12:00:00" })],
    remind: REMIND,
    now: NOW,
  });
  eq("最多三行", s.rows.length, 3);
  eq("第一行是正在上的课", s.rows[0].text, "08:00 高等数学");
  eq("正在上的课标注状态", s.rows[0].sub, "正在上课");
  eq("第二行是接下来的课", s.rows[1].text, "14:00 大学物理");
  eq("第二行带地点", s.rows[1].sub, "六教6A215");
  eq("第三行是最近的 DDL", s.rows[2].text, "DDL 第三章习题");
  ok("DDL 副标题带今天与剩余", s.rows[2].sub.startsWith("今天 20:00 · 还有"));
  eq("脚注统计总数并提示截断", s.footer, "3 节课 · 2 个截止 · 还有 2 项");
}

/* 过滤：不相关的一律不进快照 */
{
  const s = buildWidgetSnapshot({
    schedule: [cls({ date: "2026-09-22" })],                                  // 不是今天
    homework: [
      hw({ id: "a", submitted: true }),                                       // 已提交
      hw({ id: "b", deadline: "2026-09-20 12:00:00" }),                       // 已过期
      hw({ id: "c", deadline: "2026-10-20 12:00:00" }),                       // 超出 7 天窗
    ],
    remind: REMIND,
    now: NOW,
  });
  eq("非今天/已提交/已过期/超窗都不进快照", s.rows.length, 0);
  eq("过滤后仍是空态", s.footer, "今天没有课与截止");
}

/* DDL 副标题：今天的显示「今天 HH:MM」，跨天显示「M/D HH:MM」 */
{
  const today = buildWidgetSnapshot({ schedule: [], homework: [hw()], remind: REMIND, now: NOW });
  ok("今日 DDL 显示今天与剩余", today.rows[0].sub.startsWith("今天 23:59 · 还有"));
  const later = buildWidgetSnapshot({ schedule: [], homework: [hw({ deadline: "2026-09-23 08:00:00" })], remind: REMIND, now: NOW });
  ok("非今日 DDL 显示月日", later.rows[0].sub.startsWith("9/23 08:00 · 还有"));
}

/* 长文本截断 + 插件条目补位 */
{
  const s = buildWidgetSnapshot({
    schedule: [cls({ courseName: "这是一个特别特别长的课程名称用来验证截断行为" })],
    homework: [],
    remind: REMIND,
    now: NOW,
    extraRows: [{ text: "插件条目", sub: "来自插件" }],
  });
  eq("课程名截断 14 字 + 省略号", s.rows[0].text, "10:00 这是一个特别特别长的课程名称…");
  eq("空位由插件条目补上", s.rows[1].text, "插件条目");
  eq("maxRows 生效", s.rows.length, 2);
}
{
  const s = buildWidgetSnapshot({
    schedule: [cls({ startTime: "10:00" }), cls({ startTime: "12:00" }), cls({ startTime: "14:00" })],
    homework: [], remind: REMIND, now: NOW, maxRows: 2,
    extraRows: [{ text: "不该出现" }],
  });
  eq("行满时插件条目不抢位", s.rows.length, 2);
  eq("行满时插件条目不出现", s.rows.some((r) => r.text === "不该出现"), false);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
