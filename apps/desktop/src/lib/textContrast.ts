/**
 * 全字符对比度引擎 · 定格版（2026-10-14 用户拍板）：
 * 「实时渲染字体颜色应该在用户看到的那一刻就停止为静态，
 *   并且在整个生命周期不再变化。」
 *
 * 实现：
 *  - 每个文本叶子在**首次进入视口**那一刻计算一次：壁纸离屏采样(1/8 网格) +
 *    全局纱 + 沿途玻璃 rgba 层合成亮度 → 对比率 ≥3 达标则一字节不写（交还主题），
 *    不达标才写一次内联色，随后 data-tx="lock"，**整个生命周期不再变化**。
 *  - 新挂载的元素 = 新生命周期，各自定格一次。
 *  - 监听仅两类：元素进入视口（IntersectionObserver）与结构增删（新叶子消费）。
 *    刻意没有滚动/样式事件——那是首版乱闪的根源。
 */
import { builtinCss, displayRef, subscribeWallpaper, wallpaperSnapshot } from "../state/wallpaper.js";

const CELL = 8;              // 壁纸离屏网格（px）
const TILE = 96;             // 瓦片亮度缓存粒度
const NODE_BUDGET = 4000;    // 单轮新增叶子预算
const MIN_CONTRAST = 3.0;

const tileCache = new Map<string, number>();
const tracked = new WeakSet<HTMLElement>();
let wall: HTMLCanvasElement | null = null;
let wallKey = "";
let started = false;
let io: IntersectionObserver | null = null;
let scanScheduled = 0;

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

function rebuildWall(): void {
  const wp = wallpaperSnapshot();
  const ref = wp.global;
  const W = window.innerWidth, H = window.innerHeight;
  const key = (ref ?? "none") + "|" + W + "x" + H;
  if (key === wallKey && wall) return;
  wallKey = key;
  tileCache.clear();
  const c = document.createElement("canvas");
  c.width = Math.ceil(W / CELL);
  c.height = Math.ceil(H / CELL);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) { wall = null; return; }
  const dark = document.documentElement.dataset.scheme === "dark";
  ctx.fillStyle = dark ? "#151517" : "#fcfdff";
  ctx.fillRect(0, 0, c.width, c.height);
  if (!ref) { wall = c; return; }
  if (ref.startsWith("data:video/") || (ref.startsWith("local:") && /\.(mp4|webm)$/i.test(ref))) {
    ctx.fillStyle = dark ? "#151517" : "#2c2e36";
    ctx.fillRect(0, 0, c.width, c.height);
    wall = c; return;
  }
  const css = builtinCss(ref);
  if (css) {
    const stops = [...css.matchAll(/(#[0-9a-fA-F]{6}|rgba?\([^)]*\))\s+(\d+)%/gi)]
      .map((m) => ({ color: m[1] as string, at: Number(m[2]) / 100 }));
    const deg = Number((css.match(/(-?\d+)deg/) ?? [])[1] ?? "180");
    const rad = ((deg - 90) * Math.PI) / 180;
    const dx = Math.cos(rad), dy = Math.sin(rad);
    const cx = c.width / 2, cy = c.height / 2;
    const len = (Math.abs(c.width * dx) + Math.abs(c.height * dy)) / 2;
    const g = ctx.createLinearGradient(cx - dx * len, cy - dy * len, cx + dx * len, cy + dy * len);
    if (stops.length === 0) {
      ctx.fillStyle = dark ? "#151517" : "#fcfdff";
    } else {
      for (const st of stops) g.addColorStop(Math.min(1, Math.max(0, st.at)), st.color);
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, c.width, c.height);
    wall = c;
    return;
  }
  const img = new Image();
  img.onload = () => {
    try {
      const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
      const scale = Math.max(c.width / iw, c.height / ih);
      ctx.drawImage(img, (c.width - iw * scale) / 2, (c.height - ih * scale) / 2, iw * scale, ih * scale);
      wall = c;
      scanNew();
    } catch { wall = null; }
  };
  img.onerror = () => { wall = null; };
  img.src = displayRef(ref);
}

function tileLum(vx: number, vy: number): number {
  const key = Math.floor(vx / TILE) + ":" + Math.floor(vy / TILE);
  let v = tileCache.get(key);
  if (v != null) return v;
  if (!wall) return 0.5;
  const ctx = wall.getContext("2d");
  if (!ctx) return 0.5;
  const cx = Math.min(wall.width - 1, Math.floor(vx / CELL));
  const cy = Math.min(wall.height - 1, Math.floor(vy / CELL));
  const d = ctx.getImageData(cx, cy, 1, 1).data;
  v = lum([d[0] as number, d[1] as number, d[2] as number]);
  tileCache.set(key, v);
  return v;
}

/** 定格时刻的壁纸亮度（元素矩形内瓦片均值） */
function wallLum(rect: DOMRect): number {
  let sum = 0, n = 0;
  const step = TILE / 2;
  const right = Math.min(rect.right, window.innerWidth);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  for (let x = Math.max(0, rect.left); x < right; x += step) {
    for (let y = Math.max(0, rect.top); y < bottom; y += step) {
      sum += tileLum(x + step / 2, y + step / 2);
      n++;
    }
  }
  if (n) return sum / n;
  return tileLum(
    Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
    Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)),
  );
}

