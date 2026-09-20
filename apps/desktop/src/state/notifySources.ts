/**
 * 通知/小组件的生产接线：真实订阅 + 真实取数 + 单例运行时。
 *
 * 运行时做成单例的原因：设置页要能「立即应用」「预览即将提醒」，而启动时按下的那条链
 * 必须和它是同一份——两条调度链并行会互相撤销对方的排程（同一批 id 反复排/撤）。
 *
 * 后端类型由原生回答（`notify_backend`），不猜 UA：tauri.conf.json 为适配 Android
 * 的 wengine 指纹固定了 Windows 版 Chrome UA，UA 判定在本项目里不可靠。
 */
import { invoke } from "@tauri-apps/api/core";
import { subscribeCampusData, subscribeLearnData } from "./data.js";
import { subscribeExtHw } from "./exthw.js";
import { subscribeHwRemind } from "./hwRemind.js";
import { subscribePluginWidgets } from "../plugins/pluginWidgets.js";
import { collectNotifyInputs } from "./notifyInputs.js";
import { createNotifyRuntime, type NotifyRuntime } from "./notifyRuntime.js";
import { createWidgetRuntime, type WidgetRuntime } from "./widgetRuntime.js";
import type { NotifyInvoke } from "./notifyScheduler.js";

export type NotifyRuntimeHandle = NotifyRuntime;
export type WidgetRuntimeHandle = WidgetRuntime;

/** 数据源任一变化都重算（防抖在运行时里，订阅这里只做转发）。
 *  含插件小组件注册表：插件重新声明小组件时，桌面上的槽位内容要立刻跟上。 */
export function subscribeNotifySources(fn: () => void): () => void {
  const unsubs = [
    subscribeLearnData(fn),
    subscribeExtHw(fn),
    subscribeHwRemind(fn),
    subscribeCampusData(fn),
    subscribePluginWidgets(fn),
  ];
  return () => {
    for (const u of unsubs) u();
  };
}

const invokeBridge: NotifyInvoke = (cmd, args) => invoke(cmd, args ?? {});

let backendKind = "unknown";
let notifyRuntime: NotifyRuntime | null = null;
let widgetRuntime: WidgetRuntime | null = null;

/** 探测本机通知后端（android / macos / windows / none）；结果缓存 */
export async function detectNotifyBackend(): Promise<string> {
  if (backendKind !== "unknown") return backendKind;
  try {
    backendKind = await invoke<string>("notify_backend");
  } catch {
    backendKind = "none";
  }
  return backendKind;
}

export function currentNotifyBackend(): string {
  return backendKind;
}

/** 懒启动单例（首次会先探测后端）；后端为 none 时也会返回运行时，只是所有动作会跳过 */
export async function ensureNotifyRuntime(): Promise<NotifyRuntime> {
  if (notifyRuntime) return notifyRuntime;
  const kind = await detectNotifyBackend();
  notifyRuntime = createNotifyRuntime({
    invoke: invokeBridge,
    backendAvailable: kind !== "none",
    onError: (m) => console.warn("[notify]", m),
    collect: collectNotifyInputs,
    subscribe: subscribeNotifySources,
  });
  return notifyRuntime;
}

export async function ensureWidgetRuntime(): Promise<WidgetRuntime> {
  if (widgetRuntime) return widgetRuntime;
  const kind = await detectNotifyBackend();
  widgetRuntime = createWidgetRuntime({
    invoke: invokeBridge,
    backendAvailable: kind === "android",   // 小组件只有 Android 有承载（桌面端明确不做）
    onError: (m) => console.warn("[widget]", m),
    collect: collectNotifyInputs,
    subscribe: subscribeNotifySources,
  });
  return widgetRuntime;
}

/** 登出/卸载时收摊 */
export function releaseNotifyRuntimes(): void {
  notifyRuntime?.stop();
  widgetRuntime?.stop();
  notifyRuntime = null;
  widgetRuntime = null;
}
