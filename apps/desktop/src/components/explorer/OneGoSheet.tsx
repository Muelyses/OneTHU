import { useOverlayBack } from "../../state/navStack.js";
import { msg as i18nMsg, t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
import { vaultCatchWorkspace } from "../../lib/vaultCatch.js";
import { Input, Row } from "@onethu/gui";
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
import { createOnePage, openOnePage, removeOnePage, renameOnePage, userOnePages } from "../../state/onePage.js";
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
  runFlowNow,
  setFlowEnabled,
  subscribeUserExt,
  userExtSnapshot,
} from "../../state/userext.js";
import { confirmOk } from "../../lib/confirm.js";
import { openWorkspaceEditor } from "./WorkspaceEditor.js";
import { openFormModal } from "../../lib/formModal.js";

/* ══════════ 抽屉开合 store（palette.ts 同款） ══════════ */

type SheetTab = "favs" | "ws";
let sheetOpen = false;
let sheetTab: SheetTab = "favs";
let sectionRequest = 0;
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

/** Open the requested section even when the sheet was already mounted. */
export function openOneGoSection(tab: SheetTab): void {
  sheetTab = tab;
  sectionRequest++;
  sheetOpen = true;
  emitSheet();
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
  const uiLocale = useUiLocale();

  const { navigate } = useApp();
  const [name, setName] = useState("");
  const [tick, setTick] = useState(0);
  /* OnePage = 白板（2026-10-13 定案）：列出 BoardDoc.boards；点击 = 设为当前板并打开白板页 */
  useEffect(() => {
    const on = (): void => setTick((t) => t + 1);
    window.addEventListener("onethu.boards.changed", on);
    return () => window.removeEventListener("onethu.boards.changed", on);
  }, []);
  /* 只列**用户的** OnePage（2026-10-15 用户实测）：系统板（「首页」）不是一块可打开的 OnePage，
     把它列进来，点「首页」等于"把首页当白板打开"，看到的是旧板面而不是首页。首页另有入口：
     顶栏 Logo、程序坞、以及本表下方的「功能目录在首页」。 */
  const boards = userOnePages();
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
    void confirmOk(i18nMsg("components.explorer.onegosheet.3c09b64b68ca", { name: String(b.name) })).then((ok) => {
      if (ok) removeOnePage(b.id);
    });
  };

  const rename = async (b: Board): Promise<void> => {
    const f = await openFormModal(i18nMsg("components.explorer.onegosheet.0c898fe25ba6"), [
      { key: "name", label: i18nMsg("components.explorer.onegosheet.6773310492a9"), required: true, default: b.name },
    ]);
    if (!f) return;
    renameOnePage(b.id, f.name ?? b.name);
  };

  const rowMenu = (b: Board, x: number, y: number): void => {
    openContextMenu(x, y, [
      { label: i18n("components.explorer.onegosheet.ec4cd05f5147"), onSelect: () => void rename(b) },
      { label: i18n("components.explorer.onegosheet.9201642820f0"), onSelect: () => openFolderIconPicker(b.id) },
      { label: i18n("components.explorer.onegosheet.3a32f6df621a"), onSelect: () => { openOnePage(b.id); showToast(i18nMsg("components.explorer.onegosheet.54b5026aad0d", { name: String(b.name) })); } },
      { label: i18n("components.explorer.onegosheet.0552e329ccf8"), danger: true, sepBefore: true, onSelect: () => remove(b) },
    ]);
  };

  return (
    <section aria-label={i18n("components.explorer.onegosheet.eb597c54b6b0")}>
      <div className="ex-sec-head">
        <b>{i18n("components.explorer.onegosheet.eb597c54b6b0")}</b>
      </div>
      {/* 「首页」入口（2026-10-15 用户点名「点击首页回首页」）：系统板不是 OnePage，不能列成一块板，
          但"回首页"这件事必须在这个列表里点得到 —— 它聚焦首页标签（与顶栏 Logo 同一条路）。
          用 GUI 的 Row（可点）而不是自写的裸按钮元素：仓库的裸控件棘轮只许降不许涨（R4）。 */}
      <Row
        title={i18n("components.explorer.onegosheet.203c08e0d44a")}
        sub={i18n("components.explorer.onegosheet.1e8cdaa51b97")}
        onClick={() => {
          focusTab(HOME_TAB_ID);
          onDone();
        }}
      />
      <div className="ex-newrow">
        <Input placeholder={i18n("components.explorer.onegosheet.b666a22dbc56")} value={name} onChange={(value) => setName(value)} onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }} />
        <Btn variant="outline" onClick={create} disabled={!name.trim()}>{i18n("components.explorer.onegosheet.50ef2f4cf6a4")}</Btn>
      </div>
      {boards.length === 0 ? (
        <div className="ex-empty-hint">{i18n("components.explorer.onegosheet.b7c9f326f03e")}</div>
      ) : (
        <div className="ex-row-list">
          {boards.map((b) => (
            <div key={b.id} className="ex-row-wrap">
              <button
                className="ex-row ex-row-clickable"
                onClick={() => openBoard(b)}
                onContextMenu={(e) => { e.preventDefault(); rowMenu(b, e.clientX, e.clientY); }}
              >
                <span className="ex-row-icon"><FolderIcon name={b.icon ?? "fist"} /></span>
                <span className="ex-row-main">
                  <span className="ex-row-title">{b.name}</span>
                  <span className="ex-row-sub">{b.kind === "system" ? i18n("components.explorer.onegosheet.97778650b3ab") : "OnePage"}</span>
                </span>
              </button>
              {b.kind === "system" ? null : (
                <Btn variant="ghost" onClick={(e) => rowMenu(b, e.clientX, e.clientY)}>⋯</Btn>
              )}
            </div>
          ))}
        </div>
      )}
      <Row
        title={i18n("components.explorer.onegosheet.0f591af87c35")}
        sub={i18n("components.explorer.onegosheet.2fffc7ba053b")}
        onClick={() => { navigate("boards"); onDone(); }}
      />
      <Row
        title={i18n("components.explorer.onegosheet.804002a9c49a")}
        sub={i18n("components.explorer.onegosheet.2ea06cb193ec")}
        onClick={() => { navigate("vault"); onDone(); }}
      />
      <div className="ex-hint-line">{i18n("components.explorer.onegosheet.940e1639d05d")}</div>
    </section>
  );
}

