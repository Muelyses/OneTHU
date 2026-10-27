/**
 * dev 视觉自检驱动（仅 dev 构建；正式版被 rollup 剥离）：
 * `?explorer-preview=<场景>` 挂载后程序化摆好 explorer 状态，供无头截图审样式。
 * 场景：home / otherinfo / page(+?page=&params=) / tabs / drawer / onego / overlay(+?settings-tab=页签) / overlay-oh / search / ctxmenu
 * 与 ?searchland=selfcheck 同一惯例：不进导航、不进产物。
 */
import { useEffect, useState } from "react";
import { focusTab, openSettings, openTab } from "../../state/explorer.js";
import { requestSettingsTab } from "../../state/settingsMode.js";
import { openTabDrawer } from "./TabDrawer.js";
import { openOneGoSheet } from "./OneGoSheet.js";
import { requestOhPanel } from "../../plugins/ohControl.js";
import { useDockUi } from "../../plugins/ChatDock.js";

const SCENARIOS: Record<string, () => void> = {
  home: () => focusTab("home"),
  otherinfo: () => {
    focusTab("home");
    window.setTimeout(() => openTab("otherinfo"), 250);
  },
  tabs: () => {
    openTab("learn-assignments");
    openTab("cloud", undefined, { activate: false });
    openTab("schedule", undefined, { activate: false });
    openTab("info", { infoTab: "news" }, { activate: false });
  },
  drawer: () => {
    SCENARIOS.tabs!();
    window.setTimeout(openTabDrawer, 250);
  },
  onego: () => window.setTimeout(openOneGoSheet, 250),
  /** 指定页签的设置浮层：overlay + ?settings-tab=<页签名> */
  overlay: () => window.setTimeout(() => openSettings("settings"), 250),
  "settings-tab": () => window.setTimeout(() => {
    openSettings("settings");
    const tab = new URLSearchParams(window.location.search).get("settings-tab") ?? "外观";
    requestSettingsTab(tab);
  }, 250),
  "overlay-oh": () => window.setTimeout(() => openSettings("oh"), 250),
  "overlay-plugins": () => window.setTimeout(() => openSettings("plugins"), 250),
  "home-scrolled": () => {
    SCENARIOS.tabs!();
    window.setTimeout(() => window.scrollTo(0, 420), 700);
  },
  search: () => window.setTimeout(() => requestOhPanel("search", "音色"), 350),
  "search-oh": () => window.setTimeout(() => {
    requestOhPanel("search", "音色");
    window.setTimeout(() => {
      const tabs = document.querySelectorAll(".dock-panel [role='tab']");
      tabs[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }, 700);
  }, 350),
  /** 任意内容页：`?explorer-preview=page&page=<pageId>&params=<json>`（竖屏巡检各页用） */
  page: () => {
    const q = new URLSearchParams(window.location.search);
    const page = q.get("page") ?? "home";
    let params: Record<string, unknown> | undefined;
    try {
      params = q.get("params") ? (JSON.parse(q.get("params")!) as Record<string, unknown>) : undefined;
    } catch {
      params = undefined;
    }
    window.setTimeout(() => openTab(page as never, params as never), 250);
  },
  ctxmenu: () => {
    SCENARIOS.tabs!();
    window.setTimeout(() => {
      const panel = document.querySelector<HTMLElement>(".explorer-panel:not([style*='none'])");
      panel?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 320, clientY: 300 }));
    }, 500);
  },
};


export function ExplorerPreview(): null {
  /* 面板开合整流（事件驱动）：useDockUi 观察到 open=true 就发同模式命令（无预填=收起），
     归零后才跑场景；彻底关不掉 900ms 兜底放行。不依赖对 localStorage 的外部操作。 */
  const ui = useDockUi();
  const [settled, setSettled] = useState(!ui.open);
  useEffect(() => {
    if (ui.open && !settled) {
      requestOhPanel(ui.mode || "oh"); // 同模式无预填 = ChatDock 收窗
      const t = window.setTimeout(() => setSettled(true), 900);
      return () => window.clearTimeout(t);
    }
    if (!ui.open && !settled) setSettled(true);
    return undefined;
  }, [ui.open, ui.mode, settled]);
  useEffect(() => {
    if (!settled) return;
    const s = new URLSearchParams(window.location.search).get("explorer-preview") ?? "home";
    const t = window.setTimeout(() => SCENARIOS[s]?.(), 200);
    return () => window.clearTimeout(t);
  }, [settled]);
  return null;
}

export default ExplorerPreview;
