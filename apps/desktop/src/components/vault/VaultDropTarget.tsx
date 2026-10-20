import { VaultExchangeActions } from "./VaultExchangeActions.js";
/**
 * 常驻「暂存箱」入口 + 半圆雷达。
 *
 * - 桌面和手机：独立记住贴边入口位置；点开预览、向内滑动打开管理、长按拖动换位。
 * - 点一下箱子展开雷达：半圆收纳示意与静止的最近条目，文字不随动画移动；
 *   拖到箱子上松手 = 收进来，拖到底部/顶部的 OH 胶囊 = 发给小OH。
 * - 长按任意带 `data-vault-catch` 的内容自动展开雷达并成为投递目标（vaultDrag.ts 驱动）。
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Btn, IconBtn, IconVault } from "@onethu/gui";
import { IconIn, IconX } from "../Icons.js";
import { useApp } from "../../state/context.js";
import { useOverlayBack } from "../../state/navStack.js";
import { useVaultAnchor, vaultViewport, visibleVaultObstacles, VAULT_OBSTACLES } from "./useVaultAnchor.js";
import { clamp } from "../../state/vaultAnchor.js";
import { activeVault, addToVault, subscribeVault, vaultSnapshot, VAULT_TYPE_LABEL, type VaultItem } from "../../state/vault.js";
import { openVaultItem } from "../../state/vaultRegistry.js";
import { openVaultSheet } from "./VaultSheet.js";
import { stageFromFiles } from "../../lib/fileChannel.js";
import { showToast } from "../../state/toast.js";
import { installVaultDragSources, subscribeVaultDrag, vaultDragSnapshot } from "./vaultDrag.js";

const RECENT_ITEMS = 3;
type AnchorPoint = { left: number; top: number };
type RadarPosition = AnchorPoint & { width: number; maxHeight: number; compact: boolean; tight: boolean };

export function VaultDropTarget(): ReactNode {
  const [fileDrag, setFileDrag] = useState(false);
  useEffect(() => installVaultDragSources(), []);
  useEffect(() => {
    /* 选中文字 → ⌘/Ctrl+Shift+S 收进暂存箱（文字没有可拖 DOM，给一个快捷入口）。 */
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key.toLowerCase() !== "s") return;
      const text = window.getSelection?.()?.toString().trim() ?? "";
      if (!text) return;
      e.preventDefault();
      const r = addToVault({ type: "text", title: text.slice(0, 40), sub: text.length > 40 ? `${text.length} 字` : undefined, text: text.slice(0, 4000), source: "选中文字" });
      showToast(r.ok ? "选中文字已收进暂存箱" : "暂存箱里已经有这段文字了");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent): void => { if (hasFiles(e)) { e.preventDefault(); setFileDrag(true); } };
    const onOver = (e: DragEvent): void => { if (hasFiles(e)) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } };
    const onLeave = (e: DragEvent): void => { if (!e.relatedTarget) setFileDrag(false); };
    const finishFileDrag = (): void => setFileDrag(false);
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      setFileDrag(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      const target = activeVault();
      const targetId = target.id, targetName = target.name;
      void stageFromFiles(files).then((staged) => {
        let ok = 0;
        for (const f of staged) {
          const r = addToVault({ type: "file", title: f.name, sub: `${f.size} B · ${f.mime}`, file: { name: f.name, size: f.size, mime: f.mime, hash: f.sha256, cloudPath: null, stagedPath: f.localPath }, source: "文件拖入" }, targetId);
          if (r.reason === "no-box") throw new Error(`暂存箱「${targetName}」已删除，请重新拖入文件`);
          if (r.ok) ok++;
        }
        showToast(ok ? `已收进「${targetName}」：${ok} 个文件` : "这些文件已在暂存箱里（按内容指纹去重）");
      }).catch((err) => showToast(`文件读取失败：${err instanceof Error ? err.message : String(err)}`));
    };
    document.addEventListener("dragenter", onEnter);
    document.addEventListener("dragover", onOver);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("drop", finishFileDrag, true);
    document.addEventListener("dragend", finishFileDrag);
    window.addEventListener("onethu:vault-file-drop-handled", finishFileDrag);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onEnter);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("drop", finishFileDrag, true);
      document.removeEventListener("dragend", finishFileDrag);
      window.removeEventListener("onethu:vault-file-drop-handled", finishFileDrag);
      document.removeEventListener("drop", onDrop);
    };
  }, []);
  const box = activeVault();
  return createPortal(<>
    <VaultButton />
    {fileDrag ? <div className="vault-file-overlay">
        <div className="vault-file-overlay-box">
          <IconIn width={28} height={28} />
          <span>松手收进「{box.name}」</span>
          <span className="vault-file-overlay-sub">文件会先算内容指纹，同内容自动去重</span>
        </div>
      </div> : null}
    </>, document.body);
}

