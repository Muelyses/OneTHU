#!/usr/bin/env node
/**
 * 白板文档（P0 数据层）护栏。方案：docs/原子收藏-可行性与实现方案.md §3 / §6.1。
 *
 * 盯住四件事：
 *   ① 解析必须严：损坏 / 版本不符 / 单元格非法 / 活动板不存在 → 一律回落 null；
 *   ② 迁移必须**读真实存储的布局**（按朝向各一份），不能拿默认布局顶包，否则抹掉用户自定义；
 *   ③ 迁移幂等：文档已在则原样返回，不重复迁移；
 *   ④ 渲染适配往返：layout → cells → layout 保序保栏位，并把注册表里不在板上的卡补成 off。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/board-model-test.mjs ｜ 0 通过 / 1 违规
 */
import { readFileSync } from "node:fs";

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

const src = readFileSync("apps/desktop/src/state/boardCore.ts", "utf8") + readFileSync("apps/desktop/src/state/board.ts", "utf8");
const B = await import("../apps/desktop/src/state/boardCore.ts");

const HOME_IDS = ["homework", "balance-strip", "notices"];
const DEFAULT_ITEMS = HOME_IDS.map((id) => ({ id, col: "off", collapsed: false }));
const PORTRAIT = [
  { id: "homework", col: "main", collapsed: true },
  { id: "balance-strip", col: "rail", collapsed: false },
];

const mem = new Map();
const storage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, v); },
};
let portraitStore = PORTRAIT;
const savedOrders = [];
const deps = {
  knownIds: HOME_IDS,
  loadLayoutItems: (o) => (o === "portrait" ? portraitStore : null),
  resolveLayout: (saved) => (saved && saved.length ? saved : DEFAULT_ITEMS),
  loadOrder: () => ({ mode: "auto", edited: false, order: ["homework"] }),
  saveOrder: (s) => { savedOrders.push(s); },
  storage,
};

/* ① 解析严格性 */
ok(B.parseBoard(null) === null, "parseBoard(null) 必须回落 null");
ok(B.parseBoard("not json") === null, "parseBoard 对非 JSON 必须回落 null");
ok(B.parseBoard(JSON.stringify({ v: 2, boards: [{ id: "b", name: "n", icon: "i", kind: "user", cells: { portrait: [] } }], activeBoardId: "b", order: {} })) === null, "版本不符（v=2）必须回落 null");
ok(B.parseBoard(JSON.stringify({ v: 1, boards: [], activeBoardId: "x", order: {} })) === null, "空 boards 必须回落 null");
const badCell = JSON.stringify({ v: 1, boards: [{ id: "b", name: "n", icon: "i", kind: "user", cells: { portrait: [{ id: "a", spec: { kind: "divider" }, cell: { x: 0, y: 0, w: 0, h: 1 } }] } }], activeBoardId: "b", order: {} });
ok(B.parseBoard(badCell) === null, "单元格 w=0 非法，必须回落 null");
const badActive = JSON.stringify({ v: 1, boards: [{ id: "b", name: "n", icon: "i", kind: "user", cells: { portrait: [] } }], activeBoardId: "zzz", order: {} });
ok(B.parseBoard(badActive) === null, "activeBoardId 指向不存在的板，必须回落 null");

/* ② 迁移读真实布局 */
mem.clear();
const doc = B.loadBoard(deps);
const sys = B.systemBoard(doc);
ok(!!sys, "迁移后必须存在一块系统板");
const cells = B.cellsOf(sys, "portrait");
const hw = cells.find((c) => c.spec.kind === "custom" && c.spec.id === "homework");
const bal = cells.find((c) => c.spec.kind === "custom" && c.spec.id === "balance-strip");
ok(!!hw && hw.collapsed === true, "迁移必须保留用户存的折叠态（homework collapsed=true）");
ok(!!hw && hw.cell.x === 0 && hw.cell.w === 3, "main 栏卡应落在基准单位 0..3（宽 3）");
ok(!!bal && bal.cell.x === 3 && bal.cell.w === 1, "rail 栏卡应落在基准单位 3..4（宽 1）");
ok(!!mem.get(B.BOARD_KEY), "迁移结果必须落盘（后续以文档为准）");

