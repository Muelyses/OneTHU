/* OneGUI · 行与列表：全站唯一"一行东西"的模型（List / Row / EmptyState） */
import type { ReactNode } from "react";
import { cx, one, pickDataAttrs, scopeProps, type OneBase } from "./kit.js";

export type RowSize = "sm" | "md" | "lg";

export interface ListProps {
  children: ReactNode;
  /** 行间分隔线（功能性列表用它；卡片式列表不用） */
  divided?: boolean;
  /** 行间距档：0 表示紧贴 */
  gap?: 0 | 1 | 2 | 3;
  flush?: boolean;
  scope?: string;
  className?: string;
}

export function List({ children, divided, gap = 0, flush, scope, className }: ListProps): ReactNode {
  const cls = cx(
    "og-list",
    gap > 0 ? `og-list--gap-${gap}` : "",
    divided ? "og-list--divided" : "",
    flush ? "og-list--flush" : "",
    className,
  );
  return (
    <div {...scopeProps(scope)} className={cls} role="list">
      {children}
    </div>
  );
}

export interface RowProps extends OneBase {
  /** 左件：图标 / 头像 / 表情 / 复选框 */
  leading?: ReactNode;
  title?: ReactNode;
  /** 副题（第二行，弱化） */
  sub?: ReactNode;
  /** 标题后紧跟的元信息（时间、大小、标签） */
  meta?: ReactNode;
  /** 右件：数值、状态、按钮 */
  trailing?: ReactNode;
  /** 右侧箭头（可进入的行才有） */
  caret?: boolean;
  size?: RowSize;
  selected?: boolean;
  active?: boolean;
  disabled?: boolean;
  /** 贴边（列表卡里的整行） */
  flush?: boolean;
  compact?: boolean;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  href?: string;
  titleAttr?: string;
  role?: string;
  tabIndex?: number;
  children?: ReactNode;
}

/** 一行：左件 + 主列（标题/副题/元信息）+ 右件。全站所有列表行都是它的实例 */
export function Row({
  leading, title, sub, meta, trailing, caret, size = "md", selected, active, disabled, flush, compact,
  href, scope, className, children, titleAttr, ...dom
}: RowProps): ReactNode {
  const interactive = Boolean(dom.onClick || href);
  const cls = cx(
    one("row").size(size).state("selected", selected).state("active", active).state("disabled", disabled).toString(),
    flush ? "og-row--flush" : "",
    compact ? "og-row--compact" : "",
    interactive ? "og-row--interactive og-interactive" : "",
    className,
  );
  const inner = (
    <>
      {leading !== undefined ? <span className="og-row-leading">{leading}</span> : null}
      <span className="og-row-main">
        {title !== undefined && title !== null ? (
          <span className="og-row-line">
            <span className="og-row-title">{title}</span>
            {meta !== undefined && meta !== null ? <span className="og-row-sub">{meta}</span> : null}
          </span>
        ) : null}
        {sub !== undefined && sub !== null ? <span className="og-row-sub">{sub}</span> : null}
        {children}
      </span>
      {trailing !== undefined && trailing !== null ? <span className="og-row-trailing">{trailing}</span> : null}
      {caret ? <span className="og-row-caret" aria-hidden="true">›</span> : null}
    </>
  );
  const dataAttrs = pickDataAttrs(dom as unknown as Record<string, unknown>);
  if (href && !disabled) {
    return (
      <a {...scopeProps(scope)} {...dataAttrs} className={cls} href={href} title={titleAttr} role={dom.role ?? "listitem"} {...pick(dom)}>
        {inner}
      </a>
    );
  }
  return (
    <div
      {...scopeProps(scope)}
      {...dataAttrs}
      className={cls}
      title={titleAttr}
      role={dom.role ?? "listitem"}
      tabIndex={interactive ? (dom.tabIndex ?? 0) : dom.tabIndex}
      onClick={disabled ? undefined : dom.onClick}
      onMouseDown={dom.onMouseDown}
      onKeyDown={dom.onKeyDown}
      aria-disabled={disabled || undefined}
      aria-selected={selected || undefined}
    >
      {inner}
    </div>
  );
}

function pick(p: { onClick?: (e: React.MouseEvent<HTMLElement>) => void; onMouseDown?: (e: React.MouseEvent<HTMLElement>) => void; onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void }): {
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
} {
  const out: ReturnType<typeof pick> = {};
  if (p.onClick) out.onClick = p.onClick;
  if (p.onMouseDown) out.onMouseDown = p.onMouseDown;
  if (p.onKeyDown) out.onKeyDown = p.onKeyDown;
  return out;
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title?: ReactNode;
  hint?: ReactNode;
  /** 下一步动作（能给出下一步的一定要给按钮） */
  action?: ReactNode;
  scope?: string;
  className?: string;
}

export function EmptyState({ icon, title, hint, action, scope, className }: EmptyStateProps): ReactNode {
  return (
    <div {...scopeProps(scope)} className={cx("og-empty", className)}>
      {icon ? <div className="og-empty-icon" aria-hidden="true">{icon}</div> : null}
      {title ? (typeof title === "string" ? <div className="og-empty-title">{title}</div> : title) : null}
      {hint ? (typeof hint === "string" ? <div className="og-empty-hint">{hint}</div> : hint) : null}
      {action ? <div className="og-empty-action">{action}</div> : null}
    </div>
  );
}

/** 分隔线：一条线也是一个组件（不许在页面里画 border） */
export function Divider({ inset, vertical, scope, className }: { inset?: boolean; vertical?: boolean; scope?: string; className?: string }): ReactNode {
  return <div {...scopeProps(scope)} className={cx("og-divider", inset ? "og-divider--inset" : "", vertical ? "og-divider--v" : "", className)} role="separator" />;
}
