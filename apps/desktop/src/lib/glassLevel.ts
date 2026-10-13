/**
 * 玻璃程度（液态玻璃浓度四档）：clear 清透 / balanced 均衡（默认）/ rich 浓郁 / deep 极致。
 *
 * 实现：档位写进 <html data-glass>，global.css 的玻璃令牌块按属性档静态覆盖
 * （Chromium 96 兼容——全部 rgba 死值，不运算）。默认档不写属性 = 走基座值。
 * 存储：localStorage，键是内部实现约定，不要渲给用户。
 */

const KEY = "onethu.glass.level";
export type GlassLevel = "clear" | "balanced" | "rich" | "deep";
const LEVELS: GlassLevel[] = ["clear", "balanced", "rich", "deep"];

export function glassLevels(): Array<{ id: GlassLevel; label: string }> {
  return [
    { id: "clear", label: "清透" },
    { id: "balanced", label: "均衡" },
    { id: "rich", label: "浓郁" },
    { id: "deep", label: "极致" },
  ];
}

function normalize(v: string | null | undefined): GlassLevel {
  return (LEVELS as string[]).includes(String(v)) ? (v as GlassLevel) : "balanced";
}

export function getGlassLevel(): GlassLevel {
  try {
    return normalize(localStorage.getItem(KEY));
  } catch {
    return "balanced";
  }
}

export function setGlassLevel(level: GlassLevel): void {
  try {
    if (level === "balanced") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, level);
  } catch {
    /* 存不进就本次有效 */
  }
  applyGlassLevel(getGlassLevel());
  for (const f of listeners) f();
}

/** 应用/切档时写 <html data-glass>（默认档删属性 = 基座值） */
export function applyGlassLevel(level: GlassLevel): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (level === "balanced") delete root.dataset.glass;
  else root.dataset.glass = level;
}

/** 应用启动钩子：读档落属性（main.tsx 调） */
export function initGlassLevel(): void {
  applyGlassLevel(getGlassLevel());
}

/* 订阅（设置页选择器用） */
const listeners = new Set<() => void>();
export function subscribeGlassLevel(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
