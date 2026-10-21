import { t as i18n } from "../i18n/index.js";
/**
 * 图像滤镜（需求 8）：拍照/相册进来的手写照片，上传前给你几个「一眼有用」的处理。
 *
 * 设计要点（为什么这么写）：
 *  1) **只用 Canvas2D**，零依赖、零网络：createImageBitmap（拿不到就退 <img>）→ canvas
 *     → getImageData 像素循环 → toDataURL。不用 `ctx.filter`：macOS 的 WKWebView 在旧
 *     Safari 上没有该属性，一旦两边走不同代码路径，同一条滤镜在桌面和手机上会长得不一样；
 *     全部走显式像素运算，结果确定、跨内核一致（`supportsCanvasFilter()` 只用于诊断）。
 *  2) **大图先降采样**：长边超过 maxEdge（默认 2000）先等比缩到 2000。手机原图 4000px+
 *     直接跑像素循环会卡住主线程好几秒；2000px 对手写作业足够看清笔画，峰值内存也从
 *     3-4 千万像素降到 3 百万像素级。
 *  3) 「去阴影」不引入任何模糊库：把画面缩到 64px 长边再读回像素，得到一张粗糙的
 *     「局部背景亮度」图（缩略过程本身就是一次大半径模糊），像素循环里对它做双线性
 *     采样，再按 v * (目标亮度 / 参考亮度) 归一化 —— 就是扫描类 App 的去阴影原理。
 *     参考亮度再叠一条「不低于全图最亮块 85%」的地板，粗笔画才不会被整格吃掉后反被拉白
 *     （见 brightFloor 的注释）；整张图都暗时另有增益闸（见 gainCap）。
 */

/** 能被当画源的东西：位图 / 图片元素 / 已有画布（画布是为了链式叠加：先旋转再上滤镜） */
export type ImageSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

/** 预设 id（存进 UI 状态与报告，不用中文当 key） */
export type FilterPreset = "original" | "scan" | "bw" | "sharpen" | "warm";

/** 旋转角度（只有 90 的整数倍，避免引入插值重采样与「自由旋转」的 UI 复杂度） */
export type RotationDeg = 0 | 90 | 180 | 270;

export interface FilterPresetInfo {
  id: FilterPreset;
  label: string;
  hint: string;
}

/** 横排缩略图的数据源（顺序即 UI 顺序） */
export const FILTER_PRESETS: readonly FilterPresetInfo[] = [
  { id: "original", get label() { return i18n("lib.imagefilters.4b1db520af46"); }, get hint() { return i18n("lib.imagefilters.1073267e70f3"); } },
  { id: "scan", get label() { return i18n("lib.imagefilters.c2a291b64f6b"); }, get hint() { return i18n("lib.imagefilters.6403563723c7"); } },
  { id: "bw", get label() { return i18n("lib.imagefilters.47d88357c5ea"); }, get hint() { return i18n("lib.imagefilters.d4040b81cd67"); } },
  { id: "sharpen", get label() { return i18n("lib.imagefilters.fc538f246da7"); }, get hint() { return i18n("lib.imagefilters.b9c153f4ea21"); } },
  { id: "warm", get label() { return i18n("lib.imagefilters.1a407ccbb6dc"); }, get hint() { return i18n("lib.imagefilters.e0cebe6ab1c6"); } },
] as const;

/** 最终成图的长边上限（降采样阈值） */
export const MAX_EDGE = 2000;
/** 编辑界面预览的长边上限：像素循环只跑这个尺寸，拖动/切预设要即时 */
export const PREVIEW_EDGE = 720;
/** 预设缩略图的长边 */
export const THUMB_EDGE = 72;

/** 光照图长边（越小越快、越平滑；配合 brightFloor 的地板，64px 已够用） */
const LUM_EDGE = 64;
/** 光照下限：防止纯黑区域除出天文数字（放大噪点） */
const LUM_FLOOR = 24;
/** 归一化目标亮度：局部背景被抬到接近白纸 */
const SCAN_TARGET = 232;
/** 增益上限：暗光照片不至于被放大成雪花 */
const SCAN_GAIN_MAX = 4;
/** 平均亮度低于它 → 判定为「暗场景照片」而非「白纸 + 阴影」，增益另收紧（见 gainCap） */
const DARK_SCENE_AVG = 90;

