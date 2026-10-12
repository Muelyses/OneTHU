#!/usr/bin/env node
/**
 * 尺寸档位护栏：交付清单与代码里的挡位提案表必须逐条一致。
 *
 * 由来（霖 2026-10-11）：取消自由缩放后，「哪些组件需要逐个设计不同大小的排版」变成一份**交付清单**。
 * 清单写在 docs/白板组件尺寸档清单.md，机读事实源是 state/widgets.ts 的 SIZE_PLANS。两者一旦不同步，
 * 要么有组件在界面上挑不到档位，要么设计做完了却没人知道。
 *
 * 盯住四件事：
 *   ① SIZE_PLANS 自身自洽：推荐档位落在档位清单里、档位不越基准单位、清单里没有重复；
 *   ② 纯逻辑对得上：sizeTiersOf / snapToTier / tierIndexOf 对每个真实提案给出的结果符合预期；
 *   ③ 清单 §1 的组件集合与 SIZE_PLANS 的键集合**完全相等**（多一个少一个都失败）；
 *   ④ 清单 §1 每行的档位列与推荐档位列与代码逐字一致。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/board-size-test.mjs ｜ 0 通过 / 1 违规
 */
import { readFileSync } from "node:fs";

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

const widgets = readFileSync("apps/desktop/src/state/widgets.ts", "utf8");
const doc = readFileSync("docs/白板组件尺寸档清单.md", "utf8");
const W = await import("../apps/desktop/src/state/widgetMeta.ts");

/** 取 readonly SizeTier[] 常量。 */
const helperTiers = (name) => {
  const m = new RegExp("const " + name + ": readonly SizeTier\\[\\] = \\[([^\\]]*)\\]").exec(widgets);
  if (!m) return null;
  return [...m[1].matchAll(/\{ w: (\d+), h: (\d+) \}/g)].map((x) => ({ w: Number(x[1]), h: Number(x[2]) }));
};
const STAT = helperTiers("STAT_TIERS");
const STUDENT = helperTiers("STUDENT_TIERS");
ok(!!STAT && STAT.length >= 2, "解析 STAT_TIERS 失败");
ok(!!STUDENT && STUDENT.length >= 2, "解析 STUDENT_TIERS 失败");

const planStart = widgets.indexOf("export const SIZE_PLANS");
ok(planStart > 0, "找不到 SIZE_PLANS");
const planEnd = widgets.indexOf("\n};", planStart);
const planSeg = widgets.slice(planStart, planEnd + 3);

const plans = new Map();
for (const m of planSeg.matchAll(/"?([a-zA-Z0-9-]+)"?:\s*\{\s*tiers:\s*(\[[^\]]*\]|STAT_TIERS|STUDENT_TIERS),\s*def:\s*\{ w: (\d+), h: (\d+) \}\s*\}/g)) {
  const raw = m[2];
  const tiers = raw === "STAT_TIERS" ? STAT : raw === "STUDENT_TIERS" ? STUDENT
    : [...raw.matchAll(/\{ w: (\d+), h: (\d+) \}/g)].map((x) => ({ w: Number(x[1]), h: Number(x[2]) }));
  plans.set(m[1], { tiers, def: { w: Number(m[3]), h: Number(m[4]) } });
}
ok(plans.size >= 10, "SIZE_PLANS 解析到的条目太少（" + plans.size + " 条），解析可能失效");

