/**
 * OH 全局悬浮球的 OneGUI 专属档位登记（scope: oh.orb）。
 *
 * 红线：OH 家族要「这次特殊」必须走 OneGUI 的 scope 机制 —— 在管线里 defineScope 登记，
 * 取值只允许「指向另一个 --og-* 语义令牌」或合法枚举档；渲染出的
 * `[data-og-scope="oh.orb"]{ --og-*:var(--og-…) }` 由 StyleDirector 写进 #onegui-scopes
 * 样式表（onegui-guard 允许的受控注入），调度权在 OneGUI 管线，OH 自己不持任何样式表。
 *
 * 悬浮球 / 悬浮小窗的专属材质档（GlobalOrb 的两块壳自挂 data-og-scope="oh.orb" 接入，
 * 子树里的 Segment/Btn/Row/Input/Chip 一并被级联调度）：
 *  - surface-1: surface-overlay → 面档整体上浮到 overlay 档。球与小窗都是画布上的浮体：
 *    玻璃皮肤下取半透明白 + 更大背景模糊（等价旧「毛玻璃背板」），中性皮肤下取实档浮面；
 *    顶栏 outline 按钮的填充读 surface-1，跟着一起上浮成旧「实底胶囊」的量级。
 *  - line-1: line-2             → 轮廓用强一档线。透明悬浮窗里 hairline 定不住边界
 *    （旧玻璃块取 border-l2 的 70% mix，同是「比 hairline 强一档」）。
 *
 * 半径不在此登记：surface 的 radius 枚举没有 full 档、且 --og-c-radius 契约位当前无组件消费；
 * 球壳的圆直接引用 --og-radius-full 语义令牌，小窗用 --og-radius-2xl，都是 OG 结构令牌。
 */
import { og } from "@onethu/gui";

export const OH_ORB_SCOPE = "oh.orb";

const SPEC: Parameters<typeof og.defineScope>[1] = {
  "surface-1": "surface-overlay",
  "line-1": "line-2",
};

let registered = false;

/** 幂等登记：HMR/热重载下重复调用只会把同一份 spec 重新落到管线 */
export function ensureOhOrbScope(): void {
  if (registered && og.scope(OH_ORB_SCOPE)) return;
  og.defineScope(OH_ORB_SCOPE, SPEC);
  registered = true;
}

/* 模块导入即登记（Side effect import）：og 是全局单例，登记状态在应用生命周期内常驻，
   后续 og.apply() 会让管线重渲染 scope 块，无需重复登记。 */
ensureOhOrbScope();
