#!/usr/bin/env node
/**
 * 自由画布「不裁切的盒子 + 缩放」守栏（2026-10-15，用户两轮点名后定稿）。
 *
 * 模型：画布是个盒子，但**盒子的尺寸永远盖住内容**（跟着内容长、缩放一起算），
 * 于是"内容落在盒子外面被切掉"这条路径在数学上不存在 —— 用户原话：
 *   「你怎么还有那么明显一个内容框呢？出了内容框就被截断，我们要的是没有那个隐形的 frame」
 * 「平移」交给滚动（文档流模型）：内容长到哪，滚动容器就能滚到哪。
 * 缩放是真的缩放（世界层 scale(z)），条目坐标系（cell / rect 契约）一个字都不改。
 *
 * 断言：
 *   ① **不裁切不变量**（boardView.boxSize）：对任意内容/任意倍率，盒子 ≥ 缩放后的内容外接框。
 *      这是本文件最重要的一条 —— 「截断」三次都是从这里漏出去的。
 *   ② 缩放纯函数：换算往返、档位梯子单调、夹取、适配不超过 100%、位移÷倍率。
 *   ③ 视图落另一个 key（视图不是文档）。
 *   ④ 接线：FreeBoard 不再裁切（画布 overflow:visible）、盒子由 minWidth/minHeight 撑、
 *      滚轮不抢普通滚动、± 按钮是 OneGUI 的 IconBtn/BtnGroup。
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

console.log("① 不裁切不变量：盒子永远盖住内容（截断三次都漏在这里）");
{
  const cases = [
    { name: "空画布", items: [], z: 1 },
    { name: "单件小卡", items: [{ x: 8, y: 8, w: 286, h: 88 }], z: 1 },
    { name: "内容偏右下（老模型的截断点）", items: [{ x: 8, y: 8, w: 286, h: 88 }, { x: 372, y: 661, w: 384, h: 88 }], z: 1 },
    { name: "缩放 40%", items: [{ x: 8, y: 8, w: 286, h: 88 }, { x: 372, y: 661, w: 384, h: 88 }], z: 0.4 },
    { name: "缩放 250%", items: [{ x: 8, y: 8, w: 286, h: 88 }, { x: 372, y: 661, w: 384, h: 88 }], z: 2.5 },
    { name: "超宽内容（横向也不能切）", items: [{ x: 0, y: 0, w: 3000, h: 200 }], z: 1 },
    { name: "超高内容", items: [{ x: 0, y: 0, w: 200, h: 5000 }], z: 1.5 },
  ];
  for (const c of cases) {
    const box = v.boxSize(c.items, c.z, { w: 0, h: 0 });
    const r = v.contentRect(c.items);
    const needW = r ? (r.x + r.w) * c.z : 0;
    const needH = r ? (r.y + r.h) * c.z : 0;
    /* 世界层是 transform-origin:0 0 的 scale(z)：内容右上角在屏幕上的落点就是 (x+w)*z */
    ok(box.w >= needW && box.h >= needH, `${c.name}：盒子 ${box.w}×${box.h} ≥ 内容缩放后 ${Math.ceil(needW)}×${Math.ceil(needH)}`);
  }
  /* 视口本身也要被盖住（内容比视口小的时候，盒子不能小于视口 —— 否则画布区域会缩成一条） */
  const box2 = v.boxSize([{ x: 0, y: 0, w: 10, h: 10 }], 1, { w: 1200, h: 800 });
  ok(box2.w >= 1200 && box2.h >= 800, `内容小、视口大时盒子按视口算（${box2.w}×${box2.h}）`);
  const box3 = v.boxSize([{ x: 0, y: 0, w: 10, h: 10 }], 0.4, { w: 1200, h: 800 });
  ok(box3.w >= 1200 * 0.4 && box3.h >= 800 * 0.4, "缩小时视口下界也按倍率折算（不会缩出屏幕外）");
  ok(v.boxSize([], 1).w >= v.BOX_PAD, `空画布也留呼吸位（≥${v.BOX_PAD}px）`);
}

