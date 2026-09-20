/**
 * 通知与小组件自检测试（编排层，副作用全部注入）。
 *
 * 自检的价值全在「结论指向正确的层」：把「未授权」误报成「投递失败」，用户就会去查系统
 * 通知设置之外的地方。故逐条钉住每种故障下它说什么、以及不该做什么。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/notify-doctor-test.mjs
 */
const { runNotifyDoctor, DOCTOR_PROBE_ID } = await import("../apps/desktop/src/state/notifyDoctor.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const NOW = new Date(2026, 8, 21, 9, 0).getTime();

/** 假后端：按需注入各种故障 */
function harness(over = {}) {
  const calls = [];
  const pending = new Set();
  const cfg = {
    backend: "android",
    granted: true,
    exact: true,
    scheduleOk: true,
    scheduleReason: "",
    pendingContainsProbe: true,
    testOk: true,
    widget: {
      ok: true, hostPlaced: 1, slotsPlaced: { "1": 1 }, hasSnapshot: true, snapshotAt: NOW - 60_000,
      slotTitles: { "1": "Hello 计数 3" }, providersRegistered: ["宿主", "槽位1", "槽位2", "槽位3"],
    },
    hasWidgetStatus: true,
    ...over,
  };
  return {
    calls, pending, cfg,
    deps: {
      status: async (request) => { calls.push(["status", request]); return { ok: true, backend: cfg.backend, granted: cfg.granted, exact: cfg.exact }; },
      scheduleProbe: async (probe) => {
        calls.push(["schedule", probe]);
        if (!cfg.scheduleOk) return { ok: false, reason: cfg.scheduleReason || "in-past" };
        pending.add(probe.id);
        return { ok: true };
      },
      pending: async () => { calls.push(["pending"]); return cfg.pendingContainsProbe ? [...pending] : []; },
      cancel: async (ids) => { calls.push(["cancel", ids]); for (const i of ids) pending.delete(i); },
      testSend: async () => { calls.push(["testSend"]); return cfg.testOk; },
      ...(cfg.hasWidgetStatus ? { widgetStatus: async () => { calls.push(["widget"]); return cfg.widget; } } : {}),
      now: () => NOW,
    },
  };
}
const stepIds = (r) => r.steps.map((s) => s.id);
const step = (r, id) => r.steps.find((s) => s.id === id);

/* ① 全绿路径 */
{
  const h = harness();
  const r = await runNotifyDoctor(h.deps);
  eq("全绿 → ok", r.ok, true);
  eq("步骤齐备", stepIds(r), ["backend", "permission", "exact", "widget", "schedule", "cleanup", "deliver"]);
  ok("结论含通过数", r.summary.includes("自检通过"));
  eq("退订探针", h.pending.has(DOCTOR_PROBE_ID), false);
  ok("探针时刻在未来", h.calls.find((c) => c[0] === "schedule")[1].at > NOW);
  eq("权限查询不请求授权（自检不该弹框）", h.calls.find((c) => c[0] === "status")[1], false);
}

/* ② 无后端：立即停止，不白跑后续步骤 */
{
  const h = harness({ backend: "none" });
  const r = await runNotifyDoctor(h.deps);
  eq("无后端 → 失败", r.ok, false);
  eq("无后端 → 只有一步", stepIds(r), ["backend"]);
  eq("无后端 → 不尝试排程", h.calls.some((c) => c[0] === "schedule"), false);
  eq("无后端 → 不弹测试通知", h.calls.some((c) => c[0] === "testSend"), false);
}

/* ③ 未授权：指向授权，而不是报「投递失败」 */
{
  const h = harness({ granted: false });
  const r = await runNotifyDoctor(h.deps);
  eq("未授权 → 失败", r.ok, false);
  eq("未授权 → 停在授权步", stepIds(r), ["backend", "permission"]);
  ok("未授权 → 明说去系统设置", step(r, "permission").detail.includes("系统设置"));
  eq("未授权 → 不排程", h.calls.some((c) => c[0] === "schedule"), false);
}

/* ④ Android 精确提醒被拒：warn，整体仍算通过 */
{
  const h = harness({ exact: false });
  const r = await runNotifyDoctor(h.deps);
  eq("精确提醒被拒 → 仍通过", r.ok, true);
  eq("精确提醒被拒 → warn", step(r, "exact").status, "warn");
  ok("精确提醒被拒 → 说明不影响送达", step(r, "exact").detail.includes("不会丢"));
  ok("结论里点出提示项", r.summary.includes("提示"));
}

/* ⑤ macOS：没有精确闹钟概念，也没有小组件 → 跳过两步且不崩 */
{
  const h = harness({ backend: "macos", hasWidgetStatus: false });
  const r = await runNotifyDoctor(h.deps);
  eq("macOS → 无 exact 步", stepIds(r).includes("exact"), false);
  eq("macOS → 无小组件步", stepIds(r).includes("widget"), false);
  eq("macOS → 通过", r.ok, true);
}

/* ⑥ 排程被拒：如实给出原生原因，并仍然清理 */
{
  const h = harness({ scheduleOk: false, scheduleReason: "in-past" });
  const r = await runNotifyDoctor(h.deps);
  eq("排程被拒 → 失败", r.ok, false);
  eq("排程步 fail", step(r, "schedule").status, "fail");
  ok("带上原生原因", step(r, "schedule").detail.includes("in-past"));
  ok("仍然执行了清理", h.calls.some((c) => c[0] === "cancel"));
}

/* ⑦ 写入成功但回读不到：warn（可能被系统限流），不当成失败 */
{
  const h = harness({ pendingContainsProbe: false });
  const r = await runNotifyDoctor(h.deps);
  eq("回读不到 → warn 而非 fail", step(r, "schedule").status, "warn");
  eq("整体仍通过", r.ok, true);
}

/* ⑧ 小组件未放/无快照：warn 且把数字讲清楚 */
{
  const h = harness({ widget: { ok: true, hostPlaced: 0, slotsPlaced: {}, hasSnapshot: false, snapshotAt: 0, slotTitles: {}, providersRegistered: ["宿主"] } });
  const r = await runNotifyDoctor(h.deps);
  const w = step(r, "widget");
  eq("无快照 → warn", w.status, "warn");
  ok("指出还没快照", w.detail.includes("还没有快照"));
  ok("指出桌面没放", w.detail.includes("尚未放置"));
}

/* ⑨ 已经放了小组件且插件占了槽位：数字与标题都要出现 */
{
  const h = harness();
  const r = await runNotifyDoctor(h.deps);
  const w = step(r, "widget");
  eq("有快照 → ok", w.status, "ok");
  ok("报出放置数量", w.detail.includes("桌面已放 2 个"));
  ok("报出宿主数量", w.detail.includes("宿主 1"));
  ok("报出槽位标题", w.detail.includes("Hello 计数 3"));
  ok("报出 provider 登记情况", w.detail.includes("系统已登记 4 个 provider"));
}

/* ⑨b provider 未登记（清单合并没生效）：直接判失败并交回开发者 */
{
  const h = harness({ widget: { ok: true, hostPlaced: 0, slotsPlaced: {}, hasSnapshot: true, snapshotAt: NOW, slotTitles: {}, providersRegistered: [] } });
  const r = await runNotifyDoctor(h.deps);
  const w = step(r, "widget");
  eq("provider 未登记 → fail", w.status, "fail");
  eq("provider 未登记 → 整体失败", r.ok, false);
  ok("指明清单合并可能未生效", w.detail.includes("清单合并"));
}

/* ⑩ 投递被拒：最后一步失败，结论指向它 */
{
  const h = harness({ testOk: false });
  const r = await runNotifyDoctor(h.deps);
  eq("投递失败 → 整体失败", r.ok, false);
  eq("投递步 fail", step(r, "deliver").status, "fail");
  ok("结论提示看第一处不通过", r.summary.includes("不通过"));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
