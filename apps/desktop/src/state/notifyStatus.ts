import { t as i18n } from "../i18n/index.js";
/**
 * 通知状态 → 用户该看到什么（纯函数，可测）。
 *
 * 为什么单独抽出来：这段文案是**唯一的降级沟通渠道**。Android 14 起精确闹钟默认被拒，
 * 用户「明明开了提醒却晚了十分钟」时，全部依赖这里把原因讲清楚、并把去处理的入口摆在
 * 眼前；写成散在 JSX 里的三元表达式就没法测，也就没法保证每种组合都讲到点上。
 */
export type NotifyBackendKind = "android" | "macos" | "windows" | "none" | (string & {});

export interface NotifyStatusInput {
  backend: NotifyBackendKind;
  granted: boolean;
  exact: boolean;
}

export interface NotifyHintAction {
  /** 要打开的系统设置页 */
  kind: "channels" | "exact-alarm" | "app";
  label: string;
}

export interface NotifyHint {
  level: "ok" | "warn" | "error";
  text: string;
  action?: NotifyHintAction;
}

const BACKEND_LABEL: Record<string, string> = {
  get android() { return i18n("state.notifystatus.571c1a7180e0"); },
  get macos() { return i18n("state.notifystatus.ca8b58ed4c71"); },
  get windows() { return i18n("state.notifystatus.94b0e03aba0d"); },
};

export function notifyHint(s: NotifyStatusInput): NotifyHint {
  const label = BACKEND_LABEL[s.backend] ?? s.backend;

  if (!s.backend || s.backend === "none") {
    return { level: "error", text: i18n("state.notifystatus.8533a6995d6d") };
  }
  if (!s.granted) {
    return {
      level: "error",
      text: i18n("state.notifystatus.03f0a153cd11"),
      action: { kind: "app", label: i18n("state.notifystatus.b19160883cfe") },
    };
  }
  if (s.backend === "android" && !s.exact) {
    return {
      level: "warn",
      text: i18n("state.notifystatus.cef529305e3b"),
      action: { kind: "exact-alarm", label: i18n("state.notifystatus.6fd3264bb821") },
    };
  }
  return {
    level: "ok",
    text: i18n("state.notifystatus.a9c6ad5d54e8", { label: String(label) }),
    action: { kind: "channels", label: s.backend === "android" ? i18n("state.notifystatus.8657a95fc74c") : i18n("state.notifystatus.13632693e676") },
  };
}
