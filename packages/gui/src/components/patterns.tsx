/* OneGUI · 页面模式：Page / PageHead / Toolbar / SettingsList / Tabs / Segment / Banner / SectionCard
 *
 * 旧代码里的 9 套标签系统（tabstrip/segmented/seg-track/plg-tab/gitlab-tabs/thos-tabs/settings-seg/ex-tab…）
 * 与 8 种手写设置行，到这里全部收口。页面只需要给数据，不再自己拼 DOM 与样式。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./chip.js";
import { IconBtn } from "./button.js";
import { cx, one, scopeProps, type OGSize } from "./kit.js";
import { Card, Surface } from "./surface.js";
import { Section, Text } from "./text.js";
import { List, Row } from "./list.js";

/* ── 页面脚手架 ─────────────────────────────────────────────────────── */

export type PageWidth = "narrow" | "default" | "wide" | "full";

export interface PageProps {
  title?: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** 页头下方的标签条（Tabs/Segment） */
  tabs?: ReactNode;
  maxWidth?: PageWidth;
  flush?: boolean;
  scope?: string;
  className?: string;
  children?: ReactNode;
}

export function Page({ title, sub, meta, actions, tabs, maxWidth = "default", flush, scope, className, children }: PageProps): ReactNode {
  const cls = cx(
    "og-page",
    maxWidth !== "default" ? `og-page--${maxWidth}` : "",
    flush ? "og-page--flush" : "",
    className,
  );
  return (
    <div {...scopeProps(scope)} className={cls}>
      <div className="og-page-inner">
        {title !== undefined || actions ? <PageHead title={title} sub={sub} meta={meta} actions={actions} /> : null}
        {tabs}
        <div className="og-page-body">{children}</div>
      </div>
    </div>
  );
}

export interface PageHeadProps {
  title?: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** 返回按钮（详情页） */
  onBack?: () => void;
  scope?: string;
  className?: string;
}

export function PageHead({ title, sub, meta, actions, onBack, scope, className }: PageHeadProps): ReactNode {
  return (
    <div {...scopeProps(scope)} className={cx("og-pagehead", className)}>
      {onBack ? (
        <IconBtn label="返回" variant="ghost" onClick={onBack} icon={<Icon><path d="M15 5l-7 7 7 7" /></Icon>} />
      ) : null}
      <div className="og-pagehead-main">
        <div className="og-pagehead-topic">
          {typeof title === "string" ? <Text slot="display" as="h1" truncate>{title}</Text> : title}
        </div>
        {sub || meta ? (
          <div className="og-pagehead-sub">
            {typeof sub === "string" ? <span>{sub}</span> : sub}
            {meta}
          </div>
        ) : null}
      </div>
      {actions ? <div className="og-pagehead-actions">{actions}</div> : null}
    </div>
  );
}

/* ── 工具条 ─────────────────────────────────────────────────────────── */

export interface ToolbarProps {
  children: ReactNode;
  align?: "start" | "end" | "between";
  sticky?: boolean;
  divided?: boolean;
  scope?: string;
  className?: string;
}

export function Toolbar({ children, align = "start", sticky, divided, scope, className }: ToolbarProps): ReactNode {
  const inner = (
    <div className={cx("og-toolbar", align !== "start" ? `og-toolbar--${align}` : "", divided ? "og-toolbar--divided" : "", className)}>
      {children}
    </div>
  );
  if (!sticky) return inner;
  return (
    <Surface level={0} pad="sm" radius="lg" sticky {...scopeProps(scope)}>
      {inner}
    </Surface>
  );
}

/* ── 设置列表 ───────────────────────────────────────────────────────── */

export interface SettingsListProps {
  title?: ReactNode;
  sub?: ReactNode;
  headAside?: ReactNode;
  children: ReactNode;
  scope?: string;
  className?: string;
}

export function SettingsList({ title, sub, headAside, children, scope, className }: SettingsListProps): ReactNode {
  return (
    <Card flush className={cx("og-settings", className)} {...scopeProps(scope)}>
      {title || headAside ? (
        <div className="og-settings-head">
          <span className="og-settings-title">{title}</span>
          {headAside ? <span className="og-settings-sub">{headAside}</span> : null}
        </div>
      ) : null}
      {sub ? <div className="og-settings-sub og-settings-sub--lead">{sub}</div> : null}
      {children}
    </Card>
  );
}

export interface SettingsRowProps {
  /** DOM id（应用侧用它做检索直达锚点，例：id="row-开启悬浮球"） */
  id?: string;
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  /** 右侧只读值 */
  value?: ReactNode;
  /** 右侧控件（Switch / Select / Segment…） */
  control?: ReactNode;
  caret?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  scope?: string;
  className?: string;
}

