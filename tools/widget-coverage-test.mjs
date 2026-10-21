#!/usr/bin/env node
/**
 * 组件注册覆盖护栏（P1）。方案：docs/原子收藏-可行性与实现方案.md §4.4 / §7 / §11。
 *
 * 覆盖是**硬要求**：卡片注册表里的每一张卡都必须有用户可见描述，不许留空、不许用模板糊。
 * 本护栏按源码解析（卡片注册表经图标 .tsx，node 装不动），因此只做静态覆盖与文案质量断言。
 *
 * 跑法：node tools/widget-coverage-test.mjs ｜ 0 通过 / 1 违规
 */
import { readUiSource as readFileSync } from "./i18n/source-view.mjs";

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

const cards = readFileSync("apps/desktop/src/lib/homeCards.ts", "utf8");
const widgets = readFileSync("apps/desktop/src/state/widgets.ts", "utf8");

/* ① 取卡片注册表的全部 id（标题可能与 id 不同行，故只取 id） */
const metaStart = cards.indexOf("export const HOME_CARD_META");
ok(metaStart > 0, "找不到 HOME_CARD_META");
const ids = [...cards.slice(metaStart).matchAll(/\{ id: "([a-z0-9-]+)"/g)].map((m) => m[1]);
ok(ids.length >= 30, "解析到的卡片太少（" + ids.length + "），解析可能失效");

/* ② 取描述表的键与值 */
const mapStart = widgets.indexOf("export const CARD_DESCRIPTIONS");
ok(mapStart > 0, "找不到 CARD_DESCRIPTIONS");
const mapSeg = widgets.slice(mapStart, widgets.indexOf("};", mapStart));
const entries = [...mapSeg.matchAll(/"?([a-z0-9-]+)"?:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]);
const described = new Map(entries);

/* ③ 覆盖：每张卡都要有描述，且不得留空 */
const missing = ids.filter((id) => !described.has(id));
ok(missing.length === 0, "这些卡片没有用户可见描述：" + missing.join(", "));
const orphan = [...described.keys()].filter((id) => !ids.includes(id));
ok(orphan.length === 0, "描述表里有卡片注册表已不存在的键（应删）：" + orphan.join(", "));

/* ④ 文案质量：与组件目录护栏同口径 */
for (const [id, text] of described) {
  ok(text.length >= 8 && text.length <= 60, "描述长度不合适（应 8..60 字）：" + id + " (" + text.length + ")");
  ok(!/spec|kind|JSON|props|TODO|待补/.test(text), "描述里出现开发者术语或占位：" + id);
  ok(/[。！？]$/.test(text) || text.length <= 20, "描述应成句（句末带标点）：" + id);
}

/* ⑤ 尺寸规则：条目要有 defaultSize/sizeRange，且宽度不超基准单位 */
/* 尺寸规则在整份文件里判定：rangeFor / defaultWidth 定义在 cardWidgetDefs 之上，
   只从 cardWidgetDefs 起切片会漏掉它们（本护栏第一版就踩了这个）。 */
/* services（+homework）有专门默认尺寸、其余走 free/plan 分流；自由控制与挡位两套都要有 */
ok(/defaultSize:[\s\S]{0,200}free \? \{ w, h: 2 \} : \{ \.\.\.plan\.def \}/.test(widgets), "卡片条目的默认尺寸没有按「自由控制/挡位控制」分流生成");
ok(/sizeControl: free \? "free" : "tiers"/.test(widgets) && /sizeTiers: free \? undefined : plan\.tiers/.test(widgets), "卡片的 sizeControl/sizeTiers 没有按自由控制分流");
ok(/maxW: BOARD_UNITS/.test(widgets) && /minW: 1, minH: 1, maxW: BOARD_UNITS/.test(widgets), "卡片条目的 sizeRange 没有受基准单位约束");
ok(!/description: ""/.test(widgets), "条目里出现了空描述（必须逐卡写）");
ok(/defaultCol === "rail" \? 1 : 3/.test(widgets), "默认宽度没有按 defaultCol 区分主栏/侧栏");

/* ⑥ 尺寸档位覆盖（霖 2026-10-11）：取消自由控制后，凡是不保留自由控制的卡片都必须登记档位清单，
   否则该组件在长按菜单里选「改变大小」会落进一个没有可选档位的抽屉。 */
const metaKinds = [...cards.slice(metaStart).matchAll(/\{ id: "([a-z0-9-]+)", title: "[^"]*", kind: "(bespoke|entry)"/g)].map((m) => [m[1], m[2]]);
ok(metaKinds.length >= 30, "解析卡片 kind 失败（" + metaKinds.length + " 条），解析可能失效");
const listSeg = (widgets.match(/export const LIST_WIDGET_IDS[\s\S]*?\];/) || [""])[0];
const listIds = [...listSeg.matchAll(/"custom:([a-z0-9-]+)"/g)].map((m) => m[1]);
const planSeg = (widgets.match(/export const SIZE_PLANS[\s\S]*?\n\};/) || [""])[0];
const planKeys = new Set([...planSeg.matchAll(/"?([a-z0-9-]+)"?:\s*\{ tiers:/g)].map((m) => m[1]));
ok(planKeys.size >= 10, "挡位提案表条目太少（" + planKeys.size + " 条），解析可能失效");
/* services 在 widgets.ts 里被点名保留自由控制（def.id === "services" 分支），不要求挡位清单。 */
const freeBespoke = new Set(["services"]);
const needPlan = metaKinds.filter(([id, kind]) => kind === "bespoke" && !listIds.includes(id) && !freeBespoke.has(id)).map(([id]) => id);
const noPlan = needPlan.filter((id) => !planKeys.has(id));
ok(noPlan.length === 0, "这些卡片取消了自由控制却没有登记尺寸档位（用户无法改变大小）：" + noPlan.join(", "));
/* 页面自带组件里的数字卡/统计卡也要有档位；成绩明细是列表，保留自由控制。 */
["mine-balance", "mine-credit", "mine-gpa", "mine-student", "report-done", "report-credit", "report-overall", "report-latest"].forEach((id) => {
  ok(planKeys.has(id), "页面自带组件没有登记尺寸档位：" + id);
});
ok(!planKeys.has("report-list"), "成绩明细是列表，应保留自由控制（不该被登记成挡位）");
if (fails.length) {
  console.error("组件注册覆盖护栏（P1）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("组件注册覆盖护栏（P1）：覆盖 " + ids.length + " 张卡片且无空描述 ✓ ｜ 无孤儿键 ✓ ｜ 文案面向用户 ✓ ｜ 尺寸规则受基准单位约束 ✓");
