/**
 * 小组件运行时测试（依赖注入 + 短定时）：推送时机与失败处理。
 *
 * 小组件的特殊性：快照里含「还有 3 小时」这类算出来的文本，原生侧算不了，
 * 所以定时重推是**功能正确性的一部分**（不推就会停留在旧文案），不能当成多余请求优化掉。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/widget-runtime-test.mjs
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

const { createWidgetRuntime } = await import("../apps/desktop/src/state/widgetRuntime.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const T = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
/** 今天（真实日期）：运行时的 now 取系统时钟，固定日期会被「不是今天」过滤掉 */
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const tonight = () => {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return `${todayStr()} 23:59:00`;
};

function harness({ ok: okFlag = true, throwIt = false } = {}) {
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
    collect: () => ({
      schedule: [{ date: todayStr(), startTime: "10:00", courseName: "数据结构", location: "六教6A215", category: "课程" }],
      homework: [{ id: "h1", title: "第三章习题", deadline: tonight(), submitted: false }],
    }),
    subscribe: (fn) => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    fire: () => { for (const fn of [...listeners]) fn(); },
  };
}

/* ① 启动即推一次，载荷是契约结构 */
{
  const h = harness();
  const rt = createWidgetRuntime({ invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe, tickMs: 999999 });
  const okPush = await rt.syncNow();
  eq("推送成功", okPush, true);
  eq("命令名", h.calls[0][0], "widget_push");
  const snap = JSON.parse(h.calls[0][1].snapshot);
  eq("快照字段齐备", Object.keys(snap).sort(), ["footer", "rows", "target", "title", "updatedAt"]);
  ok("含课程行", snap.rows.some((r) => r.text.includes("数据结构")));
  eq("快照可回读", rt.snapshot()?.title, snap.title);
  rt.stop();
}

/* ② 数据变化 → 防抖后只重推一次（tick 拉长，避免混入） */
{
  const h = harness();
  const rt = createWidgetRuntime({ invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe, debounceMs: 20, tickMs: 100000 });
  await rt.syncNow();
  h.calls.length = 0;
  h.fire(); h.fire();
  await sleep(80);
  eq("多次变化只重推一次", h.calls.filter((c) => c[0] === "widget_push").length, 1);
  rt.stop();
}

/* ②b 定时到点会重推：快照里的「还有 X 小时」是算出来的文本，不重推就会停在旧值 */
{
  const h = harness();
  const rt = createWidgetRuntime({ invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe, debounceMs: 100000, tickMs: 30 });
  await rt.syncNow();
  h.calls.length = 0;
  await sleep(80);
  ok("定时到点会再推", h.calls.filter((c) => c[0] === "widget_push").length >= 1);
  rt.stop();
}

/* ③ 失败：不更新最近快照、错误上报、不抛 */
{
  const h = harness({ throwIt: true });
  const rt = createWidgetRuntime({
    invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe,
    tickMs: 999999, onError: (m) => h.errors.push(m),
  });
  const okPush = await rt.syncNow();
  eq("失败不报成功", okPush, false);
  eq("失败不留快照", rt.snapshot(), null);
  ok("错误已上报", h.errors.length >= 1);
  rt.stop();
}

/* ④ 原生明确回 ok:false（例如无小组件承载）→ 也算失败，不记快照 */
{
  const h = harness({ ok: false });
  const rt = createWidgetRuntime({ invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe, tickMs: 999999 });
  eq("原生拒绝不算成功", await rt.syncNow(), false);
  eq("拒绝对应无快照", rt.snapshot(), null);
  rt.stop();
}

/* ⑤ 非 Android：零调用 */
{
  const h = harness();
  const rt = createWidgetRuntime({ invoke: h.invoke, backendAvailable: false, collect: h.collect, subscribe: h.subscribe, tickMs: 999999 });
  eq("非 Android 不推", await rt.syncNow(), false);
  eq("非 Android 零调用", h.calls.length, 0);
  rt.stop();
}

/* ⑥ stop 后不再推 */
{
  const h = harness();
  const rt = createWidgetRuntime({ invoke: h.invoke, backendAvailable: true, collect: h.collect, subscribe: h.subscribe, debounceMs: 10, tickMs: 20 });
  await rt.syncNow();
  rt.stop();
  h.calls.length = 0;
  h.fire();
  await sleep(60);
  eq("stop 后零调用", h.calls.length, 0);
  eq("stop 后订阅解绑", h.listeners.length, 0);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
