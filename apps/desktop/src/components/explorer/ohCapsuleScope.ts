/**
 * OH 胶囊的 OneGUI 专属档位登记（scope: oh.capsule）。
 *
 * 红线：OH 家族要「这次特殊」必须走 OneGUI 的 scope 机制 —— 在管线里 defineScope 登记，
 * 取值只允许「指向另一个 --og-* 语义令牌」或合法枚举档；渲染出的
 * `[data-og-scope="oh.capsule"]{ --og-c-*: … }` 由 StyleDirector 写进 #onegui-scopes
 * 样式表（onegui-guard 允许的受控注入），调度权在 OneGUI 管线，OH 自己不再持有样式表。
 *
 * 白长条胶囊的专属材质档（OhCapsule 外壳自挂 data-og-scope="oh.capsule" 接入）：
 *  - radius: full          → 全圆角（--og-radius-full）
 *  - surface-1: overlay    → 面档上浮到 overlay 档（胶囊是画布上的浮体）
 *  - line-1: line-2        → 轮廓用强一档线（双描边「外实」层 / 手机档 rim 加强）
 */
import { og } from "@onethu/gui";

export const OH_CAPSULE_SCOPE = "oh.capsule";

const SPEC: Parameters<typeof og.defineScope>[1] = {
  radius: "full",
  "surface-1": "surface-overlay",
  "line-1": "line-2",
};

let registered = false;

/** 幂等登记：HMR/热重载下重复调用只会把同一份 spec 重新落到管线 */
export function ensureOhCapsuleScope(): void {
  const known = og.scope(OH_CAPSULE_SCOPE);
  if (registered && known) return;
  og.defineScope(OH_CAPSULE_SCOPE, SPEC);
  registered = true;
}

/* 模块导入即登记（Side effect import）：og 是全局单例，登记状态在应用生命周期内常驻，
   后续 og.apply() 会让管线重渲染 scope 块，无需重复登记。 */
ensureOhCapsuleScope();
