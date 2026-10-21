#!/usr/bin/env node
/**
 * 空状态护栏（手册 §3.7）。
 * 空状态是"页面看起来是不是坏了"的第一道观感，配方固定：图标（可选）+ 口语说明 + 行动按钮。
 * 插画环节 2026-02 已决定跳过，所以这里的重点是：文案口语化、能给出下一步的都给按钮。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/* 空态底座已收编 OneGUI EmptyState（.og-empty* 在 packages/gui/src/styles/row.css，
   组件在 packages/gui/src/components/list.tsx）；宿主 Layout 只做转发。 */
const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const GUI_CSS = readFileSync("packages/gui/src/styles/row.css", "utf8");
const GUI_LIST = readFileSync("packages/gui/src/components/list.tsx", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

function blockOf(src) {
  return (sel) => {
    const i = src.indexOf(sel);
    if (i < 0) return "";
    return src.slice(i, src.indexOf("}", i));
  };
}
const block = blockOf(CSS);
const guiBlock = blockOf(GUI_CSS);

/* 1 容器与标题配方（OneGUI 令牌口径） */
const e = guiBlock(".og-empty {");
ok(/display: flex/.test(e) && /flex-direction: column/.test(e), ".og-empty 应为纵向 flex");
ok(/gap: var\(--og-space-2\)/.test(e), ".og-empty 的 gap 应走 8px 档（--og-space-2）");
ok(/padding: var\(--og-space-7\) var\(--og-space-4\)/.test(e), ".og-empty 的 padding 应为竖向 28 / 横向 16 档令牌");
const t = guiBlock(".og-empty-title {");
ok(/font-weight: var\(--og-weight-semibold\)/.test(t), ".og-empty-title 应为 semibold 字重（标题不能跟正文一样轻）");
ok(/font-size: var\(--og-text-subtitle\)/.test(t), ".og-empty-title 字号应走副标题令牌");
ok(guiBlock(".og-empty-hint {").length > 0 && guiBlock(".og-empty-action {").length > 0, "缺 .og-empty-hint / .og-empty-action 样式");

/* 2 EmptyState 组件要把四个槽位都渲出来 */
for (const cls of ["og-empty-icon", "og-empty-title", "og-empty-hint", "og-empty-action"]) {
  ok(GUI_LIST.includes(cls), "EmptyState 组件没有渲染 ." + cls);
}

/* 3 行动按钮数量下限：现有 8 处，掉到 7 以下说明有人把按钮删了 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}
let sites = 0;
const where = [];
for (const f of [...walk("apps/desktop/src/pages"), ...walk("apps/desktop/src/components")]) {
  const src = readFileSync(f, "utf8");
  const hits = src.match(/<Empty[\s\S]{0,500}?action=\{/g) || [];
  if (hits.length) { sites += hits.length; where.push(f.split("/").pop() + "×" + hits.length); }
}
ok(sites >= 7, "带行动按钮的空状态应 ≥7 处（现有 8），实为 " + sites + "：" + where.join(" "));

/* 4 今日快捷 chip 的间距要落在 4pt 网格上 */
const chip = block(".today-quick-chip {");
ok(/height: 36px/.test(chip) && /padding: 0 16px/.test(chip), ".today-quick-chip 应为 height 36px + padding 0 16px（4pt 网格）");

console.log(
  fails.length
    ? "空状态护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "空状态护栏：容器/标题配方 ✓ 四槽位齐 ✓ 行动按钮 " + sites + " 处（" + where.join(" ") + "）✓ chip 落网格 ✓",
);
process.exit(fails.length ? 1 : 0);
