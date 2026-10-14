/**
 * 白板画笔（2026-10-13，霖：白板上要能勾勒划线）。
 *
 * 刻意与白板文档（state/boardCore）分离：笔画存独立键（onethu.board.pen.v1），
 * 一来不惊动 board-model-test 的文档 schema 严格性护栏，二来「清空组件」不该连带
 * 擦掉手写批注（两者的生命周期本来就不同）。
 *
 * 坐标：点集存**画布百分比**（0..1000 的千分比整数，省体积也免浮点漂移），渲染时按
 * 画布实际尺寸换算——窗口宽窄变化时笔迹跟随内容缩放，不会错位。
 *
 * 键：**板 id + 朝向**（penKeyOf）。首页自由画布 2026-10-15 前的键是 "free:home|default"，
 * 老用户的批注不能丢 —— 首次读盘时一次性改写到系统板键（HOME_PEN_KEY）。
 */
import { SYSTEM_BOARD_ID } from "./boardCore.js";

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
/** 首页自由画布的历史笔键与现键（迁移用；见文件头注释）。 */
const LEGACY_HOME_KEY = "free:home|default";
const HOME_KEY = SYSTEM_BOARD_ID + "|portrait";
export const HOME_PEN_KEY = HOME_KEY;

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
    if (raw) {
      const doc = sanitize(JSON.parse(raw));
      /* 老键 → 系统板键：只在目标键还没有笔迹时改写（同一次会话里改了两次也不动它）。 */
      const legacy = doc.boards[LEGACY_HOME_KEY];
      if (legacy && legacy.length > 0 && !doc.boards[HOME_KEY]) {
        const boards = { ...doc.boards, [HOME_KEY]: legacy };
        delete boards[LEGACY_HOME_KEY];
        try {
          localStorage.setItem(KEY, JSON.stringify({ v: 1, boards }));
        } catch {
          /* 写不进去也照样用内存态（下次进来再试） */
        }
        return { v: 1, boards };
      }
      return doc;
    }
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
