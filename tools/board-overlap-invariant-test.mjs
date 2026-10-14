#!/usr/bin/env node
/**
 * 白板「格子契约不重叠」不变量守栏（2026-10-15，oh-wire）。
 *
 * 为什么有这条：2026-10-11 霖现场「放手后两个组件叠在一起」→ 当时的 BoardPage 设了**写入口漏斗**
 * （`apply()` 里 `ensureNoOverlap(cells)` + 挂载期修一次 + repackBoard 补空隙），注释写着
 * 「无论哪个操作漏了让位，写进去的文档都不会重叠」。白板接入④（假白板下线）把那个页面删了，
 * 漏斗随之消失——**repair 函数与 repack 在生产里零调用**，而 `tools/board-drag-test.mjs` 的
 * 注释仍在说「写入口用 ensureNoOverlap 兜底」。本守栏就是来把这件事钉住的：
 *
 *   ① 常态断言（今天就该绿）：生产写路径（boardEdit.moveItem / resizeItem / addItemTo）
 *      落库后不重叠；落库与让位预览一致；ensureNoOverlap 能拆重叠且不可变；
 *      `rectOf` 对没存过 rect 的条目回落到 cell 派生（= 格子重叠就是**视觉**重叠）。
 *   ② **接线探测 + 困难布局断言**：守栏自己先探测生产里有没有"落库前的重叠修复"调用点
 *      （`ensureNoOverlap`/`repack`/`repairOverlaps` 之类，排除定义行与注释）：
 *        · 有接线 → 困难布局（board-drag-test 同一条 tall fixture + OH 直写格子那条路）
 *          的**不变量断言强制生效**：落库后一格都不许重叠；
 *        · 没接线 → 打印显眼的「不变量未接线（已知缺口）」+ 证据，并跳过困难布局断言
 *          （退出码仍 0，免得 guard 链为已知缺口常红）——**绝不静默**。
 *      这样本守栏在"接线前/接线后"都自洽：HEAD 上不假红，接线后自动转严（回归即红）。
 *   ③ `--strict`：无论有没有接线都强制跑困难布局断言（接线前会红——那是缺口本体）。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/board-overlap-invariant-test.mjs [--strict]
 *   退出码：0 通过（含"未接线"的显式跳过） / 1 违规。
 */
import "./board-test-env.mjs";

const STRICT = process.argv.includes("--strict");
const { readFileSync, readdirSync, statSync } = await import("node:fs");

const board = await import("../apps/desktop/src/state/board.ts");
const core = await import("../apps/desktop/src/state/boardCore.ts");
const be = await import("../apps/desktop/src/state/boardEdit.ts");
const reflow = await import("../apps/desktop/src/state/boardReflow.ts");
const onePage = await import("../apps/desktop/src/state/onePage.ts");
const explorer = await import("../apps/desktop/src/state/explorer.ts");
const { setNavBridge } = await import("../apps/desktop/src/plugins/bridges.ts");
const { buildApi } = await import("../apps/desktop/src/plugins/facade.ts");

setNavBridge((page, params) => explorer.explorerNavigate(page, params));
const api = buildApi("onethu.harness", new Set(["nav", "ui"]));

const fails = [];
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else fails.push(m); };
const show = (arr) => arr.map((c) => `${c.id}@${c.cell.x},${c.cell.y},${c.cell.w}x${c.cell.h}`).join(" | ");

/* ── 生产里到底有没有"最后一道不变量"？ ──
   判据要**精确**（第一版在 HEAD 上误判成"已接线"：把 repackBoard 定义体内的 repackItems 自调用
   也算成调用点了）：只看"修复函数在**定义它的模块之外**被调用"——
     · ensureNoOverlap 定义在 boardReflow.ts（算法模块）→ 它以外的调用 = 真接线；
     · repairOverlaps（若存在）= 落库漏斗，任何调用都算。
   顺带把死代码（repackBoard/repackItems 无人调用）单独报出来，但不参与判据。 */