const rgbaOne = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/;

function parseLayers(el: HTMLElement): Array<{ a: number; rgb: [number, number, number] }> {
  const layers: Array<{ a: number; rgb: [number, number, number] }> = [];
  let hop = 0;
  for (let p = el.parentElement; p && hop < 40; p = p.parentElement, hop++) {
    if (p.tagName === "HTML") break;
    const cs = getComputedStyle(p);
    collect(cs.backgroundColor);
    const bi = cs.backgroundImage;
    if (bi && bi !== "none") for (const m of bi.matchAll(/rgba?\([^)]*\)/g)) collect(m[0]);
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

function compositeLum(el: HTMLElement): number {
  let L = wallLum(el.getBoundingClientRect());
  const shell = document.querySelector(".explorer-shell") as HTMLElement | null;
  const mode = shell?.dataset.wallpaperLum;
  const dark = document.documentElement.dataset.scheme === "dark";
  const veil = mode === "dark" && !dark ? 0.34 : mode === "light" && dark ? 0.36 : 0;
  if (veil) L = L * (1 - veil) + (dark ? 0 : 1) * veil;
  const layers = parseLayers(el);
  for (const ly of layers) L = L * (1 - ly.a) + lum(ly.rgb) * ly.a;
  return Math.round(Math.min(1, Math.max(0, L)) * 20) / 20;
}

const WANT_DARK = "rgba(255, 255, 255, 0.95)";
const WANT_LIGHT = "rgba(20, 22, 28, 0.94)";

/** 元素生命周期只进一次：进视口即定格 */
function settle(el: HTMLElement): void {
  if (tracked.has(el)) return;
  tracked.add(el);
  try {
    if (el.closest('[data-tx="keep"]')) return;
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
    if (!hasOwnText) return;
    const rect = el.getBoundingClientRect();
    if (rect.bottom < -120 || rect.top > window.innerHeight + 120) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return;
    const cm = (cs.color.match(/[\d.]+/g) ?? []).map(Number);
    if (cm.length < 3) return;
    const bg = compositeLum(el);
    const tLum = lum([cm[0] as number, cm[1] as number, cm[2] as number]);
    if (contrast(tLum, bg) >= MIN_CONTRAST) return;   // 主题给得出对比度：一字节不碰
    el.style.setProperty("color", bg < 0.5 ? WANT_DARK : WANT_LIGHT);
    el.dataset.tx = "lock";
  } catch { /* 单叶失败不影响整体 */ }
}

function scanNew(): void {
  if (!wall) { rebuildWall(); if (!wall) return; }
  const root = (document.querySelector(".explorer-shell") as HTMLElement | null) ?? document.body;
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as HTMLElement | null;
  let budget = NODE_BUDGET;
  while (node && budget > 0) {
    const el = node;
    node = walker.nextNode() as HTMLElement | null;
    budget--;
    if (el instanceof SVGElement || tracked.has(el)) continue;
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
    if (!hasOwnText || el.children.length > 0) continue;
    tracked.add(el);
    if (io) io.observe(el);
    else settle(el);
  }
}

function startIO(): void {
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io?.unobserve(e.target);
      settle(e.target as HTMLElement);   // 用户看到的那一刻，一次定格
    }
  }, { root: null, threshold: 0.01 });
}

/** 启动（main.tsx 调一次；幂等） */
export function installTextContrast(): void {
  if (started) return;
  started = true;
  rebuildWall();
  startIO();
  subscribeWallpaper(() => { wallKey = ""; rebuildWall(); scanNew(); });
  new MutationObserver(() => {
    if (scanScheduled) return;
    scanScheduled = window.setTimeout(() => { scanScheduled = 0; scanNew(); }, 350);
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("resize", () => { wallKey = ""; rebuildWall(); scanNew(); });
  scanNew();
}
