/* OneGUI · 面与卡：唯一的"块"入口（面阶/浮起/圆角/内边距全是枚举） */
import type { ReactNode } from "react";
import { cx, one, scopeProps, type OneBase } from "./kit.js";

export type SurfacePad = "none" | "sm" | "md" | "lg" | "xl";
export type SurfaceRadius = "sm" | "md" | "lg" | "xl" | "2xl";
export type SurfaceTag = "div" | "section" | "article" | "aside" | "li" | "nav" | "header" | "footer" | "main";

export interface SurfaceProps extends OneBase {
  /** 面阶：0 = 画布上的正面；1/2 = 卡内嵌套；3 = 更深 */
  level?: 0 | 1 | 2 | 3;
  /** 浮起高度：0–3（0 = 不写，走皮肤默认） */
  elevation?: 0 | 1 | 2 | 3;
  /** 向下凹的块（代码块/输入区底座） */
  sunken?: boolean;
  /** 浮层面（菜单/弹窗） */
  overlay?: boolean;
  /** 无底无框（只借圆角与裁剪） */
  plain?: boolean;
  pad?: SurfacePad;
  radius?: SurfaceRadius;
  /** 吸顶（页面工具条、筛选条）—— 层高走 --og-z-sticky */
  sticky?: boolean;
  interactive?: boolean;
  selected?: boolean;
  disabled?: boolean;
  as?: SurfaceTag;
  role?: string;
  tabIndex?: number;
  "aria-label"?: string;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  children?: ReactNode;
}

/** 构建 .og-surface 的类名（Card 与其它派生面共用这一处） */
export function surfaceClass(p: SurfaceProps): string {
  const shape = p.plain ? "plain" : p.overlay ? "overlay" : p.sunken ? "sunken" : p.level && p.level > 0 ? `l${p.level}` : undefined;
  return one("surface")
    .variant(shape)
    .variant(p.elevation ? `e${p.elevation}` : undefined)
    .variant(p.radius && p.radius !== "lg" ? `r-${p.radius}` : undefined)
    .variant(p.pad && p.pad !== "none" ? `p-${p.pad}` : undefined)
    .state("selected", p.selected)
    .state("disabled", p.disabled)
    .state("interactive", p.interactive)
    .state("sticky", p.sticky)
    .toString();
}

export function Surface({ as: Tag = "div", scope, className, children, ...rest }: SurfaceProps): ReactNode {
  const cls = surfaceClass({ ...rest, className });
  return (
    <Tag {...scopeProps(scope)} className={cx(cls, className)} {...pickDom(rest)}>
      {children}
    </Tag>
  );
}

/** 只把 DOM 事件透传给标签，其余（枚举 prop）不进 DOM */
function pickDom(p: SurfaceProps): { role?: string; tabIndex?: number; "aria-label"?: string; onClick?: (e: React.MouseEvent<HTMLElement>) => void; onMouseDown?: (e: React.MouseEvent<HTMLElement>) => void; onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void } {
  const { role, tabIndex } = p;
  const aria = p["aria-label"];
  const out: ReturnType<typeof pickDom> = {};
  if (role) out.role = role;
  if (tabIndex !== undefined) out.tabIndex = tabIndex;
  if (aria) out["aria-label"] = aria;
  if (p.onClick) out.onClick = p.onClick;
  if (p.onMouseDown) out.onMouseDown = p.onMouseDown;
  if (p.onKeyDown) out.onKeyDown = p.onKeyDown;
  return out;
}

export interface CardProps extends Omit<SurfaceProps, "as" | "pad" | "level" | "plain" | "sunken"> {
  /** 卡面头部：标题 + 右侧动作 */
  title?: ReactNode;
  headAside?: ReactNode;
  /** 卡底操作条 */
  foot?: ReactNode;
  /** 卡内边距档（默认 md = --og-card-pad） */
  pad?: SurfacePad;
  /** 卡内嵌套层级（默认 0） */
  level?: 0 | 1 | 2 | 3;
  /** 贴边（列表卡：内容自己贴到卡边，靠 List 行内边距） */
  flush?: boolean;
  children?: ReactNode;
}

/** 卡片：全站所有"一块内容"的容器。云盘格子、作业卡、设置分组都从这里派生 */
export function Card({ title, headAside, foot, flush, children, className, pad = "md", level = 0, ...rest }: CardProps): ReactNode {
  const cls = cx(
    surfaceClass({ ...rest, level, pad: flush ? "none" : pad }),
    "og-card",
    flush ? "og-card--flush" : "",
    className,
  );
  const hasHead = Boolean(title || headAside);
  return (
    <div {...scopeProps(rest.scope)} className={cls} {...pickDom(rest)}>
      {hasHead ? (
        <div className="og-card-head">
          {typeof title === "string" ? <div className="og-card-title">{title}</div> : title}
          {headAside ? <div className="og-section-aside">{headAside}</div> : null}
        </div>
      ) : null}
      {flush ? children : <div className="og-card-body">{children}</div>}
      {foot ? <div className="og-card-foot">{foot}</div> : null}
    </div>
  );
}

export type GridMin = "sm" | "md" | "lg";

export interface GridProps {
  /** 最小列宽档（受控枚举，不写死像素；自适应列数） */
  min?: GridMin;
  scope?: string;
  className?: string;
  children?: ReactNode;
}

/** 卡片栅格：文件浏览器、插件市场、服务目录、白板入口共用同一套列宽 */
export function Grid({ min = "md", scope, className, children }: GridProps): ReactNode {
  return (
    <div {...scopeProps(scope)} className={cx(one("grid").variant(min).toString(), className)}>
      {children}
    </div>
  );
}
