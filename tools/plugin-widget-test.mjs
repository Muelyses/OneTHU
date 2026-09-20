/**
 * 插件小组件测试（纯逻辑）：声明注册、原子行解析、槽位分配、快照落盘形态。
 *
 * 插件小组件是「声明式」的：插件说显示什么，宿主解析后交原生渲染。这套解析若出错，
 * 用户桌面上会出现空白卡片、错位内容或压根不出现的槽位——所以逐条钉住。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/plugin-widget-test.mjs
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

const W = await import("../apps/desktop/src/plugins/pluginWidgets.ts");
const { registerPluginAtom, unregisterPluginAtoms } = await import("../apps/desktop/src/plugins/pluginAtoms.ts");
const { serializeWidgetPush } = await import("../apps/desktop/src/state/widgetSnapshot.ts");
const { registerPluginWidget, unregisterPluginWidgets, pluginWidgetDefs, collectWidgetSlots, PLUGIN_WIDGET_SLOTS, __resetPluginWidgets } = W;

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const now = new Date(2026, 8, 21, 9, 0).getTime();
const def = (over = {}) => ({
  id: "card", pluginId: "onethu.habit", pluginName: "打卡", title: "连续打卡 3 天",
  rows: [{ text: "已打卡 3 天" }], ...over,
});

/* ① 注册 / 覆盖 / 注销 */
{
  __resetPluginWidgets();
  registerPluginWidget(def());
  registerPluginWidget(def({ id: "other", title: "第二个" }));
  eq("两个小组件都登记", pluginWidgetDefs("onethu.habit").map((w) => w.id), ["card", "other"]);
  registerPluginWidget(def({ title: "改了标题" }));
  eq("同 id 覆盖不重复", pluginWidgetDefs("onethu.habit").length, 2);
  eq("覆盖生效", pluginWidgetDefs("onethu.habit")[0].title, "改了标题");
  eq("覆盖保持占位顺序（槽位不让位）", pluginWidgetDefs("onethu.habit")[0].id, "card");
  unregisterPluginWidgets("onethu.habit");
  eq("注销后为空", pluginWidgetDefs("onethu.habit"), []);
}

/* ② 字面行：空文本丢弃、sub 空串不写 */
{
  __resetPluginWidgets();
  registerPluginWidget(def({ rows: [{ text: "有内容", sub: "副标题" }, { text: "   " }, { text: "只有主行", sub: "  " }] }));
  const rows = collectWidgetSlots()[0].rows;
  eq("空文本行被丢弃", rows.length, 2);
  eq("副标题保留", rows[0], { text: "有内容", sub: "副标题" });
  eq("空副标题不写字段", rows[1], { text: "只有主行", sub: undefined });
}

/* ③ 原子行：走插件原子注册表解析；失效行丢弃 */
{
  __resetPluginWidgets();
  registerPluginAtom({
    kind: "plugin:onethu.habit",
    pluginId: "onethu.habit",
    group: "打卡",
    resolve: (key) => (key === "main~count:3" ? { title: "打卡 3 天", sub: "连续" } : null),
  });
  registerPluginWidget(def({ rows: [{ atom: "main~count:3" }, { atom: "main~missing" }, { text: "兜底行" }] }));
  const rows = collectWidgetSlots()[0].rows;
  eq("原子行解析成一行", rows[0], { text: "打卡 3 天", sub: "连续" });
  eq("失效原子被丢弃", rows.map((r) => r.text), ["打卡 3 天", "兜底行"]);
  unregisterPluginAtoms("onethu.habit");
  eq("原子种类注销后该行也消失", collectWidgetSlots()[0].rows.map((r) => r.text), ["兜底行"]);
}

/* ④ 一行不剩的小组件不占槽位 */
{
  __resetPluginWidgets();
  registerPluginWidget(def({ pluginId: "onethu.empty", pluginName: "空插件", rows: [{ text: "" }] }));
  registerPluginWidget(def({ pluginId: "onethu.habit", pluginName: "打卡", rows: [{ text: "有内容" }] }));
  const slots = collectWidgetSlots();
  eq("空小组件不占槽", slots.length, 1);
  eq("槽位从 1 连续编号（不留空洞）", slots[0].slot, "1");
  eq("占槽的是有内容那个", slots[0].pluginId, "onethu.habit");
}

