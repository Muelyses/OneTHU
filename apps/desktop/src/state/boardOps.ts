/**
 * 多收藏夹操作（P2 纯逻辑）。方案：docs/原子收藏-可行性与实现方案.md §7.9。
 *
 * 列表 = BoardDoc.boards 的顺序；「作为今日页」= 写 activeBoardId；上移/下移 = 交换数组次序；
 * 删除 = 从数组移除（**系统板不可删**——「今日」必须一直在，否则用户没有可回退的主页）。
 */
import type { Board, BoardDoc } from "./boardCore.js";

export interface BoardSummary {
  id: string;
  name: string;
  icon: string;
  kind: "system" | "user";
  /** 组件数（取任一朝向的条目数；空板为 0）。 */
  count: number;
  active: boolean;
}

export function boardsOf(doc: BoardDoc): Board[] {
  return doc.boards;
}

export function boardSummary(doc: BoardDoc): BoardSummary[] {
  return doc.boards.map((b) => {
    const cells = b.cells.portrait ?? b.cells.landscape ?? [];
    return { id: b.id, name: b.name, icon: b.icon, kind: b.kind, count: cells.length, active: b.id === doc.activeBoardId };
  });
}

export function findBoard(doc: BoardDoc, boardId: string): Board | null {
  return doc.boards.find((b) => b.id === boardId) ?? null;
}

/** 新建收藏夹（用户板）。名称与图标由调用方给，这里只保证 id 唯一与结构完整。 */
export function createBoard(doc: BoardDoc, name: string, icon = "star"): { doc: BoardDoc; board: Board } {
  const base = "board.user." + Date.now().toString(36);
  let id = base;
  let n = 1;
  while (doc.boards.some((b) => b.id === id)) {
    id = base + "." + String(n);
    n += 1;
  }
  const board: Board = { id, name: name.trim() || "新收藏夹", icon, kind: "user", cells: { portrait: [] } };
  return { doc: { ...doc, boards: [...doc.boards, board] }, board };
}

/** 设为当前主页（「作为今日页」）。 */
export function setActiveBoard(doc: BoardDoc, boardId: string): BoardDoc {
  if (!doc.boards.some((b) => b.id === boardId)) return doc;
  return { ...doc, activeBoardId: boardId };
}

/** 上移/下移：与相邻项交换。已在端点则原样返回（同一引用）。 */
export function moveBoard(doc: BoardDoc, boardId: string, dir: "up" | "down"): BoardDoc {
  const i = doc.boards.findIndex((b) => b.id === boardId);
  if (i < 0) return doc;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= doc.boards.length) return doc;
  const next = [...doc.boards];
  const a = next[i];
  const b = next[j];
  if (!a || !b) return doc;
  next[i] = b;
  next[j] = a;
  return { ...doc, boards: next };
}

export type DeleteReason = "system-board" | "not-found" | "last-board";

/** 删除用户收藏夹。系统板、最后一块板都不许删（删掉就没有主页了）。 */
export function deleteBoard(doc: BoardDoc, boardId: string): { doc: BoardDoc; reason?: DeleteReason } {
  const board = doc.boards.find((b) => b.id === boardId);
  if (!board) return { doc, reason: "not-found" };
  if (board.kind === "system") return { doc, reason: "system-board" };
  if (doc.boards.length <= 1) return { doc, reason: "last-board" };
  const boards = doc.boards.filter((b) => b.id !== boardId);
  const activeBoardId = doc.activeBoardId === boardId ? (boards.find((b) => b.kind === "system") ?? boards[0])?.id ?? doc.activeBoardId : doc.activeBoardId;
  return { doc: { ...doc, boards, activeBoardId } };
}

/** 重命名与换图标（列表页长按菜单与「编辑导航栏」都会用）。 */
export function renameBoard(doc: BoardDoc, boardId: string, name: string, icon?: string): BoardDoc {
  return {
    ...doc,
    boards: doc.boards.map((b) => (b.id === boardId ? { ...b, name: name.trim() || b.name, icon: icon ?? b.icon } : b)),
  };
}
