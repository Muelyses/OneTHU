/**
 * 常驻「暂存箱」入口 + 局部接收扫描。
 *
 * - 点入口直接打开管理，向内滑动同样打开管理；长按入口拖动换位。
 * - 雷达只在长按内容进行传输时出现；拖到箱子附近收进来，拖到 OH 发给小OH。
 * - 长按任意带 `data-vault-catch` 的内容自动展开雷达并成为投递目标（vaultDrag.ts 驱动）。
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Btn, IconVault } from "@onethu/gui";
import { IconIn } from "../Icons.js";
import { useOverlayBack } from "../../state/navStack.js";
import { useVaultAnchor, vaultViewport, visibleVaultObstacles, VAULT_OBSTACLES } from "./useVaultAnchor.js";
import { clamp } from "../../state/vaultAnchor.js";
import { activeVault, addToVault, subscribeVault, vaultSnapshot } from "../../state/vault.js";
import { openVaultSheet } from "./VaultSheet.js";
import { stageFromFiles } from "../../lib/fileChannel.js";
import { showToast } from "../../state/toast.js";
import { installVaultDragSources, subscribeVaultDrag, vaultDragSnapshot } from "./vaultDrag.js";
import { VaultRadarScope } from "./VaultRadarScope.js";

type AnchorPoint = { left: number; top: number };
type MenuPosition = AnchorPoint & { width: number; maxHeight: number };

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
  const anchor = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition>();
  const [menu, setMenu] = useState(false);
  const openVaultPage = (): void => {
    anchor.current?.querySelector("button")?.focus(); setMenu(false); openVaultSheet();
  };
  const edge = useVaultAnchor(anchor, () => setMenu(false));
  const closeMenu = (): void => { setMenu(false); anchor.current?.querySelector("button")?.focus(); };
  useOverlayBack("vault-anchor-position", menu, closeMenu);
  useEffect(() => { if (drag.active) setMenu(false); }, [drag.active]);
  useEffect(() => {
    const showPositionMenu = (): void => setMenu(true);
    window.addEventListener("onethu:vault-anchor-menu", showPositionMenu);
    return () => window.removeEventListener("onethu:vault-anchor-menu", showPositionMenu);
  }, []);

  useLayoutEffect(() => {
    if (!menu) return;
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
      const maxHeight = Math.max(0, bottom - topLimit);
      const sideSpace = edge.placement.side === "left" ? bounds.right - rect.right - gap : rect.left - gap - bounds.left;
      const width = Math.min(parseFloat(tokens.getPropertyValue("--og-vault-menu-w")), sideSpace >= 220 ? sideSpace : bounds.right - bounds.left);
      const left = clamp(edge.placement.side === "left" ? rect.right + gap : rect.left - gap - width, bounds.left, bounds.right - width);
      const panelHeight = Math.min(maxHeight, menuRef.current?.offsetHeight || maxHeight);
      const top = clamp(rect.top + rect.height / 2 - panelHeight * .35, topLimit, bottom - panelHeight);
      const next: MenuPosition = {left, top, width, maxHeight};
      setPosition(old => old && Object.keys(next).every(key => old[key as keyof MenuPosition] === next[key as keyof MenuPosition]) ? old : next);
    };
    const schedule = (): void => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(anchor.current!);
    if (menuRef.current) resize.observe(menuRef.current);
    for (const el of document.querySelectorAll(VAULT_OBSTACLES)) resize.observe(el);
    measure(); window.addEventListener("resize", schedule); window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule); window.visualViewport?.addEventListener("scroll", schedule);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true); window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule); };
  }, [menu, edge.placement]);
  useEffect(() => { if (menu) menuRef.current?.querySelector("button")?.focus(); }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const inOverlay = (el: Element | null): boolean => !!el?.closest(".og-scrim, [role='dialog'], .plg-form-modal");
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".og-scrim, [role='dialog']")) return;
      setMenu(false);
      anchor.current?.querySelector("button")?.focus();
    };
    const onDown = (e: PointerEvent): void => {
      const el = e.target as Element | null;
      if (inOverlay(el)) return;
      if (!el?.closest(".vault-anchor, .vault-anchor-menu")) setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [menu]);

  return (
    <>
      <span ref={edge.safe} className="vault-safe-area" aria-hidden="true" />
      <div ref={anchor} className={"vault-floating-anchor vault-anchor is-" + edge.placement.side + (edge.ready ? " is-ready" : "") + (edge.moving ? " is-moving" : "") + (drag.active ? " is-transfer" : "") + (drag.target === "vault" ? " is-hover" : "")} style={{ left: edge.placement.left, top: edge.placement.top }}>
        <Btn
          className="vault-box-button"
          variant="solid"
          data-vault-drop
          aria-haspopup="dialog"
          aria-description={drag.active ? drag.target === "vault" ? "松手存入暂存箱" : "可接收拖动内容" : undefined}
          aria-label={`暂存箱，${items.length} 项`}
          titleAttr="暂存箱 · 点击打开，拖动换位"
          onPointerDown={edge.onPointerDown}
          onPointerMove={edge.onPointerMove}
          onPointerUp={edge.onPointerUp}
          onPointerCancel={edge.onPointerCancel}
          onContextMenu={e => { e.preventDefault(); if (!edge.pressedRef.current) setMenu(true); }}
          onClick={(e) => {
            if (!edge.consumeClick(e)) openVaultPage();
          }}
        >
          <IconVault size="md" />
          <span className="vault-box-label">暂存箱</span><span className="vault-box-count">{items.length}</span>
        </Btn>
      </div>
      {menu ? createPortal(<div ref={menuRef} className="vault-anchor-menu" role="menu" aria-label="暂存箱入口位置" style={position ? {left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight} : undefined}><p>拖动入口换位 · 点击打开暂存箱</p><Btn role="menuitem" variant="ghost" onClick={() => { edge.reset(); closeMenu(); }}>恢复默认位置</Btn><Btn role="menuitem" variant="ghost" onClick={closeMenu}>关闭</Btn></div>, document.body) : null}
      {drag.active ? <VaultRadarScope
        left={edge.placement.left + (anchor.current?.offsetWidth ?? 64) / 2}
        top={edge.placement.top + (anchor.current?.offsetHeight ?? 48) / 2}
        hover={drag.target === "vault"}
      /> : null}
      
      {drag.active ? <TransferHint target={drag.target} /> : null}
    </>
  );
}
