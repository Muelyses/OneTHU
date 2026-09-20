/**
 * 插件系统通知桥（facade 的 `onethu.notify.*` 落到这里）。
 *
 * 三件事说清楚：
 *   ① 插件通知 id 统一 `plugin:<pluginId>:<key>`，与宿主提醒（`<kind>:<key>:<offset>`）
 *      分属两个 id 空间——宿主同步只对齐自己的空间，不会把插件排的通知撤掉；
 *   ② 插件停用/卸载时由 loader 调 `cancelPluginNotifications` 收回（见 loader.deactivate），
 *      否则卸载后的插件通知还会照常弹出；
 *   ③ 插件通知不受宿主「提醒总开关」约束：那个开关管的是宿主自己的课程/DDL 提醒，
 *      插件既然单独申请了 notify 权限，就该由插件自己决定发不发。
 */
import { invoke } from "@tauri-apps/api/core";
import { fetchNotifyStatus, type NativeNotifyStatus } from "./notifyBridge.js";
import { isPluginNotifyId, pluginNotifyId } from "./notifyIds.js";

export type PluginNotifyStatus = NativeNotifyStatus;

/** 后端与授权状态（复用通用桥，插件侧只关心结果形状） */
export async function pluginNotifyStatus(request: boolean): Promise<PluginNotifyStatus> {
  return fetchNotifyStatus(request);
}

/** 排一条插件通知；`afterSeconds` 为 0 时立即发（原生侧用 1 秒兜底，避免"过去时刻"被拒） */
export async function sendPluginNotification(args: {
  pluginId: string;
  key: string;
  title: string;
  body: string;
  afterSeconds: number;
  page: string;
}): Promise<{ ok: boolean; id: string; reason?: string }> {
  const id = pluginNotifyId(args.pluginId, args.key);
  const at = Date.now() + Math.max(1, Math.round(args.afterSeconds)) * 1000;
  try {
    const raw = (await invoke<Record<string, unknown>>("notify_schedule", {
      items: JSON.stringify([
        { id, at, title: args.title, body: args.body, channel: "ddl", target: args.page },
      ]),
    })) as { ok?: boolean; scheduled?: number; reason?: string };
    if (raw?.scheduled === 1) return { ok: true, id };
    return { ok: false, id, reason: typeof raw?.reason === "string" && raw.reason ? raw.reason : "schedule-failed" };
  } catch (e) {
    return { ok: false, id, reason: String(e).slice(0, 120) };
  }
}

export async function cancelPluginNotification(id: string): Promise<boolean> {
  if (!isPluginNotifyId(id)) return false;      // 只允许撤销插件自己的 id 空间
  try {
    await invoke("notify_cancel", { ids: JSON.stringify([id]) });
    return true;
  } catch {
    return false;
  }
}

/** 收回某插件的全部待投递通知（停用/卸载时调用） */
export async function cancelPluginNotifications(pluginId: string): Promise<number> {
  try {
    const raw = (await invoke<{ ids?: string[] }>("notify_pending")) ?? {};
    const prefix = pluginNotifyId(pluginId, "");
    const ids = (raw.ids ?? []).filter((id) => id.startsWith(prefix));
    if (ids.length) await invoke("notify_cancel", { ids: JSON.stringify(ids) });
    return ids.length;
  } catch {
    return 0;
  }
}
