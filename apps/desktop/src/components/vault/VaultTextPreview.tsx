import { msg as i18nMsg, t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { useRef, useSyncExternalStore, type ReactNode } from "react";
import { Btn, Modal, Text } from "@onethu/gui";
import { useOverlayBack } from "../../state/navStack.js";
import { showToast } from "../../state/toast.js";

type Preview = { title: string; text: string };
let current: Preview | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => listeners.delete(listener); };
const snapshot = (): Preview | null => current;
const publish = (value: Preview | null): void => { current = value; listeners.forEach(listener => listener()); };
export function openVaultTextPreview(title: string, text: string): void { publish({ title, text }); }

/** Both the quick preview and the workspace open the same selectable full text. */
export function VaultTextPreviewHost(): ReactNode {
  const uiLocale = useUiLocale();

  const preview = useSyncExternalStore(subscribe, snapshot, snapshot);
  const last = useRef<Preview | null>(null);
  if (preview) last.current = preview;
  const shown = preview ?? last.current;
  const close = (): void => publish(null);
  useOverlayBack("vault-text-preview", !!preview, close);
  return <Modal open={!!preview} onClose={close} title={shown?.title ?? i18n("components.vault.textPreviewFallback")} className="vault-text-preview" size="md" foot={<Btn variant="outline" onClick={() => {
    if (!preview) return;
    void navigator.clipboard.writeText(preview.text).then(() => showToast(i18nMsg("components.vault.vaulttextpreview.cd78767c92e6"))).catch(() => showToast(i18nMsg("components.vault.vaulttextpreview.654ba67673c8")));
  }}>{i18n("components.vault.vaulttextpreview.29636e43fdb4")}</Btn>}>
    <Text as="div" className="vault-text-body">{shown?.text}</Text>
  </Modal>;
}