/* ③ 幂等 */
portraitStore = [{ id: "notices", col: "main", collapsed: false }];
const again = B.loadBoard(deps);
const againIds = B.cellsOf(B.systemBoard(again), "portrait").filter((c) => c.spec.kind === "custom").map((c) => c.spec.id);
ok(againIds.includes("homework") && !againIds.includes("notices"), "二次 loadBoard 不得重新迁移（文档已在即原样返回）");

/* ④ 往返适配 */
const back = B.cellsToLayout(B.layoutToCells(PORTRAIT), HOME_IDS);
const inMain = back.filter((i) => i.col === "main").map((i) => i.id);
const inRail = back.filter((i) => i.col === "rail").map((i) => i.id);
const off = back.filter((i) => i.col === "off").map((i) => i.id);
ok(inMain.join(",") === "homework" && inRail.join(",") === "balance-strip", "往返后栏位与序必须保持");
ok(off.join(",") === "notices", "注册表里不在板上的卡应补成 off，且不混入板上卡");
ok(back.filter((i) => i.id === "homework")[0].collapsed === true, "往返后折叠态必须保持");

/* ⑤ 跨朝向回落 */
const onlyPortrait = { id: "u", name: "n", icon: "i", kind: "user", cells: { portrait: [{ id: "a", spec: { kind: "divider" }, cell: { x: 0, y: 0, w: 1, h: 1 } }] } };
ok(B.cellsOf(onlyPortrait, "landscape").length === 1, "只定义 portrait 的板在 landscape 下必须回落（§6.1）");

/* ⑥ 落盘与排序 */
B.saveBoard(doc, deps);
ok(savedOrders.length > 0, "saveBoard 必须同时把排序模式交回应用侧持久化");

/* ⑦ 源码层 */
for (const kind of ["atom-link", "nav", "card", "text", "divider", "custom"]) {
  ok(new RegExp('kind: "' + kind + '"').test(src), "WidgetSpec 缺少 kind: " + kind);
}
ok(/deps\.resolveLayout\(deps\.loadLayoutItems\(o\)\)/.test(src), "迁移没有读真实布局（loadLayoutItems）——会抹掉用户自定义");

