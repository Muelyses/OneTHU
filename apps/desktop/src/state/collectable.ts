/**
 * 收藏动作核心（P1 纯逻辑）：把「某个组件被收藏」换算成「白板文档该怎么变」。
 *
 * 方案：docs/原子收藏-可行性与实现方案.md §4（元素级收藏）与 §6.2（落位与让位）。
 * 规则：新条目从左上起找第一处不与既有重叠的落点；重叠时被压到的条目**向下推**（霖 2026-10-09 定案）。
 */
import {
  BOARD_COLS, type Board, type BoardCell, type BoardDoc, type BoardItem, type WidgetSpec,
} from "./boardCore.js";
import { clampSize, defForSpec, widgetById, type WidgetDef, type WidgetSize } from "./widgetMeta.js";

export function overlaps(a: BoardCell, b: BoardCell): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 从左上角起逐行扫描，找第一处不与既有条目重叠、且不越出列宽的落点。 */
export function findFreeCell(items: readonly BoardItem[], size: WidgetSize, cols: number = BOARD_COLS): BoardCell {
  const w = Math.min(Math.max(1, Math.round(size.w)), cols);
  const h = Math.max(1, Math.round(size.h));
  for (let y = 0; y < 1000; y += 1) {
    for (let x = 0; x + w <= cols; x += 1) {
      const cand: BoardCell = { x, y, w, h };
      if (!items.some((it) => overlaps(cand, it.cell))) return cand;
    }
  }
  return { x: 0, y: 1000, w, h };
}

/**
 * 让位：把被落点压到的条目依次向下推，直到**任意两项之间都不再重叠**。
 *
 * 旧实现只解决「与落点重叠」：落点高 2 时，原本在 y=1 与 y=2 的两项会被同时推到 y=2，
 * 于是它们彼此叠在一起（霖 2026-10-10 报的「偶尔多个组件重叠」）。
 * 现在按 y 升序逐项落位，每项都与「落点 + 已落位项」比较，遇到重叠就落到对方下方。
 * 返回数组保持传入顺序（渲染顺序由它决定）。
 */
export function pushDown(items: readonly BoardItem[], placed: BoardCell): BoardItem[] {
  const out = items.map((it) => ({ ...it, cell: { ...it.cell } }));
  const occupied: BoardCell[] = [placed];
  for (const it of out.slice().sort((a, b) => a.cell.y - b.cell.y)) {
    let y = it.cell.y;
    for (let guard = 0; guard < 200; guard += 1) {
      const hit = occupied.find((o) => overlaps({ ...it.cell, y }, o));
      if (!hit) break;
      y = hit.y + hit.h;
    }
    it.cell = { ...it.cell, y };
    occupied.push(it.cell);
  }
  return out;
}

/** 是否已经在板上（同一个 spec 视为同一组件，避免重复收藏）。 */
export function alreadyCollected(board: Board, spec: WidgetSpec): boolean {
  const key = JSON.stringify(spec);
  return Object.values(board.cells).some((list) => (list ?? []).some((it) => JSON.stringify(it.spec) === key));
}

export type CollectReason = "unknown-widget" | "duplicate" | "no-board";

export interface CollectResult {
  doc: BoardDoc;
  added: BoardItem | null;
  reason?: CollectReason;
}

/** 把 spec 收进白板：未知组件拒绝、重复收藏拒绝、缺系统板拒绝；成功则返回新文档与新条目。 */
export function collectInto(
  doc: BoardDoc,
  spec: WidgetSpec,
  appDefs: readonly WidgetDef[] = [],
  boardId?: string,
): CollectResult {
  const target = boardId
    ? doc.boards.find((b) => b.id === boardId)
    : doc.boards.find((b) => b.id === doc.activeBoardId) ?? doc.boards[0];
  if (!target) return { doc, added: null, reason: "no-board" };
  if (alreadyCollected(target, spec)) return { doc, added: null, reason: "duplicate" };

  const def = defForSpec(spec, appDefs);
  /* 卡片与页面自带组件必须有目录条目（否则渲染层只会画空态，收藏没有意义）。 */
  if (!def && (spec.kind === "card" || spec.kind === "custom")) {
    return { doc, added: null, reason: "unknown-widget" };
  }
  const size = def ? clampSize(def, def.defaultSize) : { w: 2, h: 1 };

  const orient = Object.keys(target.cells)[0] as "portrait" | "landscape" | undefined;
  if (!orient) return { doc, added: null, reason: "no-board" };
  const items = target.cells[orient] ?? [];
  const cell = findFreeCell(items, size);
  const item: BoardItem = { id: "it." + spec.kind + "." + Date.now().toString(36), spec, cell };
  const nextCells = { ...target.cells, [orient]: [...pushDown(items, cell), item] };
  const nextDoc: BoardDoc = { ...doc, boards: doc.boards.map((b) => (b.id === target.id ? { ...b, cells: nextCells } : b)) };
  return { doc: nextDoc, added: item };
}
