/**
 * OneGO 抽屉（dev-explorer）：从收藏夹升级来的「工作组织工具」。
 * 两个分段：我的收藏（OnePage）| 工作区。
 * - OnePage 现阶段按普通收藏夹格式组织（含子收藏夹——在一个 OnePage 里放
 *   另一个 OnePage 的入口）；点击 = 在新标签页打开该收藏夹页（FolderPage）。
 * - 工作区段与 TabDrawer 共用 WorkspacePanel（一份逻辑，两处引用）。
 * 开合是模块级 store（palette.ts 同款写法）。
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { focusTab, HOME_TAB_ID, openTab } from "../../state/explorer.js";
import { useExitPhase } from "../../lib/useExitPhase.js";
import { useFavs } from "../../state/favs.js";
import { FolderIcon } from "../Icons.js";
import { WorkspacePanel } from "./TabDrawer.js";

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
  const favs = useFavs();
  const [name, setName] = useState("");
  const roots = favs.data.order;

  const create = (): void => {
    const t = name.trim();
    if (!t) return;
    const id = favs.create(t, null);
    if (id) {
      setName("");
      openTab("folder", { folderId: id }, { title: t });
      onDone();
    }
  };

  return (
    <section aria-label="我的收藏 OnePage">
      <div className="ex-sec-head">
        <b>我的收藏（OnePage）</b>
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
        <button className="btn ex-btn-sm" onClick={create} disabled={!name.trim()}>新建</button>
      </div>
      {roots.length === 0 ? (
        <div className="ex-empty-hint">还没有 OnePage。新建一个，把常用功能组织进去（在收藏夹页点星标或添加原子）。</div>
      ) : (
        <div className="ex-row-list">
          {roots.map((id) => {
            const f = favs.data.folders[id];
            const title = f?.title ?? "OnePage";
            return (
              <button
                key={id}
                className="ex-row ex-row-clickable"
                onClick={() => {
                  openTab("folder", { folderId: id }, { title });
                  onDone();
                }}
              >
                <span className="ex-row-icon"><FolderIcon name={f?.icon} /></span>
                <span className="ex-row-main">
                  <span className="ex-row-title">{title}</span>
                  <span className="ex-row-sub">{(f?.items?.length ?? 0)} 项</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="ex-hint-line">OnePage 即收藏夹页面；在一个 OnePage 里可以放另一个 OnePage 的入口（子收藏夹）。</div>
    </section>
  );
}

/* ══════════ 抽屉本体 ══════════ */

type SheetTab = "favs" | "ws";

function OneGoSheetInner(): ReactNode {
  const open = useOneGoSheetOpen();
  const [closing, requestClose] = useExitPhase(closeOneGoSheet, open);
  const [seg, setSeg] = useState<SheetTab>("favs");

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
      <aside className={"ex-sheet ex-onego" + (closing ? " is-closing" : "")} role="dialog" aria-label="OneGO!">
        <header className="ex-sheet-head">
          <b>OneGO!</b>
          <span className="ex-sec-head-note">组织你的工作</span>
          <button className="btn btn-ghost ex-btn-sm" onClick={requestClose}>完成</button>
        </header>
        <div className="ex-seg-row">
          <div className="segmented ex-seg" role="tablist" aria-label="OneGO! 分段">
            <button className={seg === "favs" ? "is-active" : ""} role="tab" aria-selected={seg === "favs"} onClick={() => setSeg("favs")}>我的收藏</button>
            <button className={seg === "ws" ? "is-active" : ""} role="tab" aria-selected={seg === "ws"} onClick={() => setSeg("ws")}>工作区</button>
          </div>
        </div>
        <div className="ex-sheet-body">
          {seg === "favs" ? <FavsSection onDone={closeOneGoSheet} /> : <WorkspacePanel />}
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
