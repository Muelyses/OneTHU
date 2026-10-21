/**
 * OH 对话坞（ChatDock）的 OneGUI 专属档位登记（scope: oh.dock）。
 *
 * 红线：OH 家族要「这次特殊」必须走 OneGUI 的 scope 机制 —— 在管线里 defineScope 登记，
 * 取值只允许「指向另一个 --og-* 语义令牌」或合法枚举档（白名单 = packages/gui
 * pipeline/director.ts SCOPE_TOKENS）；渲染出的 `[data-og-scope="oh.dock"]{ --og-*:… }`
 * 由 StyleDirector 写进 #onegui-scopes 样式表（onegui-guard 允许的受控注入），
 * 调度权在 OneGUI 管线，OH 自己不持任何样式表。
 *
 * 对话坞面板的专属材质档（面板壳在 ChatDock 挂 data-og-scope="oh.dock" 接入，
 * 子树里的 Btn/Chip/Banner/Row/Inline 等一并被级联调度 —— 内嵌组件不必再各自挂 scope）：
 *  - surface-1: surface-overlay → 面档整体上浮到浮层档。对话坞是画布上的浮体：玻璃皮肤下
 *    壳与子控件的填充取半透明白 + 更大背景模糊（等价旧「86% 毛玻璃背板 + blur」），
 *    中性皮肤下取实档浮面；旧 dock 内的 Btn 填充跟着上浮到旧「实底胶囊」的量级。
 *  - line-1: line-2             → 轮廓用强一档线。半透明浮体里 hairline 定不住边界
 *    （旧 dock-panel 用 70% inset 环，「比 hairline 强一档」；oh.orb 同判例）。
 *
 * 半径不在此登记：surface 的 radius 枚举没有旧 24px 档；面板壳圆角直接引用
 * --og-radius-xl（OneGUI 面板档，与 Modal/Sheet 面板同一档），生长契约的底角
 * （.ohx-panel-grow 的 14px）属几何骨架，仍在 explorer-oh.css。
 */
import { og } from "@onethu/gui";

export const OH_DOCK_SCOPE = "oh.dock";

const SPEC: Parameters<typeof og.defineScope>[1] = {
  "surface-1": "surface-overlay",
  "line-1": "line-2",
};

let registered = false;

/** 幂等登记：HMR/热重载下重复调用只会把同一份 spec 重新落到管线 */
export function ensureDockScope(): void {
  if (registered && og.scope(OH_DOCK_SCOPE)) return;
  og.defineScope(OH_DOCK_SCOPE, SPEC);
  registered = true;
}

/* 模块导入即登记（Side effect import）：og 是全局单例，登记状态在应用生命周期内常驻，
   后续 og.apply() 会让管线重渲染 scope 块，无需重复登记。 */
ensureDockScope();
