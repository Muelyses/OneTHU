/**
 * 白板编辑操作（P1 纯逻辑）：编辑模式下的每一次改动都是「文档进 → 文档出」。
 *
 * 方案：docs/原子收藏-可行性与实现方案.md §6.2 / §6.3 / §6.6。
 * 全部纯函数、不可变更新，便于 node 护栏逐条驱动；UI 只负责把手指动作换算成这里的调用。
 *
 * 落位规则（霖 2026-10-09 定案）：组件落在**目标格**，不向上补齐；只处理重叠——被压到的向下推。
 */
import { BOARD_COLS, MAIN_W, type BoardDoc, type BoardItem, type WidgetSpec } from "./boardCore.js";
import { reflowForMove } from "./boardReflow.js";
import { findFreeCell, overlaps, pushDown } from "./collectable.js";
import { defForSpec, normalizeSize, type WidgetDef, type WidgetSize } from "./widgetMeta.js";

function withCells(
  doc: BoardDoc,
  boardId: string,
  ori: "portrait" | "landscape",
  cells: BoardItem[],
): BoardDoc {
  return {
    ...doc,
    boards: doc.boards.map((b) => (b.id === boardId ? { ...b, cells: { ...b.cells, [ori]: cells } } : b)),
  };
}

function cellsOf(doc: BoardDoc, boardId: string, ori: "portrait" | "landscape"): BoardItem[] {
  const board = doc.boards.find((b) => b.id === boardId);
  return board ? board.cells[ori] ?? board.cells.portrait ?? [] : [];
}

/** 移动：落在目标格（不补齐），越界的 x 夹回列内；被压到的条目向下推。 */
export function moveItem(doc: BoardDoc, boardId: string, ori: "portrait" | "landscape", itemId: string, to: { x: number; y: number }, cols: number = BOARD_COLS): BoardDoc {
  const items = cellsOf(doc, boardId, ori);
  const item = items.find((it) => it.id === itemId);
  if (!item) return doc;
  const x = Math.min(Math.max(0, Math.round(to.x)), Math.max(0, cols - item.cell.w));
  const y = Math.max(0, Math.round(to.y));
  /* 落库与预览共用同一套让位模型（boardReflow.reflowForMove）——否则预览与落点会不一致。
     reflowForMove 内部已做带 keep 的全局兜底（被拖项停在目标格，其余拆开重叠）。 */
  return withCells(doc, boardId, ori, reflowForMove(items, itemId, { x, y }));
}

/** 缩放：四边把手换算出的新尺寸，夹到该组件的 sizeRange 与列宽内。 */
export function resizeItem(doc: BoardDoc, boardId: string, ori: "portrait" | "landscape", itemId: string, size: WidgetSize, defs: readonly WidgetDef[] = [], cols: number = BOARD_COLS): BoardDoc {
  const items = cellsOf(doc, boardId, ori);
  const item = items.find((it) => it.id === itemId);
  if (!item) return doc;
  const def = defForSpec(item.spec, defs);
  const clamped = normalizeSize(def, size);
  const w = Math.min(clamped.w, cols - item.cell.x);
  const next: BoardItem = { ...item, cell: { ...item.cell, w: Math.max(1, w), h: clamped.h } };
  const others = items.filter((it) => it.id !== itemId);
  return withCells(doc, boardId, ori, [...pushDown(others, next.cell), next]);
}

/** 四边把手（需求原文：上下左右四个拖拽点）。 */
export type ResizeHandle = "n" | "s" | "e" | "w";

/**
 * 把手拖动 → 新单元格。北/西两个把手会**同时移动原点**（否则缩放会从左上角长出去）。
 * 宽高各不小于 1；x/y 不得为负（为负时把多出来的部分补给宽高，避免组件被推出画布）。
 */
