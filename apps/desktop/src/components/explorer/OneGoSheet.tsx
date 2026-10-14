import { Btn } from "@onethu/gui";
/**
 * OneGO 抽屉（dev-explorer）：从收藏夹升级来的「工作组织工具」。
 * 两个分段：我的收藏（OnePage）| 工作区。
 * - OnePage 现阶段按普通收藏夹格式组织（含子收藏夹——在一个 OnePage 里放
 *   另一个 OnePage 的入口）；点击 = 在新标签页打开该收藏夹页（FolderPage）。
 * - 工作区段与 TabDrawer 共用 WorkspacePanel（一份逻辑，两处引用）。
 * 开合是模块级 store（palette.ts 同款写法）。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { closeLiveWorkspace, dissolveWorkspace, explorerSnapshot, focusTab, HOME_TAB_ID, openTab, openWorkspace, subscribeExplorer } from "../../state/explorer.js";
import { useExitPhase } from "../../lib/useExitPhase.js";
import { useIsPhone, useSheetSnap } from "../../state/phoneSheets.js";
import { PhoneSheetGrip, useSheetDrag } from "./PhoneSheet.js";
import { openContextMenu, type MenuItem } from "./ContextMenu.js";
import { useDrawerRowsReorder } from "./TabDrawer.js";
import { useAnchorPos } from "./TabDrawer.js";
import { useExpanded } from "../../state/usePlatformLayout.js";
import { useFavs } from "../../state/favs.js";
import { allOnePages, createOnePage, openOnePage, removeOnePage } from "../../state/onePage.js";
import type { Board } from "../../state/boardCore.js";
import { resolveAtom } from "../../state/atoms.js";
import type { LearnNav, Page } from "../../state/app.js";
import { useApp } from "../../state/context.js";
import { FolderIcon } from "../Icons.js";
import { WorkspacePanel } from "./TabDrawer.js";
import { openFolderIconPicker } from "./FolderIconPicker.js";
import { showToast } from "../../state/toast.js";
import {
  activateUserTheme,
  deleteFlow,
  deleteTheme,
  subscribeUserExt,
  userExtSnapshot,
} from "../../state/userext.js";
import { confirmOk } from "../../lib/confirm.js";
import { openWorkspaceEditor } from "./WorkspaceEditor.js";

/* ══════════ 抽屉开合 store（palette.ts 同款） ══════════ */

let sheetOpen = false;
const sheetListeners = new Set<() => void>();

function emitSheet(): void {
  for (const f of sheetListeners) f();
}

export function openOneGoSheet(): void {
  if (!sheetOpen) {
    sheetOpen = true;
    emitSheet();
  }
}

export function closeOneGoSheet(): void {
  if (sheetOpen) {
    sheetOpen = false;
    emitSheet();
  }
}

function subscribeSheet(f: () => void): () => void {
  sheetListeners.add(f);
  return () => {
    sheetListeners.delete(f);
  };
}

export function useOneGoSheetOpen(): boolean {
  return useSyncExternalStore(subscribeSheet, () => sheetOpen, () => false);
}

/* ══════════ 我的收藏（OnePage）分段 ══════════ */

