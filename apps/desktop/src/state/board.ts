/**
 * 白板文档（应用侧）：把今日页的布局、排序与卡片注册表接进 core。
 * 纯模型、解析、迁移与读写都在 state/boardCore.ts（依赖注入，node 护栏可真实驱动）。
 *
 * 方案：docs/原子收藏-可行性与实现方案.md §3 / §6.1。
 */
import { HOME_CARD_META, loadLayout, resolveLayout } from "../lib/homeCards.js";
import { loadHomeOrder, saveHomeOrder } from "./homeOrder.js";
import {
  BOARD_KEY, cellsOf, loadBoard as coreLoadBoard, saveBoard as coreSaveBoard, systemBoard,
  type Board, type BoardDeps, type BoardDoc, type Orientation,
} from "./boardCore.js";

export {
  BOARD_COLS, BOARD_KEY, EMPTY_BOARD, MAIN_W, SYSTEM_BOARD_ID, TILE_GAP, TILE_H, activeBoard, cellsOf, cellsToLayout, isCell, isItem, isOrientation,
  layoutToCells, parseBoard, systemBoard,
} from "./boardCore.js";
export type { Board, BoardCell, BoardDoc, BoardItem, LayoutLike, Orientation, WidgetSpec } from "./boardCore.js";

/** 注入应用侧依赖：卡片注册表 + 今日页两套持久化。 */
export const boardDeps: BoardDeps = {
  knownIds: HOME_CARD_META.map((d) => String(d.id)),
  loadLayoutItems: (o) => loadLayout(o),
  resolveLayout: (saved) => resolveLayout(HOME_CARD_META, saved as Parameters<typeof resolveLayout>[1]),
  loadOrder: () => loadHomeOrder(),
  saveOrder: (s) => saveHomeOrder(s as ReturnType<typeof loadHomeOrder>),
};

/** 今日页的卡片 id 全集（cellsToLayout 补 off 用；也供页面侧对账）。 */
export const KNOWN_IDS: readonly string[] = boardDeps.knownIds;

/** 读文档（缺失或损坏则迁移一份并落盘；已在则原样返回）。 */
export function loadBoard(): BoardDoc {
  return coreLoadBoard(boardDeps);
}

export function saveBoard(doc: BoardDoc): void {
  coreSaveBoard(doc, boardDeps);
}

/** 渲染适配：系统板某朝向的单元格。 */
export function boardCellsFor(doc: BoardDoc, o: Orientation): Board["cells"][Orientation] {
  const board = systemBoard(doc);
  return board ? cellsOf(board, o) : [];
}
