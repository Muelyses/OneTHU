/**
 * 全字符对比度引擎（2026-10-14 用户点名：每个字符串在其背景栈渲染后实时算偏黑/偏白）。
 *
 * 原理（不是按类名翻色，是真算）：
 *  1. 壁纸离屏画布：把全屏壁纸（内置渐变/图片/视频兜底暗）画进 1/8 缩放的 offscreen
 *     canvas——壁纸钉死视口，任意元素的背景像素都能按其视口矩形取到。
 *  2. 背景栈合成：从元素沿祖先向上收集每层的 rgba 填充（backgroundColor +
 *     backgroundImage 里的 rgba 色标），自底向上 alpha 混合，得该文本叶子的合成亮度。
 *     全局纱（壁纸反差纱）与视频蒙层作为常数层参与。
 *  3. 对比度裁决：文本计算色 vs 合成底的 W3C 对比率 ≥3 为达标不动；不达标才把
 *     内联 color 改成偏白/偏黑（rgba .94）。凡是主题/档位本身给得出对比度的字符串
 *     一个字节都不碰（换主题/档后重算自动收敛）。
 *
 * 触发：壁纸变更 / 档位与主题变更（属性观察）/ 窗口 resize / 滚动（rAF 节流）/
 * DOM 变更（MutationObserver 300ms 防抖）。预算：单轮 ≤4000 叶子、只处理视口内。
 */
import { builtinCss, displayRef, subscribeWallpaper, wallpaperSnapshot } from "../state/wallpaper.js";

const CELL = 8;              // 壁纸采样网格（px）
const NODE_BUDGET = 4000;    // 单轮叶子预算
const MIN_CONTRAST = 3.0;

let wall: HTMLCanvasElement | null = null;
let wallKey = "";            // 壁纸内容指纹（ref + 视口尺寸）
let scheduled = 0;
let started = false;

/* ---------- 亮度工具（W3C 相对亮度 / 对比率） ---------- */

