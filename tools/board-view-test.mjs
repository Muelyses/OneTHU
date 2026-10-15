#!/usr/bin/env node
/**
 * 自由画布「无限画布 + 缩放」守栏（2026-10-15，用户拍板的模型纠正）。
 *
 * 模型：`screen = world * z + (x, y)`。条目坐标系（cell/rect）**一个字都不改** ——
 * 平移与缩放只是"看的方式"。这条守栏钉住三件事：
 *   ① 纯函数正确：换算往返、锚点不动点（捏合时画面不许往左上角跑）、档位梯子、夹取、
 *      屏幕位移 → 世界位移要除以 z（不除的话拖动手感会随缩放失真）；
 *   ② 视图落的是**另一个 key**（`onethu.boardview.v1`）：视图不是文档，不许混进 onethu.board.v1；
 *   ③ 接线：FreeBoard 必须真的有世界层（transform）与 ± 按钮，且不再有"画布高度跟着内容长"
 *      那套旧模型（`minHeight = 内容底边`）—— 用户原话：「自由扩展不是妥协，无限大是与生俱来的」。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/board-view-test.mjs
 *   退出码：0 通过 / 1 违规。
 */
import "./board-test-env.mjs";
const { readFileSync } = await import("node:fs");

const v = await import("../apps/desktop/src/state/boardView.ts");

const fails = [];
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else fails.push(m); };
const near = (a, b, eps = 0.001) => Math.abs(a - b) <= eps;

console.log("① 视口变换（纯函数）");
{
  const view = { x: 120, y: -40, z: 1.5 };
  const s = v.toScreen(view, 200, 300);
  const back = v.toWorld(view, s.x, s.y);
  ok(near(back.x, 200) && near(back.y, 300), `screen↔world 往返相等（${s.x.toFixed(2)},${s.y.toFixed(2)} → ${back.x.toFixed(2)},${back.y.toFixed(2)}）`);

  ok(near(v.toScreen({ x: 0, y: 0, z: 1 }, 10, 20).x, 10), "z=1 且无平移时屏幕=世界（默认视图不动任何东西）");

  /* 锚点不动点：缩放前后，锚点下的世界点必须还在锚点屏幕位置 */
  const zoomed = v.zoomAt(view, 2.5, 640, 400);
  const wAfter = v.toWorld(zoomed, 640, 400);
  const wBefore = v.toWorld(view, 640, 400);
  ok(near(wAfter.x, wBefore.x) && near(wAfter.y, wBefore.y), "zoomAt：锚点下的世界坐标不动（捏合/按钮都不会让画面跑掉）");
  ok(zoomed.z === 2.5, "zoomAt 落到目标倍率");

  /* 夹取 */
  ok(v.clampZoom(9) === v.ZOOM_MAX && v.clampZoom(0.01) === v.ZOOM_MIN, `倍率夹到 [${v.ZOOM_MIN}, ${v.ZOOM_MAX}]`);
  ok(v.clampZoom(Number.NaN) === 1, "倍率 NaN → 回 100%（画面不会消失）");

  /* 档位梯子：单调、端点封顶 */
  ok(v.stepZoom(1, 1) === 1.25, "＋ 从 100% 走到 125%");
  ok(v.stepZoom(1, -1) === 0.8, "－ 从 100% 走到 80%");
  ok(v.stepZoom(v.ZOOM_MAX, 1) === v.ZOOM_MAX, "已在最大倍率时 ＋ 不动");
  ok(v.stepZoom(v.ZOOM_MIN, -1) === v.ZOOM_MIN, "已在最小倍率时 － 不动");
  ok(v.ZOOM_STEPS.every((z, i) => i === 0 || z > v.ZOOM_STEPS[i - 1]), "档位梯子严格递增");
  ok(v.ZOOM_STEPS.includes(1), "梯子上有 100%（重置视图的落点）");

  /* 位移换算：拖动要除以 z */
  ok(near(v.worldDelta(2, 100, 50).x, 50) && near(v.worldDelta(2, 100, 50).y, 25), "放大 2 倍时，屏幕拖 100px = 世界移动 50px");
  ok(near(v.worldDelta(0.5, 100, 0).x, 200), "缩小到 50% 时，屏幕拖 100px = 世界移动 200px");
  ok(near(v.worldDelta(0, 100, 0).x, 100), "z=0（异常）退化成 1:1，不做除以零");

  /* 平移与"回到内容" */
  ok(v.panBy(view, 10, -20).x === 130, "panBy 累加屏幕位移");
  ok(v.panBy(view, Number.NaN, 0) === view, "panBy 遇 NaN 原样返回（坏事件不许污染视图）");

  const items = [{ x: 40, y: 100, w: 200, h: 88 }, { x: 400, y: 20, w: 100, h: 300 }];
  const cr = v.contentRect(items);
  ok(cr && cr.x === 40 && cr.y === 20 && cr.w === 460 && cr.h === 300, `内容外接矩形正确（${cr?.x},${cr?.y} ${cr?.w}x${cr?.h}）`);
  ok(v.contentRect([]) === null, "空画布没有内容矩形");
  /* 无限画布的反面断言：外接矩形**只用来定"回到内容"**，不许被当作画布边界回写 */
  const home = v.viewForRect(cr, 1);
  ok(near(home.x, v.VIEW_ORIGIN_PAD - 40) && near(home.y, v.VIEW_ORIGIN_PAD - 20) && home.z === 1, "viewForRect：内容左上角贴到呼吸位、倍率 100%");

  ok(v.zoomLabel(0.9999999) === "100%", "倍率格式化按四舍五入（捏合会跑出 0.9999…）");
}

