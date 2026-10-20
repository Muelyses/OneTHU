import { createContext, useContext, useMemo, type ReactNode } from "react";

/** Library-owned defaults. Hosts may supply translations without a reverse dependency. */
export const ONE_GUI_ZH_CN = {
  "gui.action.back": "返回",
  "gui.action.close": "关闭",
  "gui.action.remove": "移除",
  "gui.search.placeholder": "搜索",
  "gui.search.clear": "清空",
  "gui.number.decrease": "减",
  "gui.number.increase": "加",
  "gui.range.lower": "下限",
  "gui.range.upper": "上限",
  "gui.status.loading": "加载中",
  "gui.breadcrumb.label": "面包屑",
  "gui.pagination.previous": "上一页",
  "gui.pagination.next": "下一页",
  "gui.code.copy": "复制",
  "gui.code.copied": "已复制",
  "gui.overlay.dialog": "对话框",
  "gui.overlay.panel": "面板",
  "gui.overlay.drawer": "抽屉",
  "gui.overlay.actionMenu": "操作菜单",
  "gui.overlay.actions": "操作",
  "gui.overlay.popover": "浮层",
  "gui.segment.scroll": "滚动选项",
  "gui.tabs.label": "标签页",
  "gui.tabs.close": "关闭标签页",
  "gui.tabs.all": "全部标签页",
  "gui.navigation.home": "首页",
} as const;

export type OneGUIMessageKey = keyof typeof ONE_GUI_ZH_CN;
export type OneGUIMessages = Readonly<Record<OneGUIMessageKey, string>>;
export const ONE_GUI_MESSAGE_KEYS = Object.freeze(Object.keys(ONE_GUI_ZH_CN) as OneGUIMessageKey[]);

export const ONE_GUI_EN_US: OneGUIMessages = {
  "gui.action.back": "Back",
  "gui.action.close": "Close",
  "gui.action.remove": "Remove",
  "gui.search.placeholder": "Search",
  "gui.search.clear": "Clear",
  "gui.number.decrease": "Decrease",
  "gui.number.increase": "Increase",
  "gui.range.lower": "Lower bound",
  "gui.range.upper": "Upper bound",
  "gui.status.loading": "Loading",
  "gui.breadcrumb.label": "Breadcrumb",
  "gui.pagination.previous": "Previous page",
  "gui.pagination.next": "Next page",
  "gui.code.copy": "Copy",
  "gui.code.copied": "Copied",
  "gui.overlay.dialog": "Dialog",
  "gui.overlay.panel": "Panel",
  "gui.overlay.drawer": "Drawer",
  "gui.overlay.actionMenu": "Actions menu",
  "gui.overlay.actions": "Actions",
  "gui.overlay.popover": "Popover",
  "gui.segment.scroll": "Scroll options",
  "gui.tabs.label": "Tabs",
  "gui.tabs.close": "Close tab",
  "gui.tabs.all": "All tabs",
  "gui.navigation.home": "Home",
};

interface OneGUILocaleValue {
  locale: string;
  messages: OneGUIMessages;
  t: (key: OneGUIMessageKey) => string;
}

const DEFAULT_VALUE: OneGUILocaleValue = {
  locale: "zh-CN",
  messages: ONE_GUI_ZH_CN,
  t: key => ONE_GUI_ZH_CN[key],
};
const LocaleContext = createContext<OneGUILocaleValue>(DEFAULT_VALUE);

export interface OneGUILocaleProviderProps {
  /** BCP 47 locale. Additional languages are supplied by the host's messages. */
  locale?: string;
  messages?: Partial<OneGUIMessages>;
  children?: ReactNode;
}

/** Updates mounted consumers, including portals, without remounting their state. */
export function OneGUILocaleProvider({ locale: requested, messages: supplied, children }: OneGUILocaleProviderProps): ReactNode {
  const parent = useContext(LocaleContext);
  const locale = requested ?? parent.locale;
  const value = useMemo<OneGUILocaleValue>(() => {
    const defaults = /^en(?:-|$)/i.test(locale) ? ONE_GUI_EN_US : ONE_GUI_ZH_CN;
    const messages: Record<OneGUIMessageKey, string> = {
      ...(locale === parent.locale ? parent.messages : defaults),
    };
    for (const key of ONE_GUI_MESSAGE_KEYS) {
      const text = supplied?.[key];
      if (typeof text === "string" && text.trim()) messages[key] = text;
    }
    return { locale, messages, t: key => messages[key] };
  }, [locale, parent.locale, parent.messages, supplied]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useOneGUILocale(): OneGUILocaleValue {
  return useContext(LocaleContext);
}
