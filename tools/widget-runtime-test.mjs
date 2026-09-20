/**
 * 小组件运行时测试（依赖注入 + 短定时）：按「每一块」算内容、推送时机与失败处理。
 *
 * 小组件的特殊性：内容是算出来的文本（「还有 3 小时」），原生算不了，所以定时重推是
 * **功能正确性的一部分**（不推就停在旧文案），不能当成多余请求优化掉。另一半是
 * 「内容按实例绑定」——桌面上四块各显示各的，这一条链错了用户看到的就是四块一样的东西。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/widget-runtime-test.mjs
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

const { createWidgetRuntime, gridCapacity } = await import("../apps/desktop/src/state/widgetRuntime.ts");
const { registerPluginWidget, __resetPluginWidgets } = await import("../apps/desktop/src/plugins/pluginWidgets.ts");
const { bindWidgetInstance, subscribeWidgetInstances } = await import("../apps/desktop/src/state/widgetInstances.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const tonight = () => `${todayStr()} 23:59:00`;

/** 桌面上放了哪几块（原生报回的形状） */
const BOARD = [
  { id: 11, provider: "OnethuWidgetShortcut", w: 60, h: 60, bound: false },
  { id: 12, provider: "OnethuWidgetNarrow", w: 110, h: 40, bound: false },
  { id: 13, provider: "OnethuWidgetProvider", w: 180, h: 110, bound: false },
];

function harness({ ok: okFlag = true, throwIt = false, instances = BOARD, listFails = false } = {}) {
  store.clear();
  const calls = [];
  const listeners = [];
  const errors = [];
  const invoke = async (cmd, args) => {
    calls.push([cmd, args]);
    if (throwIt) throw new Error("native down");
    return { ok: okFlag };
  };
  return {
    calls, listeners, errors, invoke,
    listInstances: async () => {
      if (listFails) return null;
      return instances;
    },
    collect: () => ({
      schedule: [{ date: todayStr(), startTime: "10:00", courseName: "数据结构", location: "六教6A215", category: "课程" }],
      homework: [{ id: "h1", title: "第三章习题", deadline: tonight(), submitted: false }],
    }),
    // 生产接线（subscribeNotifySources）里「绑定变化」也是重推触发源，这里照抄
    subscribe: (fn) => {
      listeners.push(fn);
      const off = subscribeWidgetInstances(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
        off();
      };
    },
    fire: () => { for (const fn of [...listeners]) fn(); },
    pushes: () => calls.filter((c) => c[0] === "widget_push").map((c) => JSON.parse(c[1].snapshot)),
  };
}

/** 绑定解析的替身：按绑定的 kind 给不同内容，用来验证「每块各显示各的」 */
const resolveStub = (binding) => {
  if (binding.kind === "shortcut") return { kind: "shortcut", label: "校园卡", sub: "余额 ¥23.4", target: "info", ref: binding.atom };
  if (binding.kind === "detail") return { kind: "detail", title: "数据结构", rows: [{ text: "数据结构", sub: "张三 · 课程" }], footer: "3 次待上", target: "learn-course" };
  if (binding.kind === "folder") {
    return {
      kind: "grid", title: "常用", target: "folder", params: { folderId: binding.folderId },
      items: [{ label: "网络学堂", ref: { kind: "page", key: "learn" }, target: "learn" }],
    };
  }
  return null;
};

/* ① 启动即推：载荷是「实例 + 槽位 + prune」契约结构 */
{
  const h = harness();
  const rt = createWidgetRuntime({
    invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe,
    listInstances: h.listInstances, tickMs: 999999,
  });
  eq("推送成功", await rt.syncNow(), true);
  eq("命令名", h.calls[0][0], "widget_push");
  const p = h.pushes()[0];
  eq("载荷键", Object.keys(p).sort(), ["instances", "prune", "slots"]);
  eq("载荷：每块都在", Object.keys(p.instances).sort(), ["11", "12", "13"]);
  eq("载荷：允许修剪", p.prune, true);
  ok("未绑定的块显示日程与 DDL", p.instances["13"].rows.some((r) => r.text.includes("数据结构")));
  eq("快照可回读", rt.snapshot()?.target, "today");
  rt.stop();
}

