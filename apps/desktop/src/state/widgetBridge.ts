/**
 * 小组件的原生桥：查询「桌面上到底放了几个、快照什么时候更新的」。
 *
 * 这个信息只有原生知道（provider 实例数由 AppWidgetManager 掌握），而它正是
 * 「用户说桌面上没看到」时第一个要查的东西，所以单独成桥供自检使用。
 */
import { invoke } from "@tauri-apps/api/core";

export interface NativeWidgetStatus {
  ok: boolean;
  /** 宿主小组件在桌面上放了几个 */
  hostPlaced: number;
  /** 槽位号 → 该槽位小组件放了几个 */
  slotsPlaced: Record<string, number>;
  hasSnapshot: boolean;
  /** 快照生成时刻（毫秒）；0 = 还没有快照 */
  snapshotAt: number;
  /** 槽位号 → 该槽位当前标题（插件声明的内容） */
  slotTitles: Record<string, string>;
  /** 系统侧已登记的 provider（宿主 / 槽位N）——空数组说明清单合并没生效 */
  providersRegistered: string[];
  reason?: string;
}

export async function fetchWidgetStatus(): Promise<NativeWidgetStatus | null> {
  try {
    const raw = (await invoke<Record<string, unknown>>("widget_status")) as Partial<NativeWidgetStatus> & { ok?: boolean };
    if (raw?.ok !== true) return null;
    return {
      ok: true,
      hostPlaced: Number(raw.hostPlaced ?? 0),
      slotsPlaced: (raw.slotsPlaced as Record<string, number>) ?? {},
      hasSnapshot: raw.hasSnapshot === true,
      snapshotAt: Number(raw.snapshotAt ?? 0),
      slotTitles: (raw.slotTitles as Record<string, string>) ?? {},
      providersRegistered: Array.isArray(raw.providersRegistered) ? (raw.providersRegistered as string[]) : [],
    };
  } catch {
    return null;      // 桌面端 not-android：诊断里跳过这一步
  }
}
