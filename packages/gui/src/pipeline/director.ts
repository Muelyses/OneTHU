/* ════════════════════════════════════════════════════════════════════════════
 * OneGUI · 风格管线 StyleDirector —— 唯一的"风格指挥"
 *
 * 六轴：皮肤 skin / 明暗 scheme / 密度 density / 动效 motion / 强调色 accent(theme) / 平台 platform。
 * 一处解析、一处落盘（<html> 上的 data-og-* + 一族人造强调色），全应用只读语义令牌。
 *
 * 为什么不是"再写一套 CSS"：
 *   - 皮肤只是**同一组语义名的另一种取值**（skins/*.css），组件零感知；
 *   - 强调色的一族人造色（soft/line/on/quiet/ring）由这里算，页面不许自己 mix；
 *   - "这次特殊"必须走 defineScope()：登记进管线 → 生成受控 CSS 变量块 → 组件挂 data-og-scope。
 *     可选值域由管线的白名单枚举，塞不进任意颜色/尺寸 —— 这就是"统一接口接入风格管线"。
 * ══════════════════════════════════════════════════════════════════════════ */
import { bestOn, ensureContrast, mix, over, parseColor, toCss, type Rgba } from "./color.js";

export type OGSkin = "neutral" | "glass" | (string & {});
export type OGScheme = "light" | "dark";
export type OGSchemePref = "auto" | OGScheme;
export type OGDensity = "comfortable" | "compact" | "touch";
export type OGMotion = "full" | "reduced";
export type OGPlatform = "desktop" | "mobile";
export type OGSurfaceLevel = 0 | 1 | 2 | 3 | 4;

/** 主题只提供"强调色"，其余人造色由管线算 —— 主题作者不需要也不允许碰面/字/线 */
export interface OGTheme {
  id: string;
  name?: string;
  accent: string;
  accentStrong?: string;
  accentOn?: string;
  scheme?: OGScheme;
}

export interface OGAxes {
  skin: OGSkin;
  /** 皮肤自己的浓淡档（玻璃用 clear/base/rich/deep；中性皮肤忽略） */
  skinLevel: string;
  scheme: OGSchemePref;
  density: OGDensity;
  motion: OGMotion;
  platform: OGPlatform;
  theme: OGTheme | string | null;
}

export type OGScopeSpec = Partial<Record<ScopeToken, string>>;

/** scope 可改的令牌（白名单）—— 只允许"指向另一个语义令牌"或"枚举档位" */
export const SCOPE_TOKENS = {
  "surface-0": "surface",
  "surface-1": "surface",
  "surface-2": "surface",
  "surface-3": "surface",
  "surface-4": "surface",
  "surface-overlay": "surface",
  "content-1": "content",
  "content-2": "content",
  "content-3": "content",
  "line-1": "line",
  "line-2": "line",
  "radius": "radius",
  "pad": "space",
  "gap": "space",
  "tone": "tone",
} as const;

export type ScopeToken = keyof typeof SCOPE_TOKENS;

const SURFACES = ["--og-surface-0", "--og-surface-1", "--og-surface-2", "--og-surface-3", "--og-surface-4", "--og-surface-overlay"] as const;
const CONTENTS = ["--og-content-1", "--og-content-2", "--og-content-3"] as const;
const LINES = ["--og-line-1", "--og-line-2", "--og-line-3"] as const;
const RADII = ["--og-radius-xs", "--og-radius-sm", "--og-radius-md", "--og-radius-lg", "--og-radius-xl", "--og-radius-2xl", "--og-radius-full"] as const;
const SPACES = ["--og-space-0", "--og-space-1", "--og-space-2", "--og-space-3", "--og-space-4", "--og-space-5", "--og-space-6", "--og-space-7", "--og-space-8", "--og-space-9", "--og-space-10"] as const;
const TONES = ["default", "quiet", "brand", "error", "warning", "success", "info"] as const;

