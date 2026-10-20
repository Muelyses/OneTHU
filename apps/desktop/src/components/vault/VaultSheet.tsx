import { useSyncExternalStore, type ReactNode } from "react";
import { Btn, Modal } from "@onethu/gui";
import { IconExternal, IconIn } from "../Icons.js";
import { useApp } from "../../state/context.js";
import { useOverlayBack } from "../../state/navStack.js";
import { VaultWorkspace } from "./VaultWorkspace.js";
import { VaultTextPreviewHost } from "./VaultTextPreview.js";

let sheetOpen = false;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach(listener => listener());
export function openVaultSheet(): void { if (!sheetOpen) { sheetOpen = true; emit(); } }
export function closeVaultSheet(): void { if (sheetOpen) { sheetOpen = false; emit(); } }
export function subscribeVaultSheet(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function vaultSheetSnapshot(): boolean { return sheetOpen; }

/** Shared modal owns focus and exit; the edge handle never creates a second editor. */
export function VaultSheetHost(): ReactNode {
  const open = useSyncExternalStore(subscribeVaultSheet, vaultSheetSnapshot, vaultSheetSnapshot);
  const { navigate } = useApp();
  useOverlayBack("vault-manager", open, closeVaultSheet);
  return <><VaultTextPreviewHost /><Modal open={open} onClose={closeVaultSheet} size="lg" className="vault-manager" title={<span className="vault-manager-title"><IconIn /><b>暂存箱</b></span>} foot={<>
    <Btn size="sm" variant="ghost" onClick={() => { closeVaultSheet(); requestAnimationFrame(() => window.dispatchEvent(new Event("onethu:vault-anchor-menu"))); }}>入口位置</Btn>
    <Btn size="sm" variant="ghost" icon={<IconExternal />} onClick={() => { closeVaultSheet(); navigate("vault"); }}>在标签页打开</Btn>
  </>}>
    <VaultWorkspace compact onNavigate={closeVaultSheet} />
  </Modal></>;
}
