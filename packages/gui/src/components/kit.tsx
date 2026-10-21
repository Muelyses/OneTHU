/* ════════════════════════════════════════════════════════════════════════════
 * OneGUI · 组件基类（对象模型）
 *
 * 所有组件都是同一个基类的实例：**样式由 OneStyle 生成，不由各页面手写 class/CSS**。
 * 一个组件的"类"= 组件名 + 变体轴（variant/size/tone）+ 状态轴（loading/selected/…）。
 * 子类（IconBtn 之于 Btn、DangerBtn 之于 Btn）只改**枚举值**，不改写法 —— 这就是"面向对象"。
 *
 * 统一接口（每个组件都长这样）：
 *   variant?  solid | tonal | outline | ghost | plain        （强调程度）
 *   size?     sm | md | lg                                   （控件尺度，走密度轴）
 *   tone?     default | quiet | brand | error | warning | success | info
 *   scope?    管线里登记的 scope 名（唯一的"特殊要求"入口）
 *   block?    撑满父宽
 *   disabled? / loading?
 * ══════════════════════════════════════════════════════════════════════════ */
import type { CSSProperties, ReactNode } from "react";

export type OGSize = "sm" | "md" | "lg";
export type OGTone = "default" | "quiet" | "brand" | "error" | "warning" | "success" | "info";
export type OGEmphasis = "solid" | "tonal" | "outline" | "ghost" | "plain";
export type OGLevel = 0 | 1 | 2 | 3;

/** 所有组件的公共接口 —— 子类只在此之上加自己的枚举（tone/title 由各组件自己声明） */
export interface OneBase {
  /** 控件尺度（走密度轴）：sm | md | lg */
  size?: OGSize;
  /** 管线 scope：组件挂 data-og-scope，读该 scope 的令牌 */
  scope?: string;
  className?: string;
  id?: string;
  /** DOM title 提示（不占 title 这个名字：卡片/行的 title 是内容槽） */
  titleAttr?: string;
  "aria-label"?: string;
  "data-testid"?: string;
  /** 允许把 data-* 透传到 DOM（暂存箱长按来源、拖拽锚点等） */
  [dataAttr: `data-${string}`]: string | undefined;
}

/** 收集 data-* 透传属性（React 组件默认不展开到 DOM） */
export function pickDataAttrs(p: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k.startsWith("data-") && typeof v === "string") out[k] = v;
  }
  return out;
}

/** 样式对象：一次 class 生成，不做字符串拼接散布在各处 */
export class OneStyle {
  readonly #name: string;
  readonly #mods: string[] = [];
  readonly #flags: string[] = [];

  constructor(name: string) {
    this.#name = name;
  }

  /** 变体（强调程度/形态）：default 不落类 */
  variant(v?: string): this {
    if (v && v !== "default") this.#mods.push(`--${v}`);
    return this;
  }

  /** 尺寸：md 是基准，不落类 */
  size(s?: string): this {
    if (s && s !== "md") this.#mods.push(`--${s}`);
    return this;
  }

  /** 语义色：default 不落类 */
  tone(t?: string): this {
    if (t && t !== "default") this.#mods.push(`--t-${t}`);
    return this;
  }

  /** 布尔状态：is-xxx */
  state(kind: string, on?: boolean): this {
    if (on) this.#flags.push(`is-${kind}`);
    return this;
  }

  /** 布局开关：block / inline / stretched 等 */
  layout(kind?: string): this {
    if (kind) this.#mods.push(`--${kind}`);
    return this;
  }

  /** 渲染成类名：一个修饰符一个类（基类 + 修饰符类 + 状态类），保持单类特异性 */
  toString(): string {
    const base = `og-${this.#name}`;
    return [base, ...this.#mods.map((m) => `${base}${m}`), ...this.#flags].join(" ");
  }

  /** 基类名（组合组件需要拼子部件时用） */
  get base(): string {
    return `og-${this.#name}`;
  }
}

/** 组件 CSS 里最外层的基类名：one("btn") → "og-btn" */
export function one(name: string): OneStyle {
  return new OneStyle(name);
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** scope 透传：组件生成 <div data-og-scope="x"> 的那个属性 */
export function scopeProps(scope?: string): { "data-og-scope"?: string } {
  return scope ? { "data-og-scope": scope } : {};
}

/**
 * 组件的公共 DOM 属性集合。**刻意不暴露 style** ——
 * 想要外观差异就去加枚举变体，或者登记 scope；内联样式不是接口。
 */
export interface OneDomProps {
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLElement>) => void;
  tabIndex?: number;
  role?: string;
}

export interface SlotProps {
  children?: ReactNode;
}

/** 组件内部（且只有内部）可以用的"受控内联"：CSS 变量也不是样式，是令牌传递 */
export type TokensStyle = CSSProperties & Record<`--og-${string}`, string | number>;
