/**
 * 标签页抽屉（dev-explorer）：当前标签页（按工作区分组）+ 工作区管理。
 * 手机 = 底部抽屉，桌面 = 右下浮层面板（同一 DOM，CSS 媒体查询分流）。
 *
 * v2（用户拍板「工作区像摆设」）：
 * - 「当前标签页」按 workspaceId 分组：组头 = 工作区名 + 实时计数；未归属归「未分组」兜底；
 * - 每个 tab 行可「移入工作区」（⋯ 浮层：列工作区 / 新建工作区… / 移出）；
 * - 行摘要 = tabTitles 的完整路径（小字），标题 = 实体短标签；
 * - WorkspacePanel 每行显示**实时**成员数与 label 预览（按 workspaceId 反查，不是快照数）。
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
  setTabWorkspace,
  subscribeExplorer,
  useExplorerState,
  type ExplorerTab,
} from "../../state/explorer.js";
import { resolveTabTitle, useTabTitleTick } from "../../state/tabTitles.js";
import { useExitPhase } from "../../lib/useExitPhase.js";
import { IconX } from "../Icons.js";

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

function useDrawerOpen(): boolean {
  return useSyncExternalStore(subscribeDrawer, () => drawerOpen, () => false);
}

/* 抽屉内部读开合用 useDrawerOpen；对外导出 useTabDrawerOpen */
export function useTabDrawerOpen(): boolean {
  return useDrawerOpen();
}

/** store 状态视图类型（explorer.ts 未导出接口本体，借 hook 返回类型） */
type ExplorerStateView = ReturnType<typeof useExplorerState>;

/* ══════════ 小工具 ══════════ */

