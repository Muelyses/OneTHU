import { useOverlayBack } from "../../state/navStack.js";
import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { SimpleSettings } from "../SimpleSettings.js";
import { useIsSimpleLike } from "../../state/experienceMode.js";
import { IconBtn, IconUser } from "@onethu/gui";
/**
 * 设置浮层（dev-explorer）：个人设置 / 插件 / OneTHU Harness 三段合一。
 *
 * 用户拍板（2026-10-12）：它们**不是任何标签页，高于任何标签页**——顶栏齿轮
 * 打开，段内切换走 goEntry（= explorer overlay store，旧 Entry 状态机的本体）。
 * 手机=全屏浮层，桌面=右侧推入面板（同 TabManageModal 的 PC 形态语言）。
 */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitPhase } from "../../lib/useExitPhase.js";
import { useExpanded } from "../../state/usePlatformLayout.js";
import { closeSettings, openSettings, useOverlayEntry, type OverlayEntry } from "../../state/explorer.js";
import { markSettingsRows } from "../Layout.js";
import { NameCardSection } from "../NameCardSection.js";
import { SettingsPage } from "../../pages/Settings.js";
import { PluginsPage } from "../../pages/Plugins.js";
import { IconSettings, IconX } from "../Icons.js";
import { HarnessMark } from "../HarnessMark.js";
import { IconPlug } from "../Icons.js";

const SEGMENTS: Array<{ id: OverlayEntry; label: string; icon: ReactNode }> = [
  { id: "profile", get label() { return i18n("components.explorer.settingsoverlay.487e926379fe"); }, icon: <IconUser size="sm" /> },
  { id: "settings", get label() { return i18n("components.explorer.settingsoverlay.c2952a5ffcc3"); }, icon: <IconSettings width={14} height={14} /> },
  { id: "plugins", get label() { return i18n("components.explorer.settingsoverlay.e806fbbe8ec6"); }, icon: <IconPlug width={14} height={14} /> },
  { id: "oh", label: "Harness", icon: <HarnessMark size={12} /> },
];

export function SettingsOverlay(): ReactNode {
  const uiLocale = useUiLocale();

  const simple = useIsSimpleLike();
  const entry = useOverlayEntry(); // null = 关闭
  const expanded = useExpanded();
  /** 退场动画（TabManageModal 同款：先播淡出再卸载） */
  const [closing, requestClose] = useExitPhase(closeSettings, entry !== null);
  useOverlayBack("explorer-settings", entry !== null, requestClose);

  /* 入场：用 Web Animations 只播一次。
     以前入场动画写在 CSS 的 .settings-panel/.settings-mask 上——面板在打开后还会
     因 class/布局变化重新命中样式，动画可能被重启（用户实测“连续播两次、闪一下”）。
     WAAPI 动画绑定在本次挂载的节点上，样式重算不会重启；关闭时取消，让 .is-closing
     的退场动画接管。 */
  const maskRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const enterAnims = useRef<Animation[]>([]);
  const enteredRef = useRef(false);
  useEffect(() => {
    if (entry === null) {
      enterAnims.current = [];
      enteredRef.current = false;
      return;
    }
    /* 段内切换（我的名片 ↔ 个人设置 ↔ 插件 ↔ Harness）不重播入场。 */
    if (enteredRef.current) return;
    enteredRef.current = true;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) return;
    const rootStyle = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string): string => rootStyle.getPropertyValue(name).trim() || fallback;
    const ms = (value: string, fallback: number): number => {
      const n = Number.parseFloat(value);
      return Number.isFinite(n) ? (value.trim().endsWith("ms") ? n : n * 1000) : fallback;
    };
    const panel = panelRef.current;
    const mask = maskRef.current;
    if (panel) {
      enterAnims.current.push(panel.animate(
        [{ opacity: 0, transform: "translate3d(18px, 0, 0)" }, { opacity: 1, transform: "none" }],
        { duration: ms(token("--dur-3", "300ms"), 300), easing: token("--ease-ios", "ease"), fill: "both" },
      ));
    }
    if (mask) {
      enterAnims.current.push(mask.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: ms(token("--dur-2", "200ms"), 200), easing: token("--ease-out", "ease"), fill: "both" },
      ));
    }
  }, [entry]);
  useEffect(() => {
    if (!closing) return;
    for (const anim of enterAnims.current) anim.cancel();
    enterAnims.current = [];
  }, [closing]);

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
    <div className={mask} ref={maskRef} onClick={requestClose}>
      <div className={panel} ref={panelRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={i18n("components.explorer.settingsoverlay.7f1d9dd04cd1")}>
        <div className="settings-head">
          <span className="workbench-settings-brand">OneTHU</span>
          {!simple && <div className="settings-seg" role="tablist" aria-label={i18n("components.explorer.settingsoverlay.b31841ccaf3d")}>
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
          </div>}
          <IconBtn label={i18n("components.explorer.settingsoverlay.77b17fc4a52a")} size="sm" variant="outline" titleAttr={i18n("components.explorer.settingsoverlay.51f560817509")} icon={<IconX width={14} height={14} />} onClick={requestClose} />
        </div>
        <div className={"explorer-settings-body" + (entry === "profile" || entry === "plugins" ? " workbench-plugin-settings" : "")}>
          {simple ? <SimpleSettings/> : entry === "profile" ? <NameCardSection view="personal" /> : entry === "settings" ? <SettingsPage /> : <PluginsPage />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
