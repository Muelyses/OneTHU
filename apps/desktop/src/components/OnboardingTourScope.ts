/**
 * 导览（Onboarding）在 OneGUI 风格管线里的专属 scope —— 集中注册一处。
 *
 * 红线：导览 coach 卡/演练 HUD 的浮层外观全部来自 @onethu/gui（Modal/Sheet/Surface）；
 * 这里的 scope 只做「把通用档位锁成导览需要的档位」，值一律指向别的 --og-* 令牌或
 * 枚举档（白名单见 packages/gui/src/pipeline/director.ts 的 SCOPE_TOKENS），
 * 不允许出现字面色/字面尺寸。注册一次即全局生效；组件用 scope="tour.card" 挂载。
 */
import { og, type OGScopeSpec } from "@onethu/gui";

/** 导览 coach 卡与演练 HUD 共用的 scope 名 */
export const TOUR_CARD_SCOPE = "tour.card";

/**
 * tour 卡的专属键位：浮层面阶保持全站浮层同档（Modal/Sheet/Overlay 面只认
 * --og-surface-overlay 一族，显式锁档防「导览页特别黑」）；内容/线档和圆角
 * 逐档指向语义令牌，不引入新值。
 */
const TOUR_CARD: OGScopeSpec = {
  "surface-overlay": "surface-overlay",
  "content-1": "content-1",
  "content-2": "content-2",
  "content-3": "content-3",
  "line-1": "line-1",
  radius: "2xl",
};

let registered = false;

/** 幂等注册（组件 render 期调用安全；重复调用无害） */
export function defineOnboardingScopes(): void {
  if (registered) return;
  registered = true;
  og.defineScope(TOUR_CARD_SCOPE, TOUR_CARD);
}
