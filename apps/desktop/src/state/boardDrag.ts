/**
 * 白板拖拽几何（P1 纯逻辑）：把指针位置换算成目标格，并给出「松手后会变成什么样」的预览。
 *
 * 方案：docs/原子收藏-可行性与实现方案.md §6.2 / §6.5。
 * 预览与落库分离：拖拽期只算预览（不写文档），松手才写——避免中途每一步都落盘。
 */
import { BOARD_COLS, type BoardDoc, type BoardItem } from "./boardCore.js";
import { overlaps, pushDown } from "./collectable.js";
import { previewResize, reflowForMove } from "./boardReflow.js";

export interface GridRect { left: number; top: number; width: number; rowHeight: number }

/** 指针位置 → 目标格。列宽由画布宽度与列数算出；行高由画布高度与行数算出（渲染层给的 rows）。 */
export function cellFromPoint(clientX: number, clientY: number, rect: GridRect, size: { w: number; h: number }, cols: number = BOARD_COLS): { x: number; y: number } {
  const colW = rect.width > 0 && cols > 0 ? rect.width / cols : 0;
  /* 行高必须由渲染层**实测**传入：本仓库的卡片高度由内容决定，用「总高 / 估算行数」会算错，
     实测证据：卡片约 650px，而估算得到约 310px，垂直落点因此系统性偏移两行。 */
  const rowH = rect.rowHeight > 0 ? rect.rowHeight : 0;
  const rawX = colW > 0 ? Math.round((clientX - rect.left) / colW) : 0;
  const rawY = rowH > 0 ? Math.round((clientY - rect.top) / rowH) : 0;
  const x = Math.min(Math.max(0, rawX), Math.max(0, cols - size.w));
  return { x, y: Math.max(0, rawY) };
}

export interface SlotRect {
  /** 该槽在文档里的格坐标与跨度 */
  x: number; y: number; w: number; h: number;
  /** 该槽的实测屏幕矩形 */
  left: number; top: number; width: number; height: number;
}

/**
 * 命中检测换格（本仓库的最终方案）。
 *
 * 为什么不用「总高 ÷ 行数」：白板卡片高度由内容决定，行与行并不等距，估算会系统性错位
 * （实测卡片约 650px、估算约 310px，垂直落点偏两行）。
 * 命中检测按**已渲染槽的实测矩形**推算：指针落在哪个槽里，就按该槽自身的高度把它换算到跨度内的行。
 *
 * excludeId：被拖拽的那一条要排除，否则它会一直命中原位、手感发黏。
 */
export function cellFromSlots(
  px: number,
  py: number,
  slots: readonly (SlotRect & { id: string })[],
  grid: { left: number; width: number },
  cols: number,
  size: { w: number; h: number },
  excludeId?: string,
): { x: number; y: number } {
  const colW = grid.width > 0 && cols > 0 ? grid.width / cols : 0;
  const rawX = colW > 0 ? Math.round((px - grid.left) / colW) : 0;
  const x = Math.min(Math.max(0, rawX), Math.max(0, cols - size.w));
  /* 被拖项**不参与障碍判断**，但必须参与**当前位置换算**：
     早前把它整个排除，指针落在它自己身上时会落到「它下面那个槽位」的 y，
     松手就向下跳一大截（约等于自身剩余高度）——霖 2026-10-11 报的正是这个。 */
  const dragged = excludeId ? slots.find((s) => s.id === excludeId) : undefined;
  if (dragged && py >= dragged.top && py <= dragged.top + dragged.height) {
    const rowH = dragged.height / Math.max(1, dragged.h);
    const row = Math.min(dragged.h - 1, Math.max(0, Math.floor((py - dragged.top) / rowH)));
    return { x, y: Math.max(0, dragged.y + row) };
  }
  const list = slots.filter((s) => s.id !== excludeId).slice().sort((a, b) => a.top - b.top);
  if (!list.length) return { x, y: 0 };
  let y = 0;
  for (const s of list) {
    if (py < s.top) { y = s.y; break; }
    if (py <= s.top + s.height) {
      const rowH = s.height / Math.max(1, s.h);
      y = s.y + Math.min(s.h - 1, Math.max(0, Math.floor((py - s.top) / rowH)));
      break;
    }
    y = s.y + s.h;
  }
  return { x, y: Math.max(0, y) };
}

/**
 * 边缘自动滚动速度（霖 2026-10-10 提出）。
 *
 * 竖直为主拖动时，若画布比屏幕长，拖到上/下边缘必须能继续滚动，否则「拖到页面之外的位置」无法完成。
 * 返回**每帧像素**（负=向上），速度与靠近边缘的程度成正比；不在边缘带内返回 0。
 */
