/* OneGUI · 布局原语（Stack / Inline / Spacer / Grow）
 *
 * 页面的"排版"只有这四个动作：纵向堆叠、横向排列、撑开剩余、按比例生长。
 * 间距只能取 0–10 档（4pt 网格），从根上避免 13px/10px 这种随手值（旧代码里 688 处）。
 */
import type { ReactNode } from "react";
import { cx, one, scopeProps, type OneBase } from "./kit.js";

export type Gap = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type Align = "start" | "center" | "end" | "baseline" | "stretch";
export type Justify = "start" | "center" | "end" | "between" | "around";

export interface StackProps extends OneBase {
  /** 纵向间距档（4pt 网格） */
  gap?: Gap;
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
  /** 撑满父容器高度 */
  fill?: boolean;
  /** 内边距档 */
  pad?: Gap;
  as?: "div" | "section" | "article" | "main" | "aside" | "nav" | "header" | "footer" | "li";
  children?: ReactNode;
}

export function Stack({ gap = 0, align, justify, wrap, fill, pad, as: Tag = "div", scope, className, children }: StackProps): ReactNode {
  const cls = cx(
    one("stack").toString(),
    gap > 0 ? `og-stack--gap-${gap}` : "",
    align ? `og-stack--a-${align}` : "",
    justify ? `og-stack--j-${justify}` : "",
    wrap ? "og-stack--wrap" : "",
    fill ? "og-stack--fill" : "",
    pad !== undefined && pad > 0 ? `og-stack--p-${pad}` : "",
    className,
  );
  return (
    <Tag {...scopeProps(scope)} className={cls}>
      {children}
    </Tag>
  );
}

export interface InlineProps extends StackProps {
  /** 子项垂直对齐（默认 center） */
  vAlign?: Align;
  /** 让子项在行内等分 */
  spread?: boolean;
}

export function Inline({ gap = 2, vAlign = "center", spread, align, justify, wrap, fill, pad, as: Tag = "div", scope, className, children }: InlineProps): ReactNode {
  const cls = cx(
    one("inline").toString(),
    gap > 0 ? `og-inline--gap-${gap}` : "",
    `og-inline--a-${vAlign}`,
    justify ? `og-inline--j-${justify}` : "",
    spread ? "og-inline--spread" : "",
    wrap ? "og-inline--wrap" : "",
    fill ? "og-inline--fill" : "",
    pad !== undefined && pad > 0 ? `og-inline--p-${pad}` : "",
    align ? `og-inline--self-${align}` : "",
    className,
  );
  return (
    <Tag {...scopeProps(scope)} className={cls}>
      {children}
    </Tag>
  );
}

/** 撑开剩余空间（把后面的东西推到另一头） */
export function Spacer({ grow = true }: { grow?: boolean }): ReactNode {
  return <span className={grow ? "og-spacer" : "og-spacer og-spacer--fixed"} aria-hidden="true" />;
}

/** 按比例生长（flex: 1），用于"这一格占满" */
export function Grow({ children, className }: { children?: ReactNode; className?: string }): ReactNode {
  return <div className={cx("og-grow", className)}>{children}</div>;
}
