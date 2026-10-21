import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
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
  const uiLocale = useUiLocale();

  const open = useSyncExternalStore(subscribeVaultSheet, vaultSheetSnapshot, vaultSheetSnapshot);
  const { navigate } = useApp();
  useOverlayBack("vault-manager", open, closeVaultSheet);
  useEffect(() => {
    const handoff = (event: Event): void => {
      const detail = (event as CustomEvent<{ target?: string; fromManager?: boolean }>).detail;
      if (detail?.target === "oh" && detail.fromManager) closeVaultSheet();
    };
    window.addEventListener("onethu:vault-handoff", handoff);
    return () => window.removeEventListener("onethu:vault-handoff", handoff);
  }, []);
  return <><VaultTextPreviewHost /><Modal open={open} onClose={closeVaultSheet} size="lg" className="vault-manager" title={<span className="vault-manager-title"><IconIn /><b>{i18n("components.vault.vaultsheet.804002a9c49a")}</b></span>} foot={<>
    <Btn size="sm" variant="ghost" onClick={() => { closeVaultSheet(); requestAnimationFrame(() => window.dispatchEvent(new Event("onethu:vault-anchor-menu"))); }}>{i18n("components.vault.vaultsheet.81e4bd9720a0")}</Btn>
    <Btn size="sm" variant="ghost" icon={<IconExternal />} onClick={() => { closeVaultSheet(); navigate("vault"); }}>{i18n("components.vault.vaultsheet.52f5d2fe6d3c")}</Btn>
  </>}>
    <VaultWorkspace compact onNavigate={closeVaultSheet} />
  </Modal></>;
}