/** 各族的默认解析面（算强调色对比率时当参考底；与 semantic.css 的初值保持一致） */
const REF_SURFACE: Record<OGScheme, string> = { light: "#ffffff", dark: "#141922" };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DirectorDeps {
  /** 平台判定注入（宿主用自己的断点/触屏判定，管线不猜） */
  platform?: () => OGPlatform;
  /** 明暗偏好注入（跟随系统时用） */
  prefersDark?: () => boolean;
  storage?: StorageLike | null;
}

const PERSIST_KEY = "onethu.onegui.axes.v1";
const STYLE_ID_SCOPES = "onegui-scopes";
const STYLE_ID_SKINS = "onegui-skins";

const DEFAULT_AXES: OGAxes = {
  skin: "neutral",
  skinLevel: "base",
  scheme: "auto",
  density: "comfortable",
  motion: "full",
  platform: "desktop",
  theme: null,
};

export class StyleDirector {
  #axes: OGAxes = { ...DEFAULT_AXES };
  #listeners = new Set<() => void>();
  #scopes = new Map<string, OGScopeSpec>();
  #skins = new Map<string, Record<string, string>>();
  #deps: DirectorDeps = {};
  #root: HTMLElement | null = null;
  #applied = false;
  #snapshot: Readonly<OGAxes> | null = null;

  /* ── 查询 ─────────────────────────────────────────────────────────── */

