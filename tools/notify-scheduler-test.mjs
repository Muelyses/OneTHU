/**
 * 通知调度器测试（依赖注入，无 Tauri / React）：计划与原生状态的对齐口径。
 *
 * 要害在「既不漏排、也不无谓重排」：漏排 = 提醒丢失；无谓重排 = 每次数据刷新都 invoke
 * 一遍系统闹钟，安卓上会触发限流并耗电。跨重启还要靠持久化指纹认出「内容变过」。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/notify-scheduler-test.mjs
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

const { createNotifyScheduler } = await import("../apps/desktop/src/state/notifyScheduler.ts");
const { loadNotifySettings, saveNotifySettings, loadScheduledFingerprints } = await import("../apps/desktop/src/state/notifySettings.ts");
const { NOTIFY_DEFAULTS } = await import("../apps/desktop/src/state/notifyPlan.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const T = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const NOW = T(2026, 9, 21, 9, 0);
const item = (id, extra = {}) => ({ id, kind: "ddl", at: NOW + 3_600_000, title: "DDL · 高数", body: "第三章习题 · 今天 23:59 截止", page: "learn", ...extra });

/** 假原生后端：记录调用、维护 pending 集合。
 *  每个用例换一个后端，同时清掉持久化指纹——否则上一个用例的指纹会漏进下一个用例，
 *  断言就变成了「跨用例巧合」（本轮真踩到：③ 里冒出了不该有的 cancel）。 */
function fakeBackend({ failOn = null } = {}) {
  store.clear();
  const calls = [];
  const pending = new Set();
  const invoke = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === failOn) throw new Error("boom");
    if (cmd === "notify_pending") return { ok: true, ids: [...pending] };
    if (cmd === "notify_schedule") {
      for (const it of JSON.parse(args.items)) pending.add(it.id);
      return { ok: true, scheduled: JSON.parse(args.items).length, exact: true };
    }
    if (cmd === "notify_cancel") {
      for (const id of JSON.parse(args.ids)) pending.delete(id);
      return { ok: true, cancelled: JSON.parse(args.ids).length };
    }
    if (cmd === "notify_permission") return { ok: true, granted: true, exact: false };
    if (cmd === "notify_test") return { ok: true };
    return { ok: false };
  };
  return { calls, pending, invoke, cmds: () => calls.map((c) => c[0]) };
}

/* ① 首次同步：全部排进去；再同步一次不发 invoke */
{
  const be = fakeBackend();
  const sc = createNotifyScheduler({ invoke: be.invoke, backendAvailable: true });
  const plan = [item("ddl:a"), item("ddl:b")];
  const r1 = await sc.sync(plan);
  eq("首轮排两条", [r1.ok, r1.scheduled, r1.cancelled], [true, 2, 0]);
  eq("调用序列", be.cmds(), ["notify_pending", "notify_schedule"]);
  const r2 = await sc.sync(plan);
  eq("内容未变不重排", [r2.scheduled, r2.cancelled], [0, 0]);
  eq("未变时只有一次探活调用", be.cmds().filter((c) => c === "notify_schedule").length, 1);
}

/* ② 新增与移除：只动差额 */
{
  const be = fakeBackend();
  const sc = createNotifyScheduler({ invoke: be.invoke, backendAvailable: true });
  await sc.sync([item("ddl:a"), item("ddl:b")]);
  const r = await sc.sync([item("ddl:b"), item("ddl:c")]);
  eq("差额：排 1 撤 1", [r.scheduled, r.cancelled], [1, 1]);
  eq("原生侧最终只剩 b、c", [...be.pending].sort(), ["ddl:b", "ddl:c"]);
}

/* ③ 内容变化（同一 id）→ 重排，不撤销 */
{
  const be = fakeBackend();
  const sc = createNotifyScheduler({ invoke: be.invoke, backendAvailable: true });
  await sc.sync([item("ddl:a", { title: "旧标题" })]);
  const r = await sc.sync([item("ddl:a", { title: "新标题" })]);
  eq("标题变化触发重排", [r.scheduled, r.cancelled], [1, 0]);
  eq("id 未变不出现在撤销名单", be.calls.filter((c) => c[0] === "notify_cancel").length, 0);
}