export function edgeScrollSpeed(pointerY: number, viewportTop: number, viewportBottom: number, zonePx: number, maxPxPerFrame: number): number {
  const zone = Math.max(1, zonePx);
  if (pointerY < viewportTop) return -maxPxPerFrame;
  if (pointerY > viewportBottom) return maxPxPerFrame;
  const topEdge = viewportTop + zone;
  if (pointerY < topEdge) {
    const near = (topEdge - pointerY) / zone;
    return -Math.max(1, Math.round(maxPxPerFrame * Math.min(1, Math.max(0, near))));
  }
  const bottomEdge = viewportBottom - zone;
  if (pointerY > bottomEdge) {
    const near = (pointerY - bottomEdge) / zone;
    return Math.max(1, Math.round(maxPxPerFrame * Math.min(1, Math.max(0, near))));
  }
  return 0;
}

/**
 * 吸附去抖（霖 2026-10-11 现场抽搐的真因）：
 *
 * 目标格按 `round(位移 / 行距)` 算，手指停在**半格**处时 ±1~3px 抖动就会让 round 在 0/1 之间来回翻；
 * 每次翻都重算让位，而让位带弹簧过渡 → 动画播不完就被打断 → 看起来是持续抽搐。
 * 因此只有越过 `threshold` 格才换格（默认 0.62，比 0.5 多出 12% 死区）。
 */
export function stickyIndex(raw: number, current: number, threshold = 0.62): number {
  return Math.abs(raw - current) >= threshold ? Math.round(raw) : current;
}

/** 预览：把某条目搬到目标格后，板上各条目的位置（被压到的向下推）。不写文档。 */
export function previewItems(
  items: readonly BoardItem[],
  itemId: string,
  to: { x: number; y: number; w?: number; h?: number },
  defs: readonly unknown[] = [],
  cols: number = BOARD_COLS,
): BoardItem[] {
  const item = items.find((it) => it.id === itemId);
  if (!item) return [...items];
  /* 带 w/h 时是缩放预览，否则只改位置。 */
  const w = typeof to.w === "number" ? Math.max(1, Math.round(to.w)) : item.cell.w;
  const h = typeof to.h === "number" ? Math.max(1, Math.round(to.h)) : item.cell.h;
  const x = Math.min(Math.max(0, Math.round(to.x)), Math.max(0, cols - w));
  /* 只改位置时走**统一的让位模型**；带 w/h 的缩放也走**统一函数**（previewResize，与落库同一套夹���）。 */
  if (typeof to.w !== "number" && typeof to.h !== "number") {
    return reflowForMove(items, itemId, { x, y: Math.max(0, Math.round(to.y)) });
  }
  if (defs && defs.length) {
    return previewResize(items, itemId, { x, y: Math.max(0, Math.round(to.y)), w, h }, defs);
  }
  const moved: BoardItem = { ...item, cell: { x, y: Math.max(0, Math.round(to.y)), w, h } };
  const others = items.filter((it) => it.id !== itemId);
  const resolved = new Map(pushDown(others, moved.cell).map((it) => [it.id, it]));
  /* **必须保持原数组顺序**：把被拖项挪到末尾会让 React 按 key 重排、移动该 DOM 节点，
     而触摸指针隐式捕获在那个节点上——节点一被摘下，浏览器立刻发 pointercancel，拖拽当场作废
     （霖 2026-10-10 现场：拖第一项必然失败、拖最后一项却成功，就是这个原因）。 */
  return items.map((it) => (it.id === itemId ? moved : (resolved.get(it.id) ?? it)));
}

/** 预览文档（渲染层直接用；与真实落库走同一套 pushDown）。 */
export function previewDoc(doc: BoardDoc, boardId: string, ori: "portrait" | "landscape", items: readonly BoardItem[]): BoardDoc {
  return {
    ...doc,
    boards: doc.boards.map((b) => (b.id === boardId ? { ...b, cells: { ...b.cells, [ori]: [...items] } } : b)),
  };
}

/** 拖拽是否发生了实质位移（用于「长按出菜单 → 位移才升级为拖拽」的判据）。 */
export function movedBeyond(from: { x: number; y: number }, to: { x: number; y: number }, threshold: number): boolean {
  return Math.abs(to.x - from.x) > threshold || Math.abs(to.y - from.y) > threshold;
}

/** 自检：预览结果不得有重叠。 */
export function previewHasOverlap(items: readonly BoardItem[]): boolean {
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
