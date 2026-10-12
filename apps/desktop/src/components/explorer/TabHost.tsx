/**
 * Explorer 标签页宿主（dev-explorer 革命核心）：所有标签页常驻挂载、display 切换。
 *
 * - **每个标签页有独立的路由上下文**（TabScope：Ctx.Provider 覆盖 page/navParams/
 *   navigate）——两个网络学堂 tab 各点各的课程互不串台（用户实测抓到的核心 bug）；
 *   面板内 navigate = 该 tab 内导航；首页面板内 navigate = 打开目标（已存在则复用）；
 * - 首页（home）恒在、恒挂载，正文 = HomeTab；
 * - 页标签页首次聚焦时才挂载（懒挂载，避免启动恢复 N 个标签页时的抓取风暴），
 *   挂过之后终身保留（display:none），工作上下文不丢；
 * - 页内导航：容器内 key=page 的 .page-anim 层重挂 → 保留原转场语义；
 * - **右键（桌面）/长按（手机）任意页面空白处** → 「在新标签页打开此页」（forceNew
 *   复制当前所在的一/二/三级页，新 tab 仍是一级面板形态）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Ctx, useApp } from "../../state/context.js";
import type { AppState, LearnNav, Page } from "../../state/app.js";
import {
  HOME_TAB_ID,
  closeTab,
  duplicateTab,
  navigateInTab,
  openSettings,
  openTab,
  useExplorerState,
} from "../../state/explorer.js";
import type { ExplorerTab } from "../../state/explorer.js";
import { isSubPage, renderPage } from "./renderPage.js";
import { HomeTab } from "./HomeTab.js";

/* ══════════ tab 局部路由上下文 ══════════ */

/** 每个标签页一个 Provider：页面里 useApp() 读到的是**该 tab 自己**的 page/params，
 *  navigate 只动这一个 tab。外壳（TopBar/齿轮等）在 Shell 层，不受覆盖影响。 */
