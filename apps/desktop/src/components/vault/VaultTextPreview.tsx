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
  const preview = useSyncExternalStore(subscribe, snapshot, snapshot);
  const last = useRef<Preview | null>(null);
  if (preview) last.current = preview;
  const shown = preview ?? last.current;
  const close = (): void => publish(null);
  useOverlayBack("vault-text-preview", !!preview, close);
  return <Modal open={!!preview} onClose={close} title={shown?.title ?? "文字内容"} className="vault-text-preview" size="md" foot={<Btn variant="outline" onClick={() => {
    if (!preview) return;
    void navigator.clipboard.writeText(preview.text).then(() => showToast("文字已复制")).catch(() => showToast("复制失败，可直接选中正文手动复制"));
  }}>复制文字</Btn>}>
    <Text as="div" className="vault-text-body">{shown?.text}</Text>
  </Modal>;
}
