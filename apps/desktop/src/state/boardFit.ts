/**
 * 「按内容拟合」的**判据**（2026-10-15 第三次修「截断」时从 FreeBoard 里提出来，单独可测）。
 *
 * 为什么要有它：自由画布的条目盒是**绝对定位**的，盒子不会自己长高；而卡片内容会变
 * （课表数据异步回来、名单多一行、字号/行高度量变化）。盒比内容矮 → 卡片底边被硬切
 * （macOS 的浮层滚动条不常驻，5px 的缺口看起来就是"下半截被截断"，用户报了三次）。
 *
 * 高度归谁管（`fitted` / `manual` 两个标记就是这件事的全部语义）：
 *   · 谁都没标     → 拟合全权负责（新件、模板件）；
 *   · `fitted`     → 拟合**曾经**撑过它 → 继续全权负责。这条是防复发的关键：
 *                    没有它，一件在档位高度上差 5px 的卡片被补好之后，明天内容再长 30px
 *                    又会越过 `manual` 的缺口线被放弃 —— 用户会第四次报"截断"。
 *   · `manual`     → 用户自己拖过/缩过：**让着它**，只补"排版税"级的缺口（≤ `FIT_MANUAL_SLACK`）。
 *                    用户故意缩小的卡片缺口远大于此，交给卡内可滚兜底，不硬切也不硬撑。
 *   · 两者都有不可能：用户一动手 `withRect` 就清 `fitted`（交权）。
 *
 * 另外两条口径也是踩过的坑：只长不缩（`FIT_DEAD_ZONE` 内一律不动，否则窗口一缩放就来回写盘、
 * 视觉抖动）；单次增长的**上限**（`FIT_MAX_STEP`）—— 缺口大得离谱说明内容是个长列表，
 * 那种情况该滚动而不是把卡片撑成几屏高。
 */

/** `manual` 条目仍允许被补上的最大缺口 px（= 一格 88px 的四分之一）：更大的缺口是明确的尺寸意图。 */
export const FIT_MANUAL_SLACK = 24;

/** 单次拟合允许增长的最大 px（≈ 半屏）：再大就不是"排版税"，是长列表，留给卡内滚动。 */
export const FIT_MAX_STEP = 480;

/** 差值 ≤ 它就不动（1px 描边上下 + 亚像素取整）。与 `boardCore.fitHeightPx` 同一口径。 */
export const FIT_DEAD_ZONE = 2;

/** 一个条目的"谁管高度"：`manual` = 用户定过，`fitted` = 拟合撑过。 */
export type FitOpts = { manual?: boolean; fitted?: boolean };

/**
 * 算「这个条目该长到多高」：`contentH` 是卡片内容的自然高（`scrollHeight`），
 * `h` 是当前盒高。返回 `null` = 不动。
 */
export function fitTarget(h: number, contentH: number, opts: FitOpts = {}): number | null {
  if (!Number.isFinite(contentH) || contentH <= 0) return null;
  const need = contentH + FIT_DEAD_ZONE;
  const deficit = need - h;
  if (deficit <= FIT_DEAD_ZONE) return null;
  const slack = opts.manual && !opts.fitted ? FIT_MANUAL_SLACK : FIT_MAX_STEP;
  if (deficit > slack) return null;
  return need;
}