console.log("② 缩放纯函数");
{
  const s = v.toScreen(1.5, 200, 300);
  const back = v.toWorld(1.5, s.x, s.y);
  ok(near(back.x, 200) && near(back.y, 300), "screen↔world 往返相等");

  ok(v.clampZoom(9) === v.ZOOM_MAX && v.clampZoom(0.01) === v.ZOOM_MIN, `倍率夹到 [${v.ZOOM_MIN}, ${v.ZOOM_MAX}]`);
  ok(v.clampZoom(Number.NaN) === 1, "倍率 NaN → 回 100%（画面不会消失）");
  ok(v.stepZoom(1, 1) === 1.25 && v.stepZoom(1, -1) === 0.8, "＋/－ 从 100% 各走一格（125% / 80%）");
  ok(v.stepZoom(v.ZOOM_MAX, 1) === v.ZOOM_MAX && v.stepZoom(v.ZOOM_MIN, -1) === v.ZOOM_MIN, "端点封顶");
  ok(v.ZOOM_STEPS.every((z, i) => i === 0 || z > v.ZOOM_STEPS[i - 1]), "档位梯子严格递增");
  ok(v.ZOOM_STEPS.includes(1), "梯子上有 100%");

  ok(near(v.worldDelta(2, 100, 50).x, 50) && near(v.worldDelta(2, 100, 50).y, 25), "放大 2 倍：屏幕拖 100px = 世界 50px");
  ok(near(v.worldDelta(0.5, 100, 0).x, 200), "缩小 50%：屏幕拖 100px = 世界 200px");
  ok(near(v.worldDelta(0, 100, 0).x, 100), "z=0（异常）退化成 1:1，不做除以零");

  const items = [{ x: 40, y: 100, w: 200, h: 88 }, { x: 400, y: 20, w: 100, h: 300 }];
  const cr = v.contentRect(items);
  ok(cr && cr.x === 40 && cr.y === 20 && cr.w === 460 && cr.h === 300, `内容外接矩形正确（${cr?.x},${cr?.y} ${cr?.w}x${cr?.h}）`);
  ok(v.contentRect([]) === null, "空画布没有内容矩形");

  const zf = v.fitZoom({ w: 1200, h: 800 }, cr);
  ok(zf <= 1 && zf >= v.ZOOM_MIN, `适配倍率不超过 100%（算出 ${v.zoomLabel(zf)}）`);
  ok(v.fitZoom({ w: 1200, h: 800 }, null) === 1, "空内容适配 → 100%");
  ok(v.fitZoom({ w: 100, h: 100 }, { x: 0, y: 0, w: 4000, h: 4000 }) === v.ZOOM_MIN, "内容极大时夹到最小倍率（不缩成看不见）");
  ok(v.zoomLabel(0.9999999) === "100%", "倍率格式化按四舍五入（捏合会跑出 0.9999…）");
}