function FavsSection({ onDone }: { onDone: () => void }): ReactNode {
  const [name, setName] = useState("");
  const [tick, setTick] = useState(0);
  /* OnePage = 白板（2026-10-13 定案）：列出 BoardDoc.boards；点击 = 设为当前板并打开白板页 */
  useEffect(() => {
    const on = (): void => setTick((t) => t + 1);
    window.addEventListener("onethu.boards.changed", on);
    return () => window.removeEventListener("onethu.boards.changed", on);
  }, []);
  const boards = allOnePages();
  void tick;

  const create = (): void => {
    const t = name.trim();
    if (!t) return;
    const id = createOnePage(t);
    setName("");
    if (id) {
      openOnePage(id);
      openTab("board", null, { title: t });
      onDone();
    }
  };

  const openBoard = (b: Board): void => {
    openOnePage(b.id);
    openTab("board", null, { title: b.name });
    onDone();
  };

  const remove = (b: Board): void => {
    void confirmOk(`确定删除 OnePage「${b.name}」？\n这块白板和其中的内容都会永久消失！`).then((ok) => {
      if (ok) removeOnePage(b.id);
    });
  };

  return (
    <section aria-label="我的 OnePage">
      <div className="ex-sec-head">
        <b>我的 OnePage</b>
      </div>
      <div className="ex-newrow">
        <input
          className="ex-input"
          placeholder="新 OnePage 名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
        />
        <Btn variant="outline" onClick={create} disabled={!name.trim()}>新建</Btn>
      </div>
      {boards.length === 0 ? (
        <div className="ex-empty-hint">还没有 OnePage。新建一块，它就是一张可以随意摆组件的白板。</div>
      ) : (
        <div className="ex-row-list">
          {boards.map((b) => (
            <div key={b.id} className="ex-row-wrap">
              <button className="ex-row ex-row-clickable" onClick={() => openBoard(b)}>
                <span className="ex-row-icon"><FolderIcon name={b.icon ?? "fist"} /></span>
                <span className="ex-row-main">
                  <span className="ex-row-title">{b.name}</span>
                  <span className="ex-row-sub">{b.kind === "system" ? "系统板（今日）" : "白板"}</span>
                </span>
              </button>
              {b.kind === "system" ? null : (
                <Btn variant="ghost" onClick={() => remove(b)}>删除</Btn>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="ex-hint-line">OnePage 是一张白板：长按组件换位，右下角进编辑与添加。</div>
    </section>
  );
}

/* ══════════ OneFlow（工作区+自动化+技能结合体）══════════ */

function FlowSection({ onDone }: { onDone: () => void }): ReactNode {
  const [, setTick] = useState(0);
  useEffect(() => {
    const off = subscribeUserExt(() => setTick((t) => t + 1));
    return off;
  }, []);
  const flows = userExtSnapshot().flows;
  const themes = userExtSnapshot().themes;
  const activeTheme = userExtSnapshot().activeThemeId;
  const run = (id: string): void => {
    /* 运行走 OH：OneFlow 的步骤经插件门面执行；此处只负责手动点火入口的可见性 */
    void id;
    showToast("在 OH 对话里说「运行 XX」即可执行（步骤走门面权限）");
  };
  return (
    <section aria-label="OneFlow">
      <div className="ex-sec-head">
        <b>OneFlow</b>
      </div>
      {flows.length === 0 ? (
        <div className="ex-empty-hint">还没有 OneFlow，去 OH 对话说「创建一个流程」即可。</div>
      ) : (
        <div className="ex-row-list">
          {flows.map((f) => (
            <div key={f.id} className="ex-row-wrap">
              <button className="ex-row ex-row-clickable" onClick={() => run(f.id)}>
                <span className="ex-row-icon"><FolderIcon name="fist" /></span>
                <span className="ex-row-main">
                  <span className="ex-row-title">{f.name}</span>
                  <span className="ex-row-sub">
                    {f.trigger.kind === "manual" ? "手动" : f.trigger.kind === "cron" ? "每 " + f.trigger.everyMinutes + " 分钟" : "事件"} ·{" "}
                    {f.lastRun ? (f.lastOk ? "上次正常" : "上次失败 · 在 OH 对话里重试并查看原因") : "未运行过"}
                  </span>
                </span>
              </button>
              <Btn variant="ghost" onClick={() => { deleteFlow(f.id); }}>删除</Btn>
            </div>
          ))}
        </div>
      )}
      {themes.length > 0 ? (
        <>
          <div className="ex-sec-head" style={{ marginTop: 10 }}>
            <b>用户主题</b>
          </div>
          <div className="ex-row-list">
            {themes.map((t) => (
              <div key={t.id} className="ex-row-wrap">
                <button
                  className="ex-row ex-row-clickable"
                  onClick={() => activateUserTheme(activeTheme === t.id ? null : t.id)}
                >
                  <span className="ex-row-icon"><FolderIcon name="star" /></span>
                  <span className="ex-row-main">
                    <span className="ex-row-title">{t.name}</span>
                    <span className="ex-row-sub">{activeTheme === t.id ? "生效中（再点恢复默认）" : "点击应用"}</span>
                  </span>
                </button>
                <Btn variant="ghost" onClick={() => deleteTheme(t.id)}>删除</Btn>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

/* ══════════ ⑦ 小窗内搜索：OnePage 按 title、工作区按 name（大小写不敏感） ══════════ */

function OneGoSearchResults({ q, onDone }: { q: string; onDone: () => void }): ReactNode {
  const { navigate } = useApp();
  const hits = allOnePages().filter((b) => b.name.toLowerCase().includes(q));
  const wsSnap = useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
  const wsHits = wsSnap.workspaces.filter((w) => w.name.toLowerCase().includes(q));
  if (hits.length === 0 && wsHits.length === 0) return <div className="ex-empty-hint">没有匹配的 OnePage 或工作区。</div>;
  return (
    <>
      {hits.length > 0 ? (
        <section aria-label="OnePage 搜索结果">
          <div className="ex-group-head">
            <span className="ex-group-name">OnePage</span>
            <span className="ex-group-count">{hits.length}</span>
          </div>
          <div className="ex-row-list">
            {hits.map((b) => (
              <div key={b.id} className="ex-row-wrap">
                <button
                  className="ex-row ex-row-clickable"
                  onClick={() => {
                    openOnePage(b.id);
                    openTab("board", null, { title: b.name });
                    onDone();
                  }}
                >
                  <span className="ex-row-icon"><FolderIcon name={b.icon ?? "fist"} /></span>
                  <span className="ex-row-main">
                    <span className="ex-row-title">{b.name}</span>
                    <span className="ex-row-sub">{b.kind === "system" ? "系统板（今日）" : "白板"}</span>
                  </span>
                </button>
                </div>
            ))}
          </div>
        </section>
      ) : null}
      {wsHits.length > 0 ? (
        <section aria-label="工作区搜索结果">
          <div className="ex-group-head">
            <span className="ex-group-name">工作区</span>
            <span className="ex-group-count">{wsHits.length}</span>
          </div>
          <div className="ex-row-list">
            {wsHits.map((w) => (
              <div className="ex-row" key={w.id}>
                <div className="ex-row-main">
                  <span className="ex-row-title">{w.name}</span>
                  <span className="ex-row-sub">{w.tabs.length} 个标签页</span>
                </div>
                <div className="ex-row-actions">
                  <Btn variant="ghost" onClick={() => { openWorkspace(w.id); onDone(); }}>打开</Btn>
                  <Btn variant="ghost" onClick={() => openWorkspaceEditor(w.id)}>编辑</Btn>
                  {w.live ? (
                    <Btn variant="ghost" titleAttr="解散：只退组，标签页保留" onClick={() => dissolveWorkspace(w.id)}>解散</Btn>
                  ) : null}
                  <button
                    className="btn btn-ghost ex-btn-sm ex-danger"
                    title="彻底删除：连同其中的标签页一起关闭"
                    onClick={() =>
                      void confirmOk(`彻底删除工作区「${w.name}」及其中的标签页？`).then((ok) => {
                        if (ok) closeLiveWorkspace(w.id);
                      })
                    }
                  >
                    彻底删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

/* ══════════ 抽屉本体 ══════════ */

type SheetTab = "favs" | "ws";

function OneGoSheetInner(): ReactNode {
  const open = useOneGoSheetOpen();
  /* 手机端（A4 同手柄）：seeking 抽屉（0.6vh ⟷ 0.94vh 两档） */
  const phoneUi = useIsPhone();
  const snapState = useSheetSnap("onego");
  const sheetRef = useRef<HTMLElement | null>(null);
  const sheet = useSheetDrag(sheetRef, { id: "onego" });
  const [closing, requestClose] = useExitPhase(closeOneGoSheet, open);
  const expanded = useExpanded();
  const anchor = useAnchorPos("ex-bbar-onego-btn", open, expanded);

  /** 工作区行菜单（与 TabDrawer 同一份语义：打开 / 编辑 / 解散 / 彻底删除；B 的右键口径） */
  const openWsMenuAt = useCallback((x: number, y: number, wsId: string): void => {
    const ws = explorerSnapshot().workspaces.find((w) => w.id === wsId);
    if (!ws) return;
    const count = explorerSnapshot().tabs.filter((t) => t.workspaceId === wsId).length;
    const items: MenuItem[] = [
      { label: "打开工作区", onSelect: () => openWorkspace(wsId) },
      { label: "编辑工作区…", onSelect: () => openWorkspaceEditor(wsId) },
      { label: "解散工作区（保留标签页）", onSelect: () => dissolveWorkspace(wsId), danger: true, sepBefore: true },
      {
        label: "彻底删除（连同标签页）",
        onSelect: () =>
          void confirmOk(`彻底删除工作区「${ws.name}」及其中的 ${count} 个标签页？`).then((ok) => {
            if (ok) closeLiveWorkspace(wsId);
          }),
        danger: true,
        sepBefore: true,
      },
    ];
    openContextMenu(x, y, items);
  }, []);

  /** 工作区块与行的长按/右键（触屏行列出工作区行；拖拽在该抽屉不启） */
  const sheetCtl = useDrawerRowsReorder({
    onTabMenu: () => undefined,
    onWsMenu: openWsMenuAt,
    onGroupDrop: () => undefined,
  });
  const [seg, setSeg] = useState<SheetTab>("favs");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, requestClose]);

  if (!open) return null;
  return createPortal(
    <>
      <div className={"ex-sheet-mask" + (closing ? " is-closing" : "")} onClick={requestClose} />
      <aside
        ref={phoneUi ? sheetRef : undefined}
        className={"ex-sheet ex-onego" + (expanded ? " ex-pop" : "") + (closing ? " is-closing" : "") + (phoneUi ? (sheet.dragging ? " is-mob-drag" : snapState === "full" ? " is-mob-full" : " is-mob-half") : "")}
        role="dialog"
        aria-label="OneGO!"
        style={phoneUi
          ? { height: sheet.dragH != null ? `${sheet.dragH}px` : undefined }
          : expanded ? { top: anchor?.top, left: anchor?.left, bottom: "auto", right: "auto", visibility: anchor ? undefined : "hidden" } : undefined}
        onPointerDown={sheetCtl.onPointerDown}
        onContextMenu={sheetCtl.onContextMenu}
        onClickCapture={sheetCtl.onClickCapture}
      >
        {phoneUi ? <PhoneSheetGrip label="拖住改高度（半屏或全屏）" gripProps={sheet.gripProps} /> : null}
        <header className="ex-sheet-head">
          <b>OneGO!</b>
          <span className="ex-sec-head-note">组织你的工作</span>
          <Btn variant="ghost" onClick={requestClose}>完成</Btn>
        </header>
        <div className="ex-seg-row">
          <div className="segmented ex-seg" role="tablist" aria-label="OneGO! 分段">
            <button className={seg === "favs" ? "is-active" : ""} role="tab" aria-selected={seg === "favs"} onClick={() => setSeg("favs")}>我的收藏</button>
            <button className={seg === "ws" ? "is-active" : ""} role="tab" aria-selected={seg === "ws"} onClick={() => setSeg("ws")}>工作区</button>
          </div>
        </div>
        <div className="ex-sheet-body">
          <div className="ex-sheet-search">
            <input
              className="ex-input"
              placeholder="搜索 OnePage / 工作区…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {q ? (
            <OneGoSearchResults q={q} onDone={requestClose} />
          ) : seg === "favs" ? (
            <>
              <FavsSection onDone={closeOneGoSheet} />
              <FlowSection onDone={requestClose} />
            </>
          ) : (
            <WorkspacePanel />
          )}
        </div>
        <footer className="ex-sheet-foot">
          <button className="btn btn-ghost" onClick={() => { focusTab(HOME_TAB_ID); requestClose(); }}>
            功能目录在首页 ↓
          </button>
        </footer>
      </aside>
    </>,
    document.body,
  );
}

export function OneGoSheet(): ReactNode {
  return <OneGoSheetInner />;
}