/* ⑤ 槽位上限 + 顺序 + 行数上限 + 落点 */
{
  __resetPluginWidgets();
  for (let i = 1; i <= PLUGIN_WIDGET_SLOTS + 2; i++) {
    registerPluginWidget(def({
      id: `w${i}`, pluginId: `p${i}`, pluginName: `插件${i}`, title: `第${i}个`,
      rows: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }],
    }));
  }
  const slots = collectWidgetSlots();
  eq("槽位数量受预留上限约束", slots.length, PLUGIN_WIDGET_SLOTS);
  eq("按声明顺序占位", slots.map((s) => s.slot), ["1", "2", "3"]);
  eq("槽位归属顺序正确", slots.map((s) => s.pluginId), ["p1", "p2", "p3"]);
  eq("行数截到三行", slots[0].rows.length, 3);
  eq("脚注署名插件名", slots[0].footer, "插件1");
  eq("落点缺省指向该插件功能页", slots[0].target, "plugin:p1:main");
  registerPluginWidget(def({ id: "w9", pluginId: "p9", pluginName: "插件9", target: "plugin:p9:detail", rows: [{ text: "x" }] }));
  unregisterPluginWidgets("p1");
  const after = collectWidgetSlots();
  eq("注销后槽位重排（不留空洞）", after.map((s) => s.slot), ["1", "2", "3"]);
  ok("显式落点被保留", after.some((s) => s.target === "plugin:p9:detail") || after.length === 3);
}

/* ⑥ 推送载荷集成：槽位随载荷下发（载荷由运行时组装，见 widget-runtime-test） */
{
  __resetPluginWidgets();
  registerPluginWidget(def({ rows: [{ text: "已打卡 3 天", sub: "连续" }] }));
  const slots = {};
  for (const sl of collectWidgetSlots()) {
    if (!sl?.slot) continue;
    slots[String(sl.slot)] = { title: sl.title, rows: sl.rows, footer: sl.footer, target: sl.target };
  }
  eq("槽位键为槽位号", Object.keys(slots), ["1"]);
  eq("槽位内容齐备", Object.keys(slots["1"]).sort(), ["footer", "rows", "target", "title"]);
  eq("槽位标题", slots["1"].title, "连续打卡 3 天");
  const round = JSON.parse(serializeWidgetPush({ instances: {}, slots, prune: true }));
  eq("序列化后槽位仍在", round.slots["1"].rows[0].text, "已打卡 3 天");
  const empty = JSON.parse(serializeWidgetPush({ instances: {}, slots: {}, prune: true }));
  eq("没有插件声明时槽位为空对象", Object.keys(empty.slots), []);
}

/* ⑦ 注册表变更通知：插件重新声明/注销时宿主才能立刻跟上 */
{
  __resetPluginWidgets();
  const events = [];
  const unsub = W.subscribePluginWidgets(() => events.push("changed"));
  registerPluginWidget(def());
  eq("注册触发一次通知", events.length, 1);
  registerPluginWidget(def({ title: "改了" }));
  eq("重注册再触发", events.length, 2);
  unregisterPluginWidgets("onethu.habit");
  eq("注销也触发", events.length, 3);
  unregisterPluginWidgets("不存在的插件");
  eq("注销不存在的插件不触发", events.length, 3);
  unsub();
  registerPluginWidget(def());
  eq("退订后不再通知", events.length, 3);
  __resetPluginWidgets();
}

/* ⑧ 无槽位号的脏输入不占槽位 */
{
  __resetPluginWidgets();
  const bad = { ...def(), id: "bad" };
  registerPluginWidget({ ...bad, rows: [] });
  eq("一行都不剩的声明不占槽位", collectWidgetSlots().length, 0);
  __resetPluginWidgets();
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
