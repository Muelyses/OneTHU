/**
 * 顶栏标签条（dev-explorer 工作空间革命）：首页恒在第一（不可关闭、不可多开），
 * 其后是打开的工作标签页（同页可多开），行尾「+」= 回首页（新标签页 = 起始页，
 * 与浏览器同构）。桌面 + 手机共用，放不下横向滚动。
 *
 * 数据唯一来源：state/explorer.ts（模块级 store，useSyncExternalStore 订阅）。
 */
import { useSyncExternalStore, type ReactNode } from "react";
import {
  allTabs,
  closeTab,
  explorerSnapshot,
  focusTab,
  HOME_TAB_ID,
  subscribeExplorer,
  titleOf,
  type ExplorerTab,
} from "../../state/explorer.js";
import { useFavs } from "../../state/favs.js";
import { IconPlus, IconX } from "../Icons.js";

/** 订阅 explorer store 的共享小钩子（TabDrawer/BottomBar 复用，别各自再写一遍） */
export function useExplorerTabs(): { tabs: ExplorerTab[]; activeId: string } {
  const snap = useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
  return { tabs: allTabs(), activeId: snap.activeId };
}

/**
 * 标签显示名解析器（钩子返回函数，避免在 map 里按数量调钩子）：
 * 收藏夹 tab 用实时名称 refine——用户改了收藏夹名，标签页名字跟着变，不用重开。
 */
export function useTabTitleRefiner(): (tab: ExplorerTab) => string {
  const favs = useFavs();
  return (tab: ExplorerTab): string => {
    if (tab.kind === "home") return "首页";
    if (tab.page === "folder" && tab.params?.folderId) {
      return favs.data.folders[tab.params.folderId]?.title ?? tab.title;
    }
    return tab.title || titleOf(tab.page, tab.params);
  };
}

/** 首页图标：小房子（内联 SVG，不引库） */
function HomeGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 7.5 8 2.8l5.5 4.7" />
      <path d="M4 6.8V13h8V6.8" />
    </svg>
  );
}

export function TabStrip(): ReactNode {
  const { tabs, activeId } = useExplorerTabs();
  const refine = useTabTitleRefiner();
  return (
    <div className="ex-tabstrip" role="tablist" aria-label="标签页">
      {tabs.map((t) => {
        const active = t.id === activeId;
        const isHome = t.kind === "home";
        const label = refine(t);
        return (
          <div
            key={t.id}
            className={"ex-tab" + (active ? " is-active" : "") + (isHome ? " is-home" : "")}
            role="tab"
            aria-selected={active}
            title={label}
          >
            <button className="ex-tab-main" onClick={() => focusTab(t.id)}>
              {isHome ? <HomeGlyph /> : null}
              <span className="ex-tab-title">{label}</span>
            </button>
            {isHome ? null : (
              <button
                className="ex-tab-close"
                aria-label={`关闭 ${label}`}
                title="关闭标签页"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
              >
                <IconX width={11} height={11} />
              </button>
            )}
          </div>
        );
      })}
      <button
        className="ex-tab-add"
        title="新标签页（回首页）"
        aria-label="新标签页"
        onClick={() => focusTab(HOME_TAB_ID)}
      >
        <IconPlus width={14} height={14} />
      </button>
    </div>
  );
}
