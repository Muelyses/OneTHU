/**
 * 自由画布的**视口变换**（2026-10-15 用户拍板的模型纠正：「像 iPad 无边记，自创建起就没有边界，
 * 无限大是**与生俱来**的属性，自由扩展不是后来的妥协」）。
 *
 * 旧模型是「一块会长的盒子」：画布高度跟着最下面那张卡走（`minHeight = 内容底边`），
 * 底下还垫着画笔层的 2400px 固定高度、外层面板靠 `overflow:auto` 兜着。那条路上每次
 * 组件比盒高都要靠拟合去救，用户三次报「截断」都出在这个盒子上。
 *
 * 新模型：**内容在世界坐标里，视口只管看哪一块。**
 *     screen = world * z + (x, y)      （world = 条目的 x/y/w/h，永远不动）
 *     world  = (screen - (x, y)) / z
 * 于是「边界」这个概念从渲染层消失了：没有盒子可以裁掉内容，往右下永远有地方，
 * 往左上也能平（视图偏移可以是负数，哪怕那里暂时什么都没有）。
 *
 * 这一层刻意只有纯函数 + 一个 localStorage 视图缓存：条目坐标系（cell/rect 契约）一个字都不改，
 * 插件/OH 读到的 cell 仍是老口径 —— 缩放和平移**只是看的方式**。
 */

/** 视图：`x/y` 是屏幕 px 的平移量，`z` 是缩放倍率。 */
export interface BoardView {
  x: number;
  y: number;
  z: number;
}

export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 2.5;
export const ZOOM_DEFAULT = 1;

/** 「＋/－」按钮走的档位（触控板捏合是连续的，不吸附到它）。 */
export const ZOOM_STEPS: readonly number[] = [0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5];

export const DEFAULT_VIEW: BoardView = { x: 0, y: 0, z: ZOOM_DEFAULT };

/** 画布左上角的呼吸位（世界原点贴到视口时的内边距）。 */
export const VIEW_ORIGIN_PAD = 16;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** 沿档位梯子走一格：`dir` = +1 放大 / −1 缩小。已经卡在端点就返回端点。 */
export function stepZoom(z: number, dir: number): number {
  const cur = clampZoom(z);
  const eps = 1e-6;
  if (dir > 0) {
    const next = ZOOM_STEPS.find((v) => v > cur + eps);
    return next ?? ZOOM_MAX;
  }
  const below = ZOOM_STEPS.filter((v) => v < cur - eps);
  const last = below[below.length - 1];
  return last ?? ZOOM_MIN;
}

/** 屏幕点 → 世界点。 */
export function toWorld(view: BoardView, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - view.x) / view.z, y: (sy - view.y) / view.z };
}

/** 世界点 → 屏幕点。 */
export function toScreen(view: BoardView, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * view.z + view.x, y: wy * view.z + view.y };
}

/** 屏幕位移 → 世界位移（拖动/缩放必须走它，否则移动会随缩放倍率失真）。 */
export function worldDelta(z: number, dx: number, dy: number): { x: number; y: number } {
  const safe = z > 0 ? z : ZOOM_DEFAULT;
  return { x: dx / safe, y: dy / safe };
}

