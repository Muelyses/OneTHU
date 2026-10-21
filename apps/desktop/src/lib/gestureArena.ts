/**
 * 手机手势竞技场（Phase 5 地基）：把「长按拖动」的阈值与所有权收敛到一处。
 *
 * 现状（docs/research/2026-10-18-mobile-drag-nfc.md）：白板 500ms/4px、标签条 300ms/8px、
 * 胶囊 450ms、暂存箱 320ms 各自为政。新代码一律从这里取阈值，并对「当前手势是谁的」做
 * 单所有者登记；旧面可在后续批次逐个接入，不要求一次性重写。
 *
 * 优先级（高 → 低）：系统返回/悬浮球 → 弹层/抽屉把手 → 强语义拖（白板/标签/轮播）
 * → 通用长按拖动（暂存箱）→ 滚动/点击。
 */
export const GESTURE = {
  /** 通用长按触发拖动（与 500ms 菜单错开；胶囊 450ms 由胶囊自己优先） */
  longPressMs: 400,
  /** 长按期间允许的手指抖动；超过即视为滚动并取消 */
  longPressSlop: 8,
  /** 鼠标拖动的启动阈值 */
  mouseSlop: 6,
  /** 弱动效/触感确认 */
} as const;

let owner: string | null = null;
const listeners = new Set<(id: string | null) => void>();

export function gestureOwner(): string | null {
  return owner;
}

/** 抢占手势所有权；已有更高优先级的所有者时返回 false（调用方应放弃）。 */
export function claimGesture(id: string): boolean {
  if (owner && owner !== id) return false;
  if (owner === id) return true;
  owner = id;
  listeners.forEach((f) => f(id));
  return true;
}

export function releaseGesture(id: string): void {
  if (owner !== id) return;
  owner = null;
  listeners.forEach((f) => f(null));
}

export function subscribeGesture(f: (id: string | null) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
