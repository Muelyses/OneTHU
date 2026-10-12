/**
 * 渲染规划（P1 纯核心）：把白板条目换算成「渲染层该画什么」。
 *
 * 方案：docs/原子收藏-可行性与实现方案.md §4.4 / §5.1 / §11。
 * 只做判定不做渲染：.tsx 只负责把 kind 映射成 JSX，判定逻辑在这里被 node 护栏真实驱动。
 */
import type { BoardItem, WidgetSpec } from "./boardCore.js";
import { BOARD_UNITS, clampSize, defForSpec, normalizeSize, widgetById, type SizeRange, type WidgetDef } from "./widgetMeta.js";

export type RenderKind = "text-title" | "text-label" | "divider" | "nav" | "atom-link" | "card" | "custom" | "empty";

/** 未知组件的兜底尺寸范围（目录里查不到时用它夹取，避免画出一个越界占位）。 */
const FALLBACK_RANGE: SizeRange = { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 3 };

export interface RenderPlan {
  kind: RenderKind;
  /** 展示用标题：跳转/卡片/自定义类取目录标题；文字类取文字本身。 */
  title: string;
  /** 文字类的正文（渲染层直接用）。 */
  text?: string;
  /** 空态原因（kind === "empty" 时必有值）。 */
  reason?: "unknown-widget";
  /** 夹取后的占格。 */
  size: { w: number; h: number };
}

function titleOf(spec: WidgetSpec, def: WidgetDef | null): string {
  if (def) return def.title;
  if (spec.kind === "text") return spec.text;
  /* 跳转类优先用声明时带上的显示名：否则白板上会显示 cloud 这类内部页名。 */
  if (spec.kind === "nav") return spec.label ?? spec.page;
  if (spec.kind === "card") return spec.card;
  if (spec.kind === "custom") return spec.id;
  if (spec.kind === "atom-link") return spec.ref;
  return "组件";
}

/** 条目 → 渲染计划。目录里查不到的 spec 一律落 empty（渲染层显示「该组件已不可用」）。 */
export function planForItem(item: BoardItem, appDefs: readonly WidgetDef[] = []): RenderPlan {
  const spec = item.spec;
  const def = defForSpec(spec, appDefs) ?? widgetById(spec.kind === "custom" ? "custom:" + spec.id : "", appDefs);
  /* 尺寸归一必须带**完整** def：挡位控制的组件要吸附到档位（只传 sizeRange 会退化成自由夹取）。
     目录里查不到时仍走兜底范围夹取，保证空态占位不会越界。 */
  const size = def ? normalizeSize(def, item.cell) : clampSize({ sizeRange: FALLBACK_RANGE } as WidgetDef, item.cell);

  if (spec.kind === "divider") return { kind: "divider", title: titleOf(spec, def), size };

  if (spec.kind === "text") {
    return {
      kind: spec.variant === "title" ? "text-title" : "text-label",
      title: titleOf(spec, def),
      text: spec.text,
      size,
    };
  }

  /* 需要「能独立渲染」的类别：卡片与页面自带组件必须有目录条目，否则落空态。 */
  if (spec.kind === "card" || spec.kind === "custom") {
    if (!def) return { kind: "empty", title: titleOf(spec, def), reason: "unknown-widget", size };
    return { kind: spec.kind === "card" ? "card" : "custom", title: def.title, size };
  }

  /* 跳转类：即便目录没登记也能画成入口（目标信息在 spec 里），但优先用目录标题。 */
  return { kind: spec.kind === "nav" ? "nav" : "atom-link", title: titleOf(spec, def), size };
}

/** 一个条目是否需要「编辑」入口（透传目录判定，供长按菜单用）。 */
export function planEditable(plan: RenderPlan): boolean {
  return plan.kind !== "empty" && plan.kind !== "divider";
}
