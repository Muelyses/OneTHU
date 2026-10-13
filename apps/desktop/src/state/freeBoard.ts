/**
 * 自由图层白板（2026-10-13 定稿，霖：要可以互相重叠盖住的高级白板）。
 *
 * 与旧网格板（boardCore：格位 + 非重叠推挤 + 挡位）的根本区别：
 *   - 组件 = 绝对像素矩形 {x,y,w,h}，**允许任意重叠**，后写的在上（数组序即图层序）；
 *   - 没有编辑模式：常态下直接拖动、把手缩放、点选删除，一切即所见；
 *   - 画笔层恒在最高层，组件盖不住它；
 *   - 推挤/让位/挡位吸附这些网格时代的机制整条退役（不是改，是不存在）。
 *
 * spec 沿用 WidgetSpec（时钟/天气/便笺/入口…的声明不变），渲染层做一层
 * 「px → 档位提示」的近似映射喂给既有卡体，卡内排版随尺寸分档的能力保留。
 */

export interface FreeItem {
  id: string;
  spec: import("./boardCore.js").WidgetSpec;
  x: number; // px，画布坐标
  y: number;
  w: number;
  h: number;
  /** 便笺等自折叠组件的收起态 */
  folded?: boolean;
}

export interface FreeBoardDoc {
  v: 1;
  items: FreeItem[];
}

const KEY = "onethu.freeboard.home.v1";

/** 画布最小尺寸约束（缩放下限） */
export const MIN_W = 120;
export const MIN_H = 64;

function sanitizeItem(raw: unknown): FreeItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<FreeItem>;
  if (!r.id || !r.spec || typeof r.spec !== "object") return null;
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    id: String(r.id),
    spec: r.spec as FreeItem["spec"],
    x: num(r.x, 20),
    y: num(r.y, 20),
    w: Math.max(MIN_W, num(r.w, 240)),
    h: Math.max(MIN_H, num(r.h, 120)),
    folded: r.folded === true ? true : undefined,
  };
}

function load(): FreeBoardDoc {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FreeBoardDoc>;
      if (parsed.v === 1 && Array.isArray(parsed.items)) {
        return { v: 1, items: parsed.items.map(sanitizeItem).filter((x): x is FreeItem => x !== null) };
      }
    }
  } catch {
    /* 脏数据当没有 */
  }
  return { v: 1, items: [] };
}

let doc: FreeBoardDoc = load();
const listeners = new Set<() => void>();

function commit(next: FreeBoardDoc): void {
  doc = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    /* 存储满：静默（内存态保到刷新） */
  }
  listeners.forEach((f) => f());
}

export function subscribeFreeBoard(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function freeBoardSnapshot(): FreeBoardDoc {
  return doc;
}

/** 置顶并返回新数组（选中/拖动即浮到最上层） */
export function bringToFront(id: string): void {
  const i = doc.items.findIndex((x) => x.id === id);
  if (i < 0 || i === doc.items.length - 1) return;
  const items = doc.items.slice();
  const it = items.splice(i, 1)[0];
  if (!it) return;
  items.push(it);
  commit({ ...doc, items });
}

export function addItem(spec: FreeItem["spec"], x: number, y: number, w = 260, h = 140): string {
  const id = "f." + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  commit({ ...doc, items: [...doc.items, { id, spec, x, y, w, h }] });
  return id;
}

export function moveItem(id: string, x: number, y: number): void {
  commit({ ...doc, items: doc.items.map((it) => (it.id === id ? { ...it, x, y } : it)) });
}

export function sizeItem(id: string, w: number, h: number, x?: number, y?: number): void {
  commit({
    ...doc,
    items: doc.items.map((it) =>
      it.id === id
        ? { ...it, w: Math.max(MIN_W, w), h: Math.max(MIN_H, h), x: x ?? it.x, y: y ?? it.y }
        : it,
    ),
  });
}

export function setItemFolded(id: string, folded: boolean): void {
  commit({ ...doc, items: doc.items.map((it) => (it.id === id ? { ...it, folded: folded || undefined } : it)) });
}

export function updateItemProps(id: string, props: Record<string, unknown> | undefined): void {
  commit({
    ...doc,
    items: doc.items.map((it) => (it.id === id ? { ...it, spec: { ...it.spec, props } } : it)),
  });
}

export function removeItem(id: string): void {
  commit({ ...doc, items: doc.items.filter((it) => it.id !== id) });
}

/** 便笺（双击空白/加号菜单的快捷项） */
export function addNote(x: number, y: number): string {
  return addItem({ kind: "custom", id: "note" }, x, y, 220, 160);
}

/** 首次进入：把旧网格系统板的内容搬进来一次（masonry 式排布在固定层下方），之后各管各的 */
export function seedFromLegacyOnce(legacyItems: Array<{ id: string; spec: FreeItem["spec"] }>): void {
  if (doc.items.length > 0) return;
  try {
    if (localStorage.getItem(KEY + ".seeded") === "1") return;
  } catch {
    /* ignore */
  }
  const perRow = 3;
  const colW = 300;
  const rowH = 190;
  const items: FreeItem[] = legacyItems.slice(0, 9).map((it, i) => ({
    id: "seed." + it.id,
    spec: it.spec,
    x: 24 + (i % perRow) * colW,
    y: 280 + Math.floor(i / perRow) * rowH,
    w: colW - 20,
    h: rowH - 24,
  }));
  commit({ ...doc, items });
  try {
    localStorage.setItem(KEY + ".seeded", "1");
  } catch {
    /* ignore */
  }
}