export function SettingsRow({ id, icon, title, sub, value, control, caret, onClick, disabled, danger, scope, className }: SettingsRowProps): ReactNode {
  return (
    <div
      id={id}
      {...scopeProps(scope)}
      className={cx(one("settings-row").state("danger", danger).state("disabled", disabled).toString(), onClick ? "og-settings-row--interactive" : "", className)}
      onClick={disabled ? undefined : onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
      onKeyDown={onClick && !disabled ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      {icon ? <span className="og-settings-row-icon" aria-hidden="true">{icon}</span> : null}
      <span className="og-settings-row-main">
        <span className="og-settings-row-title">{title}</span>
        {sub ? <span className="og-settings-row-sub">{sub}</span> : null}
      </span>
      {value !== undefined && value !== null ? <span className="og-settings-row-value">{value}</span> : null}
      {control ? <span className="og-settings-row-control">{control}</span> : null}
      {caret ? <Icon size="sm" className="og-row-caret"><path d="M9 5l7 7-7 7" /></Icon> : null}
    </div>
  );
}

/* ── 标签条 / 分段控件：共享的滑动指示器 ────────────────────────────── */

export interface TabItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  variant?: "line" | "pill" | "soft";
  sticky?: boolean;
  scope?: string;
  className?: string;
}

/**
 * 指示器几何：位置与形变写在**同一条 transform** 上（历史教训：位置走 transform、长度走 height，
 * 两条线程各计时，主线程一忙就错位）。实现上直接量激活项与容器的相对几何，
 * 写到指示器自己的 transform 上 —— 不走"容器 CSS 变量"，少一层继承，也不怕容器重排。
 */
function useIndicator(indicatorRef: React.RefObject<HTMLElement | null>, activeEl: HTMLElement | null, deps: unknown[]): void {
  const apply = useCallback(() => {
    const ind = indicatorRef.current;
    const host = activeEl?.parentElement;
    if (!ind || !activeEl || !host) return;
    const hostRect = host.getBoundingClientRect();
    const rect = activeEl.getBoundingClientRect();
    if (hostRect.width === 0) return;
    const x = rect.left - hostRect.left + host.scrollLeft;
    const scale = rect.width / hostRect.width;
    ind.style.transformOrigin = "left center";
    // 竖直方向：line 变体贴底（不需要位移），pill/soft 由 CSS 的 translateY(-50%) 负责
    const vertical = ind.dataset.ogVertical === "1" ? " translateY(-50%)" : "";
    ind.style.transform = `translateX(${x}px)${vertical} scaleX(${scale})`;
  }, [activeEl, indicatorRef]);
  useLayoutEffect(apply, [apply, ...deps]);
  useEffect(() => {
    const onResize = (): void => apply();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [apply]);
}

export function Tabs({ items, value, onChange, variant = "line", sticky, scope, className }: TabsProps): ReactNode {
  const [activeEl, setActiveEl] = useState<HTMLElement | null>(null);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  useIndicator(indicatorRef, activeEl, [value, items.length]);
  const onKey = (e: React.KeyboardEvent, idx: number): void => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (idx + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    const item = items[next];
    if (item && !item.disabled) onChange(item.id);
  };
  return (
    <div
      {...scopeProps(scope)}
      className={cx("og-tabs", variant !== "line" ? `og-tabs--${variant}` : "", sticky ? "og-tabs--sticky" : "", className)}
      role="tablist"
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          disabled={item.disabled}
          className={cx("og-tab", item.id === value ? "is-active" : "")}
          onClick={() => onChange(item.id)}
          onKeyDown={(e) => onKey(e, i)}
          ref={(el) => { if (item.id === value) setActiveEl(el); }}
        >
          {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
          <span>{item.label}</span>
          {item.badge !== undefined ? <span className="og-tab-badge">{item.badge}</span> : null}
        </button>
      ))}
      <span ref={indicatorRef} data-og-vertical={variant === "line" ? "0" : "1"} data-og-dynamic="indicator" className="og-tabs-indicator" aria-hidden="true" />
    </div>
  );
}

export interface VerticalTabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  scope?: string;
  className?: string;
}