export interface ApplyFilterOptions {
  /** 长边上限（默认 MAX_EDGE） */
  maxEdge?: number;
  /** 顺时针旋转角度（默认 0） */
  rotate?: RotationDeg;
  /** 输出 MIME（默认 image/jpeg；要保透明/无损用 image/png，但体积大） */
  mime?: string;
  /** JPEG 质量（默认 0.88） */
  quality?: number;
  /** 底色（默认白；JPEG 必须有不透明底色，否则透明区变黑） */
  background?: string;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** 画源尺寸：img 元素优先用 naturalWidth/Height（可能带 CSS 缩放） */
function dims(img: ImageSource): { w: number; h: number } {
  const natural = img as HTMLImageElement;
  const w = Math.round((natural.naturalWidth || img.width || 1));
  const h = Math.round((natural.naturalHeight || img.height || 1));
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

function newCtx(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (typeof document === "undefined") throw new Error(i18n("lib.imagefilters.6dfabd848137"));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(i18n("lib.imagefilters.6dfabd848137"));
  return { canvas, ctx };
}

/* ── 画源 → 画布（降采样 + 旋转一次做完，后续滤镜都在这张画布上原地做） ── */

export function drawToCanvas(img: ImageSource, opts: ApplyFilterOptions = {}): HTMLCanvasElement {
  const maxEdge = opts.maxEdge ?? MAX_EDGE;
  const rotate = opts.rotate ?? 0;
  const { w: sw, h: sh } = dims(img);
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const swap = rotate === 90 || rotate === 270;
  const { canvas, ctx } = newCtx(swap ? dh : dw, swap ? dw : dh);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = opts.background ?? "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 旋转用「平移 + 转坐标系」，drawImage 的矩形尺寸始终按未旋转的 dw×dh 给
  // （四个角度的落点已在下面逐个验算：结果都正好铺满 canvas）
  if (rotate === 90) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rotate === 180) {
    ctx.translate(canvas.width, canvas.height);
    ctx.rotate(Math.PI);
  } else if (rotate === 270) {
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(img, 0, 0, dw, dh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

/** 顺时针旋转 90°×times，返回新画布（尺寸互换）。要 dataURL 就用 canvasToDataUrl() */
export function rotate90(img: ImageSource, times = 1): HTMLCanvasElement {
  const n = ((Math.round(times) % 4) + 4) % 4;
  const deg = (n * 90) as RotationDeg;
  return drawToCanvas(img, { rotate: deg, maxEdge: Math.max(dims(img).w, dims(img).h) });
}

export function canvasToDataUrl(canvas: HTMLCanvasElement, mime = "image/jpeg", quality = 0.88): string {
  const q = mime === "image/png" ? undefined : quality;
  return canvas.toDataURL(mime, q);
}

/* ── 光照图（去阴影的地基） ── */

interface LumMap {
  data: Float32Array;
  w: number;
  h: number;
  /** 全图平均亮度：用来判断「这到底是不是一张纸」 */
  avg: number;
  /** 全图最亮块：纸面亮度的代理值（见 brightFloor） */
  hi: number;
}

function buildLumMap(canvas: HTMLCanvasElement, edge = LUM_EDGE): LumMap {
  const { w, h } = dims(canvas);
  const scale = Math.min(1, edge / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));
  const { canvas: small, ctx } = newCtx(sw, sh);
  // 先铺白再缩：透明像素按白纸算，不会在归一化时变成「一块黑背景」
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sw, sh);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, sw, sh);
  const px = ctx.getImageData(0, 0, sw, sh).data;
  const data = new Float32Array(sw * sh);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    const r = px[p] ?? 0;
    const g = px[p + 1] ?? 0;
    const b = px[p + 2] ?? 0;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    data[i] = lum;
    sum += lum;
  }
  let hi = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] ?? 0;
    if (v > hi) hi = v;
  }
  return { data, w: sw, h: sh, avg: data.length > 0 ? sum / data.length : 0, hi };
}

/**
 * 参考亮度（＝「这一带的纸面有多亮」）：
 *   max(局部光照, 全图最亮块 × 0.85)
 *
 * 为什么不能只用局部光照：光照图是把画面缩小再读回像素，一个格子覆盖十几个像素，
 * **粗笔画**（手写竖钩、印章、表格线）会被整格吃掉 —— 那一格的「背景」就等于笔画本身，
 * 归一化后笔画反而被拉白（实测：64px 见方的深色条在纯局部光照下会变成灰白）。
 * 加一条「不低于全图最亮处 85%」的地板后，笔画永远是在跟「纸」比，而不是跟自己比；
 * 大块阴影仍然是阴影（只抬到纸面的 85% 附近），去阴影的初衷没丢。
 */
