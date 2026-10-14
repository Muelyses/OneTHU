/**
 * 白板文档核心（纯逻辑 + 依赖注入，不依赖任何视图模块）。
 *
 * 与 state/board.ts 的分工：本文件管「模型 / 解析 / 单元格换算 / 迁移与读写（依赖注入）」，
 * 能被 node 护栏直接加载并真实测试；board.ts 负责把今日页的布局、排序与卡片注册表接进来。
 * 这样拆是硬约束使然：注册表 import 了 .tsx 图标，而 node 不能剥离 JSX。
 *
 * 方案：docs/原子收藏-可行性与实现方案.md §3 / §6.1。
 */
export const BOARD_KEY = "onethu.board.v1";
export const SYSTEM_BOARD_ID = "board.today";
/** 基准列数：手机 4 列（PC 宽窗按 §6.1 折算为 8 列，即 1 基准单位 = 2 列）。 */
/** 窄屏（手机）列数：基准单位就是它，文档里的 x/w 都以此为单位。 */
export const BOARD_COLS = 4;
/** 宽屏（平板 / PC 宽窗）列数：同一份文档在宽屏上占满需要 8 个基准单位。 */
export const BOARD_COLS_WIDE = 8;
/** 宽窄屏分界（px）：与仓库既有断点一致（§2.8.2 的 PC 阈值）。 */
export const BOARD_WIDE_MIN = 840;

/**
 * 视口宽度 → 列数（霖 2026-10-11：按宽窄屏适配，不是按平台；为安卓平板而来）。
 *
 * 口径：**基准单位不变**（1 单位 = 手机 1 列）。所以手机 4 列占满、平板 8 列占满，
 * 同一份文档两种宽度都读得通——手机上 `w=4` 是整宽，平板上是半宽、一行能放两张。
 */
export function colsForWidth(width: number): number {
  return width >= BOARD_WIDE_MIN ? BOARD_COLS_WIDE : BOARD_COLS;
}
/**
 * 基准瓦片高（px）：画布行高固定为它，高度单位因此有确定含义（霖 2026-10-10 定）。
 * 必须与 global.css 的 .board-canvas grid-auto-rows 一致——护栏会比对两处，避免各改一边。
 */
export const TILE_H = 88;
/** 行间距（与 CSS gap 一致）。 */
export const TILE_GAP = 8;

/** main 栏占 3 基准单位、rail 占 1：与今日页现状的两栏比例同构。 */
export const MAIN_W = 3;

export type Orientation = "portrait" | "landscape";

export type WidgetSpec =
  | { kind: "atom-link"; ref: string }
  | { kind: "nav"; page: string; params?: unknown; label?: string }
  | { kind: "card"; card: string }
  | { kind: "text"; text: string; variant: "label" | "title" }
  | { kind: "divider" }
  | { kind: "custom"; id: string; props?: Record<string, unknown> };

export interface BoardCell { x: number; y: number; w: number; h: number }

export interface BoardItem {
  /** 用户手动设过尺寸：拟合（按内容自动调高矮）必须跳过它，否则退出编辑态就被改回去。 */
  manual?: boolean;
  id: string;
  spec: WidgetSpec;
  cell: BoardCell;
  collapsed?: boolean;
  pinned?: boolean;
  props?: Record<string, unknown>;
}

export interface Board {
  id: string;
  name: string;
  icon: string;
  kind: "system" | "user";
  /** 按朝向各存一份；landscape 缺省时由 portrait 回落（§6.1）。 */
  cells: Partial<Record<Orientation, BoardItem[]>>;
}

export interface BoardDoc {
  v: 1;
  boards: Board[];
  activeBoardId: string;
  /** 今日页的排序模式（auto / manual），随文档一起走。 */
  order: unknown;
}

export interface LayoutLike { id: string; col: "main" | "rail" | "off"; collapsed: boolean }

/** 应用侧注入的依赖：注册表与持久化。核心因此可以被 node 护栏真实驱动。 */
export interface BoardDeps {
  knownIds: readonly string[];
  loadLayoutItems: (o: Orientation) => LayoutLike[] | null;
  resolveLayout: (saved: LayoutLike[] | null) => LayoutLike[];
  loadOrder: () => unknown;
  saveOrder: (s: unknown) => void;
  storage?: { getItem(k: string): string | null; setItem(k: string, v: string): void };
}

/** 空板常量：系统板缺失时的渲染兜底（正常路径不会走到）。 */
export const EMPTY_BOARD: Board = { id: "", name: "", icon: "", kind: "user", cells: {} };

export function isOrientation(x: unknown): x is Orientation {
  return x === "portrait" || x === "landscape";
}

export function isCell(x: unknown): x is BoardCell {
  const c = x as BoardCell | null;
  return !!c && [c.x, c.y, c.w, c.h].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) && c.w >= 1;
}

export function isItem(x: unknown): x is BoardItem {
  const it = x as BoardItem | null;
  return !!it && typeof it.id === "string" && typeof it.spec === "object" && it.spec !== null && isCell(it.cell);
}