  /** 轴快照（同一引用直到下次 set —— useSyncExternalStore 友好） */
  axes(): Readonly<OGAxes> {
    return (this.#snapshot ??= Object.freeze({ ...this.#axes }));
  }

  /** 已解析的明暗（auto 时问注入的偏好） */
  resolvedScheme(): OGScheme {
    const pref = this.#axes.scheme;
    if (pref !== "auto") return pref;
    if (this.#deps.prefersDark) return this.#deps.prefersDark() ? "dark" : "light";
    return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  /** 当前主题的强调色（未设主题时让 CSS 里的品牌初值生效） */
  resolvedAccent(): { accent: Rgba; theme: OGTheme | null } | null {
    const t = this.#axes.theme;
    const parsed = typeof t === "string" ? parseColor(t) : t ? parseColor(t.accent) : null;
    if (!parsed) return null;
    return { accent: parsed, theme: typeof t === "object" && t ? t : null };
  }

  scope(name: string): OGScopeSpec | undefined {
    return this.#scopes.get(name);
  }

  scopes(): readonly string[] {
    return [...this.#scopes.keys()];
  }

  /* ── 变更 ─────────────────────────────────────────────────────────── */

  set(patch: Partial<OGAxes>, opts?: { persist?: boolean }): void {
    let dirty = false;
    for (const key of Object.keys(patch) as (keyof OGAxes)[]) {
      const next = patch[key];
      if (next === undefined) continue;
      if (this.#axes[key] !== next) {
        (this.#axes as unknown as Record<string, unknown>)[key] = next;
        dirty = true;
      }
    }
    if (!dirty && this.#applied) return;
    this.#snapshot = null;
    this.apply();
    if (opts?.persist !== false) this.#persist();
    for (const fn of this.#listeners) fn();
  }

  /** 外部世界变了（系统明暗 / 触屏 / 窗口尺寸）→ 重算平台与明暗 */
  syncEnv(): void {
    const platform = this.#deps.platform?.() ?? this.#axes.platform;
    const next: Partial<OGAxes> = {};
    if (platform !== this.#axes.platform) next.platform = platform;
    this.set(next, { persist: false });
    if (this.#axes.scheme === "auto") this.apply();
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /* ── 特殊要求：注册受控 scope ──────────────────────────────────────── */

  /**
   * 页面/插件要"这次特殊"时登记一个 scope（例：defineScope("cloud.fileCard", { "surface-1": "surface-2" })），
   * 组件只写 <Card scope="cloud.fileCard">。可选值域见 SCOPE_TOKENS + 各族的枚举，非法值直接丢弃并告警。
   */
  defineScope(name: string, spec: OGScopeSpec): void {
    if (!/^[a-z][a-z0-9.]*$/i.test(name)) throw new Error(`OneGUI: scope 名非法：${name}`);
    this.#scopes.set(name, spec);
    this.#renderScopes();
  }

  undefineScope(name: string): void {
    if (this.#scopes.delete(name)) this.#renderScopes();
  }

  /* ── 第三方皮肤（插件）：只允许 --og-* 名 ───────────────────────────── */

  registerSkin(name: string, vars: Record<string, string>): void {
    const safe: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars)) {
      if (!k.startsWith("--og-")) continue;
      if (/[;{}<>]/.test(v)) continue;
      safe[k] = v;
    }
    this.#skins.set(name, safe);
    this.#renderSkins();
  }

  /* ── 落盘 ─────────────────────────────────────────────────────────── */

  mount(root: HTMLElement, deps: DirectorDeps = {}): void {
    this.#root = root;
    this.#deps = deps;
    if (deps.storage) {
      const raw = deps.storage.getItem(PERSIST_KEY);
      if (raw) {
        try {
          const saved = JSON.parse(raw) as Partial<OGAxes>;
          // 平台是环境事实，不从存档恢复；主题是对象，单独走主题通道
          const { platform: _p, theme: _t, ...rest } = saved;
          Object.assign(this.#axes, rest);
          this.#snapshot = null;
        } catch { /* 存档坏了就当没有 */ }
      }
    }
    this.apply();
  }

  /** 把轴写进 DOM：data-* 属性 + 强调色人造族 + 已注册 scope/skin 样式表 */
  apply(): void {
    const root = this.#root ?? (typeof document !== "undefined" ? document.documentElement : null);
    if (!root) return;
    this.#root = root;
    const a = this.#axes;
    const scheme = this.resolvedScheme();
    root.dataset.ogSkin = a.skin;
    root.dataset.ogSkinLevel = a.skinLevel;
    root.dataset.ogScheme = scheme;
    root.dataset.ogDensity = a.density;
    root.dataset.ogMotion = a.motion;
    root.dataset.ogPlatform = a.platform;
    this.#applyAccent(root, scheme);
    this.#renderScopes();
    this.#renderSkins();
    this.#applied = true;
  }

  /** 强调色一族：主题给一个色，管线算出 soft/line/strong/on/quiet/ring */
  #applyAccent(root: HTMLElement, scheme: OGScheme): void {
    const resolved = this.resolvedAccent();
    const style = root.style;
    if (!resolved) {
      for (const t of ["--og-accent", "--og-accent-strong", "--og-accent-soft", "--og-accent-soft-line", "--og-accent-on", "--og-accent-quiet", "--og-ring"]) {
        style.removeProperty(t);
      }
      return;
    }
    const { accent, theme } = resolved;
    const base = parseColor(REF_SURFACE[scheme]) ?? { r: 255, g: 255, b: 255, a: 1 };
    const white: Rgba = { r: 255, g: 255, b: 255, a: 1 };
    const black: Rgba = { r: 0, g: 0, b: 0, a: 1 };

    // 强档：亮色下往黑走（hover 更深），暗色下往白走（hover 更亮）
    const strongSeed = scheme === "light" ? black : white;
    const strong = theme?.accentStrong ? (parseColor(theme.accentStrong) ?? mix(accent, strongSeed, 0.18)) : mix(accent, strongSeed, 0.18);
    // 柔底：主题色 12% 压在当前档位上（不是纯白，避免亮暗两套写法分裂）
    const soft = scheme === "light" ? mix(accent, base, 0.88) : { ...accent, a: 0.15 };
    const softLine = scheme === "light" ? mix(accent, base, 0.7) : { ...accent, a: 0.32 };
    // 压色：强调色当文字用，必须先在当前面上过 4.5:1
    const quiet = ensureContrast(accent, base, 4.5);
    const on = theme?.accentOn ? (parseColor(theme.accentOn) ?? bestOn(accent).color) : bestOn(accent).color;
    const ringColor = { ...accent, a: scheme === "light" ? 0.28 : 0.38 };

    style.setProperty("--og-accent", toCss({ ...accent, a: 1 }));
    style.setProperty("--og-accent-strong", toCss({ ...strong, a: 1 }));
    style.setProperty("--og-accent-soft", toCss(soft));
    style.setProperty("--og-accent-soft-line", toCss(softLine));
    style.setProperty("--og-accent-on", toCss(on));
    style.setProperty("--og-accent-quiet", toCss({ ...quiet, a: 1 }));
    style.setProperty("--og-ring", `0 0 0 var(--og-ring-width) ${toCss(ringColor)}`);
    // 选中态叠色跟随强调色（否则换主题后选中行还是紫的）
    style.setProperty("--og-selected", toCss(scheme === "light" ? mix(accent, base, 0.86) : { ...accent, a: 0.2 }));
    // 反色面上的强调色（tooltip 里的链接等）
    style.setProperty("--og-accent-inverse", toCss(ensureContrast(accent, scheme === "light" ? black : white, 4.5)));
  }

  #renderScopes(): void {
    if (typeof document === "undefined") return;
    const blocks: string[] = [];
    for (const [name, spec] of this.#scopes) {
      const decls: string[] = [];
      for (const [key, value] of Object.entries(spec)) {
        const decl = resolveScopeDecl(key as ScopeToken, value);
        if (decl) decls.push(decl);
      }
      if (decls.length) blocks.push(`[data-og-scope="${name}"]{${decls.join("")}}`);
    }
    writeStyle(STYLE_ID_SCOPES, blocks.join("\n"));
  }

  #renderSkins(): void {
    if (typeof document === "undefined") return;
    const blocks: string[] = [];
    for (const [name, vars] of this.#skins) {
      const decls = Object.entries(vars).map(([k, v]) => `${k}:${v};`).join("");
      if (decls) blocks.push(`[data-og-skin="${name}"]{${decls}}`);
    }
    writeStyle(STYLE_ID_SKINS, blocks.join("\n"));
  }

  #persist(): void {
    const storage = this.#deps.storage;
    if (!storage) return;
    try {
      const { theme: _t, ...rest } = this.#axes;
      storage.setItem(PERSIST_KEY, JSON.stringify(rest));
    } catch { /* 配额满了不致命 */ }
  }
}

/* ── scope 值解析：只允许"指向另一个同族令牌"或枚举档位 ───────────────── */

function byIndex(list: readonly string[], value: string): string | null {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0 || n >= list.length) return null;
  // 允许写 "1" 也允许写 "surface-1"
  return list[n] ?? null;
}

export function resolveScopeDecl(key: ScopeToken, value: string): string | null {
  const family = SCOPE_TOKENS[key];
  if (!family) return null;
  switch (family) {
    case "surface": {
      const target = value.startsWith("surface-") ? SURFACES.find((s) => s === `--og-${value}`) : byIndex(SURFACES, value);
      return target ? `${tokenVar(key)}:var(${target});` : null;
    }
    case "content": {
      const target = value.startsWith("content-") ? CONTENTS.find((s) => s === `--og-${value}`) : byIndex(CONTENTS, value);
      return target ? `${tokenVar(key)}:var(${target});` : null;
    }
    case "line": {
      const target = value.startsWith("line-") ? LINES.find((s) => s === `--og-${value}`) : byIndex(LINES, value);
      return target ? `${tokenVar(key)}:var(${target});` : null;
    }
    case "radius": {
      const target = value.startsWith("radius-") ? RADII.find((s) => s === `--og-${value}`) : RADII.find((s) => s === `--og-radius-${value}`);
      return target ? `--og-c-radius:var(${target});` : null;
    }
    case "space": {
      const target = byIndex(SPACES, value);
      return target ? `--og-c-${key}:var(${target});` : null;
    }
    case "tone": {
      return (TONES as readonly string[]).includes(value) ? `--og-c-tone:${value};` : null;
    }
    default:
      return null;
  }
}

function tokenVar(key: ScopeToken): string {
  return `--og-c-${key}`;
}

function writeStyle(id: string, css: string): void {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

/* ── 单例 + 安装 ─────────────────────────────────────────────────────── */

export const og = new StyleDirector();

export interface InstallOptions extends DirectorDeps {
  root?: HTMLElement;
  /** 明暗跟随系统时的监听 */
  watchSystemScheme?: boolean;
  initial?: Partial<OGAxes>;
}

/**
 * 应用入口调用一次：挂载管线、按需监听系统明暗与窗口变化。
 * 返回卸载函数（热更新/测试用）。
 */
export function installOneGUI(opts: InstallOptions = {}): () => void {
  const root = opts.root ?? (typeof document !== "undefined" ? document.documentElement : undefined);
  if (!root) return () => undefined;
  const storage = opts.storage !== undefined
    ? opts.storage
    : typeof localStorage !== "undefined" ? localStorage : null;
  const platform = opts.platform ?? (() => {
    const touch = (navigator.maxTouchPoints ?? 0) > 0 || matchMedia("(pointer: coarse)").matches;
    return touch && window.innerWidth < 840 ? "mobile" : "desktop";
  });
  const prefersDark = opts.prefersDark ?? (() => matchMedia("(prefers-color-scheme: dark)").matches);
  og.mount(root, { platform, prefersDark, storage });
  if (opts.initial) og.set(opts.initial, { persist: false });
  og.syncEnv();

  const cleanups: Array<() => void> = [];
  if (opts.watchSystemScheme !== false) {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onScheme = (): void => { if (og.axes().scheme === "auto") og.apply(); };
    mq.addEventListener("change", onScheme);
    cleanups.push(() => mq.removeEventListener("change", onScheme));
  }
  const onResize = (): void => og.syncEnv();
  window.addEventListener("resize", onResize);
  cleanups.push(() => window.removeEventListener("resize", onResize));

  return () => {
    for (const fn of cleanups) fn();
  };
}

/** 测试/SSR 用：拿一份"轴 → 变量"的纯结果，不碰 DOM */
export function resolveAxes(axes: Partial<OGAxes>, scheme: OGScheme): Record<string, string> {
  const merged: OGAxes = { ...DEFAULT_AXES, ...axes };
  const out: Record<string, string> = {
    "data-og-skin": merged.skin,
    "data-og-skin-level": merged.skinLevel,
    "data-og-scheme": scheme,
    "data-og-density": merged.density,
    "data-og-motion": merged.motion,
    "data-og-platform": merged.platform,
  };
  const accent = typeof merged.theme === "string" ? parseColor(merged.theme) : merged.theme ? parseColor(merged.theme.accent) : null;
  if (accent) {
    const base = parseColor(REF_SURFACE[scheme]) ?? { r: 255, g: 255, b: 255, a: 1 };
    out["--og-accent"] = toCss({ ...accent, a: 1 });
    out["--og-accent-soft"] = toCss(scheme === "light" ? mix(accent, base, 0.88) : { ...accent, a: 0.15 });
    out["--og-accent-on"] = toCss(bestOn(accent).color);
    out["--og-accent-quiet"] = toCss(ensureContrast(accent, base, 4.5));
  }
  return out;
}

/** 把一层半透明色压在底色上（给 autoink / 玻璃实测用） */
export function composite(over_: Rgba, under: Rgba): Rgba {
  return over(over_, under);
}