export function VerticalTabs({ items, value, onChange, scope, className }: VerticalTabsProps): ReactNode {
  return (
    <div {...scopeProps(scope)} className={cx("og-vtabs", className)} role="tablist" aria-orientation="vertical">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          disabled={item.disabled}
          className={cx("og-vtab", item.id === value ? "is-active" : "")}
          onClick={() => onChange(item.id)}
        >
          {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
          <span>{item.label}</span>
          {item.badge !== undefined ? <span className="og-tab-badge">{item.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export interface SegmentOption { value: string; label: ReactNode; icon?: ReactNode; disabled?: boolean }

export interface SegmentProps {
  options: SegmentOption[];
  value: string;
  onChange: (value: string) => void;
  size?: OGSize;
  block?: boolean;
  scope?: string;
  className?: string;
}

export function Segment({ options, value, onChange, size = "md", block, scope, className }: SegmentProps): ReactNode {
  const [activeEl, setActiveEl] = useState<HTMLElement | null>(null);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  useIndicator(indicatorRef, activeEl, [value, options.length]);
  return (
    <div
      {...scopeProps(scope)}
      className={cx("og-segment", block ? "og-segment--block" : "", size !== "md" ? `og-segment--${size}` : "", className)}
      role="radiogroup"
    >
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          disabled={opt.disabled}
          className={cx("og-segment-item", opt.value === value ? "is-active" : "")}
          onClick={() => onChange(opt.value)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            const next = (i + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
            const target = options[next];
            if (target && !target.disabled) onChange(target.value);
          }}
          ref={(el) => { if (opt.value === value) setActiveEl(el); }}
        >
          {opt.icon ? <span aria-hidden="true">{opt.icon}</span> : null}
          <span>{opt.label}</span>
        </button>
      ))}
      <span ref={indicatorRef} data-og-vertical="1" data-og-dynamic="indicator" className="og-segment-indicator" aria-hidden="true" />
    </div>
  );
}

/* ── 状态横幅 ───────────────────────────────────────────────────────── */

export interface BannerProps {
  tone?: "info" | "warning" | "error" | "success";
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  scope?: string;
  className?: string;
  children?: ReactNode;
}

export function Banner({ tone = "info", title, icon, action, onDismiss, scope, className, children }: BannerProps): ReactNode {
  return (
    <div {...scopeProps(scope)} className={cx(one("banner").tone(tone).toString(), className)} role={tone === "error" ? "alert" : "status"}>
      {icon !== undefined ? <span className="og-banner-icon" aria-hidden="true">{icon}</span> : null}
      <div className="og-banner-main">
        {title ? <span className="og-banner-title">{title}</span> : null}
        {children ?? null}
      </div>
      {action ? <div className="og-banner-action">{action}</div> : null}
      {onDismiss ? <IconBtn label="关闭" variant="ghost" size="sm" onClick={onDismiss} icon={<Icon><path d="M6 6l12 12M18 6L6 18" /></Icon>} /> : null}
    </div>
  );
}

/* ── 装配块：带标题的卡片（今日课程 / 待办 / 最近文件…） ─────────────── */

export interface SectionCardProps {
  title: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
  pad?: "sm" | "md" | "lg";
  flush?: boolean;
  scope?: string;
  className?: string;
  children: ReactNode;
}

export function SectionCard({ title, sub, aside, pad = "md", flush, scope, className, children }: SectionCardProps): ReactNode {
  return (
    <Card pad={pad} flush={flush} className={className} {...scopeProps(scope)}>
      <Section title={title} hint={sub} aside={aside} />
      {children}
    </Card>
  );
}

/* ── 加载块：骨架行（不引 display.tsx，避免批次互相依赖） ────────────── */

export interface LoadingBlockProps {
  rows?: number;
  scope?: string;
  className?: string;
}

export function LoadingBlock({ rows = 3, scope, className }: LoadingBlockProps): ReactNode {
  return (
    <div {...scopeProps(scope)} className={cx("og-loading", className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="og-loading-row">
          <span className="og-loading-avatar og-skeleton" />
          <span className="og-loading-lines">
            <span className="og-loading-line og-skeleton" />
            <span className={cx("og-loading-line og-skeleton", i % 2 === 0 ? "og-loading-line--short" : "og-loading-line--mid")} />
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── 常用列表卡：Card + List + Row 的组合（云盘/作业/通知/邮件共用） ─── */

export interface DataListProps<T> {
  items: T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
  empty?: ReactNode;
  divided?: boolean;
  scope?: string;
  className?: string;
}

export function DataList<T>({ items, keyOf, render, empty, divided, scope, className }: DataListProps<T>): ReactNode {
  if (items.length === 0 && empty) return <>{empty}</>;
  return (
    <Card flush className={cx("og-datalist", className)} {...scopeProps(scope)}>
      <List divided={divided}>
        {items.map((item) => (
          <div key={keyOf(item)} className="og-datalist-item">
            {render(item)}
          </div>
        ))}
      </List>
    </Card>
  );
}

/** 列表里的一行（DataList 的标准行，等价于 Row flush） */
export function DataRow(props: Parameters<typeof Row>[0]): ReactNode {
  return <Row {...props} flush />;
}

export { Row };
