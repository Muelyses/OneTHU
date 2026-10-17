/**
 * 常驻「暂存箱」拖放目标：只在拖动开始时出现，避免遮挡底栏/OH 胶囊。
 * 桌面：右下悬浮；手机：底部居中（贴底抽屉之上）。
 */
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Btn } from "@onethu/gui";
import { IconIn } from "../Icons.js";
import { useApp } from "../../state/context.js";
import { useIsPhone } from "../../state/phoneSheets.js";
import { activeVault, vaultSnapshot, subscribeVault } from "../../state/vault.js";
import {
  installVaultDragSources, subscribeVaultDrag, vaultDragSnapshot,
} from "./vaultDrag.js";

export function VaultDropTarget(): ReactNode {
  const drag = useSyncExternalStore(subscribeVaultDrag, vaultDragSnapshot, vaultDragSnapshot);
  const vault = useSyncExternalStore(subscribeVault, vaultSnapshot, vaultSnapshot);
  const isPhone = useIsPhone();
  const { navigate } = useApp();
  useEffect(() => installVaultDragSources(), []);
  const box = activeVault();
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
