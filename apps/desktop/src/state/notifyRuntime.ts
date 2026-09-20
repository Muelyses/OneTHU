/**
 * 通知运行时：把「数据变化 → 重算计划 → 对齐原生排程」这条链在应用内接起来。
 *
 * 时机（防抖 / 定时 / 冷启动）由 displaySyncer 统一提供；本模块只负责「算什么」与
 * 「推给谁」，并保证一件事：**总开关关闭时不是不算，而是撤干净**——用户关掉提醒后
 * 不该再收到上一轮排下的旧通知。
 *
 * 取数与订阅都从外部注入（notifyInputs / notifySources 提供生产实现），
 * 因此「什么时候算一次」这件最容易出错的事可以在 Node 里直测。
 */
import { getHwRemindState } from "./hwRemind.js";
import { buildNotifyPlan, type NotifyPlanItem, type PlanHomework, type PlanScheduleEntry } from "./notifyPlan.js";
import { createNotifyScheduler, type NotifyInvoke } from "./notifyScheduler.js";
import { loadNotifySettings } from "./notifySettings.js";
import { createSyncer } from "./displaySyncer.js";

export interface NotifyRuntimeDeps {
  invoke: NotifyInvoke;
  backendAvailable: boolean;
  onError?: (m: string) => void;
  /** 计划输入来源（应用启动时传 collectNotifyInputs；测试注入假数据） */
  collect: (now: number) => { schedule: PlanScheduleEntry[]; homework: PlanHomework[] };
  /** 数据变化订阅（应用启动时传 subscribeNotifySources；测试注入假订阅） */
  subscribe: (fn: () => void) => () => void;
  /** 测试用：缩短防抖与定时间隔 */
  debounceMs?: number;
  tickMs?: number;
}

export interface NotifySyncSummary {
  scheduled: number;
  cancelled: number;
  skipped?: string;
  error?: string;
}

export interface NotifyRuntime {
  /** 立即重算并对齐（设置页按钮 / 启动时调用），返回本次排程统计 */
  syncNow: () => Promise<NotifySyncSummary>;
  /** 当前计划快照（设置页「即将提醒」预览） */
  plan: () => NotifyPlanItem[];
  stop: () => void;
}

export function createNotifyRuntime(deps: NotifyRuntimeDeps): NotifyRuntime {
  const scheduler = createNotifyScheduler({
    invoke: deps.invoke,
    backendAvailable: deps.backendAvailable,
    onError: deps.onError,
  });

  let lastPlan: NotifyPlanItem[] = [];
  let lastSummary: NotifySyncSummary = { scheduled: 0, cancelled: 0 };

  async function apply(
    inputs: { schedule: PlanScheduleEntry[]; homework: PlanHomework[] },
    now: number,
  ): Promise<NotifySyncSummary> {
    const settings = loadNotifySettings();
    if (!settings.enabled) {
      const r = await scheduler.cancelAll();
      lastPlan = [];
      lastSummary = { scheduled: 0, cancelled: r.cancelled, skipped: r.skipped, error: r.error };
      return lastSummary;
    }
    const plan = buildNotifyPlan({
      schedule: inputs.schedule,
      homework: inputs.homework,
      remind: getHwRemindState(),
      settings,
      now,
    });
    lastPlan = plan;
    const r = await scheduler.sync(plan);
    lastSummary = { scheduled: r.scheduled, cancelled: r.cancelled, skipped: r.skipped, error: r.error };
    return lastSummary;
  }

  const syncer = createSyncer({
    collect: deps.collect,
    subscribe: deps.subscribe,
    run: async (inputs, now) => {
      await apply(inputs, now);   // 结果留在 lastSummary 里给 syncNow 返回
    },
    debounceMs: deps.debounceMs,
    tickMs: deps.tickMs,
    onError: deps.onError,
  });

  return {
    syncNow: async () => {
      await syncer.syncNow();
      return lastSummary;
    },
    plan: () => [...lastPlan],
    stop: () => syncer.stop(),
  };
}