console.log("③ 视图落的是另一个 key（视图 ≠ 文档）");
{
  let raw = readFileSync("apps/desktop/src/state/boardView.ts", "utf8");
  let src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(/onethu\.boardview\.v2/.test(src), "视图存在 onethu.boardview.v2（v1 是平移+缩放那一版，形状与语义都变了，直接丢）");
  ok(!/onethu\.board\.v1/.test(src), "视图模块的代码不碰 board 文档（文档与视图分开）");
  const core = readFileSync("apps/desktop/src/state/boardCore.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/boardview/.test(core), "文档模型（boardCore）不知道视图的存在");
}

console.log("保存视图与默认视图区分");
{
  const key = "test-phone-view|portrait|phone";
  ok(!v.hasSavedView(key), "读取默认视图不会伪造保存记录");
  v.viewOf(key);
  ok(!v.hasSavedView(key), "缓存默认 100% 仍保持未初始化");
  v.setView(key, { z: 1 });
  ok(v.hasSavedView(key), "显式保存 100% 后是有效用户选择");
  ok(v.viewOf(key).z === 1, "保存 100% 不被手机默认覆盖");
}

console.log("④ 接线：画布不裁切、盒子撑起来、控件走 OneGUI");
{
  const src = readFileSync("apps/desktop/src/components/FreeBoard.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const css = readFileSync("apps/desktop/src/styles/explorer-home.css", "utf8");
  ok(/freeboard-world/.test(src), "画布里有世界层（.freeboard-world）");
  ok(/boxSize\(items(?:\.map\([^;]*?\))?, displayScale/.test(src), "盒子尺寸由 boxSize 算（不裁切不变量的唯一实现处）");
  ok(!/fitZoom\(viewportRef/.test(src) || !/首次打开/.test(src), "不再有首次打开自动适配：盒子永远盖住内容 → 内容都够得着，把高板缩成 40% 反而吓人");
  ok(/el\.style\.minWidth = box\.w/.test(src) && /el\.style\.minHeight = box\.h/.test(src), "盒子的最小尺寸真的写进 DOM（宽高都要，横向也别切）");
  ok(!/el\.style\.minHeight = bottom/.test(src), "删掉旧模型「画布高度跟着内容底边长」");
  ok(/needsPenCanvas \? BOARD_CANVAS_H : 0/.test(src), "仅有笔迹或正在绘画时保留笔迹的归一化画布");
  ok(!/beginPan|is-panning/.test(src), "没有空白拖动平移那套（用户否掉的第一版：它会把内容拖到盒子外面）");
  ok(/if \(!e\.ctrlKey && !e\.metaKey\) return;/.test(src), "滚轮处理器先放走没有修饰键的滚动（捏合/⌘ 才拦）");
  const wheelBody = src.slice(src.indexOf("const onWheel"), src.indexOf("host.addEventListener(\"wheel\""));
  ok((wheelBody.match(/preventDefault\(\)/g) ?? []).length === 1, "滚轮处理器里只有一处 preventDefault，且在修饰键守卫之后（普通滚动绝不被吞）");

  ok(/\.freeboard \{[\s\S]{0,900}overflow: visible/.test(css), "画布 overflow:visible —— 这里绝不裁切内容");
  ok(/\.freeboard-world \{[\s\S]{0,400}transform: scale\(var\(--board-z/.test(css), "世界层按 --board-z 缩放（transform-origin 0 0，与盒子的算法同一口径）");
  ok(/\.explorer-panel\.is-onepage-canvas[\s\S]{0,200}overflow: auto/.test(css), "面板恢复滚动：内容长到哪就滚到哪");
  ok(!/freeboard-world \.board-pen/.test(css), "画笔层不在世界层里（笔迹尺寸固定、不随缩放走，归一化坐标才稳定）");

  ok(/BtnGroup/.test(src) && /IconBtn/.test(src), "± 按钮用 OneGUI 的 IconBtn + BtnGroup（不是裸控件）");
  ok(/OgIconMinus/.test(src) && /OgIconPlus/.test(src), "＋/－ 各一枚图标（IconMinus 是新加进 @onethu/gui 图标集的）");
  ok(/zoomBy\(-1\)/.test(src) && /zoomBy\(1\)/.test(src), "两个按钮分别缩/放一档");
  ok(/stepZoom\(/.test(src), "按钮走档位梯子（0.4…2.5）");
  ok(/board-zoombar/.test(css), "缩放条有独立定位（屏幕空间，不随世界层缩放）");
}

console.log(fails.length ? `\n✗ 无限画布守栏 ${fails.length} 项失败` : "\n✅ 无限画布守栏通过（不裁切不变量 + 缩放 + 接线）");
for (const f of fails) console.error("   ✗ " + f);
process.exit(fails.length ? 1 : 0);
