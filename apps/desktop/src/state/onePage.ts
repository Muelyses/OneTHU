/**
 * OnePage（白板化）共享数据层。
 *
 * 2026-10-13 定案：OnePage 的本体 = 一块白板（BoardDoc.boards 里的一块 board），
 * 不再是旧收藏体系（favorites/favs）里的 folder。旧 folder 数据保留在原存储里
 * 不迁移不删除（用户没发话之前不动数据），只是所有**新建/入口**全部切到白板。
 *
 * 一个 OnePage 里收的内容 = `atom-link` 组件（PR 55 设计：atoms.tsx 的引用式书签
 * 以 widget 形态活在白板上），一颗星 = 建一块只含该原子入口的板，用户随后可自由
 * 加组件、摆位、改大小——这才是「独立的白板页」而不是「一个书签列表」。
 */
import {
  createBoard,
  deleteBoard,
  setActiveBoard,
} from "./boardOps.js";
import { loadBoard, saveBoard } from "./board.js";
import type { Board, BoardDoc } from "./boardCore.js";

/** 通知板文档变了（Today/BoardPage/OneGO 都听这个事件重读） */
export function notifyBoardsChanged(): void {
  try {
    window.dispatchEvent(new Event("onethu.boards.changed"));
  } catch {
    /* 非浏览器环境（node 护栏）静默 */
  }
}

/** 读 + 改 + 存 + 通知 的一条龙：mutate 返回新文档（或 null 表示放弃） */
export function mutateBoards(mutate: (doc: BoardDoc) => BoardDoc | null): BoardDoc | null {
  const doc = loadBoard();
  const next = mutate(doc);
  if (!next || next === doc) return null;
  saveBoard(next);
  notifyBoardsChanged();
  return next;
}

/** 找包含某原子入口的 OnePage（星标点亮判定 + 移除定位） */
export function onePagesWithAtom(key: string): Board[] {
  return loadBoard().boards.filter((b) =>
    Object.values(b.cells).some((items) =>
      (items ?? []).some((it) => it.spec.kind === "atom-link" && it.spec.ref === key),
    ),
  );
}

/**
 * 收一颗原子为独立 OnePage：新建一块板，第一格里放它的 atom-link 入口。
 * 返回新板 id（调用方据此打开/点亮星标）。
 */
export function createOnePageForAtom(name: string, atomKey: string, icon = "fist"): string {
  let id = "";
  mutateBoards((doc) => {
    const r = createBoard(doc, name, icon);
    id = r.board.id;
    const board = r.board;
    const items = board.cells.portrait ?? [];
    board.cells.portrait = [
      ...items,
      {
        id: "it." + Date.now().toString(36),
        spec: { kind: "atom-link", ref: atomKey },
        cell: { x: 0, y: 0, w: 2, h: 1 },
      },
    ];
    return r.doc;
  });
  return id;
}

/** 删除一块 OnePage（系统板由 deleteBoard 自己拦） */
export function removeOnePage(boardId: string): string | undefined {
  let reason: string | undefined;
  mutateBoards((doc) => {
    const r = deleteBoard(doc, boardId);
    reason = r.reason;
    return r.doc;
  });
  return reason;
}

/** 重命名（OneGO 行内改名单用） */
export function renameOnePage(boardId: string, name: string): void {
  mutateBoards((doc) => {
    const b = doc.boards.find((x) => x.id === boardId);
    if (!b) return null;
    return {
      ...doc,
      boards: doc.boards.map((x) => (x.id === boardId ? { ...x, name: name.trim() || x.name } : x)),
    };
  });
}

/** 新建一块空 OnePage，返回板 id */
export function createOnePage(name: string, icon = "star"): string {
  let id = "";
  mutateBoards((doc) => {
    const r = createBoard(doc, name, icon);
    id = r.board.id;
    return r.doc;
  });
  return id;
}

/** 打开一块 OnePage：设为当前板（白板页渲染的就是当前板）+ 通知 */
export function openOnePage(boardId: string): void {
  mutateBoards((doc) => setActiveBoard(doc, boardId));
}

/** 全部 OnePage（按文档顺序） */
export function allOnePages(): Board[] {
  return loadBoard().boards;
}
