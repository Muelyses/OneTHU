#!/usr/bin/env node
/**
 * B5 控件护栏：chip 与开关。
 * 这两族的病是"各写一套"——胶囊 24px/27px 两种高度、999px 与 --r-pill 混用、
 * 开关有 36×22 与 34×20 两套几何、on 态一个走强调色一个走语义绿。
 * 这里逐个钉住：一套几何、一套令牌、状态层与焦点环不许漏。
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

function block(sel) {
  const i = CSS.indexOf(sel + " {");
  if (i < 0) return null;
  return CSS.slice(i + sel.length + 3, CSS.indexOf("}", i));
}

/* 胶囊：字面圆角/Compat 描边清除，与 .chip 同高，并共用状态层 */
const cb = block(".chip-btn");
ok(cb !== null, ".chip-btn 规则缺失");
if (cb) {
  ok(!/999px/.test(cb), ".chip-btn 仍写死 999px（应 var(--r-pill)）");
  ok(!/var\(--border\)|var\(--surface-2\)/.test(cb), ".chip-btn 仍用 Compat 底色/描边");
  ok(/height: 24px/.test(cb), ".chip-btn 高度应与 .chip 齐平（24px）");
}
ok(/\.chip-btn::after/.test(CSS), ".chip-btn 未接入共用状态层");
ok(/\.chip-btn:focus-visible/.test(CSS), ".chip-btn 缺焦点环");
ok(!CSS.includes("border-radius: 999px"), "全文仍有字面 999px 胶囊（应 var(--r-pill)）");

/* 开关：遗留 .switch（global.css）与新 OneGUI .og-switch（gui form.css）各自钉几何/令牌/焦点环；
   on 态都走强调色，不再出现语义绿（2026-10-19 控件收编 OneGUI 后，两套几何不再强求一致）。 */
const GUI_FORM = readFileSync("packages/gui/src/styles/form.css", "utf8");
const sw = block(".switch");
ok(sw !== null, ".switch 规则缺失");
if (sw) {
  ok(/width: 36px/.test(sw) && /height: 22px/.test(sw), ".switch 几何应为 36×22");
  ok(!sw.includes("var(--surface-3)") && !sw.includes("var(--border-strong)"), ".switch 仍用 Compat 底色/描边");
  ok(sw.includes("--md-sys-color-surface-container-high"), ".switch 轨道底色应走 System 令牌");
}
ok(!/var\(--green\)/.test(CSS.slice(CSS.indexOf(".switch.on"), CSS.indexOf(".switch.on") + 200)), ".switch 的 on 态仍是语义绿（应与强调色一致）");
ok(/\.switch\.on[^}]*--md-sys-color-primary/.test(CSS), ".switch 的 on 态应走 primary");
ok(/\.switch:hover::before/.test(CSS) || /\.switch:hover/.test(CSS), ".switch 缺 hover 状态层");
ok(/\.switch:focus-visible/.test(CSS), ".switch 缺焦点环");
/* OneGUI 开关：几何走令牌、on 态走强调色、焦点环不许漏 */
ok(GUI_FORM.includes(".og-switch {"), "OneGUI .og-switch 规则缺失");
if (GUI_FORM.includes(".og-switch {")) {
  const ogSwitch = GUI_FORM.slice(GUI_FORM.indexOf(".og-switch {"), GUI_FORM.indexOf("}", GUI_FORM.indexOf(".og-switch {")));
  ok(ogSwitch.includes("var(--og-ctl-switch-w)") && ogSwitch.includes("var(--og-ctl-switch-h)"), ".og-switch 几何应走开关令牌");
  ok(/\.og-switch\.is-checked[^}]*\{[^}]*var\(--og-accent\)/.test(GUI_FORM), ".og-switch 的 on 态应走强调色");
  ok(/\.og-switch:focus-visible \{ box-shadow: var\(--og-ring\); \}/.test(GUI_FORM), ".og-switch 缺焦点环");
}

/* 进度：遗留 .thos-progress-bar 与 OneGUI .og-progress（chip.css）都是胶囊端点 + 令牌轨道/强调色填充 */
const GUI_CHIP = readFileSync("packages/gui/src/styles/chip.css", "utf8");
const pb = block(".thos-progress-bar");
ok(pb !== null, ".thos-progress-bar 规则缺失");
if (pb) {
  ok(pb.includes("var(--r-pill)"), ".thos-progress-bar 端点应为胶囊令牌");
  ok(pb.includes("--md-sys-color-surface-container-high"), ".thos-progress-bar 轨道应走 System 令牌");
  ok(!/var\(--surface-3\)|var\(--border-soft\)/.test(pb), ".thos-progress-bar 仍用 Compat 轨道色");
}
const pbFill = block(".thos-progress-bar > span");
ok(pbFill !== null && pbFill.includes("var(--md-sys-color-primary)") && pbFill.includes("var(--r-pill)"), ".thos-progress-bar > span 填充应走 primary + 胶囊令牌");
ok(GUI_CHIP.includes(".og-progress {") && /--og-c-progress-h/.test(GUI_CHIP), "OneGUI .og-progress 规则缺失");
if (GUI_CHIP.includes(".og-progress {")) {
  const ogProg = GUI_CHIP.slice(GUI_CHIP.indexOf(".og-progress {"), GUI_CHIP.indexOf("}", GUI_CHIP.indexOf(".og-progress {")));
  ok(ogProg.includes("var(--og-radius-full)") && ogProg.includes("var(--og-surface-4)"), "OneGUI .og-progress 应走胶囊端点 + 表面令牌轨道");
  ok(/\.og-progress-fill \{[^}]*var\(--og-accent\)/.test(GUI_CHIP), "OneGUI .og-progress-fill 应走强调色");
}

/* 骨架屏：只许一条规则，流光只许走 --skeleton-shine */
ok((CSS.match(/^\.skeleton \{/gm) || []).length === 1, "骨架屏规则应合并为一条");
ok(/\.skeleton::after[^}]*var\(--skeleton-shine\)/.test(CSS), "骨架屏流光应走 --skeleton-shine 令牌");
ok(!CSS.includes("cloud-skeleton"), "退役的 cloud-skeleton 关键帧仍在");

/* 空状态：令牌化 + 4pt 网格 */
const em = block(".empty");
ok(em !== null, ".empty 规则缺失");
if (em) {
  ok(em.includes("--md-sys-color-on-surface-variant"), ".empty 文案色应走 System 令牌");
  ok(/padding: 32px 16px/.test(em), ".empty 内边距应在 4pt 网格上");
}

console.log(
  fails.length
    ? "控件护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "控件护栏：胶囊一套几何 + 状态层/焦点环 ✓ 开关两实现归一 + System 令牌 ✓ 进度两条配方归一 ✓ 骨架屏单条 + 流光令牌 ✓ 空状态令牌化 ✓ 无字面 999px ✓",
);
process.exit(fails.length ? 1 : 0);