/** 解析：任何一处不合法都回落 null（由调用方决定默认值），绝不半信半疑地渲染。 */
export function parseBoard(raw: string | null): BoardDoc | null {
  if (!raw) return null;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  const d = obj as BoardDoc | null;
  if (!d || d.v !== 1 || !Array.isArray(d.boards) || d.boards.length === 0) return null;
  for (const b of d.boards) {
    if (!b || typeof b.id !== "string" || typeof b.name !== "string" || (b.kind !== "system" && b.kind !== "user")) return null;
    if (!b.cells || typeof b.cells !== "object") return null;
    for (const key of Object.keys(b.cells)) {
      if (!isOrientation(key)) return null;
      const list = (b.cells as Record<string, unknown>)[key];
      if (!Array.isArray(list) || !list.every(isItem)) return null;
    }
  }
  if (typeof d.activeBoardId !== "string") return null;
  if (!d.boards.some((b) => b.id === d.activeBoardId)) return null;
  if (!d.order || typeof d.order !== "object") return null;
  return d;
}

/** 今日页布局 → 单元格（main 占左 3 单位、rail 占右 1 单位；y = 栏内序）。 */
export function layoutToCells(items: readonly LayoutLike[]): BoardItem[] {
  const main = items.filter((i) => i.col === "main");
  const rail = items.filter((i) => i.col === "rail");
  const out: BoardItem[] = [];
  main.forEach((i, y) => out.push({ id: "today." + i.id, spec: { kind: "custom", id: i.id }, cell: { x: 0, y, w: MAIN_W, h: 1 }, collapsed: i.collapsed }));
  rail.forEach((i, y) => out.push({ id: "today." + i.id, spec: { kind: "custom", id: i.id }, cell: { x: MAIN_W, y, w: BOARD_COLS - MAIN_W, h: 1 }, collapsed: i.collapsed }));
  return out;
}

/** 单元格 → 今日页布局（含 off：knownIds 里存在但不在板上的卡，保持既有下游语义）。 */
export function cellsToLayout(items: readonly BoardItem[], knownIds: readonly string[]): LayoutLike[] {
  const seen = new Set<string>();
  const out: LayoutLike[] = [];
  for (const it of items) {
    if (it.spec.kind !== "custom") continue;
    const id = it.spec.id;
    seen.add(id);
    out.push({ id, col: it.cell.x >= MAIN_W ? "rail" : "main", collapsed: it.collapsed === true });
  }
  for (const id of knownIds) {
    if (!seen.has(id)) out.push({ id, col: "off", collapsed: false });
  }
  return out;
}

/** 取某朝向的单元格；缺省回落到 portrait（§6.1 的比例映射在实现前先做直通）。 */
export function cellsOf(board: Board, o: Orientation): BoardItem[] {
  return board.cells[o] ?? board.cells.portrait ?? [];
}

/** 由现状生成系统板。**迁移必须读真实存储的布局**（按朝向各一份），否则会抹掉用户自定义。 */
export function buildSystemBoard(deps: BoardDeps): Board {
  const cells: Board["cells"] = {};
  for (const o of ["portrait", "landscape"] as const) {
    cells[o] = layoutToCells(deps.resolveLayout(deps.loadLayoutItems(o)));
  }
  return { id: SYSTEM_BOARD_ID, name: "首页", icon: "today", kind: "system", cells };
}

export function defaultBoardDoc(deps: BoardDeps): BoardDoc {
  const board = buildSystemBoard(deps);
  return { v: 1, boards: [board], activeBoardId: board.id, order: deps.loadOrder() };
}

/** 读文档：缺失或损坏 → 迁移一份并落盘；文档已在则**原样返回**（幂等）。 */
export function loadBoard(deps: BoardDeps): BoardDoc {
  const store = deps.storage ?? globalThis.localStorage;
  const parsed = parseBoard(store?.getItem(BOARD_KEY) ?? null);
  if (parsed) return parsed;
  const fresh = defaultBoardDoc(deps);
  saveBoard(fresh, deps);
  return fresh;
}

export function saveBoard(doc: BoardDoc, deps: BoardDeps): void {
  try {
    (deps.storage ?? globalThis.localStorage)?.setItem(BOARD_KEY, JSON.stringify(doc));
    if (doc.order && typeof doc.order === "object") deps.saveOrder(doc.order);
  } catch {
    /* 存储失败（配额/隐私模式）：保持内存态可用，由调用方决定是否提示 */
  }
}

export function systemBoard(doc: BoardDoc): Board | null {
  return doc.boards.find((b) => b.kind === "system") ?? null;
}

/**
 * 当前应渲染的板：优先 activeBoardId 指向的那块（用户在收藏夹列表里选的就是它），
 * 缺了才回落到系统板。写死 systemBoard 会让用户板永远打不开（本轮实测踩过）。
 */
export function activeBoard(doc: BoardDoc): Board | null {
  return doc.boards.find((b) => b.id === doc.activeBoardId) ?? systemBoard(doc);
}
