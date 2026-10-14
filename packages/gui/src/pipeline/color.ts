/* ════════════════════════════════════════════════════════════════════════════
 * OneGUI · 取色工具箱（零依赖）
 *
 * 管线要做的三件事都靠它：主题色 → 一族人造色（soft/line/强档/环）、
 * 明暗合成（玻璃叠在壁纸上到底是什么颜色）、对比度选字色（黑白二选一取高者）。
 * 纯函数，无 DOM 依赖 —— 单测直接跑。
 * ══════════════════════════════════════════════════════════════════════════ */

export interface Rgb { r: number; g: number; b: number }
export interface Rgba extends Rgb { a: number }

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const clamp255 = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : n);

/** 解析 #rgb / #rgba / #rrggbb / #rrggbbaa / rgb() / rgba()（其余返回 null，不猜） */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    const expand = (c: string): number => parseInt(c + c, 16);
    const at = (i: number): number => parseInt(hex.slice(i, i + 1), 16);
    if (hex.length === 3 || hex.length === 4) {
      const a = hex.length === 4 ? at(3) / 15 : 1;
      return { r: expand(hex[0]!), g: expand(hex[1]!), b: expand(hex[2]!), a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const pair = (i: number): number => parseInt(hex.slice(i, i + 2), 16);
      const a = hex.length === 8 ? pair(6) / 255 : 1;
      return { r: pair(0), g: pair(2), b: pair(4), a };
    }
    return null;
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!m) return null;
  const parts = m[1]!.split(/[,\s/]+/).filter(Boolean).map((p) => Number.parseFloat(p));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return { r: clamp255(parts[0]!), g: clamp255(parts[1]!), b: clamp255(parts[2]!), a: clamp01(parts[3] ?? 1) };
}

export function toCss({ r, g, b, a }: Rgba): string {
  const ri = Math.round(clamp255(r));
  const gi = Math.round(clamp255(g));
  const bi = Math.round(clamp255(b));
  return a >= 1 ? `rgb(${ri}, ${gi}, ${bi})` : `rgba(${ri}, ${gi}, ${bi}, ${Number(a.toFixed(3))})`;
}

/** sRGB 线性插值混色（t=0 取 a，t=1 取 b）；alpha 一并插值 */
export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  const k = clamp01(t);
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
    a: a.a + (b.a - a.a) * k,
  };
}

/** fg 半透明地压在 bg 上（sRGB 逐通道合成）—— 玻璃面上算真实底色就靠它 */
export function over(fg: Rgba, bg: Rgba): Rgba {
  const a = clamp01(fg.a);
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/** 相对亮度（WCAG 2.1，sRGB 线性化） */
export function luminance(c: Rgb): number {
  const lin = (v: number): number => {
    const s = clamp255(v) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/**
 * 在一个底色上选「白字 or 黑字」：两个候选都算对比率，取高者。
 * （历史教训：用 bg<0.5 当分界是错的，黑白交叉点在相对亮度 ≈ 0.179。）
 */
export function bestOn(bg: Rgb, white: Rgb = WHITE, black: Rgb = BLACK): { color: Rgba; ratio: number; light: boolean } {
  const cw = contrast(white, bg);
  const cb = contrast(black, bg);
  return cw >= cb ? { color: { ...white, a: 1 }, ratio: cw, light: true } : { color: { ...black, a: 1 }, ratio: cb, light: false };
}

/** 把色往底色方向混到至少达到 minRatio 对比率（用于"强调色当文字用"的可读性保底） */
export function ensureContrast(fg: Rgba, bg: Rgb, minRatio: number): Rgba {
  if (contrast(fg, bg) >= minRatio) return fg;
  const target = luminance(bg) > 0.5 ? BLACK : WHITE;
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const candidate = mix(fg, { ...target, a: 1 }, t);
    if (contrast(candidate, bg) >= minRatio) return candidate;
  }
  return { ...target, a: 1 };
}