function callSitesOf(names, skipFiles = []) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = dir + "/" + e;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e)) {
        if (skipFiles.some((s) => p.endsWith(s))) continue;
        readFileSync(p, "utf8").split("\n").forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) return;
          if (new RegExp(`export function (${names.join("|")})`).test(t)) return;
          if (new RegExp(`\\b(${names.join("|")})\\s*\\(`).test(t)) out.push(`${p}:${i + 1}`);
        });
      }
    }
  };
  walk("apps/desktop/src");
  return out;
}
const repair = [
  ...callSitesOf(["ensureNoOverlap"], ["/boardReflow.ts"]),   /* 算法模块以外的调用 = 真接线 */
  ...callSitesOf(["repairOverlaps"]),
];
const deadPack = callSitesOf(["repackBoard"]);
const WIRED = repair.length > 0;

const item = (id, x, y, w, h) => ({ id, spec: { kind: "text", text: id }, cell: { x, y, w, h } });
const boardId = onePage.createOnePage("不变量守栏板");
const docOf = (items) => ({ ...board.loadBoard(), boards: board.loadBoard().boards.map((b) => (b.id === boardId ? { ...b, cells: { ...b.cells, portrait: items } } : b)) });
const cellsNow = () => core.cellsOf(board.loadBoard().boards.find((b) => b.id === boardId), "portrait");
const persist = (doc) => board.saveBoard(doc);

console.log(`不变量接线探测：修复函数在算法模块之外的调用点 ${repair.length} 处${repair.length ? "（" + repair.join(" / ") + "）" : "（⚠ 生产里没有任何一处会修重叠）"}`);
if (deadPack.length) console.log(`  · 死代码提示：repackBoard 仅被定义、无调用（${deadPack.length} 处全在定义体内）`);

/* ── ① 常态断言 ── */
{
  const typical = [item("a", 0, 0, 2, 2), item("b", 2, 0, 2, 2), item("c", 0, 2, 4, 1)];
  persist(docOf(typical));
  const moved = be.moveItem(board.loadBoard(), boardId, "portrait", "a", { x: 2, y: 2 });
  persist(moved);
  ok(!be.hasOverlap(cellsNow()), `boardEdit.moveItem 常态落库不重叠：${show(cellsNow())}`);

  const preview = reflow.reflowForMove(typical, "a", { x: 2, y: 2 });
  ok(show(cellsNow()) === show(preview), "落库与让位预览一致（两处不会分叉）");

  const resized = be.resizeItem(board.loadBoard(), boardId, "portrait", "a", { w: 4, h: 1 });
  persist(resized);
  ok(!be.hasOverlap(cellsNow()), `boardEdit.resizeItem 常态落库不重叠：${show(cellsNow())}`);

  const added = be.addItemTo(board.loadBoard(), boardId, "portrait", { kind: "text", text: "新件" }, [], { w: 2, h: 1 });
  ok(!!added.added, "addItemTo 放得下新件（findFreeCell 有位可落）");
  if (added.added) { persist(added.doc); ok(!be.hasOverlap(cellsNow()), `boardEdit.addItemTo 新增后不重叠：${show(cellsNow())}`); }

  const messy = [item("x", 0, 0, 4, 4), item("y", 0, 2, 4, 4)];
  ok(be.hasOverlap(messy), "hasOverlap 认得出叠在一起的布局（判据本身可信）");
  const fixed = reflow.ensureNoOverlap(messy);
  ok(!be.hasOverlap(fixed), "ensureNoOverlap 能拆开重叠");
  ok(messy[1].cell.y === 2, "ensureNoOverlap 不可变（不动入参）");

  /* 格子重叠 = 视觉重叠：没存过 rect 的条目按 cell 派生位置 */
  const noRect = { id: "nr", spec: { kind: "text", text: "无 rect" }, cell: { x: 1, y: 2, w: 2, h: 1 } };
  const r = core.rectOf(noRect);
  ok(r.x === core.rectFromCell(noRect.cell).x && r.y === core.rectFromCell(noRect.cell).y, "rectOf 对无 rect 条目回落到 cell 派生（所以格子重叠会真的叠在屏幕上）");
  const ohItem = await api.ext.onePageAddItem(boardId, "text", { text: "插件放的" }, 0, 0, 2, 1);
  ok(!!ohItem?.id, "ext.onePageAddItem（插件/OH 契约）能放件");
  const ohCells = api.ext.onePageItems(boardId);
  ok(ohCells.some((i) => i.x === 0 && i.y === 0), "OH 读回的坐标就是 cell（契约层口径一致）");
  ok(!cellsNow().some((c) => c.id === ohItem?.id && c.rect), "ext.onePageAddItem 只写 cell、不写 rect（所以这条路的落点完全由格子语义决定）");
}