/** 平移（屏幕 px）。 */
export function panBy(view: BoardView, dx: number, dy: number): BoardView {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return view;
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/**
 * 以某个**屏幕锚点**为不动点缩放：锚点下的世界坐标在缩放前后必须落在同一屏幕位置
 * （触控板捏合与按钮缩放都靠它，否则画面会往左上角跑）。
 */
export function zoomAt(view: BoardView, nextZ: number, anchorX: number, anchorY: number): BoardView {
  const z = clampZoom(nextZ);
  const w = toWorld(view, anchorX, anchorY);
  return { x: anchorX - w.x * z, y: anchorY - w.y * z, z };
}

/** 把视图对到某块世界矩形（重置/回到内容）：矩形左上角贴在视口的呼吸位上，倍率 `z`。 */
export function viewForRect(
  rect: { x: number; y: number; w: number; h: number } | null,
  z: number = ZOOM_DEFAULT,
): BoardView {
  const scale = clampZoom(z);
  if (!rect) return { ...DEFAULT_VIEW, z: scale };
  return { x: VIEW_ORIGIN_PAD - rect.x * scale, y: VIEW_ORIGIN_PAD - rect.y * scale, z: scale };
}

/**
 * 「适配窗口」：把整块内容放进视口（居中、留呼吸位），倍率**不超过 `maxZ`**（默认 100% ——
 * 一块小内容不该被放大到糊）。首次打开一块板就是走它：无限画布里没有"滚动条兜底"，
 * 不主动对一次内容，用户看到的就是"内容不见了"。
 */
export function fitView(
  viewport: { w: number; h: number },
  rect: { x: number; y: number; w: number; h: number } | null,
  margin: number = VIEW_ORIGIN_PAD * 2,
  maxZ: number = ZOOM_DEFAULT,
): BoardView {
  const vw = Math.max(1, viewport.w);
  const vh = Math.max(1, viewport.h);
  if (!rect || rect.w <= 0 || rect.h <= 0) {
    /* 空板：内容原点贴左上角呼吸位（不是居中——空板要以"世界原点"为锚，双击加东西才落在看得见的地方）。 */
    return { x: VIEW_ORIGIN_PAD, y: VIEW_ORIGIN_PAD, z: clampZoom(maxZ) };
  }
  const z = clampZoom(Math.min(maxZ, (vw - margin * 2) / rect.w, (vh - margin * 2) / rect.h));
  return {
    x: (vw - rect.w * z) / 2 - rect.x * z,
    y: (vh - rect.h * z) / 2 - rect.y * z,
    z,
  };
}

/** 内容的外接矩形（空内容 → null）：重置视图时用它当「内容原点」。 */
export function contentRect(items: readonly { x: number; y: number; w: number; h: number }[]): { x: number; y: number; w: number; h: number } | null {
  if (items.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const it of items) {
    x0 = Math.min(x0, it.x);
    y0 = Math.min(y0, it.y);
    x1 = Math.max(x1, it.x + it.w);
    y1 = Math.max(y1, it.y + it.h);
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 视图键：每块板 × 每个朝向各记一套（横竖屏看到的位置本来就不同）。 */
export function boardViewKey(boardId: string, orientation: string): string {
  return boardId + "|" + orientation;
}

/** 格式化倍率（浮点捏合会跑出 0.9999… 这种值）。 */
export function zoomLabel(z: number): string {
  return Math.round(clampZoom(z) * 100) + "%";
}

/* ── 视图缓存（每块板一套 + 落 localStorage） ─────────────────────────────────
   为什么视图要持久化：无边记的语义是"我上次看到哪，下次还看到哪"。
   为什么放**另一个 key**：视图是"看的方式"，不是文档内容 —— 混进 onethu.board.v1
   会让插件/OH 读到一堆与自己无关的字段，也会让"落库"和"看了一眼"互相触发。 */

const KEY = "onethu.boardview.v1";
const snaps = new Map<string, BoardView>();
const listeners = new Set<() => void>();
let store: Record<string, BoardView> | null = null;

function readAll(): Record<string, BoardView> {
  if (store) return store;
  let out: Record<string, BoardView> = {};
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const o = v as Partial<BoardView> | null;
        if (!o || typeof o !== "object") continue;
        if (typeof o.x !== "number" || typeof o.y !== "number") continue;
        if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) continue;
        out[k] = { x: o.x, y: o.y, z: clampZoom(typeof o.z === "number" ? o.z : ZOOM_DEFAULT) };
      }
    }
  } catch {
    out = {};
  }
  store = out;
  return out;
}

function persist(): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(readAll()));
  } catch {
    /* 存储不可用（护栏/隐私模式）：视图退回内存，不该让画布挂掉 */
  }
}

let wired = false;
function wire(): void {
  if (wired) return;
  wired = true;
  try {
    globalThis.addEventListener?.("onethu.boards.changed", () => emit());
  } catch {
    /* 非浏览器环境（node 护栏）没有事件源也无妨 */
  }
}

function emit(): void {
  listeners.forEach((f) => f());
}

export function viewOf(key: string): BoardView {
  wire();
  const hit = snaps.get(key);
  if (hit) return hit;
  const v = readAll()[key] ?? DEFAULT_VIEW;
  snaps.set(key, v);
  return v;
}

/** 这块板有没有存过视图（没有 = 首次打开，要主动对一次内容，见 fitView）。 */
export function hasView(key: string): boolean {
  return readAll()[key] !== undefined;
}

export function setView(key: string, next: BoardView): void {
  const v: BoardView = { x: Math.round(next.x * 100) / 100, y: Math.round(next.y * 100) / 100, z: clampZoom(next.z) };
  const prev = snaps.get(key);
  if (prev && prev.x === v.x && prev.y === v.y && prev.z === v.z) return;
  snaps.set(key, v);
  readAll()[key] = v;
  persist();
  emit();
}

export function subscribeView(f: () => void): () => void {
  wire();
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/** 护栏/测试用：清掉缓存与（可选）存储。 */
export function resetViewCache(): void {
  store = null;
  snaps.clear();
}
