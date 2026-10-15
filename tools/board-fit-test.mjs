#!/usr/bin/env node
/**
 * 白板「按内容拟合」守栏（2026-10-15，用户第三次报「截断」）。
 *
 * 为什么有这条：自由画布的条目盒是绝对定位的，**不会自己长高**；卡片内容一变长
 * （课表数据异步回来、名单多一行、行高度量变化），盒就比内容矮，卡片底边被硬切。
 * macOS 的浮层滚动条不常驻，5px 的缺口看起来就是"下半截被截断"。这一条修了三次：
 *   ① 只清网格残留、不拟合 → 网格派生的高度永远比内容矮；
 *   ② 拟合挂在 [items] 上，只在条目数组变化时量一次 → 内容异步长的时候量不到（"有时好有时坏"）；
 *   ③ 拆开「谁管高度」这件事（`manual` 用户定过 / `fitted` 拟合撑过 / 都没标 = 拟合全权）。
 *
 * 断言分两层：
 *   ① **判据单元断言**（`state/boardFit.fitTarget`）：这是能"想清楚"的部分，必须钉死 ——
 *      只长不缩、`manual` 只补排版税、`fitted` 继续负责（防复发）、单次增长有上限。
 *   ② **落库断言**（`boardCore.fitHeightPx`）：只长不缩、置 `fitted`、不置 `manual`、**不碰 cell**
 *      （cell 是插件/OH 契约层：写什么读回什么）；以及用户动手的 `withRect` 要**清掉 fitted**（交权）。
 *   ③ **接线断言**：FreeBoard 必须同时挂 ResizeObserver（盒子尺寸）× MutationObserver（内容变化）
 *      —— 少一路就是②号坑原样复现。文案型断言，只为拦住"改动时顺手删了一路"。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/board-fit-test.mjs
 *   退出码：0 通过 / 1 违规。
 */
import "./board-test-env.mjs";
const { readFileSync } = await import("node:fs");

const fit = await import("../apps/desktop/src/state/boardFit.ts");
const core = await import("../apps/desktop/src/state/boardCore.ts");

const fails = [];
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else fails.push(m); };

console.log("① 判据单元断言（state/boardFit.fitTarget）");
{
  const { fitTarget, FIT_DEAD_ZONE, FIT_MANUAL_SLACK, FIT_MAX_STEP } = fit;
  ok(FIT_DEAD_ZONE === 2, `死区 = 2px（与 fitHeightPx 同口径）：${FIT_DEAD_ZONE}`);
  ok(FIT_MANUAL_SLACK === 24, `manual 缺口线 = 24px（一格 88 的四分之一）：${FIT_MANUAL_SLACK}`);
  ok(FIT_MAX_STEP === 480, `单次增长上限 = 480px：${FIT_MAX_STEP}`);

  /* 只长不缩 */
  ok(fitTarget(400, 400) === null, "内容正好装下 → 不动");
  ok(fitTarget(400, 398) === null, "内容比盒子矮 → 不动（绝不缩）");
  ok(fitTarget(400, 401) === 403, "内容比盒子高 1px → 补到 403（+2 描边余量，正好抹掉那 1px 切边）");
  ok(fitTarget(400, 399) === null, "内容比盒子矮 1px → 不动（死区 2px 罩住取整误差）");

  /* 谁都没标：拟合全权 */
  ok(fitTarget(400, 470) === 472, "裸件：内容 470 → 长到 472");
  ok(fitTarget(400, 1000) === null, `裸件缺口 ${600} 超过单次上限 → 不动（长列表该滚，见 FIT_MAX_STEP）`);
  ok(fitTarget(400, 700) === 702, "裸件缺口 300（在上限内）→ 长到 702");

  /* manual：只补排版税 —— 用户实测的 5px 缺口就是这一类 */
  ok(fitTarget(465, 470, { manual: true }) === 472, "manual：5px 缺口（排版税）→ 补上（用户报的截断本体）");
  ok(fitTarget(400, 424, { manual: true }) === null, "manual：缺口 26px 刚好越过 24 → 不动（用户是故意缩小的话缺口只会更大）");
  ok(fitTarget(400, 422, { manual: true }) === 424, "manual：22px 缺口（线内）→ 补上");
  ok(fitTarget(140, 600, { manual: true }) === null, "manual：用户故意缩到 140 的卡片 → 绝不被撑开");

  /* fitted：继续负责（防第三种坑复发） */
  ok(fitTarget(465, 470, { fitted: true }) === 472, "fitted：补上");
  ok(fitTarget(472, 510, { fitted: true }) === 512, "fitted：明天内容再长 38px（越过 manual 线）→ 仍然补上（防复发）");
  ok(fitTarget(472, 2000, { fitted: true, manual: true }) === null, "fitted 也要守单次上限（fitted 恒定压过 manual 的 24）");

  /* 异常输入不许把盒子搞坏 */
  ok(fitTarget(400, 0) === null, "内容高 0（隐藏面板/未挂载）→ 不动");
  ok(fitTarget(400, Number.NaN) === null, "内容高 NaN → 不动");
  ok(fitTarget(400, -5) === null, "内容高为负 → 不动");
}

