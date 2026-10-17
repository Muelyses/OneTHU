/**
 * 常驻「暂存箱」拖放目标：只在拖动开始时出现，避免遮挡底栏/OH 胶囊。
 * 桌面：右下悬浮；手机：底部居中（贴底抽屉之上）。
 */
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconIn } from "../Icons.js";
import { activeVault, vaultSnapshot, subscribeVault } from "../../state/vault.js";
import {
  installVaultDragSources, subscribeVaultDrag, vaultDragSnapshot,
} from "./vaultDrag.js";

export function VaultDropTarget(): ReactNode {
  const drag = useSyncExternalStore(subscribeVaultDrag, vaultDragSnapshot, vaultDragSnapshot);
  useSyncExternalStore(subscribeVault, vaultSnapshot, vaultSnapshot);
  useEffect(() => installVaultDragSources(), []);
  if (!drag.active) return null;
  const box = activeVault();
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
