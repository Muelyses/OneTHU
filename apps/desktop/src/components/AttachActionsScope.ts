/**
 * 附件动作面板（AttachActionsSheet）的 OneGUI 专属档位登记（scope: ohaa.sheet）。
 *
 * 红线：本面板的「这次特殊」必须走 OneGUI 的 scope 机制 —— 在管线里 defineScope 登记，
 * 取值只允许「指向另一个 --og-* 语义令牌」或合法枚举档（白名单 =
 * packages/gui/src/pipeline/director.ts 的 SCOPE_TOKENS）；渲染出的
 * `[data-og-scope="ohaa.sheet"]{ … }` 由 StyleDirector 写进 #onegui-scopes
 * 样式表（onegui-guard 允许的受控注入），面板自己不再持有任何 <style>/样式表。
 *
 * 另一个职责：这颗 scope 名同时是 ChatDock 点外守卫的锚 —— Shell 会把 data-og-scope
 * 放到 Sheet 的遮罩上，面板内任何点击沿子树 DOM 都能被
 * `closest('[data-og-scope="ohaa.sheet"]')` 命中（替代旧 `.ohaa-backdrop` 的语义，
 * 遮罩点击也不算「点外了」，Dock 小窗不会被顺手关掉）。
 *
 * 锁位（全身份引用，同 tour.card 写法）：面板是画布上的浮层 → 面档锁 overlay；
 * 内容三档 / 线两档锁全站语义档，不引入任何新刻度。
 */
import { og, type OGScopeSpec } from "@onethu/gui";

/** 附件动作 Sheet 的 scope 名（组件挂 scope，ChatDock 点外守卫用同名字符串找它） */
export const ATTACH_SHEET_SCOPE = "ohaa.sheet";

const SPEC: OGScopeSpec = {
  "surface-overlay": "surface-overlay",
  "content-1": "content-1",
  "content-2": "content-2",
  "content-3": "content-3",
  "line-1": "line-1",
  "line-2": "line-2",
};

let registered = false;

/** 幂等登记：HMR/热重载下重复调用只会把同一份 spec 重新落到管线 */
export function ensureAttachSheetScope(): void {
  const known = og.scope(ATTACH_SHEET_SCOPE);
  if (registered && known) return;
  og.defineScope(ATTACH_SHEET_SCOPE, SPEC);
  registered = true;
}

/* 模块导入即登记（Side effect import）：og 是全局单例，登记状态在应用生命周期内常驻，
   后续 og.apply() 会让管线重渲染 scope 块，无需重复登记。 */
ensureAttachSheetScope();
