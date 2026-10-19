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
   口径（2026-10-16 用户拍板：电脑端压得足够窄就直接用手机端样式；2026-10-19 修正）：
     ① 宽度 < 600（窄窗 / 竖屏手机）→ 手机形态；
     ② 高度 < 600 且宽度 ≤ 960（横屏手机：844×390 / 932×430 这类宽而不高的）→ 手机形态；
     ③ 其余（含被压矮的桌面窗，如 1256×596）→ 桌面形态。
   为什么不能只看「短边 < 600」：桌面窗被压矮时短边也会掉到 600 以下（1256×596 这种
   几乎满屏的窗），按短边判会把电脑判成手机。区分点：横屏手机宽而不太宽（≤960），
   桌面窗再矮也普遍更宽——所以高度规则要加宽度上限。
   dev 开关（仅 DEV）：`?phone=1` 无条件按手机、`?phone=0` 无条件按桌面（验收对照用）。 */

export function hasCoarsePointer(): boolean {
  if (typeof navigator === "undefined") return false;
  return (navigator.maxTouchPoints ?? 0) > 0 || window.matchMedia?.("(pointer: coarse)").matches === true;
}

/** 横屏手机的宽度上限（iPhone 15 Pro Max 932 / Pixel 8 Pro 915，取 960 留余量）。 */
const LANDSCAPE_PHONE_MAX_W = 960;

const PHONE_FORCE: boolean | null = (() => {
  if (typeof window === "undefined") return null;
  if (!import.meta.env?.DEV) return null;
  const q = new URLSearchParams(window.location.search).get("phone");
  return q === null ? null : q !== "0";
})();

export function isPhoneViewport(): boolean {
  if (typeof window === "undefined") return false;
  if (PHONE_FORCE !== null) return PHONE_FORCE;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w < BP.medium) return true;
  /* 宽而不高 = 横屏手机；但桌面窗压矮也这样，所以宽度必须压在手机上限内 */
  return h < BP.medium && w <= LANDSCAPE_PHONE_MAX_W;
}