/* ══════════ OneFlow（工作区+自动化+技能结合体）══════════ */

function FlowSection({ onDone }: { onDone: () => void }): ReactNode {
  const uiLocale = useUiLocale();

  const [, setTick] = useState(0);
  useEffect(() => {
    const off = subscribeUserExt(() => setTick((t) => t + 1));
    return off;
  }, []);
  const flows = userExtSnapshot().flows;
  const themes = userExtSnapshot().themes;
  const activeTheme = userExtSnapshot().activeThemeId;
  const run = (id: string, name: string): void => {
    showToast(i18nMsg("components.explorer.onegosheet.73e756dbfa1a", { name: String(name) }));
    void runFlowNow(id).then((r) => {
      if (r.ok) showToast(i18nMsg("components.explorer.onegosheet.dd85b3f9c981", { name: String(name) }));
      else showToast(i18nMsg("components.explorer.onegosheet.30344364115f", { name: String(name), value: String(r.error ?? i18n("components.explorer.onegosheet.13a46616e16f")) }));
      setTick((t) => t + 1);
    });
  };
  return (
    <section aria-label="OneFlow">
      <div className="ex-sec-head">
        <b>OneFlow</b>
      </div>
      {flows.length === 0 ? (
        <div className="ex-empty-hint">{i18n("components.explorer.onegosheet.a41b60d0727e")}</div>
      ) : (
        <div className="ex-row-list">
          {flows.map((f) => (
            <div key={f.id} className="ex-row-wrap">
              <button className="ex-row ex-row-clickable" onClick={() => run(f.id, f.name)}>
                <span className="ex-row-icon"><FolderIcon name="fist" /></span>
                <span className="ex-row-main">
                  <span className="ex-row-title">{f.name}</span>
                  <span className="ex-row-sub">
                    {f.enabled === false ? i18n("components.explorer.onegosheet.191605f81453") : ""}
                    {f.trigger.kind === "manual" ? i18n("components.explorer.onegosheet.962f41ef825b") : f.trigger.kind === "cron" ? i18n("components.explorer.onegosheet.0a97ef128fc4") + f.trigger.everyMinutes + i18n("components.explorer.onegosheet.40de54344d22") : i18n("components.explorer.onegosheet.c560201b331c")} ·{" "}
                    {f.lastRun ? (f.lastOk ? i18n("components.explorer.onegosheet.ef6db76ef5a8") : i18n("components.explorer.onegosheet.4c4b273d507f") + (f.lastError ? "：" + f.lastError : "")) : i18n("components.explorer.onegosheet.8d812d3abb5a")}
                  </span>
                </span>
              </button>
              <Btn variant="ghost" onClick={() => { setFlowEnabled(f.id, f.enabled === false); }}>{f.enabled === false ? i18n("components.explorer.onegosheet.f4f0ead1116b") : i18n("components.explorer.onegosheet.4e6fd0e28c55")}</Btn>
              <Btn variant="ghost" onClick={() => {
                void confirmOk(i18nMsg("components.explorer.onegosheet.512385d31c57", { name: String(f.name) })).then((ok) => {
                  if (ok) { deleteFlow(f.id); showToast(i18nMsg("components.explorer.onegosheet.e6d7b9ff838f", { name: String(f.name) })); }
                });
              }}>{i18n("components.explorer.onegosheet.2f9daa828907")}</Btn>
            </div>
          ))}
        </div>
      )}
      {themes.length > 0 ? (
        <>
          <div className="ex-sec-head" style={{ marginTop: 10 }}>
            <b>{i18n("components.explorer.onegosheet.6afc8b735d6d")}</b>
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
                    <span className="ex-row-sub">{activeTheme === t.id ? i18n("components.explorer.onegosheet.2ce3ff19d6ac") : i18n("components.explorer.onegosheet.6630af4e3a3e")}</span>
                  </span>
                </button>
                <Btn variant="ghost" onClick={() => deleteTheme(t.id)}>{i18n("components.explorer.onegosheet.2f9daa828907")}</Btn>
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
  const uiLocale = useUiLocale();

  const { navigate } = useApp();
  const hits = userOnePages().filter((b) => b.name.toLowerCase().includes(q));
  const wsSnap = useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
  const wsHits = wsSnap.workspaces.filter((w) => w.name.toLowerCase().includes(q));
  if (hits.length === 0 && wsHits.length === 0) return <div className="ex-empty-hint">{i18n("components.explorer.onegosheet.7825abf8e9da")}</div>;
  return (
    <>
      {hits.length > 0 ? (
        <section aria-label={i18n("components.explorer.onegosheet.1b1e801f448e")}>
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
                    <span className="ex-row-sub">{b.kind === "system" ? i18n("components.explorer.onegosheet.08c9a0baa828") : i18n("components.explorer.onegosheet.55add4b94983")}</span>
                  </span>
                </button>
                </div>
            ))}
          </div>
        </section>
      ) : null}
      {wsHits.length > 0 ? (
        <section aria-label={i18n("components.explorer.onegosheet.fbf2cea571ab")}>
          <div className="ex-group-head">
            <span className="ex-group-name">{i18n("components.explorer.onegosheet.37979829426b")}</span>
            <span className="ex-group-count">{wsHits.length}</span>
          </div>
          <div className="ex-row-list">
            {wsHits.map((w) => (
              <div className="ex-row" key={w.id} data-vault-catch={vaultCatchWorkspace({ id: w.id, name: w.name, count: w.tabs.length })}>
                <div className="ex-row-main">
                  <span className="ex-row-title">{w.name}</span>
                  <span className="ex-row-sub">{i18nRich("components.explorer.onegosheet.ff83dbf31107", { length: w.tabs.length })}</span>
                </div>
                <div className="ex-row-actions">
                  <Btn variant="ghost" onClick={() => { openWorkspace(w.id); onDone(); }}>{i18n("components.explorer.onegosheet.c771248e511f")}</Btn>
                  <Btn variant="ghost" onClick={() => openWorkspaceEditor(w.id)}>{i18n("components.explorer.onegosheet.051836569928")}</Btn>
                  {w.live ? (
                    <Btn variant="ghost" titleAttr={i18n("components.explorer.onegosheet.dc04bd26995b")} onClick={() => dissolveWorkspace(w.id)}>{i18n("components.explorer.onegosheet.5c551062c8a5")}</Btn>
                  ) : null}
                  <Btn variant="ghost" titleAttr={i18n("components.explorer.onegosheet.d4b82994b06a")} onClick={() =>
                      void confirmOk(i18nMsg("components.explorer.onegosheet.68070021bd6a", { name: String(w.name) })).then((ok) => {
                        if (ok) closeLiveWorkspace(w.id);
                      })
                    }>{i18n("components.explorer.onegosheet.7aa6d0ef5feb")}</Btn>
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

function OneGoSheetInner(): ReactNode {
  const uiLocale = useUiLocale();

  const open = useOneGoSheetOpen();
  /* 手机端（A4 同手柄）：seeking 抽屉（0.6vh ⟷ 0.94vh 两档） */
  const phoneUi = useIsPhone();
  const snapState = useSheetSnap("onego");
  const sheetRef = useRef<HTMLElement | null>(null);
  const sheet = useSheetDrag(sheetRef, { id: "onego" });
  const [closing, requestClose] = useExitPhase(closeOneGoSheet, open);
  useOverlayBack("explorer-onego", open, requestClose);
  const expanded = useExpanded();
  const anchor = useAnchorPos("ex-bbar-onego-btn", open, expanded);

  /** 工作区行菜单（与 TabDrawer 同一份语义：打开 / 编辑 / 解散 / 彻底删除；B 的右键口径） */
  const openWsMenuAt = useCallback((x: number, y: number, wsId: string): void => {
    const ws = explorerSnapshot().workspaces.find((w) => w.id === wsId);
    if (!ws) return;
    const count = explorerSnapshot().tabs.filter((t) => t.workspaceId === wsId).length;
    const items: MenuItem[] = [
      { label: i18n("components.explorer.onegosheet.05cc68bdf7ae"), onSelect: () => openWorkspace(wsId) },
      { label: i18n("components.explorer.onegosheet.c6d80849d9f5"), onSelect: () => openWorkspaceEditor(wsId) },
      { label: i18n("components.explorer.onegosheet.40561d059752"), onSelect: () => dissolveWorkspace(wsId), danger: true, sepBefore: true },
      {
        label: i18n("components.explorer.onegosheet.e9a95effb2f5"),
        onSelect: () =>
          void confirmOk(i18nMsg("components.explorer.onegosheet.9e76a0089e2c", { name: String(ws.name), count: String(count) })).then((ok) => {
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
  const seg = useSyncExternalStore(subscribeSheet, () => sheetTab, () => "favs" as SheetTab);
  const setSeg = (tab: SheetTab): void => { sheetTab = tab; emitSheet(); };
  const [query, setQuery] = useState("");
  const requestedSection = useSyncExternalStore(subscribeSheet, () => sectionRequest, () => 0);
  useEffect(() => { if (open) setQuery(""); }, [open, requestedSection]);
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
        {phoneUi ? <PhoneSheetGrip label={i18n("components.explorer.onegosheet.1f5c44171ba4")} gripProps={sheet.gripProps} /> : null}
        <header className="ex-sheet-head">
          <b>OneGO!</b>
          <span className="ex-sec-head-note">{i18n("components.explorer.onegosheet.0a02de34e600")}</span>
          <Btn variant="ghost" onClick={requestClose}>{i18n("components.explorer.onegosheet.c0b3fbff51cc")}</Btn>
        </header>
        <div className="ex-seg-row">
          <div className="segmented ex-seg" role="tablist" aria-label={i18n("components.explorer.onegosheet.51c73468645c")}>
            <button className={seg === "favs" ? "is-active" : ""} role="tab" aria-selected={seg === "favs"} onClick={() => setSeg("favs")}>{i18n("components.explorer.onegosheet.9385bfefca58")}</button>
            <button className={seg === "ws" ? "is-active" : ""} role="tab" aria-selected={seg === "ws"} onClick={() => setSeg("ws")}>{i18n("components.explorer.onegosheet.37979829426b")}</button>
          </div>
        </div>
        <div className="ex-sheet-body">
          <div className="ex-sheet-search">
            <Input placeholder={i18n("components.explorer.onegosheet.588a734ec8a5")} value={query} onChange={(value) => setQuery(value)} />
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
          <Btn variant="ghost" onClick={() => { focusTab(HOME_TAB_ID); requestClose(); }}>{i18n("components.explorer.onegosheet.24fc53052dd6")}</Btn>
        </footer>
      </aside>
    </>,
    document.body,
  );
}

export function OneGoSheet(): ReactNode {
  const uiLocale = useUiLocale();

  return <OneGoSheetInner />;
}
