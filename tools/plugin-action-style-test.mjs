/**
 * 插件卡片「动作行」样式护栏（防复发，2026-10-11 用户：『再让我看见这种风格的按钮我捶你』）
 *
 * 规则：插件页**卡片 / 列表行内的可点项一律纯文字**——
 *   ✅ 允许：`btn btn-ghost`（纯文字；无底色无描边）、`switch`（开关语义自带形态）
 *   ❌ 禁止：`chip`、`seg-item`、`btn-primary`（这些只允许出现在筛选行 / 页级主操作 / 主题板「应用」）
 * 检查范围：`pages/Plugins.tsx` 里 PluginCard 与 MarketView 的卡片区块，以及任何 `plg-*` 动作行。
 * 退出码：0 = 通过；1 = 命中违规（打印 文件:行 + class + 原文）。
 */
import { readFileSync } from "node:fs";

const FILE = "apps/desktop/src/pages/Plugins.tsx";
/** 违规（致命）：胶囊类出现在卡片动作行 —— 用户点名要根治的那种灰底胶囊 */
const BAD = ["chip", "seg-item"];
/** 提示（非致命）：btn-primary 出现在卡片区域。规则允许它作为**卡片主操作**出现
 *  （安装 / 更新至 vX / 运行命令 / 主题板「应用」），所以只提示不拦，便于人工复核。 */
const NOTE = ["btn-primary"];
const src = readFileSync(FILE, "utf8").split("\n");

/** 卡片/列表动作行的判定：从 `className={"plg-…"}` 到该 div 结束之间，或 PluginCard 函数体内 */
const startIdx = src.findIndex((l) => l.includes("function PluginCard("));
const marketIdx = src.findIndex((l) => l.includes("function MarketView("));
if (startIdx < 0) {
  console.error("✗ 找不到 PluginCard（护栏需要更新锚点）");
  process.exit(1);
}
/** 只扫这两个组件体（卡片/列表区域），页面级主操作（安装插件、保存等）不在其中 */
const regions = [
  [startIdx, src.findIndex((l, i) => i > startIdx && l.startsWith("function "))],
  [marketIdx, src.findIndex((l, i) => i > marketIdx && l.startsWith("function "))],
];

const hits = [];
const notes = [];
for (const [a, b] of regions) {
  for (let i = a; i < (b < 0 ? src.length : b); i++) {
    const line = src[i];
    if (!/className=/.test(line)) continue;
    for (const bad of BAD) {
      if (new RegExp(`className=[^\\n]*\\b${bad}\\b`).test(line)) hits.push({ line: i + 1, cls: bad, text: line.trim().slice(0, 100) });
    }
    for (const n of NOTE) {
      if (new RegExp(`className=[^\\n]*\\b${n}\\b`).test(line)) notes.push({ line: i + 1, cls: n, text: line.trim().slice(0, 100) });
    }
  }
}

for (const n of notes) console.log(`ℹ 卡片区内 btn-primary（应为卡片主操作，请人工确认）：${FILE}:${n.line}  ${n.text}`);

if (hits.length === 0) {
  console.log("插件卡片动作行护栏：卡片/列表行内**无 chip / seg-item**（动作项一律纯文字 btn-ghost）✓");
  process.exit(0);
}
console.error(`✗ 插件卡片动作行出现胶囊类按钮 ${hits.length} 处（应改为 btn btn-ghost 纯文字）：`);
for (const h of hits) console.error(`   ${FILE}:${h.line}  [${h.cls}]  ${h.text}`);
process.exit(1);
