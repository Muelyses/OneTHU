/**
 * dev 视觉自检驱动（仅 dev 构建；正式版被 rollup 剥离）：
 * `?explorer-preview=<场景>` 挂载后程序化摆好 explorer 状态，供无头截图审样式。
 * 场景：home / tabs / drawer / onego / overlay / overlay-oh / search / ctxmenu
 * 与 ?searchland=selfcheck 同一惯例：不进导航、不进产物。
 */
import { useEffect } from "react";
import { focusTab, openSettings, openTab } from "../../state/explorer.js";
import { openTabDrawer } from "./TabDrawer.js";
import { openOneGoSheet } from "./OneGoSheet.js";
import { requestOhPanel } from "../../plugins/ohControl.js";

const SCENARIOS: Record<string, () => void> = {
  home: () => focusTab("home"),
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
  overlay: () => window.setTimeout(() => openSettings("settings"), 250),
  "overlay-oh": () => window.setTimeout(() => openSettings("oh"), 250),
  search: () => window.setTimeout(() => requestOhPanel("search", "音色"), 350),
  "search-oh": () => window.setTimeout(() => {
    requestOhPanel("search", "音色");
    window.setTimeout(() => {
      const tabs = document.querySelectorAll(".dock-panel [role='tab']");
      tabs[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }, 700);
  }, 350),
  ctxmenu: () => {
    SCENARIOS.tabs!();
    window.setTimeout(() => {
      const panel = document.querySelector<HTMLElement>(".explorer-panel:not([style*='none'])");
      panel?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 320, clientY: 300 }));
    }, 500);
  },
};


export function ExplorerPreview(): null {
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("explorer-preview") ?? "home";
    const t = window.setTimeout(() => SCENARIOS[s]?.(), 200);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}

/* lazy() 需要 default 导出（named 导出供场景表内部引用） */
export default ExplorerPreview;