/* ④ 原生侧丢了排程（用户清了 App 数据/系统回收）→ 下一轮补排 */
{
  const be = fakeBackend();
  const sc = createNotifyScheduler({ invoke: be.invoke, backendAvailable: true });
  await sc.sync([item("ddl:a")]);
  be.pending.clear();                                  // 原生侧丢失
  const r = await sc.sync([item("ddl:a")]);
  eq("原生丢了就补排", [r.scheduled, r.cancelled], [1, 0]);
}

/* ⑤ 计划清空 → 全部撤销 */
{
  const be = fakeBackend();
  const sc = createNotifyScheduler({ invoke: be.invoke, backendAvailable: true });
  await sc.sync([item("ddl:a"), item("ddl:b")]);
  const r = await sc.sync([]);
  eq("清空计划撤销全部", [r.scheduled, r.cancelled], [0, 2]);
  eq("原生侧已空", [...be.pending], []);
}

/* ⑥ 非 Android：一次 invoke 都不发 */
{
  const be = fakeBackend();
  const sc = createNotifyScheduler({ invoke: be.invoke, backendAvailable: false });
  const r = await sc.sync([item("ddl:a")]);
  eq("非 Android 跳过", [r.ok, r.skipped], [false, "not-android"]);
  eq("非 Android 零调用", be.calls.length, 0);
}

/* ⑦ 失败不更新指纹：下一次必须重试 */
{
  const be = fakeBackend({ failOn: "notify_schedule" });
  const sc = createNotifyScheduler({ invoke: be.invoke, backendAvailable: true });
  const r1 = await sc.sync([item("ddl:a")]);
  eq("失败如实回报", [r1.ok, r1.scheduled], [false, 0]);
  ok("失败原因带出", typeof r1.error === "string" && r1.error.length > 0);
  eq("失败不入指纹", Object.keys(sc.fingerprints()).length, 0);
  be.calls.length = 0;
  const be2 = fakeBackend();
  const sc2 = createNotifyScheduler({ invoke: be2.invoke, backendAvailable: true });
  eq("重试路径可用（新调度器首轮即排）", (await sc2.sync([item("ddl:a")])).scheduled, 1);
}

/* ⑧ 冷启动：指纹跨重启持久化，内容未变则不动 */
{
  const be = fakeBackend();
  const sc = createNotifyScheduler({ invoke: be.invoke, backendAvailable: true });
  await sc.sync([item("ddl:a")]);
  ok("指纹已落盘", Object.keys(loadScheduledFingerprints()).length === 1);
  const sc2 = createNotifyScheduler({ invoke: be.invoke, backendAvailable: true });   // 模拟重启
  const r = await sc2.sync([item("ddl:a")]);
  eq("重启后内容未变仍不重排", [r.scheduled, r.cancelled], [0, 0]);
}

/* ⑨ cancelAll（用户关总开关） */
{
  const be = fakeBackend();
  const sc = createNotifyScheduler({ invoke: be.invoke, backendAvailable: true });
  await sc.sync([item("ddl:a"), item("ddl:b")]);
  const r = await sc.cancelAll();
  eq("cancelAll 撤掉全部", [r.ok, r.cancelled], [true, 2]);
  eq("指纹一并清空", Object.keys(sc.fingerprints()).length, 0);
}

/* ⑩ 权限与测试通知 */
{
  const be = fakeBackend();
  const sc = createNotifyScheduler({ invoke: be.invoke, backendAvailable: true });
  eq("权限状态透传", await sc.permission(), { ok: true, granted: true, exact: false });
  eq("测试通知成功", await sc.test(), true);
  const none = createNotifyScheduler({ invoke: be.invoke, backendAvailable: false });
  eq("非 Android 权限查询降级", await none.permission(), { ok: false, granted: false, exact: false });
  eq("非 Android 测试通知不调用", await none.test(), false);
}

/* ⑪ 设置读写：坏存储回落默认，范围钳制 */
{
  store.clear();
  eq("默认总开关关", loadNotifySettings().enabled, false);
  saveNotifySettings({ enabled: true, classLead: 30 });
  eq("设置已保存", [loadNotifySettings().enabled, loadNotifySettings().classLead], [true, 30]);
  saveNotifySettings({ horizonDays: 999, maxItems: 0 });
  eq("超范围钳制", [loadNotifySettings().horizonDays, loadNotifySettings().maxItems], [30, 1]);
  saveNotifySettings({ briefingAt: null });
  eq("早报可关闭", loadNotifySettings().briefingAt, null);
  store.set("onethu.notify.v1", "{坏 JSON");
  eq("坏存储回落默认", loadNotifySettings(), NOTIFY_DEFAULTS);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