/* ② 每块各显示各的：同一时刻四块内容完全不同 */
{
  const h = harness();
  bindWidgetInstance(11, { kind: "shortcut", atom: { kind: "page", key: "card" } });
  bindWidgetInstance(12, { kind: "folder", folderId: "f1" });
  bindWidgetInstance(13, { kind: "detail", atom: { kind: "course", key: "1~数据结构~张三~2025" } });
  const rt = createWidgetRuntime({
    invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe,
    listInstances: h.listInstances, resolveBinding: resolveStub,
    iconPng: async () => "data:image/png;base64,AAAA", tickMs: 999999,
  });
  await rt.syncNow();
  const p = h.pushes()[0];
  eq("快捷方式块：形态", p.instances["11"].kind, "shortcut");
  eq("快捷方式块：名称", p.instances["11"].label, "校园卡");
  eq("快捷方式块：图标由运行时补上", p.instances["11"].icon, "data:image/png;base64,AAAA");
  eq("图标组块：形态", p.instances["12"].kind, "grid");
  eq("图标组块：格子带图标与落点", [p.instances["12"].items[0].icon, p.instances["12"].items[0].target], ["data:image/png;base64,AAAA", "learn"]);
  eq("详情块：形态", p.instances["13"].kind, "list");
  eq("详情块：标题是那个原子", p.instances["13"].title, "数据结构");
  eq("三块内容互不相同", new Set([p.instances["11"].kind, p.instances["12"].kind, p.instances["13"].kind]).size, 3);
  rt.stop();
}

/* ③ 绑定失效（夹被删 / 原子解析不出）→ 那一块回落日程与 DDL，不推空卡 */
{
  const h = harness();
  bindWidgetInstance(13, { kind: "folder", folderId: "gone" });
  const rt = createWidgetRuntime({
    invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe,
    listInstances: h.listInstances, resolveBinding: () => null, tickMs: 999999,
  });
  await rt.syncNow();
  const c = h.pushes()[0].instances["13"];
  ok("失效回落：显示今天的课", c.rows.some((r) => r.text.includes("数据结构")));
  eq("失效回落：落点是今日页", c.target, "today");
  rt.stop();
}

/* ④ 图标栅格化失败：内容照推（退回系统图标），不能因为一个图标整块空白 */
{
  const h = harness();
  bindWidgetInstance(11, { kind: "shortcut", atom: { kind: "page", key: "card" } });
  const rt = createWidgetRuntime({
    invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe,
    listInstances: h.listInstances, resolveBinding: resolveStub, iconPng: async () => null, tickMs: 999999,
  });
  await rt.syncNow();
  const c = h.pushes()[0].instances["11"];
  eq("图标失败仍推送", c.kind, "shortcut");
  eq("图标字段缺省（原生用系统图标）", c.icon, undefined);
  rt.stop();
}

/* ⑤ 读不到实例清单：不推实例内容，且**不允许修剪**（否则会误删所有内容） */
{
  const h = harness({ listFails: true });
  const rt = createWidgetRuntime({
    invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe,
    listInstances: h.listInstances, resolveBinding: resolveStub, tickMs: 999999,
  });
  await rt.syncNow();
  const p = h.pushes()[0];
  eq("清单读不到：不写实例键", Object.keys(p.instances), []);
  eq("清单读不到：禁止修剪", p.prune, false);
  rt.stop();
}

/* ⑥ 插件槽位照旧随载荷下发 */
{
  const h = harness();
  registerPluginWidget({ id: "w1", title: "打卡 3 天", rows: [{ text: "本周 5/7" }] }, "onethu.demo", 1);
  const rt = createWidgetRuntime({
    invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe,
    listInstances: h.listInstances, tickMs: 999999,
  });
  await rt.syncNow();
  eq("槽位内容随载荷下发", h.pushes()[0].slots["1"].title, "打卡 3 天");
  rt.stop();
  __resetPluginWidgets();
}

