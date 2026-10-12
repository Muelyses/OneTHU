/**
 * 顶栏标签条（dev-explorer 工作空间革命）：首页恒在第一（不可关闭、不可多开），
 * 其后是打开的工作标签页（同页同实例复用，「复制」才多开），行尾「+」= 回首页。
 *
 * v2（用户拍板「tab 上只写『通知』是偷懒」）：标题走 state/tabTitles.ts 的
 * resolveTabTitle —— tab 上显示实体级短标签（label），完整路径（full）挂 title
 * 属性 hover 可见；数据快照就绪后由 useTabTitleTick 的 15s 节拍升级为实体名。
 */
import { useSyncExternalStore, type ReactNode } from "react";
import {
  allTabs,
  closeTab,
  explorerSnapshot,
  focusTab,
  HOME_TAB_ID,
  subscribeExplorer,
  type ExplorerTab,
} from "../../state/explorer.js";
import { resolveTabTitle, useTabTitleTick } from "../../state/tabTitles.js";
import { IconPlus, IconX } from "../Icons.js";

/** 订阅 explorer store 的共享小钩子（TabDrawer/BottomBar 复用，别各自再写一遍） */
export function useExplorerTabs(): { tabs: ExplorerTab[]; activeId: string } {
  const snap = useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
  return { tabs: allTabs(), activeId: snap.activeId };
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
  useTabTitleTick(); // 15s 节拍：数据快照晚于开 tab 时，实体名自动升级
  const { tabs, activeId } = useExplorerTabs();
  return (
    <div className="ex-tabstrip" role="tablist" aria-label="标签页">
      {tabs.map((t) => {
        const active = t.id === activeId;
        const isHome = t.kind === "home";
        const label = isHome ? "首页" : resolveTabTitle(t.page, t.params).label;
        const full = isHome ? "首页" : resolveTabTitle(t.page, t.params).full;
        return (
          <div
            key={t.id}
            className={"ex-tab" + (active ? " is-active" : "") + (isHome ? " is-home" : "")}
            role="tab"
            aria-selected={active}
          >
            <button className="ex-tab-main" title={full} onClick={() => focusTab(t.id)}>
              {isHome ? <HomeGlyph /> : null}
              <span className="ex-tab-title">{label}</span>
            </button>
            {isHome ? null : (
              <button
                className="ex-tab-close"
                aria-label={`关闭 ${label}`}
                title={`关闭 · ${full}`}
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
