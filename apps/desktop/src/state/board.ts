/**
 * 白板文档（应用侧）：把今日页的布局、排序与卡片注册表接进 core。
 * 纯模型、解析、迁移与读写都在 state/boardCore.ts（依赖注入，node 护栏可真实驱动）。
 *
 * 方案：docs/原子收藏-可行性与实现方案.md §3 / §6.1。
 */
import { HOME_CARD_META, clearHomeLayout, loadLayout, resolveLayout } from "../lib/homeCards.js";
import { loadHomeOrder, saveHomeOrder } from "./homeOrder.js";
import { boardViewKey, setView } from "./boardView.js";
import {
  BOARD_KEY, SYSTEM_BOARD_ID, cellsOf, homeStarterItems, loadBoard as coreLoadBoard, saveBoard as coreSaveBoard, systemBoard,
  type Board, type BoardDeps, type BoardDoc, type Orientation,
} from "./boardCore.js";

export {
  BOARD_COLS, BOARD_PAD, BOARD_KEY, CANVAS_REF_W, EMPTY_BOARD, MAIN_W, RECT_MIN_H, RECT_MIN_W, SYSTEM_BOARD_ID,
  TILE_GAP, TILE_H, TILE_W, activeBoard, cellFromRect, cellsOf, cellsToLayout, isCell, isItem, isOrientation, isRect,
  layoutToCells, parseBoard, rectFromCell, rectOf, systemBoard, withRect,
} from "./boardCore.js";
export type { Board, BoardCell, BoardDoc, BoardItem, BoardRect, LayoutLike, Orientation, WidgetSpec } from "./boardCore.js";

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

/** 仅显式恢复默认首页才发；普通存档/拖动不能重置画布的缩放或参考宽度。 */
export const HOME_BOARD_RESET_EVENT = "onethu.home-board.reset";

/** 恢复真实系统白板；用户 OnePage、当前板选择和排序偏好保持原样。 */
export function resetHomeBoard(): void {
  const doc = loadBoard();
  clearHomeLayout();
  saveBoard({
    ...doc,
    homeLayoutVersion: 2,
    boards: doc.boards.map(board => board.id === SYSTEM_BOARD_ID ? {
      ...board,
      cells: { portrait: homeStarterItems(), landscape: homeStarterItems() },
    } : board),
  });
  // 未进过首页时也能从设置重置：旧自由板留作回退资料，不能随后再合并回默认首页。
  try { globalThis.localStorage?.setItem("onethu.freeboard.merged.v1", "1"); } catch { /* 存储不可用 */ }
  for (const orientation of ["portrait", "landscape"]) {
    const key = boardViewKey(SYSTEM_BOARD_ID, orientation);
    setView(key, { z: 1 });
    setView(key + "|phone", { z: 1 });
  }
  try {
    globalThis.dispatchEvent?.(new Event("onethu.boards.changed"));
    globalThis.dispatchEvent?.(new Event(HOME_BOARD_RESET_EVENT));
  } catch { /* 非浏览器环境 */ }
}

/** 渲染适配：系统板某朝向的单元格。 */
export function boardCellsFor(doc: BoardDoc, o: Orientation): Board["cells"][Orientation] {
  const board = systemBoard(doc);
  return board ? cellsOf(board, o) : [];
}