/** 「发给小OH」提示：跟着 OH 胶囊走，胶囊在下半屏就冒在上方，否则冒在下方。 */
function TransferHint({ target }: { target?: "vault" | "oh" }): ReactNode {
  const [spot, setSpot] = useState<{ left: number; top: number; below: boolean } | null>(null);
  useLayoutEffect(() => {
    const measure = (): void => {
      const el = document.querySelector<HTMLElement>("[data-oh-drop]");
      if (!el) { setSpot(null); return; }
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) { setSpot(null); return; }
      const low = r.top + r.height / 2 > window.innerHeight / 2;
      setSpot({ left: r.left + r.width / 2, top: low ? r.top - 10 : r.bottom + 10, below: !low });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  if (!spot) return null;
  return createPortal(
    <div
      className={"transfer-oh-hint" + (spot.below ? " is-below" : "") + (target === "oh" ? " is-active" : "")}
      style={{ left: spot.left, top: spot.top }}
      role="status"
    >
      {target === "oh" ? "松手发给小OH" : "发给小OH"}
    </div>,
    document.body,
  );
}

function VaultButton(): ReactNode {
  const drag = useSyncExternalStore(subscribeVaultDrag, vaultDragSnapshot, vaultDragSnapshot);
  const doc = useSyncExternalStore(subscribeVault, vaultSnapshot, vaultSnapshot);
  const box = doc.boxes.find((b) => b.id === doc.activeId) ?? doc.boxes[0]!;
  const items = box.items;
  const { navigate } = useApp();
  const [pinned, setPinned] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<RadarPosition>();
  const open = pinned || drag.active;
  const visible = items.slice(0, RECENT_ITEMS);
  const [menu, setMenu] = useState(false);
  const closePreview = (): void => { setPinned(false); anchor.current?.querySelector("button")?.focus(); };
  const openVaultPage = (): void => {
    // Modal focus restoration must remember this persistent handle, not a disappearing preview button.
    anchor.current?.querySelector("button")?.focus(); setPinned(false); setMenu(false); openVaultSheet();
  };
  const edge = useVaultAnchor(anchor, openVaultPage, () => { setPinned(false); setMenu(false); });
  const closeMenu = (): void => { setMenu(false); anchor.current?.querySelector("button")?.focus(); };
  useOverlayBack("vault-preview", pinned, closePreview);
  useOverlayBack("vault-anchor-position", menu, closeMenu);

  useLayoutEffect(() => {
    if (!open && !menu) return;
    let frame = 0;
    const measure = (): void => {
      if (!anchor.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const bounds = vaultViewport(edge.safe.current);
      const tokens = getComputedStyle(document.documentElement);
      const gap = parseFloat(tokens.getPropertyValue("--og-space-2"));
      let topLimit = bounds.top, bottom = bounds.bottom;
      for (const obstacle of visibleVaultObstacles(".explorer-topbar, .ex-bbar, .onego-bookmarks, .oneshot")) {
        // Full-width navigation reserves its vertical band. Local tools are avoided by the handle.
        if (obstacle.right - obstacle.left < (bounds.right - bounds.left) * .5) continue;
        if (obstacle.top <= bounds.top + (bounds.bottom - bounds.top) * .35) topLimit = Math.max(topLimit, obstacle.bottom + gap);
        else if (obstacle.bottom >= bounds.bottom - (bounds.bottom - bounds.top) * .35) bottom = Math.min(bottom, obstacle.top - gap);
      }
      const sideSpace = edge.placement.side === "left" ? bounds.right - rect.right - gap : rect.left - gap - bounds.left;
      const width = Math.min(parseFloat(tokens.getPropertyValue("--og-vault-radar-w")), sideSpace >= 220 ? sideSpace : bounds.right - bounds.left);
      const left = clamp(edge.placement.side === "left" ? rect.right + gap : rect.left - gap - width, bounds.left, bounds.right - width);
      const maxHeight = Math.max(0, bottom - topLimit);
      const panelHeight = Math.min(maxHeight, (menu ? menuRef.current?.offsetHeight : panelRef.current?.offsetHeight) || maxHeight);
      const top = clamp(rect.top + rect.height / 2 - panelHeight * .35, topLimit, bottom - panelHeight);
      const next: RadarPosition = {left, top, width, maxHeight,
        compact: maxHeight < parseFloat(tokens.getPropertyValue("--og-vault-radar-comfort-h")), tight: maxHeight < parseFloat(tokens.getPropertyValue("--og-vault-radar-compact-h"))};
      setPosition(old => old && Object.keys(next).every(key => old[key as keyof RadarPosition] === next[key as keyof RadarPosition]) ? old : next);
    };
    const schedule = (): void => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(anchor.current!);
    if (panelRef.current) resize.observe(panelRef.current);
    if (menuRef.current) resize.observe(menuRef.current);
    for (const el of document.querySelectorAll(VAULT_OBSTACLES)) resize.observe(el);
    measure(); window.addEventListener("resize", schedule); window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule); window.visualViewport?.addEventListener("scroll", schedule);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true); window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule); };
  }, [open, menu, drag.active, edge.placement]);
  useEffect(() => { if (menu) menuRef.current?.querySelector("button")?.focus(); }, [menu]);
  const openItem = (it: VaultItem): void => {
    anchor.current?.querySelector("button")?.focus();
    setPinned(false);
    openVaultItem(it, {
      navigate: (page, params) => navigate(page as never, params as never),
      toast: showToast,
    });
  };

  useEffect(() => {
    if (!pinned && !menu) return;
    /* 雷达里的「分享口令 / 接收」弹窗是 portal 到 body 的，点它、按 Esc 关它都不该把雷达一起收掉——
       否则弹窗会在 pointerdown 那一下随雷达卸载，里面的按钮点了没反应。 */
    const inOverlay = (el: Element | null): boolean => !!el?.closest(".og-scrim, [role='dialog'], .plg-form-modal");
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".og-scrim, [role='dialog']")) return;
      if (menu) setMenu(false); else setPinned(false);
      anchor.current?.querySelector("button")?.focus();
    };
    const onDown = (e: PointerEvent): void => {
      const el = e.target as Element | null;
      if (inOverlay(el)) return;
      if (!el?.closest(".vault-anchor, .vault-radar, .vault-anchor-menu")) { setPinned(false); setMenu(false); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [pinned, menu]);

  const panel = open ? (
    <div
      ref={panelRef}
      className={"vault-radar" + (drag.active ? " is-transfer" : "") + (drag.target === "vault" ? " is-hover" : "") + (position?.compact ? " is-compact" : "") + (position?.tight ? " is-tight" : "")}
      style={position ? {left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight} : undefined}
      data-vault-drop={drag.active ? "" : undefined}
      role="region"
      aria-label={`暂存箱雷达：${box.name}，共 ${items.length} 项`}
    >
      {!drag.active ? <div className="vault-radar-head"><div><b>{box.name}</b><small>最近收纳 · 共 {items.length} 项</small></div><IconBtn label="关闭暂存箱预览" size="sm" icon={<IconX width={16} height={16} />} onClick={closePreview} /></div> : null}
      <div className="vault-radar-body">
      <div className="vault-radar-disc" aria-hidden={!drag.active}>
        <span className="vault-radar-plane" aria-hidden="true">
          <span className="vault-radar-band" />
          <span className="vault-radar-sweep" />
          <span className="vault-radar-ticks" />
        </span>
        <div className="vault-radar-center">
          <IconIn width={22} height={22} />
          <b>{drag.active ? (drag.target === "vault" ? "松手存入暂存箱" : "存入暂存箱") : "先收好，稍后继续"}</b>
          {drag.active ? <small>{drag.title}</small> : null}
        </div>
      </div>
      {!drag.active ? <>
        {visible.length ? <div className="vault-radar-recent">{visible.map(it => <Btn key={it.id} className="vault-radar-item" variant="ghost" titleAttr={it.title} aria-label={`打开暂存项：${it.title}`} onClick={() => openItem(it)}><span className="vault-radar-item-copy"><b>{it.title}</b><small>{VAULT_TYPE_LABEL[it.type] ?? "内容"}</small></span><span className="vault-radar-item-open" aria-hidden="true">打开</span></Btn>)}</div> : <div className="vault-radar-empty"><b>还没有收纳内容</b><span>长按内容，再拖到边缘的暂存箱。</span></div>}
      </> : null}
      {!drag.active ? <div className="vault-radar-exchange">
        <VaultExchangeActions box={box}/>
      </div> : null}
      </div>
      {!drag.active ? <div className="vault-radar-foot"><Btn variant="outline" onClick={openVaultPage}>整理暂存箱</Btn><Btn variant="ghost" size="sm" onClick={() => { setPinned(false); setMenu(true); }} aria-label="调整暂存箱入口位置">入口位置</Btn></div> : null}
    </div>
  ) : null;

  return (
    <>
      <span ref={edge.safe} className="vault-safe-area" aria-hidden="true" />
      <div ref={anchor} className={"vault-floating-anchor vault-anchor is-" + edge.placement.side + (edge.ready ? " is-ready" : "") + (edge.moving ? " is-moving" : "") + (drag.active ? " is-transfer" : "") + (drag.target === "vault" ? " is-hover" : "")} style={{ left: edge.placement.left, top: edge.placement.top }}>
        <Btn
          className="vault-box-button"
          variant="solid"
          data-vault-drop
          aria-expanded={open}
          aria-label={`暂存箱，${items.length} 项`}
          titleAttr="暂存箱 · 点击预览，向内轻滑打开，长按拖动换位"
          onPointerDown={edge.onPointerDown}
          onPointerMove={edge.onPointerMove}
          onPointerUp={edge.onPointerUp}
          onPointerCancel={edge.onPointerCancel}
          onContextMenu={e => { e.preventDefault(); if (Date.now() > edge.touchUntil.current) { setPinned(false); setMenu(true); } }}
          onClick={(e) => {
            if (e.detail !== 0 && Date.now() < edge.suppressClickUntil.current) { e.preventDefault(); return; }
            setMenu(false);
            setPinned((v) => !v);
            if (!pinned && e.detail === 0) requestAnimationFrame(() => panelRef.current?.querySelector("button")?.focus());
          }}
        >
          <IconVault size="md" />
          <span className="vault-box-label">暂存箱</span><span className="vault-box-count">{items.length}</span>
        </Btn>
      </div>
      {menu ? createPortal(<div ref={menuRef} className="vault-anchor-menu" role="menu" aria-label="暂存箱入口位置" style={position ? {left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight} : undefined}><p>长按拖动换位 · 向内轻滑打开</p><Btn role="menuitem" variant="ghost" onClick={() => { edge.reset(); closeMenu(); }}>恢复默认位置</Btn><Btn role="menuitem" variant="ghost" onClick={closeMenu}>关闭</Btn></div>, document.body) : null}
      {panel ? createPortal(panel, document.body) : null}
      
      {drag.active ? <TransferHint target={drag.target} /> : null}
    </>
  );
}
