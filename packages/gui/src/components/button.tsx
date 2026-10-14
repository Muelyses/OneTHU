/* OneGUI · 按钮族：全站唯一的可点矩形（Btn / IconBtn / FAB） */
import type { ReactNode } from "react";
import { cx, one, scopeProps, type OGEmphasis, type OGSize, type OGTone, type OneBase } from "./kit.js";

export interface BtnProps extends OneBase {
  variant?: OGEmphasis;
  tone?: OGTone;
  /** 撑满父宽 */
  block?: boolean;
  /** 在 flex 行里等分拉伸 */
  stretched?: boolean;
  loading?: boolean;
  disabled?: boolean;
  selected?: boolean;
  /** 左侧图标槽（传 <Icon…/>） */
  icon?: ReactNode;
  iconRight?: ReactNode;
  /** 给了 href 就渲染成 <a>（UX 与按钮一致，样式同源） */
  href?: string;
  target?: string;
  rel?: string;
  type?: "button" | "submit" | "reset";
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseUp?: (e: React.MouseEvent<HTMLElement>) => void;
  onContextMenu?: (e: React.MouseEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLElement>) => void;
  tabIndex?: number;
  autoFocus?: boolean;
  /** 状态语义（可访问性）：下拉/展开/按下三态与 role 都透传 */
  role?: string;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "menu" | "dialog" | "listbox" | "true" | "false";
  children?: ReactNode;
}

export function Btn({
  variant = "ghost", tone = "default", size = "md", block, stretched, loading, disabled, selected,
  icon, iconRight, href, target, rel, type = "button", scope, className, titleAttr, children, ...dom
}: BtnProps): ReactNode {
  const cls = cx(
    one("btn").variant(variant).size(size).tone(tone).layout(block ? "block" : stretched ? "stretched" : undefined).toString(),
    "og-interactive",
    loading ? "is-loading" : "",
    selected ? "is-selected" : "",
    disabled ? "is-disabled" : "",
    className,
  );
  const body = (
    <>
      {icon ? <span className="og-btn-icon" aria-hidden="true">{icon}</span> : null}
      {children !== undefined && children !== null ? <span className="og-btn-label">{children}</span> : null}
      {iconRight ? <span className="og-btn-icon" aria-hidden="true">{iconRight}</span> : null}
      {loading ? <span className="og-btn-spinner" aria-hidden="true" /> : null}
    </>
  );
  if (href && !disabled && !loading) {
    return (
      <a {...scopeProps(scope)} className={cls} href={href} target={target} rel={rel} title={titleAttr} {...dom}>
        {body}
      </a>
    );
  }
  return (
    <button {...scopeProps(scope)} className={cls} type={type} title={titleAttr} disabled={disabled || loading} aria-busy={loading || undefined} {...dom}>
      {body}
    </button>
  );
}

export interface IconBtnProps extends Omit<BtnProps, "icon" | "iconRight" | "block" | "stretched"> {
  /** 无文字按钮必须给无障碍标签（= title + aria-label） */
  label: string;
  icon: ReactNode;
  /** 圆形（悬浮球、FAB 族） */
  round?: boolean;
}

/** 方形/圆形图标按钮：与 Btn 同一套色料、状态层、焦点环 */
export function IconBtn({ label, icon, round, className, size = "md", ...rest }: IconBtnProps): ReactNode {
  const cls = cx(
    one("iconbtn").size(size).tone(rest.tone ?? "default").variant(rest.variant ?? "ghost").toString(),
    round ? "og-iconbtn--round" : "",
    className,
  );
  return (
    <Btn {...rest} size={size} className={cls} titleAttr={rest.titleAttr ?? label} aria-label={label} icon={icon} />
  );
}

export interface FabProps extends Omit<IconBtnProps, "round"> {
  /** 右下浮动动作钮（白板 ➕、刷新） */
  variant?: OGEmphasis;
}

export function Fab({ className, ...rest }: FabProps): ReactNode {
  return <IconBtn {...rest} round className={cx("og-btn--fab", className)} variant={rest.variant ?? "tonal"} />;
}

export interface BtnGroupProps {
  children: ReactNode;
  scope?: string;
  className?: string;
}

export function BtnGroup({ children, scope, className }: BtnGroupProps): ReactNode {
  return (
    <div {...scopeProps(scope)} className={cx("og-btngroup", className)} role="group">
      {children}
    </div>
  );
}