console.log("② 落库断言（boardCore.fitHeightPx / withRect）");
{
  const mk = (h) => ({ id: "a", spec: { kind: "text", text: "x" }, cell: { x: 1, y: 2, w: 2, h: 1 }, rect: { x: 8, y: 8, w: 196, h } });
  const grown = core.fitHeightPx([mk(465)], "a", 472);
  ok(!!grown && grown[0].rect.h === 472, "fitHeightPx 长到目标高");
  ok(!!grown && grown[0].fitted === true, "fitHeightPx 置 `fitted`（声明这份高度归拟合管）");
  ok(!!grown && grown[0].manual !== true, "fitHeightPx **不置** `manual`（拟合是程序行为，不是用户动作）");
  ok(!!grown && grown[0].cell.x === 1 && grown[0].cell.y === 2 && grown[0].cell.w === 2 && grown[0].cell.h === 1, "fitHeightPx 不动 cell（插件/OH 契约层：写什么读回什么）");
  ok(!!grown && grown[0].rect.x === 8 && grown[0].rect.y === 8 && grown[0].rect.w === 196, "fitHeightPx 只改高，不动 x/y/w");

  const shrunk = core.fitHeightPx([mk(472)], "a", 400);
  ok(shrunk === null, "fitHeightPx 只长不缩（更矮的目标 → 无变化，不写盘）");
  ok(core.fitHeightPx([mk(472)], "a", 473) === null, "fitHeightPx 死区内（+1）→ 无变化");

  const noRect = { id: "b", spec: { kind: "text", text: "y" }, cell: { x: 0, y: 1, w: 2, h: 1 } };
  const born = core.fitHeightPx([noRect], "b", 240);
  ok(!!born && born[0].rect.h === 240 && born[0].rect.y === core.rectFromCell(noRect.cell).y, "没存过 rect 的条目：拟合按格派生的 x/y/w 补一个 rect");

  const taken = core.withRect({ ...mk(472), fitted: true }, { x: 8, y: 8, w: 196, h: 300 });
  ok(taken.manual === true, "withRect（用户拖动/缩放）置 `manual`");
  ok(taken.fitted === undefined, "withRect **清掉** `fitted`（用户接管高度，拟合不再自动撑开）");
}

console.log("③ 接线断言（FreeBoard：两路观察缺一不可）");
{
  const src = readFileSync("apps/desktop/src/components/FreeBoard.tsx", "utf8");
  ok(/new ResizeObserver\(/.test(src), "挂了 ResizeObserver（盖盒子尺寸变化：窗口缩放 / 面板显隐 / 换档位）");
  ok(/new MutationObserver\(/.test(src), "挂了 MutationObserver（盖**内容**变化：数据异步回来、列表多一行）—— 少这一路就是「有时好有时坏」");
  ok(/fitTarget\(it\.h, contentH, \{ manual: it\.manual, fitted: it\.fitted \}\)/.test(src), "调用点把两个归属标记都传进判据（漏传 fitted 会复发第三种坑）");
  ok(!/it\.manual\) continue;/.test(src), "判据里不再有「manual 一律跳过」（那正是 5px 缺口永远补不上的原因）");
  ok(/data-manual=\{it\.manual \? "1" : undefined\}/.test(src) && /data-fitted=\{it\.fitted \? "1" : undefined\}/.test(src), "条目盒带 data-manual / data-fitted（现场探针据此区分谁在拟合、谁被跳过）");
  ok(/cardOf/.test(src) && /firstElementChild/.test(src), "量体目标是条目盒的直接子元素（CSS 里 `\\.free-item > :first-child { overflow:auto }` 就是它，card/custom 外面还套 .wg-card）");
}

console.log(fails.length ? `\n✗ 按内容拟合守栏 ${fails.length} 项失败` : "\n✅ 按内容拟合守栏通过");
for (const f of fails) console.error("   ✗ " + f);
process.exit(fails.length ? 1 : 0);
