/**
 * 自由画布的**缩放与盒子**（2026-10-15 第二轮模型纠正，用户两次点名）。
 *
 * 第一轮我做成了"视口裁切 + 拖拽平移"（Freeform 那套），用户当场否掉：
 *   「你怎么还有那么明显一个内容框呢？出了内容框就被截断，我们要的是没有那个隐形的 frame」
 * —— 对：只要画布是"一个有固定大小的盒子、内容是里面的东西"，那条**看不见的边**就还在，
 * 迟早会切掉东西（这正是「截断」报了三次的根）。所以这一版的规矩只有一条：
 *
 *   **画布的盒子永远盖住内容**（`boxSize` 是这个不变量的唯一实现处）。
 *   盒子跟着内容长，缩放也一起算 —— 于是"裁切"这条路径在数学上不存在：
 *   没有任何像素落在盒子外面，也没有任何东西需要"被裁"。
 *
 * 平移呢？**由滚动承担**（文档流模型）：内容长到哪，滚动容器就能滚到哪。
 * 这条比拖拽平移更合用户直觉，也不会有"我把内容拖出盒子了"这种自伤动作。
 *
 * 缩放仍是真的缩放：世界层 `scale(z)`，条目坐标系（cell / rect 契约）一个字都不改 ——
 * 缩放只是"看的方式"。倍率走档位梯子（± 按钮），触控板捏合连续。
 */

/** 视图：只剩倍率（平移交给滚动，见文件头）。 */
export interface BoardView {
  z: number;
}

export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 2.5;
export const ZOOM_DEFAULT = 1;

/** 「＋/－」按钮走的档位（捏合是连续的，不吸附到它）。 */
export const ZOOM_STEPS: readonly number[] = [0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5];

export const DEFAULT_VIEW: BoardView = { z: ZOOM_DEFAULT };

/* 取数触发点 v7（临时）：改本文件强制整页 reload —— 探针取证后与探针一起删。 */
/** 盒子四周的呼吸位（px，世界单位）：内容贴着边不好看，也留一点余地。 */
export const BOX_PAD = 96;

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

/** 屏幕点 → 世界点（世界原点在画布盒子左上角，`transform-origin: 0 0`）。 */
export function toWorld(z: number, sx: number, sy: number): { x: number; y: number } {
  const safe = z > 0 ? z : ZOOM_DEFAULT;
  return { x: sx / safe, y: sy / safe };
}

/** 世界点 → 屏幕点。 */
export function toScreen(z: number, wx: number, wy: number): { x: number; y: number } {
  const safe = z > 0 ? z : ZOOM_DEFAULT;
  return { x: wx * safe, y: wy * safe };
}

/** 屏幕位移 → 世界位移（拖动/缩放的指针换算要用它，否则手感随倍率失真）。 */
export function worldDelta(z: number, dx: number, dy: number): { x: number; y: number } {
  const safe = z > 0 ? z : ZOOM_DEFAULT;
  return { x: dx / safe, y: dy / safe };
}

/** 内容的外接矩形（世界坐标；空内容 → null）。 */
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

/**
 * 画布盒子的最小尺寸（屏幕 px）——**「不裁切」不变量的唯一实现处**。
 *
 * 口径：盒子的每一维都不小于 ① 内容缩放后的外接框（含内容自己的左上偏移）② 视口本身。
 * 世界层的变换是"以内容原点为原点"的 `scale(z)`（`transform-origin: 0 0`），
 * 所以内容右上角在屏幕上的落点就是 `(x + w) * z`、`(y + h) * z`。
 *
 * `pad` 是呼吸位：多出来的这点空白不装东西，但保证"最下面那张卡的圆角/投影"不会正好贴边。
 */
export function boxSize(
  items: readonly { x: number; y: number; w: number; h: number }[],
  z: number,
  viewport: { w: number; h: number } = { w: 0, h: 0 },
  pad: number = BOX_PAD,
): { w: number; h: number } {
  const scale = z > 0 ? z : ZOOM_DEFAULT;
  const r = contentRect(items);
  const contentW = r ? (r.x + r.w) * scale : 0;
  const contentH = r ? (r.y + r.h) * scale : 0;
  return {
    w: Math.ceil(Math.max(viewport.w, contentW + pad)),
    h: Math.ceil(Math.max(viewport.h, contentH + pad)),
  };
}

/**
 * 「适配窗口」：把整块内容放进视口（居中、留呼吸位），倍率**不超过 `maxZ`**（默认 100% ——
 * 一块小内容不该被放大到糊）。首次打开一块板走它：内容在盒子外 = 用户看不到 = 等于没做。
 */
export function fitZoom(
  viewport: { w: number; h: number },
  rect: { x: number; y: number; w: number; h: number } | null,
  margin: number = BOX_PAD,
  maxZ: number = ZOOM_DEFAULT,
): number {
  const vw = Math.max(1, viewport.w);
  const vh = Math.max(1, viewport.h);
  if (!rect || rect.w <= 0 || rect.h <= 0) return clampZoom(maxZ);
  return clampZoom(Math.min(maxZ, (vw - margin) / rect.w, (vh - margin) / rect.h));
}

/** 格式化倍率（浮点捏合会跑出 0.9999… 这种值）。 */
export function zoomLabel(z: number): string {
  return Math.round(clampZoom(z) * 100) + "%";
}

/** 视图键：每块板 × 每个朝向各记一套（横竖屏看到的倍率本来就不同）。 */
export function boardViewKey(boardId: string, orientation: string): string {
  return boardId + "|" + orientation;
}

/* ── 视图缓存（每块板一套 + 落 localStorage） ─────────────────────────────────
   为什么视图要持久化：无边记的语义是"我上次看到哪，下次还看到哪"。
   为什么放**另一个 key**：视图是"看的方式"，不是文档内容 —— 混进 board 文档
   会让插件/OH 读到一堆与自己无关的字段，也会让"落库"和"看了一眼"互相触发。 */

const KEY = "onethu.boardview.v2";
const snaps = new Map<string, BoardView>();
const listeners = new Set<() => void>();
let store: Record<string, BoardView> | null = null;

/** 只认 `{z}`（v1 是"平移+缩放"那一版：形状不同、语义也变了，直接丢）。 */
function readAll(): Record<string, BoardView> {
  if (store) return store;
  let out: Record<string, BoardView> = {};
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === "object") {
      for (const [k, val] of Object.entries(parsed as Record<string, unknown>)) {
        const o = val as { z?: unknown } | null;
        if (!o || typeof o !== "object" || typeof o.z !== "number" || !Number.isFinite(o.z)) continue;
        out[k] = { z: clampZoom(o.z) };
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

/** 这块板有没有存过视图（没有 = 首次打开，要主动适配一次内容，见 fitZoom）。 */
export function hasView(key: string): boolean {
  return readAll()[key] !== undefined;
}

export function setView(key: string, next: BoardView): void {
  const v: BoardView = { z: clampZoom(next.z) };
  const prev = snaps.get(key);
  if (prev && prev.z === v.z) return;
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

/** 护栏/测试用：清掉内存缓存与（可选）存储。 */
export function resetViewCache(): void {
  store = null;
  snaps.clear();
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
}