/* ① + ② 逐条自洽与纯逻辑对账 */
for (const [key, plan] of plans) {
  const id = "custom:" + key;
  const tag = id + " ";
  ok(plan.tiers.length >= 1, tag + "档位清单为空");
  const keys = plan.tiers.map((t) => t.w + "x" + t.h);
  ok(new Set(keys).size === keys.length, tag + "档位清单里有重复档位");
  ok(plan.tiers.every((t) => t.w >= 1 && t.h >= 1 && t.w <= W.BOARD_UNITS), tag + "档位越出基准单位");
  ok(plan.tiers.some((t) => t.w === plan.def.w && t.h === plan.def.h), tag + "推荐档位不在档位清单里");
  const def = {
    id, spec: { kind: "custom", id: key }, title: "示例", description: "示例组件。",
    defaultSize: plan.def, sizeRange: { minW: 1, minH: 1, maxW: W.BOARD_UNITS, maxH: 8 },
    sizeControl: "tiers", sizeTiers: plan.tiers,
  };
  ok(W.sizeControlOf(def) === "tiers" && W.isTierControlled(def), tag + "没有被判成挡位控制");
  const listed = W.sizeTiersOf(def);
  ok(listed.length === plan.tiers.length, tag + "sizeTiersOf 给出的档位数与提案不符（" + listed.length + "）");
  const snapped = W.snapToTier(def, plan.def);
  ok(snapped.w === plan.def.w && snapped.h === plan.def.h, tag + "推荐档位吸附不到自身");
  ok(W.tierIndexOf(def, plan.def) >= 0 && W.tierIndexOf(def, plan.def) < listed.length, tag + "推荐档位的下标越界");
  /* 吸附的单调性：档位外的尺寸必须落在清单内 */
  const far = W.snapToTier(def, { w: 9, h: 9 });
  ok(plan.tiers.some((t) => t.w === far.w && t.h === far.h), tag + "档位外的尺寸没有吸附到清单内的档位");
}

/* ③ 清单 §1 与 SIZE_PLANS 的键集合相等 */
const secStart = doc.indexOf("## 1.");
const secEnd = doc.indexOf("## 2.");
ok(secStart > 0 && secEnd > secStart, "交付清单里找不到 §1 / §2 分节");
const section = doc.slice(secStart, secEnd);
const rows = new Map();
/* 单元格用 \s* 容忍对齐空格：清单是人工编辑的，单元格会被补齐成等宽（改前只认单空格，人工对齐后整表解析失败）。 */
for (const m of section.matchAll(/^\|\s*(.+?)\s*\|\s*`custom:([a-zA-Z0-9-]+)`\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/gm)) {
  rows.set(m[2], { tiers: m[3].trim(), def: m[4].trim() });
}
ok(rows.size >= 10, "交付清单 §1 解析到的组件太少（" + rows.size + " 行）");
const missingInDoc = [...plans.keys()].filter((k) => !rows.has(k));
const missingInCode = [...rows.keys()].filter((k) => !plans.has(k));
ok(missingInDoc.length === 0, "这些组件有挡位提案却没有进交付清单 §1：" + missingInDoc.join(", "));
ok(missingInCode.length === 0, "交付清单 §1 列了没有挡位提案的组件（清单已过期）：" + missingInCode.join(", "));

/* ④ 每行的档位列与推荐档位列与代码逐字一致 */
for (const [key, plan] of plans) {
  const row = rows.get(key);
  if (!row) continue;
  const tiersText = plan.tiers.map((t) => t.w + "×" + t.h).join(", ");
  const defText = plan.def.w + "×" + plan.def.h;
  ok(row.tiers === tiersText, "custom:" + key + " 的档位列与代码不一致（清单 " + row.tiers + "，代码 " + tiersText + "）");
  ok(row.def === defText, "custom:" + key + " 的推荐档位列与代码不一致（清单 " + row.def + "，代码 " + defText + "）");
}

/* ⑤ 自由控制的四类必须在清单 §2 出现（口径不许被悄悄改写） */
for (const kw of ["分割线", "入口按钮", "列表", "自由控制"]) {
  ok(doc.includes(kw), "交付清单没有写明自由控制的口径关键词：" + kw);
}

if (fails.length) {
  console.error("尺寸档位护栏：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("尺寸档位护栏：" + plans.size + " 个挡位组件的提案与交付清单逐条一致 ✓ ｜ 推荐档位在清单内且可吸附 ✓ ｜ 档位不越基准单位 ✓ ｜ 自由控制口径在案 ✓");
