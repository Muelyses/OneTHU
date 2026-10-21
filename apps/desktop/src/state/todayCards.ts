/**
 * 今日页卡片注册表的发布/订阅（P1「昂贵档先复用现有外壳」的接线点）。
 *
 * 方案：docs/原子收藏-可行性与实现方案.md §4.4。
 * 卡片本体（render）目前定义在 TodayPage 内部、闭包捕获该页的数据 hook，因此不搬页面而是：
 * 今日页挂载时把自己的注册表发布到这里，白板页据此拿到同一批 render 函数。
 *
 * 已知限制（如实记录）：render 闭包捕获的是今日页那次渲染的数据；由于本仓库数据层是模块级缓存
 * （SWR 风格），离开今日页后卡片仍能画出内容，但不会自行重新订阅数据——直到再次访问今日页。
 * 真正的解法是把卡体与数据层一起抽成独立模块，属于需求书「留到后续批次」的第 1 条。
 */
import type { ReactNode } from "react";
import type { HomeCardDef } from "../lib/homeCards.js";

export type CardRenderer = () => ReactNode;

let published: HomeCardDef[] | null = null;
const listeners = new Set<() => void>();

/** 今日页发布自己的注册表（含 render 与 aside）。 */
export function publishTodayCards(defs: HomeCardDef[] | null): void {
  published = defs && defs.length ? defs : null;
  for (const fn of listeners) fn();
}

/** 已发布的注册表（未发布过时为 null）。 */
export function todayCards(): HomeCardDef[] | null {
  return published;
}

/** 某张卡片的渲染器键（与组件目录 id 同形：custom:<卡片id>）。 */
export function cardRendererKey(cardId: string): string {
  return "custom:" + cardId;
}

/** 白板页用的渲染器表：目录 id → 卡体渲染器。 */
export function cardRenderers(): Record<string, CardRenderer> {
  const out: Record<string, CardRenderer> = {};
  for (const def of published ?? []) {
    if (typeof def.render === "function") out[cardRendererKey(String(def.id))] = def.render;
  }
  return out;
}

/** 订阅变更（白板页据此在今日页发布后重画）。返回退订函数。 */
export function subscribeTodayCards(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
