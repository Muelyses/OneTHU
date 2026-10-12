#!/usr/bin/env node
/**
 * 组件目录（P1 纯核心）护栏。方案：docs/原子收藏-可行性与实现方案.md §4.4 / §5.1 / §11。
 *
 * 盯住四件事：
 *   ① 七项定义齐全：id / spec / title / description / defaultSize / sizeRange（+ 可选 editableProps），
 *      且 defaultSize 必须落在自己的 sizeRange 内、不超过基准单位上限；
 *   ② 尺寸夹取：既不越出该组件的 sizeRange，也不超过 BOARD_UNITS；
 *   ③ 未知 id 必须「可判定」而不是崩：widgetById 返回 null、isKnownWidget false、defForSpec 退到同类或 null；
 *   ④ 描述是写给用户的：非空、不含开发者术语（spec/kind/JSON 之类）。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/widget-meta-test.mjs ｜ 0 通过 / 1 违规
 */
import { readFileSync } from "node:fs";

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

const src = readFileSync("apps/desktop/src/state/widgetMeta.ts", "utf8");
const W = await import("../apps/desktop/src/state/widgetMeta.ts");

const KINDS = ["atom-link", "nav", "card", "text", "divider", "custom"];

/* ① 七项定义 */
ok(W.PRESET_WIDGETS.length >= 3, "预制组件少于 3 个（解析可能失效）");
for (const d of W.PRESET_WIDGETS) {
  ok(!!d.id && !!d.title && !!d.description, "预制组件缺 id/title/description：" + d.id);
  ok(!!d.spec && KINDS.includes(d.spec.kind), "预制组件的 spec.kind 非法：" + d.id);
  ok(!!d.defaultSize && !!d.sizeRange, "预制组件缺 defaultSize/sizeRange：" + d.id);
  const r = d.sizeRange;
  const s = d.defaultSize;
  ok(s.w >= r.minW && s.w <= r.maxW && s.h >= r.minH && s.h <= r.maxH, "defaultSize 不在 sizeRange 内：" + d.id);
  ok(r.maxW <= W.BOARD_UNITS && r.minW >= 1 && r.minH >= 1, "sizeRange 越界（应 1..BOARD_UNITS）：" + d.id);
}

/* ② 尺寸夹取 */
const div = W.widgetById("divider");
ok(!!div, "找不到 divider");
ok(JSON.stringify(W.clampSize(div, { w: 1, h: 5 })) === JSON.stringify({ w: 2, h: 1 }), "clampSize 没有按 sizeRange 夹取（divider 应为 2x1）");
const ttl = W.widgetById("text-title");
ok(JSON.stringify(W.clampSize(ttl, { w: 9, h: 9 })) === JSON.stringify({ w: 8, h: 2 }), "clampSize 没有夹到基准单位上限（应为 8x2）");
ok(JSON.stringify(W.clampSize(ttl, { w: 0.4, h: 0 })) === JSON.stringify({ w: 1, h: 1 }), "clampSize 对 0 或小数没有抬到下限");

/* ②c 尺寸档位（霖 2026-10-11 定稿）：自由控制 / 挡位控制两分，以及档位吸附 */
for (const d of W.PRESET_WIDGETS) {
  ok(W.sizeControlOf(d) === "free", "预制组件（分割线 / 文字）应保留自由控制：" + d.id);
  ok(W.sizeTiersOf(d).length === 0, "自由控制的组件不该有档位清单：" + d.id);
}
const tierDef = {
  id: "custom:t", spec: { kind: "custom", id: "t" }, title: "示例", description: "示例组件。",
  defaultSize: { w: 2, h: 2 }, sizeRange: { minW: 1, minH: 1, maxW: 8, maxH: 8 },
  sizeControl: "tiers", sizeTiers: [{ w: 2, h: 2 }, { w: 1, h: 1 }, { w: 2, h: 1 }, { w: 2, h: 2 }],
};
ok(W.sizeControlOf(tierDef) === "tiers" && W.isTierControlled(tierDef) === true, "tiers 声明没有被识别");
ok(W.sizeTiersOf(tierDef).map(W.tierLabel).join(",") === "1×1,2×1,2×2", "档位清单没有去重并按面积由小到大排序");
ok(W.sizeControlOf({ ...tierDef, sizeControl: undefined }) === "tiers", "缺省判定没有按 sizeTiers 识别挡位控制");
ok(W.sizeControlOf(null) === "free", "未知组件不该被判成挡位控制");
ok(W.isTierControlled(W.widgetById("divider")) === false, "分隔线被判成挡位控制（应保留自由控制）");
ok(JSON.stringify(W.snapToTier(tierDef, { w: 4, h: 4 })) === JSON.stringify({ w: 2, h: 2 }), "snapToTier 没有取到最近的档位");
ok(JSON.stringify(W.snapToTier(tierDef, { w: 1, h: 5 })) === JSON.stringify({ w: 1, h: 1 }), "snapToTier 没有先比宽再比高");
ok(JSON.stringify(W.normalizeSize(tierDef, { w: 4, h: 1 })) === JSON.stringify({ w: 2, h: 1 }), "normalizeSize 没有吸附到档位");
ok(JSON.stringify(W.normalizeSize(W.widgetById("divider"), { w: 9, h: 9 })) === JSON.stringify({ w: 8, h: 1 }), "normalizeSize 对自由组件没有按 sizeRange 夹取");
ok(W.tierIndexOf(tierDef, { w: 2, h: 2 }) === 2 && W.tierIndexOf(tierDef, { w: 5, h: 5 }) === 2, "tierIndexOf 下标不对");
ok(W.sizeKey({ w: 2, h: 2 }) === "2x2", "sizeKey 口径不对（data-size 与护栏共用它）");