function lum(rgb: [number, number, number]): number {
  const f = (c: number) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function contrast(a: number, b: number): number {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------- 壁纸离屏画布 ---------- */

function rebuildWall(): void {
  const wp = wallpaperSnapshot();
  const ref = wp.global;
  const W = window.innerWidth, H = window.innerHeight;
  const key = (ref ?? "none") + "|" + W + "x" + H;
  if (key === wallKey && wall) return;
  wallKey = key;
  const c = document.createElement("canvas");
  c.width = Math.ceil(W / CELL);
  c.height = Math.ceil(H / CELL);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) { wall = null; return; }
  // 底 = 主题页面底：壁纸缺席时不至于把合成亮度算劈叉
  const dark = document.documentElement.dataset.scheme === "dark";
  ctx.fillStyle = dark ? "#151517" : "#fcfdff";
  ctx.fillRect(0, 0, c.width, c.height);
  if (!ref) { wall = c; return; }
  if (ref.startsWith("data:video/") || (ref.startsWith("local:") && /\.(mp4|webm)$/i.test(ref))) {
    // 视频：按暗档兜底（真实 <video> 在下方渲染，逐帧取均值不划算）
    ctx.fillStyle = dark ? "#151517" : "#2c2e36";
    ctx.fillRect(0, 0, c.width, c.height);
    wall = c; return;
  }
  const css = builtinCss(ref);
  if (css) {
    // 内置渐变：解析 "135deg, #x 0%, #y 45%, …" 画进离屏画布（cover 全视口）
    const stops = [...css.matchAll(/(#[0-9a-fA-F]{6}|rgba?\([^)]*\))\s+(\d+)%/gi)]
      .map((m) => ({ color: m[1]!, at: Number(m[2]) / 100 }));
    const deg = Number((css.match(/(-?\d+)deg/) ?? [])[1] ?? "180");
    const rad = ((deg - 90) * Math.PI) / 180;
    const dx = Math.cos(rad), dy = Math.sin(rad);
    const cx = c.width / 2, cy = c.height / 2;
    const len = (Math.abs(c.width * dx) + Math.abs(c.height * dy)) / 2;
    const g = ctx.createLinearGradient(cx - dx * len, cy - dy * len, cx + dx * len, cy + dy * len);
    if (stops.length === 0) { ctx.fillStyle = css.slice(css.indexOf("(") + 1, css.lastIndexOf(")") - 0); ctx.fillRect(0, 0, c.width, c.height); }
    else {
      for (const st of stops) g.addColorStop(Math.min(1, Math.max(0, st.at)), st.color);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
    }
    wall = c; return;
  }
  const img = new Image();
  img.onload = () => {
    try {
      const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
      const scale = Math.max(c.width / iw, c.height / ih);  // cover
      const dw = iw * scale, dh = ih * scale;
      ctx.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
      wall = c;
      schedule(true);
    } catch { wall = null; }
  };
  img.onerror = () => { wall = null; };
  img.src = displayRef(ref);
}

/** 采样：视口矩形 → 壁纸在该区域的平均亮度（0..1） */
function wallLum(rect: DOMRect): number {
  if (!wall) return 0.5;
  const x0 = Math.max(0, Math.floor(Math.max(rect.left, 0) / CELL));
  const y0 = Math.max(0, Math.floor(Math.max(rect.top, 0) / CELL));
  const x1 = Math.min(wall.width, Math.ceil(Math.min(rect.right, window.innerWidth) / CELL));
  const y1 = Math.min(wall.height, Math.ceil(Math.min(rect.bottom, window.innerHeight) / CELL));
  if (x1 <= x0 || y1 <= y0) return wallLumCenter();
  const ctx = wall.getContext("2d");
  if (!ctx) return 0.5;
  try {
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let sum = 0, n = 0;
    for (let i = 0; i + 3 < d.length; i += 4) {
      sum += lum([d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0]);
      n++;
    }
    return n ? sum / n : 0.5;
  } catch { return 0.5; }
}

function wallLumCenter(): number {
  if (!wall) return 0.5;
  const ctx = wall.getContext("2d");
  if (!ctx) return 0.5;
  const d = ctx.getImageData(Math.floor(wall.width / 2), Math.floor(wall.height / 2), 1, 1).data;
  return lum([d[0] ?? 0, d[1] ?? 0, d[2] ?? 0]);
}

/* ---------- 背景栈合成 ---------- */

const rgbaOne = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/;

function parseLayers(el: HTMLElement | null): Array<{ a: number; rgb: [number, number, number] }> {
  const layers: Array<{ a: number; rgb: [number, number, number] }> = [];
  let hop = 0;
  for (let p = el?.parentElement; p && hop < 40; p = p.parentElement, hop++) {
    if (p.id === "onethu-dynamic-color" || p.tagName === "HTML") break;
    const cs = getComputedStyle(p);
    collect(cs.backgroundColor);
    const bi = cs.backgroundImage;
    if (bi && bi !== "none") {
      for (const m of bi.matchAll(/rgba?\([^)]*\)/g)) collect(m[0]);
    }
    if (p.classList.contains("wall-video-veil")) collect("rgba(0, 0, 0, 0.2)");
  }
  return layers;
  function collect(raw: string): void {
    if (!raw || raw === "none" || raw === "transparent") return;
    const m = rgbaOne.exec(raw);
    if (!m) return;
    const a = m[4] != null ? Number(m[4]) : 1;
    if (!a) return;
    layers.push({ a, rgb: [Number(m[1]), Number(m[2]), Number(m[3])] });
  }
}

/** 合成亮度：壁纸(视口矩形实采) → 全局纱 → 沿途玻璃层（自底向上 alpha 混合） */
function compositeLum(el: HTMLElement): number {
  let L = wallLum(el.getBoundingClientRect());
  const shell = document.querySelector(".explorer-shell") as HTMLElement | null;
  const wallLumMode = shell?.dataset.wallpaperLum;
  const dark = document.documentElement.dataset.scheme === "dark";
  // 全局反差纱（explorer-content::before）：亮主题暗壁纸提白、暗主题亮壁纸压黑
  const veil = wallLumMode === "dark" && !dark ? 0.34 : wallLumMode === "light" && dark ? 0.36 : 0;
  if (veil) L = L * (1 - veil) + (dark ? 0 : 1) * veil;
  const layers = parseLayers(el);
  for (const ly of layers) L = L * (1 - ly.a) + lum(ly.rgb) * ly.a;
  return Math.min(1, Math.max(0, L));
}

/* ---------- 引擎主流程 ---------- */

const WANT_DARK = "rgba(255, 255, 255, 0.94)";   // 底暗 → 偏白
const WANT_LIGHT = "rgba(23, 25, 32, 0.92)";     // 底亮 → 偏黑

function adjust(el: HTMLElement): void {
  if (el.closest('[data-tx="keep"]')) return;
  const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
  if (!hasOwnText) return;
  const rect = el.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;
  const cs = getComputedStyle(el);
  if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.05) return;
  const cm = cs.color.match(/[\d.]+/g)?.map(Number) ?? [];
  if (cm.length < 3) return;
  const tLum = lum([cm[0]!, cm[1]!, cm[2]!]);
  const tAlpha = cm.length > 3 ? (cm[3] ?? 1) : 1;
  const bg = compositeLum(el);
  if (contrast(tLum, bg) >= MIN_CONTRAST) {
    // 达标：交还主题（清我们可能写过的内联色）
    if (el.dataset.tx === "auto") { el.style.removeProperty("color"); delete el.dataset.tx; }
    return;
  }
  const want = bg < 0.5 ? WANT_DARK : WANT_LIGHT;
  if (el.dataset.tx === "auto" && el.style.color === want) return;
  el.style.setProperty("color", want);
  el.dataset.tx = "auto";
}

function pass(): void {
  rebuildWall();
  const root = (document.querySelector(".explorer-shell") as HTMLElement | null) ?? document.body;
  if (!root || !wall) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as HTMLElement | null;
  let budget = NODE_BUDGET;
  while (node && budget > 0) {
    const el = node;
    node = walker.nextNode() as HTMLElement | null;
    budget--;
    if (el instanceof SVGElement) continue;
    adjust(el);
  }
}

function schedule(immediate = false): void {
  if (scheduled) return;
  scheduled = window.setTimeout(() => {
    scheduled = 0;
    pass();
  }, immediate ? 80 : 300);
}

/** 启动（main.tsx 调一次；幂等） */
export function installTextContrast(): void {
  if (started) return;
  started = true;
  subscribeWallpaper(() => {
    wallKey = "";
    schedule(true);
  });
  window.addEventListener("resize", () => {
    wallKey = "";
    schedule();
  }, { passive: true });
  let lastY = window.scrollY, lastX = window.scrollX;
  window.addEventListener("scroll", () => {
    if (Math.abs(window.scrollY - lastY) < 40 && Math.abs(window.scrollX - lastX) < 40) return;
    lastY = window.scrollY; lastX = window.scrollX;
    schedule();
  }, { passive: true });
  new MutationObserver(() => schedule()).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ["class", "style", "data-theme", "data-scheme", "data-glass", "data-wallpaper-lum"],
  });
  schedule(true);
}
