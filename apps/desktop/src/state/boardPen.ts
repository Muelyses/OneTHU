/**
 * 白板画笔（2026-10-13，霖：白板上要能勾勒划线）。
 *
 * 刻意与白板文档（state/boardCore）分离：笔画存独立键（onethu.board.pen.v1），
 * 一来不惊动 board-model-test 的文档 schema 严格性护栏，二来「清空组件」不该连带
 * 擦掉手写批注（两者的生命周期本来就不同）。
 *
 * 坐标：点集存**画布百分比**（0..1000 的千分比整数，省体积也免浮点漂移），渲染时按
 * 画布实际尺寸换算——窗口宽窄变化时笔迹跟随内容缩放，不会错位。
 */

export interface PenStroke {
  id: string;
  color: string;
  w: number; // 线宽 px（渲染用 non-scaling-stroke，不随画布缩放）
  /** 扁平千分比点集：[x0,y0,x1,y1,…]（相对画布 0..1000） */
  pts: number[];
}

export interface PenDoc {
  v: 1;
  /** key = boardId + "|" + orientation */
  boards: Record<string, PenStroke[]>;
}

const KEY = "onethu.board.pen.v1";

function sanitize(raw: unknown): PenDoc {
  const base: PenDoc = { v: 1, boards: {} };
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<PenDoc>;
  const boards: Record<string, PenStroke[]> = {};
  for (const [k, v] of Object.entries(r.boards ?? {})) {
    if (!Array.isArray(v)) continue;
    const strokes = v
      .filter((s) => s && typeof s.id === "string" && Array.isArray(s.pts) && s.pts.length >= 4 && s.pts.length % 2 === 0)
      .map((s) => ({
        id: String(s.id),
        color: typeof s.color === "string" ? s.color : "var(--accent)",
        w: typeof s.w === "number" && s.w > 0 ? s.w : 2.5,
        pts: (s.pts as number[]).map((n) => Math.min(1000, Math.max(0, Math.round(n)))),
      }));
    if (strokes.length > 0) boards[k] = strokes;
  }
  return { v: 1, boards };
}

function load(): PenDoc {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch {
    /* 脏数据当没有 */
  }
  return { v: 1, boards: {} };
}

let doc: PenDoc = load();
const listeners = new Set<() => void>();

function commit(next: PenDoc): void {
  doc = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    /* 存储满：笔迹是易失批注，静默放弃（保内存态） */
  }
  listeners.forEach((f) => f());
}

export function subscribePen(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function penSnapshot(): PenDoc {
  return doc;
}

export function penKeyOf(boardId: string, orientation: string): string {
  return boardId + "|" + orientation;
}

export function strokesOf(key: string): PenStroke[] {
  return doc.boards[key] ?? [];
}

export function addStroke(key: string, stroke: PenStroke): void {
  const next = { ...doc.boards, [key]: [...(doc.boards[key] ?? []), stroke] };
  commit({ v: 1, boards: next });
}

export function undoStroke(key: string): void {
  const cur = doc.boards[key];
  if (!cur || cur.length === 0) return;
  commit({ v: 1, boards: { ...doc.boards, [key]: cur.slice(0, -1) } });
}

export function clearStrokes(key: string): void {
  if (!doc.boards[key]) return;
  const next = { ...doc.boards };
  delete next[key];
  commit({ v: 1, boards: next });
}

/** 画笔可选颜色（克制三色：墨/红/蓝，走固定值不跟主题——批注要一眼认出是手写的） */
export const PEN_COLORS = ["#3a3f4a", "#d45959", "#3b6ea5"] as const;