function TabScope({ tab, children }: { tab: ExplorerTab; children: ReactNode }): ReactNode {
  const outer = useApp();
  const navigate = useCallback(
    (p: Page, params?: LearnNav) => {
      if (p === "settings" || p === "plugins") {
        openSettings(p === "settings" ? "settings" : "plugins");
        return;
      }
      if (tab.kind === "home") {
        openTab(p, params); // 入口级：已存在同实例 → 复用聚焦（openTab 默认行为）
        return;
      }
      navigateInTab(tab.id, p, params);
    },
    [tab.id, tab.kind],
  );
  const value = useMemo<AppState>(
    () => ({ ...outer, page: tab.page, navParams: tab.params, navigate }),
    [outer, tab.page, tab.params, navigate],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ══════════ 懒挂载集合 ══════════ */

/** 本会话内已挂载过的标签页 id 集（懒挂载标记；不持久化——恢复的标签页首次聚焦再挂） */
function useMountedTabs(activeId: string, tabs: ExplorerTab[]): Set<string> {
  const [mounted, setMounted] = useState<Set<string>>(() => new Set([HOME_TAB_ID, activeId]));
  useEffect(() => {
    setMounted((prev) => {
      if (prev.has(activeId)) return prev;
      const next = new Set(prev);
      next.add(activeId);
      return next;
    });
  }, [activeId]);
  /* 已关闭的标签页从集合里清掉（防集合无界增长；id 不复用） */
  useEffect(() => {
    setMounted((prev) => {
      const live = new Set([HOME_TAB_ID, ...tabs.map((t) => t.id)]);
      let changed = false;
      const next = new Set([...prev].filter((id) => {
        if (live.has(id)) return true;
        changed = true;
        return false;
      }));
      return changed ? next : prev;
    });
  }, [tabs]);
  return mounted;
}

/* ══════════ 右键 / 长按 → 「在新标签页打开此页」 ══════════ */

/** 命中交互元素时放行（按钮/链接上的长按是页面自己的语义，不抢） */
function onInteractive(el: EventTarget | null): boolean {
  return !!(el instanceof HTMLElement && el.closest("button, a, input, textarea, select, [role='button'], [contenteditable], .seg-track, .plg-tab-root"));
}

interface MenuPos { x: number; y: number; tabId: string }

function TabContextMenu({ pos, onClose }: { pos: MenuPos; onClose: () => void }): ReactNode {
  const isHome = pos.tabId === HOME_TAB_ID;
  const items: Array<{ label: string; danger?: boolean; act: () => void }> = [
    { label: "在新标签页打开此页", act: () => duplicateTab(pos.tabId) },
    ...(isHome ? [] : [{ label: "关闭标签页", danger: true, act: () => closeTab(pos.tabId) }]),
  ];
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return createPortal(
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 1200 }}
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div className="explorer-ctxmenu" style={{ left: pos.x, top: pos.y }} role="menu">
        {items.map((it) => (
          <button
            key={it.label}
            className={"explorer-ctxmenu-item" + (it.danger ? " is-danger" : "")}
            role="menuitem"
            onClick={() => { it.act(); onClose(); }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}

/* ══════════ 宿主 ══════════ */

export function TabHost(): ReactNode {
  const st = useExplorerState();
  const activeId = st.activeId;
  const mounted = useMountedTabs(activeId, st.tabs);
  const [menu, setMenu] = useState<MenuPos | null>(null);
  /* 长按计时（触屏）：550ms 原地按住 → 菜单；鼠标用右键 */
  const press = useRef<{ x: number; y: number; id: string; timer: number } | null>(null);
  const clearPress = useCallback(() => {
    if (press.current) {
      window.clearTimeout(press.current.timer);
      press.current = null;
    }
  }, []);
  useEffect(() => clearPress, [clearPress]);

  const all = useMemo(() => {
    const home: ExplorerTab = { id: HOME_TAB_ID, kind: "home", page: "today", params: null, title: "首页", workspaceId: null, createdAt: 0, lastActiveAt: 0 };
    return [home, ...st.tabs];
  }, [st.tabs]);

  const panelPointerDown = useCallback((e: React.PointerEvent, tabId: string) => {
    if (e.pointerType === "mouse") return; // 鼠标走 contextmenu
    if (onInteractive(e.target)) return;
    clearPress();
    const { clientX, clientY } = e;
    const timer = window.setTimeout(() => {
      press.current = null;
      setMenu({ x: clientX, y: clientY, tabId });
    }, 550);
    press.current = { x: clientX, y: clientY, id: tabId, timer };
  }, [clearPress]);
  const panelPointerMove = useCallback((e: React.PointerEvent) => {
    const p = press.current;
    if (p && (Math.abs(e.clientX - p.x) > 10 || Math.abs(e.clientY - p.y) > 10)) clearPress();
  }, [clearPress]);

  return (
    <>
      {all.map((t) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            className="explorer-panel"
            data-tab-id={t.id}
            data-tab-page={t.page}
            style={active ? undefined : { display: "none" }}
            onContextMenu={(e) => {
              if (onInteractive(e.target)) return;
              e.preventDefault();
              clearPress();
              setMenu({ x: e.clientX, y: e.clientY, tabId: t.id });
            }}
            onPointerDown={(e) => panelPointerDown(e, t.id)}
            onPointerMove={panelPointerMove}
            onPointerUp={clearPress}
            onPointerCancel={clearPress}
          >
            {/* 页内导航时重挂这一层（保留 .page-anim 转场）；切标签页不动这一层 */}
            <div className="page-anim" key={t.page} data-page={t.page} data-level={isSubPage(t.page) ? "sub" : undefined}>
              <TabScope tab={t}>
                {t.kind === "home" ? (
                  <HomeTab />
                ) : mounted.has(t.id) ? (
                  renderPage(t.page)
                ) : (
                  <div className="page-body" aria-hidden="true" />
                )}
              </TabScope>
            </div>
          </div>
        );
      })}
      {menu ? <TabContextMenu pos={menu} onClose={() => setMenu(null)} /> : null}
    </>
  );
}
