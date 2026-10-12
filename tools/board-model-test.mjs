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

if (fails.length) {
  console.error("白板文档护栏（P0）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("白板文档护栏（P0）：解析严格性 ✓ ｜ 迁移读真实布局并保位次/折叠 ✓ ｜ 幂等 ✓ ｜ 往返含 off ✓ ｜ 跨朝向回落 ✓ ｜ 落盘与排序 ✓ ｜ 规格齐全 ✓");