function relTime(ts: number): string {
  if (!ts) return "—";
  const d = Date.now() - ts;
  if (d < 60_000) return "刚刚";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}小时前`;
  return `${Math.floor(d / 86_400_000)}天前`;
}

/* ══════════ 「移入工作区」浮层（复用 .explorer-ctxmenu 视觉） ══════════ */

function MoveMenu({
  tab,
  x,
  y,
  snap,
  onClose,
}: {
  tab: ExplorerTab;
  x: number;
  y: number;
  snap: ExplorerStateView;
  onClose: () => void;
}): ReactNode {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const others = snap.workspaces.filter((w) => w.id !== tab.workspaceId);
  const top = Math.min(y, Math.max(window.innerHeight - 280, 8));
  const left = Math.min(x, Math.max(window.innerWidth - 220, 8));

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation(); // 只关浮层，不连带关抽屉（抽屉侧也查 menuOpen 双保险）
        onClose();
      }
    };
    window.addEventListener("keydown", h, true); // 捕获相位：先于抽屉的冒泡 handler
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);

  const createAndMove = (): void => {
    const t = name.trim();
    if (!t) return;
    const wsId = saveWorkspace(t, [tab.id]);
    if (wsId) onClose();
  };

  return createPortal(
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 1350 }} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="explorer-ctxmenu" style={{ left, top, zIndex: 1351 }} role="menu">
        {naming ? (
          <div className="explorer-ctxmenu-naming">
            <input
              className="ex-input"
              placeholder="工作区名称"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createAndMove();
              }}
            />
            <button className="btn btn-primary ex-btn-sm" onClick={createAndMove}>存</button>
          </div>
        ) : (
          <>
            {others.map((w) => (
              <button key={w.id} className="explorer-ctxmenu-item" role="menuitem" onClick={() => { setTabWorkspace(tab.id, w.id); onClose(); }}>
                移入「{w.name}」
              </button>
            ))}
            <button className="explorer-ctxmenu-item" role="menuitem" onClick={() => setNaming(true)}>
              新建工作区…
            </button>
            {tab.workspaceId ? (
              <button className="explorer-ctxmenu-item" role="menuitem" onClick={() => { setTabWorkspace(tab.id, null); onClose(); }}>
                移出（未分组）
              </button>
            ) : null}
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

/* ══════════ 工作区面板（TabDrawer 与 OneGoSheet 共用） ══════════ */

/** 实时统计：某工作区当前的成员 tab（按 workspaceId 反查） */
function membersOf(snap: ExplorerStateView, wsId: string): ExplorerTab[] {
  return snap.tabs.filter((t) => t.workspaceId === wsId);
}

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
        <span className="ex-sec-head-note">标签页的归属组合；恢复时按实例去重</span>
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
        <div className="ex-empty-hint">还没有工作区。把眼下的标签页组合存起来，下次一键回到这个工作状态；也可以在上面的标签行里用「⋯」把单个标签移入工作区。</div>
      ) : (
        <div className="ex-ws-list">
          {snap.workspaces.map((w) => {
            const members = membersOf(snap, w.id);
            const preview = members
              .slice(0, 4)
              .map((t) => (t.kind === "home" ? "首页" : resolveTabTitle(t.page, t.params).label))
              .join("、");
            return (
              <div className="ex-row" key={w.id}>
                <div className="ex-row-main">
                  <span className="ex-row-title">{w.name}</span>
                  <span className="ex-row-sub">
                    {members.length > 0 ? `${members.length} 个标签：${preview}${members.length > 4 ? "…" : ""}` : "暂无成员标签"}
                  </span>
                </div>
                <div className="ex-row-actions">
                  <button className="btn btn-ghost ex-btn-sm" onClick={() => { openWorkspace(w.id); closeTabDrawer(); }}>打开</button>
                  <button className="btn btn-ghost ex-btn-sm ex-danger" onClick={() => deleteWorkspace(w.id)}>删除</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ══════════ 标签页行 ══════════ */

function TabRow({
  tab,
  onMove,
}: {
  tab: ExplorerTab;
  onMove: (tab: ExplorerTab, x: number, y: number) => void;
}): ReactNode {
  const isHome = tab.kind === "home";
  const { label, full } = isHome
    ? { label: "首页", full: "首页" }
    : resolveTabTitle(tab.page, tab.params);
  const active = tab.id === activeTabId();
  return (
    <div className={"ex-row" + (active ? " is-active" : "")}>
      <button className="ex-row-main ex-row-clickable" onClick={() => { focusTab(tab.id); closeTabDrawer(); }}>
        <span className="ex-row-title">{label}</span>
        <span className="ex-row-sub">
          {isHome ? "首页 · 不可关闭" : `${full} · ${relTime(tab.lastActiveAt)}`}
        </span>
      </button>
      {isHome ? null : (
        <div className="ex-row-actions">
          <button className="ex-mini" title="移入工作区" aria-label={`把「${label}」移入工作区`} onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onMove(tab, r.left, r.bottom + 4); }}>⋯</button>
          <button className="ex-mini" title="上移" aria-label={`上移 ${label}`} onClick={() => moveTab(tab.id, -1)}>↑</button>
          <button className="ex-mini" title="下移" aria-label={`下移 ${label}`} onClick={() => moveTab(tab.id, 1)}>↓</button>
          <button className="ex-mini" title="关闭" aria-label={`关闭 ${label}`} onClick={() => closeTab(tab.id)}>
            <IconX width={11} height={11} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ══════════ 抽屉本体 ══════════ */

function TabDrawerInner(): ReactNode {
  const open = useDrawerOpen();
  const [closing, requestClose] = useExitPhase(closeTabDrawer, open);
  const snap = useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
  const tabs = allTabs();
  const pageTabs = snap.tabs;
  const [menuFor, setMenuFor] = useState<{ tab: ExplorerTab; x: number; y: number } | null>(null);
  useTabTitleTick();

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !menuFor) requestClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, menuFor, requestClose]);

  if (!open) return null;

  /* 按工作区分组：未分组兜底在前，其后按工作区列表顺序 */
  const ungrouped = pageTabs.filter((t) => !t.workspaceId);
  const groups = snap.workspaces
    .map((w) => ({ ws: w, members: membersOf(snap, w.id) }))
    .filter((g) => g.members.length > 0);

  return createPortal(
    <>
      <div className={"ex-sheet-mask" + (closing ? " is-closing" : "")} onClick={requestClose} />
      <aside className={"ex-sheet ex-tabdrawer" + (closing ? " is-closing" : "")} role="dialog" aria-label="标签页">
        <header className="ex-sheet-head">
          <b>标签页</b>
          <span className="ex-sec-head-note">{pageTabs.length} 个工作标签</span>
          <button className="btn btn-ghost ex-btn-sm" onClick={requestClose}>完成</button>
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
              <TabRow tab={tabs[0]!} onMove={(tab, x, y) => setMenuFor({ tab, x, y })} />
              {ungrouped.length > 0 ? (
                <>
                  <div className="ex-group-head">
                    <span className="ex-group-name">未分组</span>
                    <span className="ex-group-count">{ungrouped.length}</span>
                  </div>
                  {ungrouped.map((t) => (
                    <TabRow key={t.id} tab={t} onMove={(tab, x, y) => setMenuFor({ tab, x, y })} />
                  ))}
                </>
              ) : null}
              {groups.map((g) => (
                <div key={g.ws.id}>
                  <div className="ex-group-head">
                    <span className="ex-group-dot" aria-hidden="true" />
                    <span className="ex-group-name">{g.ws.name}</span>
                    <span className="ex-group-count">{g.members.length}</span>
                  </div>
                  {g.members.map((t) => (
                    <TabRow key={t.id} tab={t} onMove={(tab, x, y) => setMenuFor({ tab, x, y })} />
                  ))}
                </div>
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
      {menuFor ? <MoveMenu tab={menuFor.tab} x={menuFor.x} y={menuFor.y} snap={snap} onClose={() => setMenuFor(null)} /> : null}
    </>,
    document.body,
  );
}

export function TabDrawer(): ReactNode {
  return <TabDrawerInner />;
}
