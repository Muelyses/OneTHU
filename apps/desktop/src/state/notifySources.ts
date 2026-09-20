/**
 * 通知运行时的生产接线：真实数据订阅 + 真实取数，装进 notifyRuntime。
 *
 * 运行时本身不 import 数据层（否则它会被 .tsx 拖成不可测），所以「哪些数据变化要触发
 * 重算」这份清单落在这里：learn 快照（作业/课程）、外部作业源、两级提醒设置、课表。
 */
import { subscribeCampusData, subscribeLearnData } from "./data.js";
import { subscribeExtHw } from "./exthw.js";
import { subscribeHwRemind } from "./hwRemind.js";
import { collectNotifyInputs } from "./notifyInputs.js";
import { createNotifyRuntime, type NotifyRuntime } from "./notifyRuntime.js";
import { createWidgetRuntime, type WidgetRuntime } from "./widgetRuntime.js";
import type { NotifyInvoke } from "./notifyScheduler.js";

/** 四处数据源任一变化都重算计划（防抖在运行时里，订阅这里只做转发） */
export function subscribeNotifySources(fn: () => void): () => void {
  const unsubs = [
    subscribeLearnData(fn),
    subscribeExtHw(fn),
    subscribeHwRemind(fn),
    subscribeCampusData(fn),
  ];
  return () => {
    for (const u of unsubs) u();
  };
}

/** 运行时句柄（组件持有以便卸载时停掉） */
export type NotifyRuntimeHandle = NotifyRuntime;

/** 小组件运行时句柄（组件持有以便卸载时停掉） */
export type WidgetRuntimeHandle = WidgetRuntime;

/** 小组件运行时：同一条数据订阅，独立推送链路（不受通知总开关影响） */
export function startWidgetRuntime(deps: {
  invoke: NotifyInvoke;
  backendAvailable: boolean;
  onError?: (m: string) => void;
}): WidgetRuntime {
  return createWidgetRuntime({
    invoke: deps.invoke,
    backendAvailable: deps.backendAvailable,
    onError: deps.onError,
    collect: collectNotifyInputs,
    subscribe: subscribeNotifySources,
  });
}

export function startNotifyRuntime(deps: {
  invoke: NotifyInvoke;
  backendAvailable: boolean;
  onError?: (m: string) => void;
}): NotifyRuntime {
  return createNotifyRuntime({
    invoke: deps.invoke,
    backendAvailable: deps.backendAvailable,
    onError: deps.onError,
    collect: collectNotifyInputs,
    subscribe: subscribeNotifySources,
  });
}
