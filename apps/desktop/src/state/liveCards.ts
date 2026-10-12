/**
 * 页面卡体发布/订阅（通用）：任何页面都可以把自己的卡体（render）发布到这里，
 * 白板页据此在**脱离原页面**的情况下渲染它们（方案 §4.4「昂贵档先复用现有外壳」）。
 *
 * 由来：原先这份逻辑写死在 todayCards.ts（只有今日页用）。做「我的」页三张数字卡时
 * 抽成通用模块——否则每接一个页面就复制一份发布/订阅。
 *
 * 已知限制（如实记录）：render 闭包捕获的是**发布那一刻**该页面的数据；本仓库数据层是
 * 模块级缓存（SWR 风格），离开原页面后卡片仍能画出内容，但不会自行重新订阅数据——
 * 直到再次访问该页面。真正的解法是把卡体与数据层一起抽成独立模块，属需求书
 * 「留到后续批次」表第 1 条。
 */
import type { ReactNode } from "react";

export type CardRenderer = () => ReactNode;

/** owner → 该页面发布的卡体表（键为组件目录 id，如 custom:mine-gpa）。 */
const published = new Map<string, Record<string, CardRenderer>>();
const listeners = new Set<() => void>();

/** 某张卡片的渲染器键（与组件目录 id 同形）。 */
export function cardRendererKey(cardId: string): string {
  return "custom:" + cardId;
}

/** 页面挂载时发布；卸载时传 null 清空该 owner。 */
export function publishCards(owner: string, map: Record<string, CardRenderer> | null): void {
  if (map && Object.keys(map).length) published.set(owner, map);
  else published.delete(owner);
  for (const fn of listeners) fn();
}

/** 合并所有页面发布的卡体（同名键后来者覆盖）。 */
export function liveRenderers(): Record<string, CardRenderer> {
  const out: Record<string, CardRenderer> = {};
  for (const map of published.values()) Object.assign(out, map);
  return out;
}

/** 订阅变更（白板页据此在原页面发布后重画）。 */
export function subscribeLiveCards(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 测试与排查用：当前已发布的 owner。 */
export function publishedOwners(): string[] {
  return [...published.keys()];
}
