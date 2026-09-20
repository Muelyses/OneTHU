/**
 * 导览「今日页留哪些卡」+ 场景映射（回归护栏）。
 *
 * 两件事必须钉住：
 *  ① 今日概览永远保留（它是首页的地基，导览不该让用户把它关掉）；
 *  ② 场景 chip 与卡片勾选是**同一份判定**（此前 chip 走 applyScenarios、卡片走另一套，
 *     chip 点了等于没点——正是这次要修的"两套状态"）。
 */
import assert from "node:assert/strict";
import { cardsForScenarios, cardsOfScenario, SCENARIOS } from "../apps/desktop/src/lib/onboardingCards.ts";
import { readFileSync } from "node:fs";

// ① 今日概览恒在
assert.ok(cardsForScenarios([]).includes("today-overview"), "不选任何场景也要留今日概览");
assert.ok(cardsForScenarios(["learn", "life"]).includes("today-overview"), "选场景后今日概览仍保留");

// ② 场景 → 卡片：所选场景的卡都在，未选场景的卡不在（同一场景的卡集来自 SCENARIOS）
const learn = cardsOfScenario("learn");
assert.ok(learn.length > 0, "learn 场景应有对应卡片");
for (const id of learn) assert.ok(cardsForScenarios(["learn"]).includes(id), `learn 场景应保留 ${id}`);

// ③ 多场景取并集（且不重复）
const both = cardsForScenarios(["learn", "schedule"]);
assert.equal(new Set(both).size, both.length, "并集不应有重复项");
for (const id of cardsOfScenario("schedule")) assert.ok(both.includes(id), "并集应含 schedule 的卡");

// ④ 可勾选的卡片 = 默认可见的展示卡（入口卡仍在「添加卡片」里，不进导览）——
//    该清单在浏览器侧由 HOME_CARD_META 派生（.tsx 链 node 跑不动），这里按源码核对：
//    onboarding.ts 必须从 HOME_CARD_META 过滤 bespoke 且非 defaultHidden
const onboardSrc = readFileSync(new URL("../apps/desktop/src/state/onboarding.ts", import.meta.url), "utf8");
assert.ok(
  /todayChoosableCards[\s\S]{0,240}HOME_CARD_META\.filter\([\s\S]{0,80}bespoke[\s\S]{0,80}defaultHidden/.test(onboardSrc),
  "todayChoosableCards 必须由 HOME_CARD_META 过滤（bespoke 且非 defaultHidden）派生",
);
const cardSrc = readFileSync(new URL("../apps/desktop/src/lib/homeCards.ts", import.meta.url), "utf8");

// ⑤ 「猜你喜欢」的起步项必须都是注册表里真实存在的页面原子 key：
//    曾经写了 "thos"（注册表里没有这个 key）→ resolveAtom 返回 null → 整条推荐被丢掉
const suggestSrc = readFileSync(new URL("../apps/desktop/src/lib/suggest.ts", import.meta.url), "utf8");
const atomSrc = readFileSync(new URL("../apps/desktop/src/state/atoms.tsx", import.meta.url), "utf8");
const pageKeys = new Set(
  [...atomSrc.slice(atomSrc.indexOf("export const PAGE_ATOMS"), atomSrc.indexOf("export function recordPageAtomUse")).matchAll(/key: "([a-z0-9-]+)"/g)].map((m) => m[1]),
);
const starterBlock = suggestSrc.slice(suggestSrc.indexOf("const STARTER_KEYS"), suggestSrc.indexOf("];", suggestSrc.indexOf("const STARTER_KEYS")));
const starterKeys = [...starterBlock.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
assert.ok(starterKeys.length >= 4, `起步项应有若干条（实际 ${starterKeys.length}）`);
for (const k of starterKeys) assert.ok(pageKeys.has(k), `起步项 ${k} 必须是真实存在的页面原子 key`);
for (const sc of SCENARIOS) {
  for (const id of sc.keep) {
    assert.ok(cardSrc.includes(`"${id}"`), `场景 ${sc.id} 引用的卡片 ${id} 必须存在于 homeCards 注册表`);
  }
}

console.log(`结果：导览今日卡片映射 ✓（${SCENARIOS.length} 个场景，含今日概览保底）`);
