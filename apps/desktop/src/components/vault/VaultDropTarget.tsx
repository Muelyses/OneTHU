/**
 * 常驻「暂存箱」拖放目标：只在拖动开始时出现，避免遮挡底栏/OH 胶囊。
 * 桌面：右下悬浮；手机：底部居中（贴底抽屉之上）。
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Btn } from "@onethu/gui";
import { IconIn } from "../Icons.js";
import { useApp } from "../../state/context.js";
import { useIsPhone } from "../../state/phoneSheets.js";
import { activeVault, addToVault, vaultSnapshot, subscribeVault } from "../../state/vault.js";
import { stageFromFiles } from "../../lib/fileChannel.js";
import { showToast } from "../../state/toast.js";
import {
  installVaultDragSources, subscribeVaultDrag, vaultDragSnapshot,
} from "./vaultDrag.js";

export function VaultDropTarget(): ReactNode {
  const drag = useSyncExternalStore(subscribeVaultDrag, vaultDragSnapshot, vaultDragSnapshot);
  const vault = useSyncExternalStore(subscribeVault, vaultSnapshot, vaultSnapshot);
  const isPhone = useIsPhone();
  const { navigate } = useApp();
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
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setFileDrag(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      void stageFromFiles(files).then((staged) => {
        let ok = 0;
        for (const f of staged) {
          const r = addToVault({ type: "file", title: f.name, sub: `${f.size} B · ${f.mime}`, file: { name: f.name, size: f.size, mime: f.mime, hash: f.sha256, cloudPath: null, stagedPath: f.localPath }, source: "文件拖入" });
          if (r.ok) ok++;
        }
        showToast(ok ? `已收进暂存箱：${ok} 个文件` : "这些文件已在暂存箱里（按内容指纹去重）");
      }).catch((err) => showToast(`文件读取失败：${err instanceof Error ? err.message : String(err)}`));
    };
    document.addEventListener("dragenter", onEnter);
    document.addEventListener("dragover", onOver);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onEnter);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, []);
  const box = activeVault();
  if (fileDrag) {
    return createPortal(
      <div className="vault-file-overlay">
        <div className="vault-file-overlay-box">
          <IconIn width={28} height={28} />
          <span>松手收进「{box.name}」</span>
          <span className="vault-file-overlay-sub">文件会先算内容指纹，同内容自动去重</span>
        </div>
      </div>,
      document.body,
    );
  }
  if (!drag.active) {
    /* 手机常驻入口：不挤底栏三槽，浮在底栏上方；桌面不显示（有 OneGO/侧栏入口）。 */
    if (!isPhone) return null;
    const count = box.items.length;
    return createPortal(
      <div className="vault-dock" aria-label={`暂存箱${count ? `，${count} 项` : ""}`}>
        <Btn variant="ghost" size="sm" onClick={() => navigate("vault")} titleAttr="暂存箱：先把东西收进来">
          <IconIn width={18} height={18} />
          <span className="vault-dock-label">暂存箱</span>
          {count > 0 ? <span className="vault-dock-count">{count > 99 ? "99+" : count}</span> : null}
        </Btn>
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div
      className={"vault-drop" + (drag.hover ? " is-hover" : "")}
      data-vault-drop
      role="status"
      aria-label="松手放入暂存箱"
    >
      <span className="vault-drop-icon" aria-hidden="true"><IconIn width={18} height={18} /></span>
      <span className="vault-drop-main">
        <span className="vault-drop-title">放进「{box.name}」</span>
        <span className="vault-drop-sub">{drag.hover ? "松手收纳" : "拖到这里"}</span>
      </span>
    </div>,
    document.body,
  );
}