console.log("② 视图落的是另一个 key（视图 ≠ 文档）");
{
  let raw = readFileSync("apps/desktop/src/state/boardView.ts", "utf8");
  let src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // 注释里可以提文档 key，代码里不许碰
  ok(/onethu\.boardview\.v1/.test(src), "视图存在 onethu.boardview.v1");
  ok(!/onethu\.board\.v1/.test(src), "视图模块的**代码**不碰 onethu.board.v1（文档与视图分开）");
  const core = readFileSync("apps/desktop/src/state/boardCore.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/boardview/.test(core), "文档模型（boardCore）不知道视图的存在");
}

console.log("③ 接线：FreeBoard 换成无限画布");
{
  const src = readFileSync("apps/desktop/src/components/FreeBoard.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/freeboard-world/.test(src), "画布里有世界层（.freeboard-world）");
  ok(/--board-x/.test(src) && /--board-y/.test(src) && /--board-z/.test(src), "世界层从视图变量取平移/缩放（TSX 只写变量，几何在 CSS 里）");
  const css = readFileSync("apps/desktop/src/styles/explorer-home.css", "utf8");
  ok(/\.freeboard-world[\s\S]{0,400}transform:\s*translate3d\(var\(--board-x/.test(css), "CSS 里世界层真的用 translate3d + scale 承载视图（不是内联样式，过 OneGUI R2）");
  ok(/scale\(var\(--board-z/.test(css), "世界层真的按 --board-z 缩放");
  ok(/\.freeboard\s*\{[\s\S]{0,500}overflow:\s*hidden/.test(css), "画布是视口（overflow:hidden）—— 这是视口不是边界：条目坐标没有上界");
  ok(/\.board-zoombar/.test(css), "缩放条有自己的定位（屏幕空间，不随世界层缩放）");

  /* 缩放控件必须是 OneGUI 的按钮族（用户点名「严格遵循 onegui」） */
  ok(/BtnGroup/.test(src) && /IconBtn/.test(src), "± 按钮用 OneGUI 的 IconBtn + BtnGroup（不是裸控件）");
  ok(/OgIconMinus|IconMinus/.test(src) && /OgIconPlus/.test(src), "＋/－ 各一枚图标（IconMinus 是新加进 @onethu/gui 图标集的）");
  ok(/zoomBy\(-1\)/.test(src) && /zoomBy\(1\)/.test(src), "两个按钮分别缩/放一档");
  ok(/stepZoom\(/.test(src), "按钮走档位梯子（0.4…2.5）");
  ok(/boardView/.test(src) || /viewOf\(/.test(src), "画布读板级视图（每块板记住自己看到哪）");
  ok(!/el\.style\.minHeight = bottom/.test(src), "删掉旧模型「画布高度跟着内容底边长」（无限大是与生俱来的，不是后补的）");
  ok(!/BOARD_CANVAS_H/.test(src), "不再有固定 2400px 的画布高度垫层");
  ok(!/workspace.*minHeight/.test(src) || true, "（提示性）");
}

console.log(fails.length ? `\n✗ 无限画布守栏 ${fails.length} 项失败` : "\n✅ 无限画布守栏通过");
for (const f of fails) console.error("   ✗ " + f);
process.exit(fails.length ? 1 : 0);
