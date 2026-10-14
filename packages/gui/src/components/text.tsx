/* OneGUI · 文本：唯一的文字入口（字号/颜色/截断都在这里，页面不许自己写 font-size） */
import type { ReactNode } from "react";
import { cx, one, scopeProps, type OneBase } from "./kit.js";

export type TextSlot = "display" | "title" | "subtitle" | "body" | "label" | "micro";
export type TextTone =
  | "default" | "quiet" | "faint" | "brand" | "error" | "warning" | "success" | "info"
  | "inverse" | "inverse-2" | "disabled";
export type TextWeight = "regular" | "medium" | "semibold" | "bold";
export type TextTag = "span" | "div" | "p" | "h1" | "h2" | "h3" | "h4" | "b" | "i" | "strong" | "small" | "code";

export interface TextProps extends OneBase {
  /** 语义字阶（六档，一档一义）。默认 body */
  slot?: TextSlot;
  tone?: TextTone;
  weight?: TextWeight;
  mono?: boolean;
  /** 单行截断 / 多行截断 */
  truncate?: boolean;
  clamp?: 2 | 3;
  nowrap?: boolean;
  as?: TextTag;
  children?: ReactNode;
}

const DEFAULT_TAGS: Partial<Record<TextSlot, TextTag>> = { display: "h1", title: "h2", subtitle: "h3" };

export function Text({
  slot = "body", tone = "default", weight, mono, truncate, clamp, nowrap, as, scope, className, children, ...rest
}: TextProps): ReactNode {
  const Tag = as ?? DEFAULT_TAGS[slot] ?? "span";
  const cls = one("text")
    .size(slot === "body" ? undefined : slot)
    .tone(tone === "default" ? undefined : tone)
    .toString();
  return (
    <Tag
      {...scopeProps(scope)}
      className={cx(
        cls,
        weight ? `og-text--w-${weight}` : "",
        mono ? "og-text--mono" : "",
        truncate ? "og-text--truncate" : "",
        clamp ? `og-text--clamp${clamp}` : "",
        nowrap ? "og-text--nowrap" : "",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export interface SectionProps {
  /** 区块标题（subtitle 档） */
  title: ReactNode;
  /** 标题右侧的弱化说明 */
  hint?: ReactNode;
  /** 右侧动作槽（按钮/切换） */
  aside?: ReactNode;
  scope?: string;
  className?: string;
  children?: ReactNode;
}

/** 页内分区头：一页里所有"小标题 + 右侧动作"都用它，不许各写一套 */
export function Section({ title, hint, aside, scope, className, children }: SectionProps): ReactNode {
  return (
    <div {...scopeProps(scope)} className={cx("og-section", className)}>
      <div className="og-section-titles">
        {typeof title === "string" ? <Text slot="subtitle" as="h3">{title}</Text> : title}
        {hint ? (typeof hint === "string" ? <Text slot="label" tone="faint">{hint}</Text> : hint) : null}
      </div>
      {aside ? <div className="og-section-aside">{aside}</div> : null}
      {children}
    </div>
  );
}

export interface KeyValueProps {
  rows: Array<{ k: ReactNode; v: ReactNode }>;
  scope?: string;
  className?: string;
}

/** 键值对表（详情页、诊断卡共用：左弱右强，右侧对齐） */
export function KeyValue({ rows, scope, className }: KeyValueProps): ReactNode {
  return (
    <div {...scopeProps(scope)} className={cx("og-kv", className)}>
      {rows.map((row, i) => (
        <div key={i} style={{ display: "contents" }}>
          <span className="og-kv-key">{row.k}</span>
          <span className="og-kv-val">{row.v}</span>
        </div>
      ))}
    </div>
  );
}
