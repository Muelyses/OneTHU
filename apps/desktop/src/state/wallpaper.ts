/**
 * 标签页壁纸（2026-10-13，霖：所有标签页都能换壁纸，外观里可设统一壁纸，各处可单独覆盖）。
 *
 * 数据模型：
 *   { v:1, global: string|null, tabs: Record<path, string> }
 *   - 值都是图片的 dataURL（写入前经 canvas 压到 ≤1600px 宽、JPEG 0.82，常规壁纸 100–300KB，
 *     远低于 localStorage 上限；压缩失败的原图不落库——宁可设不上也不要把存储撑爆）；
 *   - path = 页面路径键（page + "|" + params JSON），与 explorer 的实例语义一致：
 *     「每个不同路径的标签页都可以有自己的壁纸」；home 是常驻键 "home"；
 *   - 解析顺序 = tabs[path] ?? global ?? 无（纯色主题底）。
 * 不做主题联动（壁纸在内容卡下面，卡面自带 surface 底，深浅模式都不影响可读性）。
 */

export interface WallpaperDoc {
  v: 1;
  global: string | null;
  tabs: Record<string, string>;
}

const KEY = "onethu.wallpaper.v1";

const isWallpaperRef = (v: unknown): v is string =>
  typeof v === "string" && (v.startsWith("data:image/") || v.startsWith("builtin:"));

function sanitize(raw: unknown): WallpaperDoc {
  const base: WallpaperDoc = { v: 1, global: null, tabs: {} };
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<WallpaperDoc>;
  return {
    v: 1,
    global: isWallpaperRef(r.global) ? r.global : null,
    tabs: Object.fromEntries(Object.entries(r.tabs ?? {}).filter(([, v]) => isWallpaperRef(v))),
  };
}

function load(): WallpaperDoc {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch {
    /* 脏数据当没有 */
  }
  return { v: 1, global: null, tabs: {} };
}

let doc: WallpaperDoc = load();
const listeners = new Set<() => void>();

function commit(next: WallpaperDoc): void {
  doc = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    /* 存储满：壁纸是纯装饰，静默放弃（保留内存态到刷新） */
  }
  listeners.forEach((f) => f());
}

export function subscribeWallpaper(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function wallpaperSnapshot(): WallpaperDoc {
  return doc;
}

/** 页面路径键：page + 参数 JSON（与 explorer 实例键同语义；无参数就是 page 本身） */
export function wallpaperPathOf(page: string, params?: unknown): string {
  return params && typeof params === "object" && Object.keys(params as object).length > 0
    ? page + "|" + JSON.stringify(params)
    : page;
}

/** 某个路径最终生效的壁纸（tab 覆盖 > 全局 > null） */
export function wallpaperFor(path: string): string | null {
  return doc.tabs[path] ?? doc.global;
}

export function setGlobalWallpaper(dataUrl: string | null): void {
  commit({ ...doc, global: dataUrl });
}

export function setTabWallpaper(path: string, dataUrl: string | null): void {
  const tabs = { ...doc.tabs };
  if (dataUrl) tabs[path] = dataUrl;
  else delete tabs[path];
  commit({ ...doc, global: doc.global, tabs });
}

/** 内置渐变壁纸（免图片的轻量选项；值是 CSS background 简写，存进 dataURL 字段会破坏
 *  sanitize 的 data: 前缀校验——所以渐变单独走一份内置表，按 "builtin:<id>" 引用）。 */
export const BUILTIN_WALLPAPERS: Array<{ id: string; label: string; css: string }> = [
  { id: "aurora", label: "极光", css: "linear-gradient(135deg, #1a2340 0%, #233a5c 45%, #1c4a4a 100%)" },
  { id: "dusk", label: "暮色", css: "linear-gradient(160deg, #2b2140 0%, #4a2c4d 55%, #6b3a3f 100%)" },
  { id: "matcha", label: "抹茶", css: "linear-gradient(150deg, #22332a 0%, #2f4a38 60%, #3d5a45 100%)" },
  { id: "ink", label: "墨", css: "linear-gradient(180deg, #17181c 0%, #23252b 100%)" },
];

function builtinCss(ref: string): string | null {
  if (!ref.startsWith("builtin:")) return null;
  return BUILTIN_WALLPAPERS.find((b) => "builtin:" + b.id === ref)?.css ?? null;
}

/** 渲染层取值：图片（dataURL，自动叠 14% 暗纱保证内容可读）或内置渐变（自带深色，不另加纱） */
export function wallpaperStyleFor(path: string): { backgroundImage: string } | null {
  const ref = wallpaperFor(path);
  if (!ref) return null;
  const css = builtinCss(ref);
  if (css) return { backgroundImage: css };
  if (ref.startsWith("data:")) {
    return { backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.14), rgba(0, 0, 0, 0.14)), url(${ref})` };
  }
  return null;
}

/** 文件 → 压缩 dataURL（最长边 1600、JPEG 0.82）；失败返回 null（不落库） */
export function fileToWallpaper(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) return resolve(null);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const MAX = 1600;
        const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
