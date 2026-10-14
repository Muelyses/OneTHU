/**
 * 移动时的让位（**与预览、落库共用**）——霖 2026-10-11 现场认定：
 *
 * 旧做法（把被压到的项推到被移组件的**下方**，y = placed.y + placed.h）对大组件是灾难：
 * 被移项自身 h8＝760px，抓起它挪一格，邻居就被弹开整整 8 行 —— 看起来就是"卡顿瞬移"；
 * 目标格在边界上摇摆时这个位移来回翻，就是"抽搐"。
 *
 * 现在的口径与侧栏排位一致：**原位置与落点之间的项整体平移"你移动的那几行"**。
 * 挪一格邻居就挪一格；原位置留下的空档改到落点那一侧，净效果是"空档在移动"。
 * 最后再跑一遍最小让位兜底（高度不齐时保证绝无重叠）。
 *
 * **2026-10-15 现状（保留理由，勿随手删）**：白板页退役后，自由画布（px 层）不再走这条让位
 * ——重叠在自由画布上是特性，不是要修的错。但**网格契约那条线仍然活着**：插件与 OH 的
 * `ext.onePage` 走 `plugins/facade.ts` 直接写 `cell.{x,y,w,h}`，OneGO / 收藏落点走
 * `state/onePage.ts` 的 `addItemTo`（内部 `findFreeCell` + `pushDown`），两者都必须无重叠。
 * 所以本模块与 `ensureNoOverlap`（写入口的最后一道不变量）继续保留，并由
 * `tools/board-drag-test.mjs` 第 ⑦ 节逐条驱动。
 */
import { overlaps, pushDown } from "./collectable.js";
import type { BoardItem } from "./boardCore.js";

/** 最小让位兜底：把重叠的一对里**靠上的那个压下面那个**，只压"最小的量"。 */
/** 兜底让位：`keepId` 是**被拖项**，它必须停在指针指定的格上，让位由对方承担。 */
function resolveOverlaps(items: BoardItem[], keepId?: string): BoardItem[] {
  const out = items.map((it) => ({ ...it, cell: { ...it.cell } }));
  for (let guard = 0; guard < 200; guard += 1) {
    let fixed = false;
    for (let i = 0; i < out.length; i += 1) {
      for (let j = 0; j < out.length; j += 1) {
        if (i === j) continue;
        const a = out[i];
        const b = out[j];
        if (!a || !b) continue;
        if (!overlaps(a.cell, b.cell)) continue;
        /* 让 y 小的那个保持在上面：把下面的推到它下方（只推最小的量）。 */
        /* 被拖项停在目标格；对方按**方向**选最小让位：在它上方的往上让，在它下方的往下让。 */
        const keepIsA = keepId !== undefined && a.id === keepId;
        const keepIsB = keepId !== undefined && b.id === keepId;
        if (keepIsA || keepIsB) {
          const keep = keepIsA ? a : b;
          const other = keepIsA ? b : a;
          if (other.cell.y < keep.cell.y) {
            /* 往上让：**必须先确认上方真的容得下**。只看 `max(0, keep.y - h)` 会夹到 0，
               夹完仍然重叠 → 循环空转 200 次后带着重叠返回（霖 2026-10-11：三个组件叠在一起
               就是这么来的：notices 落在 classes 内部，而 classes 上方已无空间）。 */
            const up = keep.cell.y - other.cell.h;
            other.cell = up >= 0 ? { ...other.cell, y: up } : { ...other.cell, y: keep.cell.y + keep.cell.h };
          } else {
            other.cell = { ...other.cell, y: keep.cell.y + keep.cell.h };
          }
          fixed = true;
          continue;
        }
        const lower = a.cell.y <= b.cell.y ? b : a;
        const upper = a.cell.y <= b.cell.y ? a : b;
        lower.cell = { ...lower.cell, y: upper.cell.y + upper.cell.h };
        fixed = true;
      }
    }
    if (!fixed) break;
  }
  return out;
}

/**
 * 全局兜底：把任何重叠的一对拆开（y 小的保持在上，另一个推到它下方）。
 *
 * 它是**不变量守卫**，不是"让位策略"：落库后、以及从存储加载后都跑一遍，
 * 保证文档里绝不残留重叠（霖 2026-10-11 现场：放手后两个组件叠在一起）。
 */
