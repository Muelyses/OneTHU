/**
 * 小组件运行时：数据变化 → 重算快照 → 推给原生重画。
 *
 * 与通知是两条独立链路：小组件没有总开关（放不放由用户决定），也不受静默时段影响；
 * 但它同样需要「跨天/滚动时间」的定时重算——快照里的「还有 3 小时」是算出来的文本，
 * 不重推就会停在旧值上（原生侧没有课表语义，算不了）。
 *
 * 因此这里的策略是**每次都推**（而不是像通知那样只推差异）：一次 SharedPreferences
 * 写入 + 一次 RemoteViews 重画，成本可忽略，换来的是小组件上永远没有过期文案。
 */
import { getHwRemindState } from "./hwRemind.js";
import type { PlanHomework, PlanScheduleEntry } from "./notifyPlan.js";
import type { NotifyInvoke } from "./notifyScheduler.js";
import { buildWidgetSnapshot, serializeWidgetSnapshot, type WidgetSnapshot } from "./widgetSnapshot.js";
import { collectWidgetSlots } from "../plugins/pluginWidgets.js";
import { loadWidgetSettings } from "./widgetSettings.js";
import type { ResolvedSource } from "./widgetSource.js";
import { createSyncer } from "./displaySyncer.js";

export interface WidgetRuntimeDeps {
  invoke: NotifyInvoke;
  /** 本平台是否有小组件承载（当前只有 Android） */
  backendAvailable: boolean;
  collect: (now: number) => { schedule: PlanScheduleEntry[]; homework: PlanHomework[] };
  subscribe: (fn: () => void) => () => void;
  onError?: (m: string) => void;
  /** 解析「显示什么」的用户配置（收藏夹 / 收藏原子）。缺省或返回 null 时回落默认今日视图 */
  resolveSource?: () => ResolvedSource | null;
  debounceMs?: number;
  tickMs?: number;
}

export interface WidgetRuntime {
  /** 立即重算并推送一次，返回是否推成功 */
  syncNow: () => Promise<boolean>;
  /** 最近一次推的快照（设置页预览 / 调试） */
  snapshot: () => WidgetSnapshot | null;
  stop: () => void;
}

export function createWidgetRuntime(deps: WidgetRuntimeDeps): WidgetRuntime {
  let last: WidgetSnapshot | null = null;

  async function apply(
    inputs: { schedule: PlanScheduleEntry[]; homework: PlanHomework[] },
    now: number,
  ): Promise<boolean> {
    if (!deps.backendAvailable) return false;
    // 用户配置的内容来源（收藏夹/原子）优先；解析失败（夹被删、原子失效）回落今日视图
    const settings = loadWidgetSettings();
    const custom = settings.source.kind === "today" ? null : (deps.resolveSource?.() ?? null);
    const snap = buildWidgetSnapshot({
      schedule: inputs.schedule,
      homework: inputs.homework,
      remind: getHwRemindState(),
      now,
      // 插件小组件槽位：注册表是纯数据，直接读（插件的原子解析在 collectWidgetSlots 里完成）
      slots: collectWidgetSlots(),
      custom,
      // 用户指定了「点开哪个页面」就一律用它（内容来源的默认落点让位）
      targetOverride: settings.openPage,
    });
    try {
      const raw = (await deps.invoke("widget_push", { snapshot: serializeWidgetSnapshot(snap) })) as
        | Record<string, unknown>
        | null;
      const ok = raw?.ok === true;
      if (ok) last = snap;
      return ok;
    } catch (e) {
      // 推送失败不抛给调用方（设置页按钮 / 定时任务都不该因此炸），但必须上报且不记快照
      deps.onError?.(String(e).slice(0, 160));
      return false;
    }
  }

  let lastOk = false;
  const syncer = createSyncer({
    collect: deps.collect,
    subscribe: deps.subscribe,
    run: async (inputs, now) => {
      lastOk = await apply(inputs, now);
    },
    debounceMs: deps.debounceMs,
    tickMs: deps.tickMs,
    onError: deps.onError,
  });

  return {
    syncNow: async () => {
      await syncer.syncNow();
      return lastOk;
    },
    snapshot: () => last,
    stop: () => syncer.stop(),
  };
}