/* ⑧ 今日页接线（P0 下半单元）：持久化只走白板文档，不得再直接读写旧的布局/排序存储 */
const today = readFileSync("apps/desktop/src/pages/Today.tsx", "utf8");
ok(/const \[doc, setDoc\] = useState<BoardDoc>\(\(\) => loadBoard\(\)\)/.test(today), "今日页没有从白板文档取初始状态");
ok(/const layout = useMemo\(/.test(today) && /cellsToLayout\(cellsOf\(/.test(today), "今日页布局没有由文档派生");
ok(/const setLayout = useCallback/.test(today) && /layoutToCells\(next\)/.test(today), "今日页写回没有经过白板文档（setLayout 包装）");
ok(!/saveLayout\(/.test(today) && !/loadLayout\(/.test(today), "今日页仍在直接读写旧的布局存储（P0 后应只走白板文档）");
ok(!/saveHomeOrder\(/.test(today) && !/loadHomeOrder\(/.test(today), "今日页仍在直接读写旧的排序存储（P0 后应只走白板文档）");
ok(/saveBoard\(doc\)/.test(today), "今日页没有把文档落盘");

/* ⑨ px 自由图层字段（2026-10-15）：BoardItem 增加**可选** rect —— 一块板一份数据，
   格（cell）保持原样当插件/OH 契约，px（rect）是自由画布的摆放；两者必须能双向迁移。 */
const cellOf = (x, y, w, h) => ({ x, y, w, h });
const CELLS = [
  cellOf(0, 0, 4, 1), cellOf(0, 0, 1, 8), cellOf(3, 0, 1, 1), cellOf(1, 2, 2, 3),
  cellOf(0, 12, 3, 2), cellOf(2, 5, 2, 1),
];
for (const c of CELLS) {
  const r = B.rectFromCell(c);
  const back = B.cellFromRect(r);
  ok(JSON.stringify(back) === JSON.stringify(c), "格→px→格 往返不相等：" + JSON.stringify(c) + " → " + JSON.stringify(r) + " → " + JSON.stringify(back));
  ok(r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0, "迁移出的 px 矩形非法：" + JSON.stringify(r));
  ok(B.isRect(r), "rectFromCell 的结果必须通过 isRect（宽度下限）");
}
/* 迁移基准画布：4 个基准单位 + 两侧内边距正好铺满参考画布宽（多一列就出画布了）。 */
const full = B.rectFromCell(cellOf(0, 0, B.BOARD_COLS, 1));
ok(full.x === B.BOARD_PAD && full.x + full.w === B.CANVAS_REF_W - B.BOARD_PAD, "满宽条目应左右内边距对称铺满参考画布（实际 " + full.x + ".." + (full.x + full.w) + "，参考宽 " + B.CANVAS_REF_W + "）");
ok(B.CANVAS_REF_W === B.BOARD_PAD * 2 + B.TILE_W * B.BOARD_COLS + B.TILE_GAP * (B.BOARD_COLS - 1), "参考画布宽与瓦片宽/间距不自洽（改一边会静默错位）");
/* 网格不重叠 → 迁移出的 px 也不重叠（旧板的观感必须原样搬到自由画布上）。 */
const grid = [cellOf(0, 0, 3, 1), cellOf(3, 0, 1, 1), cellOf(0, 1, 4, 2)];
const rects = grid.map((c) => B.rectFromCell(c));
const hitRect = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
ok(!rects.some((a, i) => rects.some((b, j) => i !== j && hitRect(a, b))), "格不重叠但迁移出的 px 重叠了");
/* px → 格：越界必须夹回列内（宽不得越界），高度不得小于 1。 */
const wideCell = B.cellFromRect({ x: 0, y: 0, w: 9999, h: 9999 });
ok(wideCell.w === B.BOARD_COLS && wideCell.x === 0, "超宽矩形没有夹到列数内（实际 w=" + wideCell.w + " x=" + wideCell.x + "）");
const rightCell = B.cellFromRect({ x: 9999, y: 0, w: 200, h: 88 });
ok(rightCell.x === B.BOARD_COLS - rightCell.w, "右侧越界的矩形没有夹回画布内（实际 x=" + rightCell.x + "）");
ok(B.cellFromRect({ x: -50, y: -50, w: 200, h: 88 }).x === 0 && B.cellFromRect({ x: -50, y: -50, w: 200, h: 88 }).y === 0, "负坐标没有夹到 0");
const tiny = B.cellFromRect({ x: 0, y: 0, w: 1, h: 1 });
ok(tiny.w === 1 && tiny.h === 1, "小于一格的矩形应夹成 1x1（实际 " + tiny.w + "x" + tiny.h + "）");
/* 缺省即迁移：没存过 rect 的条目由格算出 px（只算不写），存过的原样返回。 */
const noRect = { id: "a", spec: { kind: "divider" }, cell: cellOf(0, 0, 2, 1) };
ok(JSON.stringify(B.rectOf(noRect)) === JSON.stringify(B.rectFromCell(noRect.cell)), "rectOf 没有对「没存过」的条目做格→px 迁移");
ok(B.rectOf(noRect) !== noRect.rect && noRect.rect === undefined, "rectOf 不该写回条目（迁移是只读的）");
const stored = { id: "b", spec: { kind: "divider" }, cell: cellOf(0, 0, 2, 1), rect: { x: 40, y: 44, w: 222, h: 96 } };
ok(JSON.stringify(B.rectOf(stored)) === JSON.stringify(stored.rect), "rectOf 应优先用存过的 px 矩形（用户的摆放不能被格覆盖）");
/* 写回：rect 记 px，cell 同步派生，并打 manual（用户自由摆过的条目不再被自动拟合改回去）。 */
const written = B.withRect(noRect, { x: 40.4, y: 44.6, w: 222.2, h: 96.8 }, B.BOARD_COLS);
ok(written.rect.x === 40 && written.rect.y === 45 && written.rect.w === 222 && written.rect.h === 97, "withRect 没有取整写入 px（实际 " + JSON.stringify(written.rect) + "）");
ok(B.isCell(written.cell) && written.cell.w >= 1 && written.cell.h >= 1, "withRect 没有同步派生合法 cell（插件/OH 契约读的是它）");
ok(written.manual === true, "自由摆放没有打 manual 标记");
const shrunk = B.withRect(noRect, { x: 0, y: 0, w: 10, h: 10 });
ok(shrunk.rect.w === B.RECT_MIN_W && shrunk.rect.h === B.RECT_MIN_H, "withRect 没有夹到 px 缩放下限（实际 " + shrunk.rect.w + "x" + shrunk.rect.h + "）");
ok(JSON.stringify(B.cellFromRect(B.rectOf(written))) === JSON.stringify(written.cell), "写回后 cell 与 rect 仍不同源（应互为派生）");
/* 解析容错：坏 rect 只回落成「没存过」，不可牵连整份文档；cell 仍严格。 */
const docRect = (rect) => JSON.stringify({ v: 1, order: {}, activeBoardId: "b", boards: [{ id: "b", name: "n", icon: "i", kind: "user", cells: { portrait: [{ id: "a", spec: { kind: "divider" }, cell: { x: 0, y: 0, w: 2, h: 1 }, rect }] } }] });
for (const bad of [{ x: 0, y: 0, w: 0, h: 88 }, { x: "3", y: 0, w: 200, h: 88 }, { x: 0, y: 0, w: Number.NaN, h: 88 }, { x: 0, y: 0, w: 200 }, { x: 0, y: 0, w: -200, h: 88 }]) {
  const parsed = B.parseBoard(docRect(bad));
  ok(!!parsed, "坏 rect 让整份文档回落 null（应只丢这个派生字段）：" + JSON.stringify(bad));
  ok(parsed && parsed.boards[0].cells.portrait[0].rect === undefined, "坏 rect 没有被丢掉：" + JSON.stringify(bad));
}
const goodParsed = B.parseBoard(docRect({ x: 8, y: 0, w: 200, h: 88 }));
ok(goodParsed && JSON.stringify(goodParsed.boards[0].cells.portrait[0].rect) === JSON.stringify({ x: 8, y: 0, w: 200, h: 88 }), "合法 rect 必须原样保留（解析不能顺手改用户的摆放）");
ok(goodParsed && goodParsed.boards[0].cells.portrait[0].cell.w === 2, "清理派生字段时动到了 cell");
/* 透明度 / 折叠态：自由层的两个附加字段也要能存读。 */
const extra = B.parseBoard(JSON.stringify({ v: 1, order: {}, activeBoardId: "b", boards: [{ id: "b", name: "n", icon: "i", kind: "user", cells: { portrait: [{ id: "a", spec: { kind: "divider" }, cell: { x: 0, y: 0, w: 2, h: 1 }, rect: { x: 8, y: 0, w: 200, h: 88 }, folded: true, opacity: 0.5 }] } }] }));
ok(!!extra && extra.boards[0].cells.portrait[0].folded === true && extra.boards[0].cells.portrait[0].opacity === 0.5, "自由层的折叠/透明度字段没有存读");
const clamped = B.parseBoard(JSON.stringify({ v: 1, order: {}, activeBoardId: "b", boards: [{ id: "b", name: "n", icon: "i", kind: "user", cells: { portrait: [{ id: "a", spec: { kind: "divider" }, cell: { x: 0, y: 0, w: 2, h: 1 }, opacity: 9 }] } }] }));
ok(!!clamped && clamped.boards[0].cells.portrait[0].opacity === 1, "透明度没有夹到 0.25~1（实际 " + (clamped && clamped.boards[0].cells.portrait[0].opacity) + "）");

if (fails.length) {
  console.error("白板文档护栏（P0）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("白板文档护栏（P0）：解析严格性 ✓ ｜ 迁移读真实布局并保位次/折叠 ✓ ｜ 幂等 ✓ ｜ 往返含 off ✓ ｜ 跨朝向回落 ✓ ｜ 落盘与排序 ✓ ｜ 规格齐全 ✓ ｜ 格↔px 双向迁移与容错 ✓");