/* ⑦ 绑定变化 → 防抖后只重推一次 */
{
  const h = harness();
  const rt = createWidgetRuntime({
    invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe,
    listInstances: h.listInstances, resolveBinding: resolveStub, debounceMs: 20, tickMs: 100000,
  });
  await rt.syncNow();
  h.calls.length = 0;
  bindWidgetInstance(13, { kind: "detail", atom: { kind: "page", key: "learn" } });
  await sleep(80);
  eq("绑定变化触发重推", h.pushes().length, 1);
  eq("重推的是新绑定", h.pushes()[0].instances["13"].title, "数据结构");
  rt.stop();
}

/* ⑧ 定时到点会重推：内容里的「还有 X 小时」是算出来的文本，不重推就停在旧值 */
{
  const h = harness();
  const rt = createWidgetRuntime({
    invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe,
    listInstances: h.listInstances, debounceMs: 100000, tickMs: 30,
  });
  await rt.syncNow();
  h.calls.length = 0;
  await sleep(80);
  ok("定时到点会再推", h.pushes().length >= 1);
  rt.stop();
}

/* ⑨ 失败与拒绝：不记快照、错误上报、不抛 */
{
  const h = harness({ throwIt: true });
  const rt = createWidgetRuntime({
    invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe,
    listInstances: h.listInstances, tickMs: 999999, onError: (m) => h.errors.push(m),
  });
  eq("抛异常不算成功", await rt.syncNow(), false);
  eq("抛异常不留快照", rt.snapshot(), null);
  ok("错误已上报", h.errors.length >= 1);
  rt.stop();

  const h2 = harness({ ok: false });
  const rt2 = createWidgetRuntime({
    invoke: h2.invoke, backendAvailable: true, collect: h2.collect, subscribe: h2.subscribe,
    listInstances: h2.listInstances, tickMs: 999999,
  });
  eq("原生拒绝不算成功", await rt2.syncNow(), false);
  eq("拒绝对应无快照", rt2.snapshot(), null);
  rt2.stop();
}

/* ⑩ 非 Android：零调用 */
{
  const h = harness();
  const rt = createWidgetRuntime({ invoke: h.invoke, backendAvailable: false, collect: h.collect, subscribe: h.subscribe, tickMs: 999999 });
  eq("非 Android 不推", await rt.syncNow(), false);
  eq("非 Android 零调用", h.calls.length, 0);
  rt.stop();
}

/* ⑪ stop 后不再推 */
{
  const h = harness();
  const rt = createWidgetRuntime({
    invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe,
    listInstances: h.listInstances, debounceMs: 10, tickMs: 20,
  });
  await rt.syncNow();
  rt.stop();
  h.calls.length = 0;
  h.fire();
  await sleep(60);
  eq("stop 后零调用", h.calls.length, 0);
  eq("stop 后订阅解绑", h.listeners.length, 0);
}

/* ⑫ 图标组容量：与原生 gridCapacity 同口径（每格约 56dp，2 行 × 4 列封顶） */
{
  eq("容量：1×1", gridCapacity(60, 60), 2);
  eq("容量：2×1 窄条", gridCapacity(110, 40), 2);
  eq("容量：2×2 方块", gridCapacity(110, 110), 4);
  eq("容量：3×2 标准", gridCapacity(180, 110), 6);
  eq("容量：4×2 宽幅", gridCapacity(250, 110), 8);
  eq("容量：拿不到尺寸时给保守值", gridCapacity(0, 0), 4);
}

/* ⑬ 桌面上没有小组件：推空实例表，也不报错 */
{
  const h = harness({ instances: [] });
  const rt = createWidgetRuntime({
    invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe,
    listInstances: h.listInstances, tickMs: 999999,
  });
  eq("空桌面：推送仍成功", await rt.syncNow(), true);
  eq("空桌面：实例表为空", Object.keys(h.pushes()[0].instances), []);
  rt.stop();
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
