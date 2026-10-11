/**
 * 设置页签清单（唯一来源：设置页、命令面板、护栏、全局搜索都取这一份）。
 *
 * 2026-10-11 重构：「高级模式」分层**整体退役**——用户拍板不再用可见性分层藏功能，
 * 插件也升成独立入口（桌面＝侧栏「设置 | 插件」框，手机＝「我的」页里的同款框）。
 * 因此原先的 `isAdvancedMode / setAdvancedMode / ADVANCED_SETTINGS_TABS / useAdvancedMode`
 * 与那份 localStorage 开关一律删除；需要「进阶项收进高级档」的地方改由页面自己分档
 * （见 components/OhSettingsPage.tsx 的普通/高级）。
 */

/** 设置页签的**唯一清单**（顺序即展示顺序）。
 *  「插件」不在其中：它有自己的入口（见上）；「桌面小组件」从「通知与提醒」独立成一栏。 */
export const SETTINGS_TAB_ORDER = [
  "账号",
  "通知与提醒",
  "桌面小组件",
  "外观与布局",
  "数据与同步",
  "下载与存储",
  "帮助",
  "关于",
];

/** 请求切到某个设置页签（页面外的入口用：插件页、助手坞、帮助页的「去设置」）。
 *  与外部作业源那条消费请求同形：写下 → 设置页挂载时取走；
 *  **设置页已挂载**时由 subscribeSettingsConsume 的订阅方就地取走（task-22：检索条在
 *  设置页内点行也要能换页签，mount-only 的 consume 在那一情形永远等不到）。 */
let pendingTab: string | null = null;
const requestListeners = new Set<() => void>();

function notifyRequest(): void {
  for (const f of requestListeners) f();
}

export function requestSettingsTab(tab: string): void {
  pendingTab = tab;
  notifyRequest();
}

export function subscribeSettingsConsume(f: () => void): () => void {
  requestListeners.add(f);
  return () => {
    requestListeners.delete(f);
  };
}

export function consumeSettingsTabRequest(): string | null {
  const t = pendingTab;
  pendingTab = null;
  return t;
}

/** 分区级子请求（配合 requestSettingsTab 用）：落到页签后**再滚动 + 高亮某个分节**。
 *  场景：插件页里主题插件的「切换主题」按钮 → 设置 → 外观与布局 → 主题（用户不用自己找）。 */
let pendingSection: string | null = null;

export function requestSettingsSection(section: string): void {
  pendingSection = section;
  notifyRequest();
}

export function consumeSettingsSectionRequest(): string | null {
  const s = pendingSection;
  pendingSection = null;
  return s;
}
