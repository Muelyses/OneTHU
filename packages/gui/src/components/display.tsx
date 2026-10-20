/* OneGUI · 展示件：Avatar / Tile / StatTile / Table / Accordion / Progress / Ring /
 *                     Skeleton / Timeline / Breadcrumb / Pagination / CodeBlock / Spinner
 *
 * 进度条与骨架屏的皮肤在 styles/chip.css（.og-progress / .og-skeleton），这里只给结构与 API。
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { cx, one, scopeProps, type OGSize, type OneBase } from "./kit.js";

/* ── Avatar ─────────────────────────────────────────────────────────── */

export type AvatarTone = "neutral" | "accent" | "info" | "success" | "warning" | "error";

export interface AvatarProps extends Omit<OneBase, "size"> {
  name?: string;
  src?: string;
  size?: "sm" | "md" | "lg" | "xl";
  tone?: AvatarTone;
}

const TONES: AvatarTone[] = ["accent", "info", "success", "warning", "error"];

function toneOf(seed: string): AvatarTone {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 997;
  return TONES[h % TONES.length] ?? "accent";
}

export function Avatar({ name, src, size = "md", tone, scope, className }: AvatarProps): ReactNode {
  const seed = name ?? "";
  const t = tone ?? (seed ? toneOf(seed) : "neutral");
  return (
    <span
      {...scopeProps(scope)}
      className={cx(one("avatar").size(size).tone(t === "neutral" ? undefined : t).toString(), className)}
      aria-label={name}
      role="img"
    >
      {src ? <img src={src} alt={name ?? ""} /> : (seed ? [...seed][0] : null)}
    </span>
  );
}

/* ── Tile ───────────────────────────────────────────────────────────── */

