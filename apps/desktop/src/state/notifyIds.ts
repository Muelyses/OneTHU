/**
 * 通知 id 的命名约定（纯函数，无 Tauri / React 依赖，任何环境可测）。
 *
 * 宿主提醒与插件通知共用同一个系统通知层，靠 id 前缀区分归属：
 *   · 宿主提醒：`<kind>:<key>:<offset>`（如 ddl:h1:120、class:2026-09-22:10:00:15）
 *   · 插件通知：`plugin:<pluginId>:<key>`
 *
 * 这条约定是「宿主重排时不误删插件通知」的唯一依据——宿主同步只对齐自己的 id 空间。
 */
export const PLUGIN_NOTIFY_PREFIX = "plugin:";

export function pluginNotifyId(pluginId: string, key: string): string {
  return `${PLUGIN_NOTIFY_PREFIX}${pluginId}:${key}`;
}

/** 是否为插件发起的通知（宿主不认领、不撤销） */
export function isPluginNotifyId(id: string): boolean {
  return typeof id === "string" && id.startsWith(PLUGIN_NOTIFY_PREFIX);
}

/** 插件通知按插件归组（设置页「插件通知」列表用）。
 *
 * 只认 `plugin:<pluginId>:<key>` 三段结构：缺段或空段的条目直接丢弃——它们不该出现，
 * 出现说明有调用方没走 pluginNotifyId，与其猜不如不显示。
 */
export function groupPluginNotifications(ids: string[]): Array<{ pluginId: string; ids: string[] }> {
  const byPlugin = new Map<string, string[]>();
  for (const id of ids ?? []) {
    if (!isPluginNotifyId(id)) continue;
    const rest = id.slice(PLUGIN_NOTIFY_PREFIX.length);
    const sep = rest.indexOf(":");
    if (sep <= 0 || sep === rest.length - 1) continue;
    const pluginId = rest.slice(0, sep);
    byPlugin.set(pluginId, [...(byPlugin.get(pluginId) ?? []), id]);
  }
  return [...byPlugin.entries()]
    .map(([pluginId, list]) => ({ pluginId, ids: list }))
    .sort((a, b) => b.ids.length - a.ids.length || a.pluginId.localeCompare(b.pluginId));
}
