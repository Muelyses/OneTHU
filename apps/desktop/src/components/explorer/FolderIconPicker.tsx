import { Btn } from "@onethu/gui";
/**
 * 收藏夹（OnePage）图标选择弹窗。入口：OneGO 收藏夹行右键「改图标…」。
 * 默认图标是拳头 logo（fist）；选中即写入收藏夹的 icon 字段。
 */
import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FOLDER_ICONS } from "../Icons.js";
import { useFavs } from "../../state/favs.js";

let pickingId: string | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((f) => f());
const subscribe = (f: () => void): (() => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
const snapshot = (): string | null => pickingId;

export function openFolderIconPicker(id: string): void {
  pickingId = id;
  emit();
}

export function closeFolderIconPicker(): void {
  if (pickingId === null) return;
  pickingId = null;
  emit();
}

export function FolderIconPickerHost(): ReactNode {
  const id = useSyncExternalStore(subscribe, snapshot, snapshot);
  const favs = useFavs();
  const folder = id ? favs.data.folders[id] : undefined;
  if (!id || !folder) return null;
  const current = folder.icon ?? "fist";
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.25)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeFolderIconPicker();
      }}
    >
      <div
        role="dialog"
        aria-label="选择图标"
        style={{ background: "var(--dsw-alias-bg-base, #fff)", color: "var(--dsw-alias-label-primary, inherit)", borderRadius: 14, padding: 18, width: 320, boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>「{folder.title}」的图标</div>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 12 }}>OnePage 默认是拳头 logo，可改成下面任一个</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
          {Object.keys(FOLDER_ICONS).map((k) => {
            const G = FOLDER_ICONS[k];
            if (!G) return null;
            return (
              <button
                key={k}
                type="button"
                aria-label={"图标 " + k}
                aria-pressed={current === k}
                onClick={() => {
                  favs.setIcon(id, k);
                  closeFolderIconPicker();
                }}
                style={{ height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 10, border: current === k ? "2px solid var(--dsw-alias-label-primary, #000)" : "1px solid transparent", background: "transparent", cursor: "pointer" }}
              >
                <G width={18} height={18} />
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <Btn variant="outline" onClick={closeFolderIconPicker}>关闭</Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}