function brightFloor(map: LumMap): number {
  return map.hi * 0.85;
}

/**
 * 归一化增益上限。
 * 纸面（白底为主）与暗场景要分开对待：整张图都很暗时（平均亮度 < 90），它多半是
 * 「一张暗照片」而不是「一张带阴影的白纸」，此时若照常按局部亮度拉满增益，
 * 会把暗照片整张漂白成白纸（这是去阴影算法最典型的翻车方式）。所以暗场景把增益
 * 压到 1.5 以内：局部对比还在，但不会把黑猫洗成白猫。纸面照片（平均 >90）不设这道闸，
 * 阴影角落才能被真正拉平。
 */
function gainCap(avg: number): number {
  return avg < DARK_SCENE_AVG ? 1.5 : SCAN_GAIN_MAX;
}

/** 双线性采样（x/y 为画布像素坐标）——小块光照图的边界要 clamp 到块内 */
function sampleLum(m: LumMap, x: number, y: number, cw: number, ch: number): number {
  const fx = (x * m.w) / cw - 0.5;
  const fy = (y * m.h) / ch - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const cx0 = Math.min(Math.max(x0, 0), m.w - 1);
  const cx1 = Math.min(Math.max(x0 + 1, 0), m.w - 1);
  const cy0 = Math.min(Math.max(y0, 0), m.h - 1);
  const cy1 = Math.min(Math.max(y0 + 1, 0), m.h - 1);
  const a = m.data[cy0 * m.w + cx0] ?? 0;
  const b = m.data[cy0 * m.w + cx1] ?? 0;
  const c = m.data[cy1 * m.w + cx0] ?? 0;
  const d = m.data[cy1 * m.w + cx1] ?? 0;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/* ── 五个预设 ── */

/** 扫描：按局部光照归一化 → 提对比 + 微提亮。手写照片的阴影/台灯黄光会被压平 */
function applyScan(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { w, h } = dims(canvas);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const map = buildLumMap(canvas);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const ref = Math.max(sampleLum(map, x, y, w, h), brightFloor(map), LUM_FLOOR);
      const gain = Math.min(SCAN_TARGET / ref, gainCap(map.avg));
      for (let c = 0; c < 3; c++) {
        const v = d[p + c] ?? 0;
        // 白平衡后的对比拉伸：围绕 118 拉 1.26 倍，再整体 +6 提亮
        d[p + c] = clamp255((v * gain - 118) * 1.26 + 124);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** 黑白文档：同样按局部光照归一化，再把归一化亮度压成「黑字 + 白纸」的两段线性映射 */
function applyBw(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { w, h } = dims(canvas);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const map = buildLumMap(canvas);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const r = d[p] ?? 0;
      const g = d[p + 1] ?? 0;
      const b = d[p + 2] ?? 0;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const ref = Math.max(sampleLum(map, x, y, w, h), brightFloor(map), LUM_FLOOR);
      // 归一化到「背景 ≈ 238」（暗场景同样收紧增益，见 gainCap）
      const n = clamp255(lum * Math.min(238 / ref, gainCap(map.avg)));
      // 两段线性：≤150 压到 0-75（字迹），≥205 直接白（纸面），中间留过渡带防锯齿
      const out = n <= 150 ? n * 0.5 : n >= 205 ? 255 : 75 + ((n - 150) * 180) / 55;
      d[p] = out;
      d[p + 1] = out;
      d[p + 2] = out;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** 锐化：3×3 卷积核 [0,-1,0;-1,5,-1;0,-1,0]（不改变亮度、只加强边缘） */
function applySharpen(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { w, h } = dims(canvas);
  if (w < 3 || h < 3) return;
  const img = ctx.getImageData(0, 0, w, h);
  const out = img.data; // 写回原缓冲
  const src = new Uint8ClampedArray(out); // 卷积必须读「未被改写的」副本
  for (let y = 0; y < h; y++) {
    const y0 = (y > 0 ? y - 1 : 0) * w;
    const y1 = y * w;
    const y2 = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0;
      const x2 = x < w - 1 ? x + 1 : x;
      const p = (y1 + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = src[p + c] ?? 0;
        const up = src[(y0 + x) * 4 + c] ?? 0;
        const down = src[(y2 + x) * 4 + c] ?? 0;
        const left = src[(y1 + x0) * 4 + c] ?? 0;
        const right = src[(y1 + x2) * 4 + c] ?? 0;
        out[p + c] = clamp255(center * 5 - up - down - left - right);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** 暖色：绕亮度轻轻加饱和 + 红提蓝压（照相馆暖调，不做怀旧黄） */
function applyWarm(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { w, h } = dims(canvas);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    const r = d[p] ?? 0;
    const g = d[p + 1] ?? 0;
    const b = d[p + 2] ?? 0;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    d[p] = clamp255(lum + (r - lum) * 1.14 + 10);
    d[p + 1] = clamp255(lum + (g - lum) * 1.14 + 2);
    d[p + 2] = clamp255(lum + (b - lum) * 1.14 - 12);
  }
  ctx.putImageData(img, 0, 0);
}

/** 在已有画布上原地套预设（缩略图与最终成图共用同一条实现） */
export function applyFilterToCanvas(canvas: HTMLCanvasElement, preset: FilterPreset): HTMLCanvasElement {
  switch (preset) {
    case "scan":
      applyScan(canvas);
      break;
    case "bw":
      applyBw(canvas);
      break;
    case "sharpen":
      applySharpen(canvas);
      break;
    case "warm":
      applyWarm(canvas);
      break;
    case "original":
    default:
      break;
  }
  return canvas;
}

/** 一步到位：降采样（+可选旋转）→ 预设 → dataURL（同步；大图会占用主线程数百毫秒） */
export function applyFilter(img: ImageSource, preset: FilterPreset, opts: ApplyFilterOptions = {}): string {
  const canvas = drawToCanvas(img, opts);
  applyFilterToCanvas(canvas, preset);
  return canvasToDataUrl(canvas, opts.mime ?? "image/jpeg", opts.quality ?? 0.88);
}

/** 预设缩略图（横排那一行）：小图跑像素循环，五张加起来也就几毫秒 */
export function filterThumbnail(img: ImageSource, preset: FilterPreset, edge = THUMB_EDGE, background?: string): string {
  const canvas = drawToCanvas(img, { maxEdge: edge, background });
  applyFilterToCanvas(canvas, preset);
  return canvasToDataUrl(canvas, "image/jpeg", 0.78);
}

/* ── 画源装载 ── */

/** Blob / dataURL / blob: / http(s) / 已是画源 → 统一成画源。
 *  createImageBitmap 不可用（老内核）时退到 <img> + objectURL，两条路都拿不到就抛错。 */
export async function loadImageSource(src: Blob | string | ImageSource): Promise<ImageSource> {
  if (typeof src === "object" && !(src instanceof Blob)) return src;
  if (typeof src === "string") {
    try {
      // dataURL / blob: / http(s) 在 WebView 里 fetch 都能用
      return await decodeBlob(await (await fetch(src)).blob());
    } catch {
      // 取字节失败（跨域 / 登录态过期）：把地址直接交给 <img>，它的报错更好懂
      return await loadViaImgElement(src, false);
    }
  }
  return await decodeBlob(src);
}

async function decodeBlob(blob: Blob): Promise<ImageSource> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* 解码失败/内核不支持：退 <img> */
    }
  }
  return await loadViaImgElement(URL.createObjectURL(blob), true);
}

function loadViaImgElement(url: string, revoke: boolean): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => {
      if (revoke) URL.revokeObjectURL(url);
      resolve(el);
    };
    el.onerror = () => {
      if (revoke) URL.revokeObjectURL(url);
      reject(new Error(i18n("lib.imagefilters.18b8640fe01c")));
    };
    el.src = url;
  });
}

/** 释放画源（ImageBitmap 持有解码后的像素内存，编辑界面关闭时必须还回去） */
export function releaseImage(img: ImageSource | null | undefined): void {
  if (!img) return;
  const maybe = img as ImageBitmap;
  if (typeof maybe.close === "function") maybe.close();
}

/** 诊断用：这台内核认不认 ctx.filter（本模块的滤镜不依赖它，见文件头第 1 条） */
export function supportsCanvasFilter(): boolean {
  try {
    const { ctx } = newCtx(1, 1);
    ctx.filter = "brightness(0.5)";
    return ctx.filter === "brightness(0.5)";
  } catch {
    return false;
  }
}
