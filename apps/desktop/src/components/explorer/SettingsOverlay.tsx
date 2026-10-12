/**
 * 设置浮层（dev-explorer）：个人设置 / 插件 / OneTHU Harness 三段合一。
 *
 * 用户拍板（2026-10-12）：它们**不是任何标签页，高于任何标签页**——顶栏齿轮
 * 打开，段内切换走 goEntry（= explorer overlay store，旧 Entry 状态机的本体）。
 * 手机=全屏浮层，桌面=右侧推入面板（同 TabManageModal 的 PC 形态语言）。
 */
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitPhase } from "../../lib/useExitPhase.js";
import { useExpanded } from "../../state/usePlatformLayout.js";
import { closeSettings, openSettings, useOverlayEntry, type OverlayEntry } from "../../state/explorer.js";
import { markSettingsRows } from "../Layout.js";
import { SettingsPage } from "../../pages/Settings.js";
import { PluginsPage } from "../../pages/Plugins.js";
import { IconSettings, IconX } from "../Icons.js";
import { HarnessMark } from "../HarnessMark.js";
import { IconPlug } from "../Icons.js";

const SEGMENTS: Array<{ id: OverlayEntry; label: string; icon: ReactNode }> = [
  { id: "settings", label: "个人设置", icon: <IconSettings width={14} height={14} /> },
  { id: "plugins", label: "插件", icon: <IconPlug width={14} height={14} /> },
  { id: "oh", label: "OneTHU Harness", icon: <HarnessMark size={12} /> },
];

export function SettingsOverlay(): ReactNode {
  const entry = useOverlayEntry(); // null = 关闭
  const expanded = useExpanded();
  /** 退场动画（TabManageModal 同款：先播淡出再卸载） */
  const [closing, requestClose] = useExitPhase(closeSettings, entry !== null);

  /* Esc 关闭 */
  useEffect(() => {
    if (entry === null) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [entry, requestClose]);

  /* 入口态变化（开关/换段）都会换内容挂载 → 重打设置行 id（幂等），供检索直达精确落点 */
  useEffect(() => {
    if (entry === null) return;
    const t = window.setTimeout(markSettingsRows, 60);
    return () => window.clearTimeout(t);
  }, [entry]);

  if (entry === null) return null;

  const mask = "settings-mask" + (closing ? " is-closing" : "");
  const panel = "settings-panel" + (expanded ? " is-desktop" : "") + (closing ? " is-closing" : "");

  return createPortal(
    <div className={mask} onClick={requestClose}>
      <div className={panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="设置">
        <div className="settings-head">
          <div className="settings-seg" role="tablist" aria-label="设置分段">
            {SEGMENTS.map((s) => (
              <button
                key={s.id}
                className={"settings-seg-item" + (entry === s.id ? " is-active" : "")}
                onClick={() => openSettings(s.id)}
                title={s.label}
                aria-current={entry === s.id ? "true" : undefined}
              >
                {s.icon}
                <span>{s.label}</span>
              </button>
            ))}
          </div>
          <button className="tb-icon settings-close" onClick={requestClose} aria-label="关闭设置" title="关闭">
            <IconX width={16} height={16} />
          </button>
        </div>
        <div className="explorer-settings-body">
          {entry === "settings" ? <SettingsPage /> : <PluginsPage />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
