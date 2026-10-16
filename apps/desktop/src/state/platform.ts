/**
 * 双端布局断点：**全应用唯一来源**（UI/UX 改造方案 §2.8.1）。
 *
 * 三档（禁止组件各写一份 matchMedia，也禁止再出现 860/861 这类散落魔数）：
 *   compact  < 600px   手机竖屏：底部 5 Tab，单列
 *   medium   600–840   手机横屏/平板竖屏/小窗：底部 Tab 保持，内容单列 ≤600 居中（过渡态）
 *   expanded ≥ 840px   PC/平板横屏：侧边栏壳
 *
 * CSS 侧与这里一一对应：媒体查询用 max-width: 839.98px / min-width: 840px，
 * 避免 839.5px 这类小数宽度落在两档之间。
 */
export const BP = { medium: 600, expanded: 840 } as const;

export type PlatformLayout = "compact" | "medium" | "expanded";

/** 由视口宽度判定档位（纯函数，便于单测） */
export function platformOf(width: number): PlatformLayout {
  if (width < BP.medium) return "compact";
  if (width < BP.expanded) return "medium";
  return "expanded";
}

/* ══════════ 手机形态判定（唯一来源：main.tsx 与 state/phoneSheets.ts 都读它） ══════════
   口径（2026-10-16 用户拍板）：**短边窄就是手机形态**——不要求触屏。
   理由两条：
     ① 用户要求「电脑端压得足够窄就直接用手机端样式」，这样既能随时预览也能真当窄窗用；
     ② 手机横屏宽度会到 840+（844×390），按宽度判会掉回 expanded 桌面档：顶部又长出标签条、
        底栏还会跑到顶上。用户口径是「横竖都不许有标签页条，换标签只能走标签页抽屉」。
   dev 开关（仅 DEV）：`?phone=1` 无条件按手机、`?phone=0` 无条件按桌面（验收对照用）。 */

export function hasCoarsePointer(): boolean {
  if (typeof navigator === "undefined") return false;
  return (navigator.maxTouchPoints ?? 0) > 0 || window.matchMedia?.("(pointer: coarse)").matches === true;
}

const PHONE_FORCE: boolean | null = (() => {
  if (typeof window === "undefined") return null;
  if (!import.meta.env?.DEV) return null;
  const q = new URLSearchParams(window.location.search).get("phone");
  return q === null ? null : q !== "0";
})();

export function isPhoneViewport(): boolean {
  if (typeof window === "undefined") return false;
  if (PHONE_FORCE !== null) return PHONE_FORCE;
  return Math.min(window.innerWidth, window.innerHeight) < BP.medium;
}
