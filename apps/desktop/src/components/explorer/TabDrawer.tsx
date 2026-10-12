/**
 * 标签页抽屉（dev-explorer）：当前标签页管理 + 工作区。
 * 手机 = 底部抽屉，桌面 = 右下浮层面板（同一 DOM，CSS 媒体查询分流）。
 * 开合是模块级 store（palette.ts 同款写法），任何入口（底栏/快捷键/插件）都能开它。
 *
 * 工作区段抽成 WorkspacePanel 导出——OneGoSheet 引同一份，逻辑不许复制两份。
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  activeTabId,
  allTabs,
  closeOtherTabs,
  closeTab,
  deleteWorkspace,
  explorerSnapshot,
  focusTab,
  HOME_TAB_ID,
  moveTab,
  openWorkspace,
  saveWorkspace,
  subscribeExplorer,
  titleOf,
  type ExplorerTab,
} from "../../state/explorer.js";
import { IconX } from "../Icons.js";
import { useTabTitleRefiner } from "./TabStrip.js";

/* ══════════ 抽屉开合 store（palette.ts 同款） ══════════ */

let drawerOpen = false;
const drawerListeners = new Set<() => void>();

function emitDrawer(): void {
  for (const f of drawerListeners) f();
}

export function openTabDrawer(): void {
  if (!drawerOpen) {
    drawerOpen = true;
    emitDrawer();
  }
}

export function closeTabDrawer(): void {
  if (drawerOpen) {
    drawerOpen = false;
    emitDrawer();
  }
}

function subscribeDrawer(f: () => void): () => void {
  drawerListeners.add(f);
  return () => {
    drawerListeners.delete(f);
  };
}

export function useTabDrawerOpen(): boolean {
  return useSyncExternalStore(subscribeDrawer, () => drawerOpen, () => false);
}

/* ══════════ 小工具 ══════════ */

function relTime(ts: number): string {
  if (!ts) return "—";
  const d = Date.now() - ts;
  if (d < 60_000) return "刚刚";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}小时前`;
  return `${Math.floor(d / 86_400_000)}天前`;
}

/* ══════════ 工作区面板（TabDrawer 与 OneGoSheet 共用） ══════════ */

export function WorkspacePanel(): ReactNode {
  const snap = useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const save = (): void => {
    const id = saveWorkspace(name);
    if (id) {
      setName("");
      setNaming(false);
    }
  };

  return (
    <section className="ex-ws" aria-label="工作区">
      <div className="ex-sec-head">
        <b>工作区</b>
        <span className="ex-sec-head-note">一组标签页的快照，可一键恢复</span>
        {snap.tabs.length > 0 ? (
          naming ? (
            <span className="ex-ws-naming">
              <input
                className="ex-input"
                placeholder="工作区名称"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") setNaming(false);
                }}
              />
              <button className="btn btn-primary ex-btn-sm" onClick={save}>保存</button>
              <button className="btn btn-ghost ex-btn-sm" onClick={() => setNaming(false)}>取消</button>
            </span>
          ) : (
            <button className="btn btn-ghost ex-btn-sm" onClick={() => setNaming(true)}>
              存当前 {snap.tabs.length} 个为工作区
            </button>
          )
        ) : null}
      </div>
      {snap.workspaces.length === 0 ? (
        <div className="ex-empty-hint">还没有工作区。把眼下的标签页组合存起来，下次一键回到这个工作状态。</div>
      ) : (
        <div className="ex-ws-list">
          {snap.workspaces.map((w) => (
            <div className="ex-row" key={w.id}>
              <div className="ex-row-main">
                <span className="ex-row-title">{w.name}</span>
                <span className="ex-row-sub">{w.tabs.length} 个标签页</span>
              </div>
              <div className="ex-row-actions">
                <button className="btn btn-ghost ex-btn-sm" onClick={() => { openWorkspace(w.id); closeTabDrawer(); }}>打开</button>
                <button className="btn btn-ghost ex-btn-sm ex-danger" onClick={() => deleteWorkspace(w.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ══════════ 标签页行 ══════════ */

function TabRow({ tab, refine }: { tab: ExplorerTab; refine: (t: ExplorerTab) => string }): ReactNode {
  const isHome = tab.kind === "home";
  return (
    <div className={"ex-row" + (tab.id === activeTabId() ? " is-active" : "")}>
      <button className="ex-row-main ex-row-clickable" onClick={() => { focusTab(tab.id); closeTabDrawer(); }}>
        <span className="ex-row-title">{refine(tab)}</span>
        <span className="ex-row-sub">
          {isHome ? "首页 · 不可关闭" : `${titleOf(tab.page, tab.params)} · ${relTime(tab.lastActiveAt)}`}
        </span>
      </button>
      {isHome ? null : (
        <div className="ex-row-actions">
          <button className="ex-mini" title="上移" aria-label={`上移 ${refine(tab)}`} onClick={() => moveTab(tab.id, -1)}>↑</button>
          <button className="ex-mini" title="下移" aria-label={`下移 ${refine(tab)}`} onClick={() => moveTab(tab.id, 1)}>↓</button>
          <button className="ex-mini" title="关闭" aria-label={`关闭 ${refine(tab)}`} onClick={() => closeTab(tab.id)}>
            <IconX width={11} height={11} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ══════════ 抽屉本体 ══════════ */

function TabDrawerInner(): ReactNode {
  const open = useTabDrawerOpen();
  const { tabs } = useExplorerTabsLocal();
  const refine = useTabTitleRefiner();
  const pageTabs = tabs.filter((t) => t.kind === "page");

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape") closeTabDrawer();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  if (!open) return null;
  return createPortal(
    <>
      <div className="ex-sheet-mask" onClick={closeTabDrawer} />
      <aside className="ex-sheet ex-tabdrawer" role="dialog" aria-label="标签页">
        <header className="ex-sheet-head">
          <b>标签页</b>
          <span className="ex-sec-head-note">{pageTabs.length} 个工作标签</span>
          <button className="btn btn-ghost ex-btn-sm" onClick={closeTabDrawer}>完成</button>
        </header>
        <div className="ex-sheet-body">
          <section aria-label="当前标签页">
            <div className="ex-sec-head">
              <b>当前标签页</b>
              {pageTabs.length > 1 ? (
                <button className="btn btn-ghost ex-btn-sm" onClick={() => closeOtherTabs(activeTabId())}>关闭其他</button>
              ) : null}
            </div>
            <div className="ex-row-list">
              {tabs.map((t) => (
                <TabRow key={t.id} tab={t} refine={refine} />
              ))}
            </div>
          </section>
          <WorkspacePanel />
        </div>
        <footer className="ex-sheet-foot">
          <button className="btn btn-ghost" onClick={() => { focusTab(HOME_TAB_ID); closeTabDrawer(); }}>
            + 新建标签页（回首页）
          </button>
        </footer>
      </aside>
    </>,
    document.body,
  );
}

/** 局部小钩子：与 TabStrip.useExplorerTabs 同源（抽成局部转发，避免跨文件多一层导出面） */
function useExplorerTabsLocal(): { tabs: ExplorerTab[]; activeId: string } {
  const snap = useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
  return { tabs: allTabs(), activeId: snap.activeId };
}

export function TabDrawer(): ReactNode {
  return <TabDrawerInner />;
}