/* ②d 目录侧静态登记：挡位提案表 / 自由控制清单 / 逐卡分流 */
const widgetsSrcT = readFileSync("apps/desktop/src/state/widgets.ts", "utf8");
ok(/SIZE_PLANS/.test(widgetsSrcT), "缺少挡位提案表（挡位控制组件无从登记档位）");
ok(/freeSizeWidgetIds/.test(widgetsSrcT), "缺少自由控制组件清单");
ok(/sizeControl: free \? "free" : "tiers"/.test(widgetsSrcT), "卡片没有按自由/挡位分流");
ok(/tierWidgetIds/.test(widgetsSrcT), "缺少挡位控制组件清单（交付清单与护栏共用它）");

/* ②b 可编辑判定（长按菜单是否出现「编辑」） */
ok(W.isEditable(W.widgetById("divider")) === false, "无 editableProps 的组件不该出现「编辑」");
ok(W.isEditable(W.widgetById("text-label")) === true, "有 editableProps 的组件必须出现「编辑」");
ok(W.isEditable(null) === false, "null 组件不可编辑");

/* ③ 未知 id 可判定 */
ok(W.widgetById("nope") === null, "未知 id 必须返回 null");
ok(W.isKnownWidget("nope") === false && W.isKnownWidget("divider") === true, "isKnownWidget 判定错误");
ok(W.defForSpec({ kind: "card", card: "nope" }) === null, "未登记的 card spec 必须退到 null（渲染层据此落空态）");

/* ④ 描述面向用户 */
for (const d of W.PRESET_WIDGETS) {
  ok(d.description.length >= 8 && d.description.length <= 80, "描述长度不合适（应 8..80 字）：" + d.id);
  ok(!/spec|kind|JSON|props/.test(d.description), "描述里出现开发者术语：" + d.id);
}

/* ⑤ specToDefId 往返 + 应用侧注入 */
for (const d of W.PRESET_WIDGETS) {
  const back = W.defForSpec(d.spec);
  ok(!!back && back.id === d.id, "specToDefId 往返失败：" + d.id);
}
const fakeCard = {
  id: "card:balance", spec: { kind: "card", card: "balance" }, title: "校园卡余额",
  description: "显示校园卡余额与最近流水，需要登录。",
  defaultSize: { w: 2, h: 1 }, sizeRange: { minW: 1, minH: 1, maxW: 4, maxH: 2 },
};
ok(W.widgetById("card:balance", [fakeCard])?.id === "card:balance", "应用侧注入的条目查不到");
ok(W.defForSpec({ kind: "card", card: "balance" }, [fakeCard])?.id === "card:balance", "注入后 spec 反查失败");
ok(W.widgetDefs([fakeCard]).length === W.PRESET_WIDGETS.length + 1, "widgetDefs 合并数量不对");

/* ⑥ 源码层：目录核心的 **import 行**不得触碰视图模块（否则 node 无法剥离 JSX，护栏会加载失败）。
   注意只查 import 行——注释里出现 .tsx 字样是正常的，按全文查会误报。 */
const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l)).join("\n");
ok(!/\.tsx/.test(importLines), "组件目录核心 import 了 .tsx（node 无法剥离 JSX，护栏将加载失败）");

if (fails.length) {
  console.error("组件目录护栏（P1）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("组件目录护栏（P1）：七项定义齐全且尺寸自洽 ✓ ｜ clampSize 双向夹取 ✓ ｜ 未知 id 可判定 ✓ ｜ 描述面向用户 ✓ ｜ spec 往返与应用侧注入 ✓ ｜ 不依赖视图 ✓");
