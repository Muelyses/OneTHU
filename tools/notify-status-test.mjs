/**
 * 通知状态文案测试（纯函数）：每种后端/授权组合都要把话说清、该给入口的给入口。
 *
 * Android 14 起精确闹钟默认被拒是常态：用户遇到「提醒晚了」时全靠这段文案解释原因并
 * 给出处理入口，所以逐组合钉住。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/notify-status-test.mjs
 */
const { notifyHint } = await import("../apps/desktop/src/state/notifyStatus.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

/* 未接入的平台：说清后果，不给无效入口 */
{
  const h = notifyHint({ backend: "none", granted: false, exact: false });
  eq("未接入 → error", h.level, "error");
  ok("未接入 → 讲清后果", h.text.includes("不会发出"));
  eq("未接入 → 不给按钮", h.action, undefined);
}

/* 未授权：必须给「去系统设置」入口 */
{
  for (const backend of ["android", "macos", "windows"]) {
    const h = notifyHint({ backend, granted: false, exact: true });
    eq(`${backend} 未授权 → error`, h.level, "error");
    eq(`${backend} 未授权 → 跳应用设置`, h.action?.kind, "app");
    ok(`${backend} 未授权 → 提到系统设置`, h.text.includes("系统设置"));
  }
}

/* Android 精确闹钟未授权：warn，而不是当成故障 */
{
  const h = notifyHint({ backend: "android", granted: true, exact: false });
  eq("精确闹钟被拒 → warn", h.level, "warn");
  eq("精确闹钟被拒 → 给授权入口", h.action?.kind, "exact-alarm");
  ok("精确闹钟被拒 → 说明只影响准时度", h.text.includes("延迟") && h.text.includes("不影响送达"));
}

/* 已就绪：按平台给渠道/通知设置入口 */
{
  const a = notifyHint({ backend: "android", granted: true, exact: true });
  eq("Android 就绪 → ok", a.level, "ok");
  eq("Android 就绪 → 渠道设置", a.action?.kind, "channels");
  eq("Android 就绪 → 渠道按钮文案", a.action?.label, "通知渠道设置");
  ok("Android 就绪 → 点名后端", a.text.includes("通知渠道"));

  const m = notifyHint({ backend: "macos", granted: true, exact: true });
  eq("macOS 就绪 → ok", m.level, "ok");
  eq("macOS 就绪 → 系统通知设置", m.action?.label, "系统通知设置");
  ok("macOS 就绪 → 文案含 macOS", m.text.includes("macOS"));

  // macOS 没有「精确闹钟」概念，exact=false 不该被误报成警告
  const m2 = notifyHint({ backend: "macos", granted: true, exact: false });
  eq("macOS 不看 exact 字段", m2.level, "ok");

  const w = notifyHint({ backend: "windows", granted: true, exact: true });
  eq("Windows 就绪 → ok", w.level, "ok");
  ok("Windows 就绪 → 文案含 Windows", w.text.includes("Windows"));
}

/* 未知后端（未来平台）：不崩、不谎报已就绪 */
{
  const h = notifyHint({ backend: "linux", granted: true, exact: true });
  eq("未知后端 → 仍然 ok（已授权即可用）", h.level, "ok");
  ok("未知后端 → 文案回退成后端名", h.text.includes("linux"));
}

/* 每种组合都给出非空文本 */
{
  const combos = [];
  for (const backend of ["android", "macos", "windows", "none"]) {
    for (const granted of [true, false]) {
      for (const exact of [true, false]) combos.push({ backend, granted, exact });
    }
  }
  ok("所有组合文案非空且不出现 undefined", combos.every((c) => {
    const h = notifyHint(c);
    return typeof h.text === "string" && h.text.length > 4 && !h.text.includes("undefined");
  }));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