export function cellFromResize(
  cell: { x: number; y: number; w: number; h: number },
  handle: ResizeHandle,
  dxPx: number,
  dyPx: number,
  colW: number,
  rowH: number,
  cols: number = BOARD_COLS,
): { x: number; y: number; w: number; h: number } {
  const dx = colW > 0 ? Math.round(dxPx / colW) : 0;
  const dy = rowH > 0 ? Math.round(dyPx / rowH) : 0;
  let x = cell.x;
  let y = cell.y;
  let w = cell.w;
  let h = cell.h;
  if (handle === "e") w = cell.w + dx;
  if (handle === "w") { x = cell.x + dx; w = cell.w - dx; }
  if (handle === "s") h = cell.h + dy;
  if (handle === "n") { y = cell.y + dy; h = cell.h - dy; }
  if (w < 1) { if (handle === "w") x = cell.x + cell.w - 1; w = 1; }
  if (h < 1) { if (handle === "n") y = cell.y + cell.h - 1; h = 1; }
  /* 西/北把手的不变式是「**对侧边缘固定**」：夹回边界时必须把宽度/高度按对侧重算，
     否则 w += x 会让宽度白白变小——表现就是「拖西把手，东侧边缘在收缩」（霖 2026-10-11 现场，
     条件是组件已在 x=0 或 y=0 时继续往左/上拖）。 */
  if (x < 0) {
    if (handle === "w") w = cell.x + cell.w;
    x = 0;
  }
  if (y < 0) {
    if (handle === "n") h = cell.y + cell.h;
    y = 0;
  }
  /* 列内夹取也放在这里：预览与落库同口径，否则拖动预览期间会画到板子外面去
     （落库那一步由 placeItem 再夹一次，两层都留着）。 */
  if (x > cols - 1) x = cols - 1;
  if (w > cols - x) w = cols - x;
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}

/**
 * 把某条目放到指定单元格（缩放与移动共用）：按 sizeRange 夹取宽高、夹回列内，
 * 被压到的条目向下推。返回新文档。
 */
export function placeItem(
  doc: BoardDoc,
  boardId: string,
  ori: "portrait" | "landscape",
  itemId: string,
  cell: { x: number; y: number; w: number; h: number },
  defs: readonly WidgetDef[] = [],
  opts?: { manual?: boolean },
  cols: number = BOARD_COLS,
): BoardDoc {
  const items = cellsOf(doc, boardId, ori);
  const item = items.find((it) => it.id === itemId);
  if (!item) return doc;
  const def = defForSpec(item.spec, defs);
  const clamped = normalizeSize(def, { w: cell.w, h: cell.h });
  const w = Math.max(1, Math.min(clamped.w, cols - Math.max(0, cell.x)));
  const next: BoardItem = { ...item, manual: opts?.manual ?? item.manual, cell: { x: Math.max(0, Math.min(cell.x, cols - w)), y: Math.max(0, cell.y), w, h: clamped.h } };
  const others = items.filter((it) => it.id !== itemId);
  return withCells(doc, boardId, ori, [...pushDown(others, next.cell), next]);
}

export function removeItem(doc: BoardDoc, boardId: string, ori: "portrait" | "landscape", itemId: string): BoardDoc {
  const items = cellsOf(doc, boardId, ori);
  if (!items.some((it) => it.id === itemId)) return doc;
  return withCells(doc, boardId, ori, items.filter((it) => it.id !== itemId));
}

/** 固定：正常模式下长按不进入快捷编辑（编辑模式中仍可长按）。 */
export function togglePin(doc: BoardDoc, boardId: string, ori: "portrait" | "landscape", itemId: string): BoardDoc {
  const items = cellsOf(doc, boardId, ori);
  if (!items.some((it) => it.id === itemId)) return doc;
  return withCells(doc, boardId, ori, items.map((it) => (it.id === itemId ? { ...it, pinned: !it.pinned } : it)));
}

