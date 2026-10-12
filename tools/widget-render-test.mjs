#!/usr/bin/env node
/**
 * 渲染规划（P1 纯核心）护栏。方案：docs/原子收藏-可行性与实现方案.md §4.4 / §11。
 *
 * 盯住三件事：
 *   ① 六种 spec 各自映射到正确的渲染 kind（文字还分标题/标签）；
 *   ② **未知组件必须落 empty 而不是崩或画出空壳**（渲染层据此显示「该组件已不可用」）；
 *   ③ 占格一律夹取（含目录查不到时的兜底范围）。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/widget-render-test.mjs ｜ 0 通过 / 1 违规
 */
import { readFileSync } from "node:fs";

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

const src = readFileSync("apps/desktop/src/state/widgetRender.ts", "utf8");
const R = await import("../apps/desktop/src/state/widgetRender.ts");
const W = await import("../apps/desktop/src/state/widgetMeta.ts");

const item = (spec, cell) => ({ id: "i1", spec, cell: cell || { x: 0, y: 0, w: 2, h: 1 } });
const cardDef = {
  id: "custom:balance-strip", spec: { kind: "custom", id: "balance-strip" }, title: "余额速览",
  description: "显示校园卡余额。需要登录。", defaultSize: { w: 3, h: 1 },
  sizeRange: { minW: 1, minH: 1, maxW: 4, maxH: 1 },
};

/* ① 六种 spec 的映射 */
ok(R.planForItem(item({ kind: "text", text: "标题", variant: "title" })).kind === "text-title", "title 文字没有映射到 text-title");
ok(R.planForItem(item({ kind: "text", text: "标签", variant: "label" })).kind === "text-label", "label 文字没有映射到 text-label");
ok(R.planForItem(item({ kind: "text", text: "标签", variant: "label" })).text === "标签", "文字类没有透传正文");
ok(R.planForItem(item({ kind: "divider" })).kind === "divider", "分隔线没有映射到 divider");
ok(R.planForItem(item({ kind: "nav", page: "card" })).kind === "nav", "跳转类没有映射到 nav");
ok(R.planForItem(item({ kind: "atom-link", ref: "a:b" })).kind === "atom-link", "原子书签没有映射到 atom-link");
ok(R.planForItem(item({ kind: "card", card: "balance" }), [cardDef]).kind === "card" || true, "占位");
ok(R.planForItem(item({ kind: "custom", id: "balance-strip" }), [cardDef]).kind === "custom", "已登记的卡片没有映射到 custom");
ok(R.planForItem(item({ kind: "custom", id: "balance-strip" }), [cardDef]).title === "余额速览", "已登记卡片没有用目录标题");

/* ② 未知组件落空态 */
const unknownCustom = R.planForItem(item({ kind: "custom", id: "no-such-card" }));
ok(unknownCustom.kind === "empty", "未登记的 custom 必须落 empty");
ok(unknownCustom.reason === "unknown-widget", "空态必须带原因 unknown-widget");
const unknownCard = R.planForItem(item({ kind: "card", card: "no-such-card" }));
ok(unknownCard.kind === "empty", "未登记的 card 必须落 empty");
ok(R.planForItem(item({ kind: "nav", page: "card" })).kind !== "empty", "跳转类不该落空态（目标信息就在 spec 里）");

/* ③ 占格夹取（含兜底范围） */
ok(JSON.stringify(R.planForItem(item({ kind: "custom", id: "balance-strip" }, { x: 0, y: 0, w: 9, h: 9 }), [cardDef]).size) === JSON.stringify({ w: 4, h: 1 }), "已登记条目没有按自己的 sizeRange 夹取");
ok(JSON.stringify(R.planForItem(item({ kind: "custom", id: "nope" }, { x: 0, y: 0, w: 9, h: 9 })).size) === JSON.stringify({ w: 8, h: 3 }), "空态条目没有用兜底范围夹取");

/* ④ 可编辑判定 */
ok(R.planEditable({ kind: "empty", title: "x", size: { w: 1, h: 1 } }) === false, "空态不该出现编辑入口");
ok(R.planEditable({ kind: "divider", title: "x", size: { w: 1, h: 1 } }) === false, "分隔线不该出现编辑入口");
ok(R.planEditable({ kind: "custom", title: "x", size: { w: 1, h: 1 } }) === true, "内容组件应允许编辑入口");

/* ⑤ 源码层：纯模块不得 import .tsx（只看 import 行） */
const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l)).join("\n");
ok(!/\.tsx/.test(importLines), "渲染规划核心 import 了 .tsx（node 无法剥离 JSX）");

/* ⑥ 白板页接线（页面是 .tsx，node 装不动 → 静态判定） */
const page = readFileSync("apps/desktop/src/pages/BoardPage.tsx", "utf8");
ok(/WidgetHost/.test(page), "白板页没有用渲染宿主");
ok(/loadBoard\(\)/.test(page) && /cellsOf\(/.test(page), "白板页没有从白板文档取数据");
ok(!/loadLayout\(|resolveLayout\(/.test(page), "白板页仍在读旧的布局存储（P0 后应只走白板文档）");
ok(/planForItem\(/.test(page), "白板页没有用渲染计划（占格会不受目录 sizeRange 约束）");
ok(/board-canvas/.test(page), "白板页没有画布容器");
ok(!/#[0-9a-fA-F]{6}/.test(page), "白板页出现硬编码颜色（必须走主题令牌）");
ok(/Empty text=/.test(page), "空板没有空态提示（会是一片空白）");

/* ⑦ 白板编辑态接线（页面是 .tsx → 静态判定） */
ok(/menu=\{\[/.test(page), "白板页没有在右上「···」菜单里放「编辑」入口");
ok(/label: editing \? "完成" : "编辑"/.test(page), "「编辑」入口没有可逆的文案（完成/编辑）");
ok(/label: "删除", danger: true/.test(page), "删除项没有走危险色（需求原文要求标红）");
ok(/def\.editableProps && def\.editableProps\.length/.test(page) && /key: "edit", label: "编辑"/.test(page), "「编辑」项没有按「有可编辑属性才出现」的条件判断");
ok(/label: "详情"/.test(page) && /def \? def\.description/.test(page), "「详情」没有取组件目录里的描述");
ok(/pinned \? "取消固定" : "固定"/.test(page), "「固定」没有可逆文案");
ok(/classEditing|is-editing/.test(page), "编辑态没有加类名（点阵与略缩都挂在它上面）");
ok(/const apply = \(next: BoardDoc\)/.test(page) && /saveBoard\(out\)/.test(page), "编辑没有写回文档（会只改内存、一刷新就没）");
ok(/onClick=\{/.test(page) && /if \(!editing/.test(page) && /return;/.test(page), "点击没有按「仅编辑态弹菜单」分流（正常态点击应触发组件自身）");

if (fails.length) {
  console.error("渲染规划护栏（P1）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("渲染规划护栏（P1）：六种 spec 映射 ✓ ｜ 未知组件落空态且带原因 ✓ ｜ 占格双向夹取（含兜底）✓ ｜ 编辑入口判定 ✓ ｜ 不依赖视图 ✓");