export interface TileProps extends OneBase {
  icon?: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  badge?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function Tile({ icon, label, sub, badge, active, disabled, onClick, scope, className }: TileProps): ReactNode {
  return (
    <button
      type="button"
      {...scopeProps(scope)}
      className={cx(one("tile").state("active", active).state("disabled", disabled).toString(), className)}
      disabled={disabled}
      onClick={onClick}
    >
      {icon ? (
        <span className="og-tile-icon">
          {icon}
          {badge ? <span className="og-tile-badge">{badge}</span> : null}
        </span>
      ) : null}
      <span className="og-tile-label">{label}</span>
      {sub ? <span className="og-tile-sub">{sub}</span> : null}
    </button>
  );
}

/* ── StatTile ───────────────────────────────────────────────────────── */

export interface StatTileProps extends OneBase {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  tone?: AvatarTone;
  onClick?: () => void;
}

export function StatTile({ label, value, unit, hint, tone, onClick, scope, className }: StatTileProps): ReactNode {
  return (
    <div
      {...scopeProps(scope)}
      className={cx(one("stat").tone(tone && tone !== "neutral" ? tone : undefined).state("interactive", Boolean(onClick)).toString(), className)}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
    >
      <span className="og-stat-label">{label}</span>
      <span className="og-stat-value">
        {value}
        {unit ? <span className="og-stat-unit">{unit}</span> : null}
      </span>
      {hint ? <span className="og-stat-hint">{hint}</span> : null}
    </div>
  );
}

/* ── Table ──────────────────────────────────────────────────────────── */

export interface TableColumn<T> {
  key: string;
  title: ReactNode;
  width?: string;
  align?: "left" | "right" | "center";
  mono?: boolean;
  render?: (row: T, index: number) => ReactNode;
  value?: (row: T) => ReactNode;
}

export interface TableProps<T> extends OneBase {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  dense?: boolean;
}

export function Table<T>({ columns, rows, rowKey, onRowClick, empty, dense, scope, className }: TableProps<T>): ReactNode {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div {...scopeProps(scope)} className={cx("og-table-wrap", className)}>
      <table className={cx("og-table", dense ? "og-table--dense" : "")}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={col.width ? { width: col.width } : undefined} className={col.align ? `og-table__${col.align === "right" ? "right" : "center"}` : undefined}>
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined} className={onRowClick ? "og-table__clickable" : undefined}>
              {columns.map((col) => (
                <td key={col.key} className={cx(col.mono ? "og-table__num" : "", col.align ? `og-table__${col.align === "right" ? "right" : "center"}` : "")}>
                  {col.render ? col.render(row, i) : col.value ? col.value(row) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Accordion ──────────────────────────────────────────────────────── */

export interface AccordionItemProps {
  id: string;
  title: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
  /** 由 Accordion 注入；单独使用时省略（默认收起） */
  open?: boolean;
  onToggle?: (id: string) => void;
}

export function AccordionItem({ id, title, sub, trailing, children, open = false, onToggle }: AccordionItemProps): ReactNode {
  return (
    <div className={cx("og-accordion-item", open ? "is-open" : "")}>
      <button type="button" className="og-accordion-head" aria-expanded={open} onClick={() => onToggle?.(id)}>
        <span className="og-accordion-main">
          <span className="og-accordion-title">{title}</span>
          {sub ? <span className="og-accordion-sub">{sub}</span> : null}
        </span>
        {trailing}
        <span className="og-accordion-caret" aria-hidden="true">
          <svg className="og-icon og-icon--sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><path d="M9 5l7 7-7 7" /></svg>
        </span>
      </button>
      <div className="og-accordion-body" inert={!open} aria-hidden={!open}>
        <div>
          <div className="og-accordion-content">{children}</div>
        </div>
      </div>
    </div>
  );
}

export interface AccordionProps {
  defaultOpenKeys?: string[];
  openKeys?: string[];
  onToggle?: (id: string) => void;
  scope?: string;
  className?: string;
  children: ReactNode;
}

export function Accordion({ defaultOpenKeys = [], openKeys, onToggle, scope, className, children }: AccordionProps): ReactNode {
  const [inner, setInner] = useState<string[]>(defaultOpenKeys);
  const keys = openKeys ?? inner;
  const toggle = (id: string): void => {
    if (openKeys === undefined) setInner((prev) => (prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]));
    onToggle?.(id);
  };
  // 由 Accordion 把 open/toggle 注入子项（子项也可以自己算）
  return (
    <div {...scopeProps(scope)} className={cx("og-accordion", className)}>
      {Array.isArray(children)
        ? (children as Array<{ props?: AccordionItemProps } | null>).map((child, i) => {
            const props = child?.props;
            if (!props || typeof props.id !== "string") return child as ReactNode;
            return <AccordionItem key={props.id} {...props} open={keys.includes(props.id)} onToggle={toggle} />;
          })
        : children}
    </div>
  );
}

/* ── Progress / Ring / Skeleton / Spinner ───────────────────────────── */

export interface ProgressProps extends OneBase {
  value: number;
  tone?: "accent" | "error" | "warning" | "success" | "info";
  size?: "sm" | "md" | "lg";
  label?: ReactNode;
  showValue?: boolean;
}

export function Progress({ value, tone = "accent", size = "md", label, showValue, scope, className }: ProgressProps): ReactNode {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div {...scopeProps(scope)} className={cx("og-progress-block", className)}>
      {label || showValue ? (
        <div className="og-progress-head">
          <span className="og-progress-label">{label}</span>
          {showValue ? <span className="og-progress-pct">{Math.round(pct)}%</span> : null}
        </div>
      ) : null}
      <div className={cx(one("progress").size(size).tone(tone === "accent" ? undefined : tone).toString())} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="og-progress-fill" data-og-dynamic="progress" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export interface RingProps extends OneBase {
  value: number;
  size?: "sm" | "md" | "lg";
  tone?: "accent" | "error" | "warning" | "success" | "info";
  children?: ReactNode;
}

const RING_SIZE = { sm: 28, md: 40, lg: 56 } as const;
const RING_STROKE = { sm: 3, md: 4, lg: 5 } as const;

export function Ring({ value, size = "md", tone = "accent", children, scope, className }: RingProps): ReactNode {
  const pct = Math.max(0, Math.min(1, value));
  const d = RING_SIZE[size];
  const sw = RING_STROKE[size];
  const r = (d - sw) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span {...scopeProps(scope)} className={cx(one("ring").tone(tone === "accent" ? undefined : tone).toString(), className)}>
      <svg width={d} height={d} viewBox={`0 0 ${d} ${d}`} aria-hidden="true">
        <circle className="og-ring-track" cx={d / 2} cy={d / 2} r={r} fill="none" strokeWidth={sw} />
        <circle
          className="og-ring-fill"
          cx={d / 2}
          cy={d / 2}
          r={r}
          fill="none"
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      {children ? <span className="og-ring-content">{children}</span> : null}
    </span>
  );
}

export type SkeletonSize = "xs" | "sm" | "md" | "lg" | "xl" | "full";

export interface SkeletonProps extends OneBase {
  width?: SkeletonSize;
  height?: SkeletonSize;
  radius?: "sm" | "md" | "full";
  lines?: number;
  circle?: boolean;
}

export function Skeleton({ width = "full", height = "sm", radius = "sm", lines, circle, scope, className }: SkeletonProps): ReactNode {
  if (lines && lines > 1) {
    return (
      <div {...scopeProps(scope)} className={cx("og-skeleton-lines", className)}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className={cx("og-skeleton", `og-skeleton--w-${i === lines - 1 ? "lg" : "full"}`, `og-skeleton--h-${height}`, `og-skeleton--r-${circle ? "full" : radius}`)} />
        ))}
      </div>
    );
  }
  return (
    <span
      {...scopeProps(scope)}
      className={cx("og-skeleton", circle ? "og-skeleton--w-lg" : `og-skeleton--w-${width}`, `og-skeleton--h-${height}`, `og-skeleton--r-${circle ? "full" : radius}`, circle ? "og-skeleton--circle" : "", className)}
    />
  );
}

export interface SpinnerProps extends OneBase {
  size?: OGSize;
  inverse?: boolean;
}

export function Spinner({ size = "md", inverse, scope, className }: SpinnerProps): ReactNode {
  return (
    <span
      {...scopeProps(scope)}
      className={cx("og-spinner", size !== "md" ? `og-spinner--${size}` : "", inverse ? "og-spinner--inverse" : "", className)}
      role="status"
      aria-label="加载中"
    />
  );
}

/* ── Timeline / Breadcrumb / Pagination / CodeBlock ─────────────────── */

export interface TimelineItem {
  id?: string;
  time: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  tone?: "accent" | "error" | "warning" | "success";
  icon?: ReactNode;
}

export function Timeline({ items, scope, className }: { items: TimelineItem[]; scope?: string; className?: string }): ReactNode {
  return (
    <div {...scopeProps(scope)} className={cx("og-timeline", className)}>
      {items.map((item, i) => (
        <div key={item.id ?? i} className={cx("og-timeline-item", item.tone && item.tone !== "accent" ? `og-timeline-item--t-${item.tone}` : "")}>
          <span className="og-timeline-rail">{item.icon ?? <span className="og-timeline-dot" />}</span>
          <span className="og-timeline-body">
            <span className="og-timeline-head">
              <span className="og-timeline-title">{item.title}</span>
              <span className="og-timeline-time">{item.time}</span>
            </span>
            {item.sub ? <span className="og-accordion-sub">{item.sub}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface BreadcrumbProps {
  items: Array<{ label: ReactNode; onClick?: () => void }>;
  separator?: ReactNode;
  scope?: string;
  className?: string;
}

export function Breadcrumb({ items, separator = "/", scope, className }: BreadcrumbProps): ReactNode {
  return (
    <nav {...scopeProps(scope)} className={cx("og-crumbs", className)} aria-label="面包屑">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="og-crumb-wrap">
            {i > 0 ? <span className="og-crumb-sep" aria-hidden="true">{separator}</span> : null}
            <button type="button" className={cx("og-crumb", last ? "is-current" : "")} onClick={last ? undefined : item.onClick} disabled={last}>
              {item.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

export interface PaginationProps {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  size?: OGSize;
  scope?: string;
  className?: string;
}

export function Pagination({ page, pageCount, onChange, scope, className }: PaginationProps): ReactNode {
  if (pageCount <= 1) return null;
  const window: Array<number | "…"> = [];
  for (let p = 1; p <= pageCount; p += 1) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) window.push(p);
    else if (window[window.length - 1] !== "…") window.push("…");
  }
  return (
    <div {...scopeProps(scope)} className={cx("og-pagination", className)}>
      <button type="button" className="og-page-btn" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="上一页">‹</button>
      {window.map((p, i) => p === "…"
        ? <span key={`e${i}`} className="og-page-ellipsis">…</span>
        : <button key={p} type="button" className={cx("og-page-btn", p === page ? "is-current" : "")} onClick={() => onChange(p)} aria-current={p === page}>{p}</button>)}
      <button type="button" className="og-page-btn" disabled={page >= pageCount} onClick={() => onChange(page + 1)} aria-label="下一页">›</button>
    </div>
  );
}

export interface CodeBlockProps extends OneBase {
  code: string;
  lang?: string;
  onCopy?: () => void;
}

export function CodeBlock({ code, lang, onCopy, scope, className }: CodeBlockProps): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <pre {...scopeProps(scope)} className={cx("og-code", className)} data-lang={lang}>
      {code}
      <button
        type="button"
        className="og-page-btn og-code-copy"
        onClick={() => {
          void navigator.clipboard?.writeText(code);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
          onCopy?.();
        }}
      >
        {copied ? "已复制" : "复制"}
      </button>
    </pre>
  );
}

/** A cropped media image. Only focal point and zoom are dynamic geometry;
 * colors and layout remain owned by OneGUI. */
export interface FocalImageProps extends Omit<OneBase, "size"> {
  src: string;
  alt?: string;
  focusX?: number;
  focusY?: number;
  zoom?: number;
}

export function FocalImage({ src, alt = "", focusX = .5, focusY = .5, zoom = 1, scope, className }: FocalImageProps): ReactNode {
  const bounded = (v: number, fallback: number, min: number, max: number): number => Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
  return <img
    {...scopeProps(scope)}
    className={cx(one("focal-image").toString(), className)}
    src={src} alt={alt} draggable={false}
    data-og-dynamic="focal-image"
    style={{
      "--og-c-image-x": `${bounded(focusX, .5, 0, 1) * 100}%`,
      "--og-c-image-y": `${bounded(focusY, .5, 0, 1) * 100}%`,
      "--og-c-image-zoom": bounded(zoom, 1, 1, 5),
    } as CSSProperties}
  />;
}