/* ── ② 困难布局：让位模型单独可能留重叠；但**落库前必须有闸**（接线即强制） ── */
const tall = [item("tall", 0, 4, 4, 8), item("up1", 0, 0, 4, 2), item("up2", 0, 2, 4, 2), item("down1", 0, 12, 4, 1)];

/* 信息项（不判失败）：让位模型**单独**跑，在这类布局上会不会留重叠。
   这是"为什么需要最后一道闸"的证据；有闸之后它留不留都不影响用户文档。 */
{
  const reflowed = reflow.reflowForMove(tall, "tall", { x: 0, y: 3 });
  console.log(`  · 参照：让位模型单独跑 tall fixture → ${be.hasOverlap(reflowed) ? "会留重叠（" + show(reflowed) + "）" : "不留重叠（" + show(reflowed) + "）"}`);
}

const hardLayouts = [
  { name: "boardEdit.moveItem 困难布局", run: () => { persist(docOf(tall)); persist(be.moveItem(board.loadBoard(), boardId, "portrait", "tall", { x: 0, y: 3 })); } },
  { name: "boardEdit.resizeItem 困难布局", run: () => { persist(docOf(tall)); persist(be.resizeItem(board.loadBoard(), boardId, "portrait", "up1", { w: 4, h: 8 })); } },
  { name: "ext.onePageMoveItem（OH 直写格子）压到别人", run: () => { persist(docOf(tall)); api.ext.onePageMoveItem(boardId, "down1", 0, 4); } },
  { name: "ext.onePageAddItem（插件契约）落到被占的格", run: async () => { persist(docOf(tall)); await api.ext.onePageAddItem(boardId, "text", { text: "插件放到被占格" }, 0, 4, 2, 2); } },
];

if (WIRED || STRICT) {
  console.log("\n[严格档] 生产里已接重叠修复 → 困难布局的不变量断言生效");
  for (const c of hardLayouts) {
    await c.run();
    ok(!be.hasOverlap(cellsNow()), `${c.name}：落库后不许重叠（${show(cellsNow())}）`);
  }
  /* 载入即修复：手写一份带重叠的文档进存储，走真读路径 */
  const messyDoc = docOf([item("m1", 0, 0, 4, 4), item("m2", 0, 2, 4, 4), item("m3", 0, 6, 4, 4)]);
  board.saveBoard(messyDoc);
  const reloaded = core.cellsOf(board.loadBoard().boards.find((b) => b.id === boardId), "portrait");
  ok(!be.hasOverlap(reloaded), `载入路径也过一遍修复（手写脏文档不许永远叠着）：${show(reloaded)}`);
} else {
  console.log(
    "\n⚠ 不变量未接线（已知缺口）：生产里没有任何一处会在落库前修重叠 —— " +
    "\n  「让位留重叠 → 原样落库 → 无人修复」这条链是通的（插件/OH 的 ext.onePage* 直写 cell 更是完全裸奔）。" +
    "\n  本题按设计**跳过**困难布局的强断言（免得 guard 链为已知缺口常红）；接线后这些断言自动生效、回归即红。" +
    "\n  想现在就看见缺口红灯：node --import ./tools/ts-resolve-register.mjs tools/board-overlap-invariant-test.mjs --strict",
  );
}

console.log(fails.length ? `\n✗ 不重叠不变量守栏 ${fails.length} 项失败` : "\n✅ 不重叠不变量守栏通过（缺口状态见上）");
for (const f of fails) console.error("   ✗ " + f);
process.exit(fails.length ? 1 : 0);