export function ensureNoOverlap(items: readonly BoardItem[]): BoardItem[] {
  return resolveOverlaps(items.map((it) => ({ ...it, cell: { ...it.cell } })));
}

/** 把某条目搬到目标格后，板上各条目的位置。不写文档；预览与落库都走它。 */
export function reflowForMove(items: readonly BoardItem[], itemId: string, to: { x: number; y: number }): BoardItem[] {
  const item = items.find((it) => it.id === itemId);
  if (!item) return items.map((it) => ({ ...it, cell: { ...it.cell } }));
  const fromY = item.cell.y;
  const delta = to.y - fromY;
  const moved: BoardItem = { ...item, cell: { ...item.cell, x: to.x, y: Math.max(0, to.y) } };
  if (delta === 0) {
    /* 纵向没动也要跑兜底：横向移动同样可能撞上邻居（与缩放一样，由对方让位）。 */
    return resolveOverlaps(items.map((it) => (it.id === itemId ? moved : { ...it, cell: { ...it.cell } })), itemId);
  }
  /* 让位对象 = **被新位置压到的那些项**（不是"y 落在区间里"——那会漏掉高度更大的邻居，
     漏掉后只能靠兜底推到组件下方，又变回瞬移）。它们整体平移 delta：挪一格就挪一格。 */
  const shifted = new Map<string, BoardItem>();
  for (const it of items) {
    if (it.id === itemId) continue;
    const hit = overlaps(it.cell, moved.cell);
    shifted.set(it.id, hit ? { ...it, cell: { ...it.cell, y: Math.max(0, it.cell.y + delta) } } : { ...it, cell: { ...it.cell } });
  }
  const out = items.map((it) => (it.id === itemId ? moved : (shifted.get(it.id) ?? it)));
  /* 只跑**带 keep 的**兜底：被拖项必须停在指针指定的格上，让位由对方承担。
     （不加另一趟无 keep 的全局兜底——那会把被拖项自己也推走，霖现场「落点不对」就是这么来的。） */
  return resolveOverlaps(out, itemId);
}

/**
 * 缩放的**预览**：与落库（`boardEdit.placeItem`）走**同一套**夹取与让位。
 *
 * 为什么必须共用：霖现场「拖左边动右边」的现象里，落库结果是对的（x+1、w−1），
 * 但拖拽**预览**只改了宽度没改 x —— 因为预览走的是另一条分支。同一个算法两处实现，
 * 迟早会分叉；这里把它收成一个函数。
 */
export function previewResize(
  items: readonly BoardItem[],
  itemId: string,
  cell: { x: number; y: number; w: number; h: number },
  defs: readonly unknown[] = [],
  cols: number = 4,
): BoardItem[] {
  const item = items.find((it) => it.id === itemId);
  if (!item) return items.map((it) => ({ ...it, cell: { ...it.cell } }));
  const def = (defs as { spec?: unknown; sizeRange?: { minW: number; minH: number; maxW: number; maxH: number } }[]).find(
    (d) => JSON.stringify(d.spec) === JSON.stringify(item.spec),
  );
  const range = def?.sizeRange ?? { minW: 1, minH: 1, maxW: 4, maxH: 8 };
  const w = Math.max(range.minW, Math.min(Math.round(cell.w), range.maxW));
  const h = Math.max(range.minH, Math.min(Math.round(cell.h), range.maxH));
  const x = Math.max(0, Math.min(Math.round(cell.x), Math.max(0, cols - w)));
  const y = Math.max(0, Math.round(cell.y));
  const placed: BoardItem = { ...item, cell: { x, y, w, h } };
  return reflowForResize(items, placed);
}

/** 缩放时的让位：只把被压到的项按最小量往下推（尺寸变化不适合整体平移）。 */
export function reflowForResize(items: readonly BoardItem[], placed: BoardItem): BoardItem[] {
  const others = items.filter((it) => it.id !== placed.id);
  const settled = pushDown(others, placed.cell);
  const out = items.map((it) => (it.id === placed.id ? placed : (settled.find((s) => s.id === it.id) ?? it)));
  return resolveOverlaps(out, placed.id);
}
