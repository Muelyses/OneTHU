/**
 * 底栏三入口（dev-explorer）：标签页 | OH 胶囊 | OneGO。
 * 所有平台恒显示（革命口径：手机与桌面同一套交互架构，桌面顶栏另有 TabStrip）。
 * - 标签页：打开 TabDrawer（角标 = 打开的工作标签数，首页不计）；
 * - 中央 OhCapsule：搜索 + OH 二合一（explorer-oh 实现，这里只放插槽）；
 * - OneGO：打开 OneGoSheet。
 */
import { IconTabsCards } from "../../components/Icons.js";
import type { ReactNode } from "react";
import { IconFist } from "../Icons.js";
import { OhCapsule } from "./OhCapsule.js";
import { openOneGoSheet, useOneGoSheetOpen } from "./OneGoSheet.js";
import { openTabDrawer, useTabDrawerOpen } from "./TabDrawer.js";
import { useExplorerTabs } from "./TabStrip.js";

export function BottomBar(): ReactNode {
  const { tabs } = useExplorerTabs();
  const count = tabs.filter((t) => t.kind === "page").length;
  const drawerOpen = useTabDrawerOpen();
  const onegoOpen = useOneGoSheetOpen();
  return (
    <nav className="ex-bbar" aria-label="工作空间导航">
      <button id="ex-bbar-tabs-btn" className={"ex-bbar-btn" + (drawerOpen ? " is-open" : "")} onClick={openTabDrawer} aria-expanded={drawerOpen} aria-label={`标签页（${count} 个）`}>
        <span className="ex-bbar-icon">
          <IconTabsCards width={20} height={20} />
          {count > 0 ? <i className="ex-bbar-badge" aria-hidden="true">{count > 99 ? "99+" : count}</i> : null}
        </span>
        <span className="ex-bbar-label">标签页</span>
      </button>
      <div className="ex-bbar-center">
        <OhCapsule />
      </div>
      <button id="ex-bbar-onego-btn" className={"ex-bbar-btn" + (onegoOpen ? " is-open" : "")} onClick={openOneGoSheet} aria-expanded={onegoOpen} aria-label="OneGO!">
        <span className="ex-bbar-icon">
          <IconFist width={20} height={20} />
        </span>
        <span className="ex-bbar-label">OneGO!</span>
      </button>
    </nav>
  );
}