/** 属性抽屉写回（文字内容等）。 */
export function setItemProps(doc: BoardDoc, boardId: string, ori: "portrait" | "landscape", itemId: string, props: Record<string, unknown>): BoardDoc {
  const items = cellsOf(doc, boardId, ori);
  const item = items.find((it) => it.id === itemId);
  if (!item) return doc;
  const spec: WidgetSpec = item.spec.kind === "text" && typeof props.text === "string"
    ? { ...item.spec, text: props.text }
    : item.spec;
  return withCells(doc, boardId, ori, items.map((it) => (it.id === itemId ? { ...it, spec, props: { ...it.props, ...props } } : it)));
}

export type AddResult = { doc: BoardDoc; added: BoardItem | null; reason?: "unknown-widget" | "duplicate" };

/**
 * 新增：找第一处空位落下（与收藏动作同一套落位规则）。
 *
 * `size` 是「添加组件」抽屉里选中的档位：传了就用它（并打上 manual，档位不再被任何自动逻辑改写）；
 * 不传则用目录里的 defaultSize。两者都过 normalizeSize：挡位控制吸附到档位，自由控制按 sizeRange 夹取。
 */
export function addItemTo(
  doc: BoardDoc,
  boardId: string,
  ori: "portrait" | "landscape",
  spec: WidgetSpec,
  defs: readonly WidgetDef[] = [],
  size?: WidgetSize,
): AddResult {
  const items = cellsOf(doc, boardId, ori);
  const key = JSON.stringify(spec);
  if (items.some((it) => JSON.stringify(it.spec) === key)) return { doc, added: null, reason: "duplicate" };
  const def = defForSpec(spec, defs);
  if (!def && (spec.kind === "card" || spec.kind === "custom")) return { doc, added: null, reason: "unknown-widget" };
  const wanted = size ?? (def ? def.defaultSize : { w: 2, h: 1 });
  const resolved = normalizeSize(def, wanted);
  const cell = findFreeCell(items, resolved);
  const item: BoardItem = { id: "it." + spec.kind + "." + Math.random().toString(36).slice(2, 8), spec, cell };
  if (size) item.manual = true;
  return { doc: withCells(doc, boardId, ori, [...pushDown(items, cell), item]), added: item };
}

/**
 * 按列重排、消除空隙：每列按数组顺序重新分配 y（0,1,2…）。
 *
 * 用途是「拟合」之后收尾——拟合会把装不下的项向下推，留下大片空行（实测 y 飘到 25/26/27）。
 * 只改 y，不改 x/w/h，也不改数组顺序（渲染顺序由数组决定）。
 */
/** 整块替换条目（套用模板用）：不动其它板，也不改数组以外的东西。 */
export function replaceCells(doc: BoardDoc, boardId: string, ori: "portrait" | "landscape", items: readonly BoardItem[]): BoardDoc {
  return withCells(doc, boardId, ori, [...items]);
}

export function repackBoard(doc: BoardDoc, boardId: string, ori: "portrait" | "landscape"): BoardDoc {
  return withCells(doc, boardId, ori, repackItems(cellsOf(doc, boardId, ori)));
}

export function repackItems(items: readonly BoardItem[]): BoardItem[] {
  const nextMain = { n: 0 };
  const nextRail = { n: 0 };
  return items.map((it) => {
    const bucket = it.cell.x >= MAIN_W ? nextRail : nextMain;
    const y = bucket.n;
    bucket.n += Math.max(1, it.cell.h);
    return { ...it, cell: { ...it.cell, y } };
  });
}

/** 板上是否已有该条目压住别人（编辑期自检与护栏用）。 */
export function hasOverlap(items: readonly BoardItem[]): boolean {
  for (let i = 0; i < items.length; i += 1) {
    const a = items[i];
    if (!a) continue;
    for (let j = i + 1; j < items.length; j += 1) {
      const b = items[j];
      if (!b) continue;
      if (overlaps(a.cell, b.cell)) return true;
    }
  }
  return false;
}
