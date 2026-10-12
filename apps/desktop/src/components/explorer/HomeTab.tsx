/**
 * 首页标签页（dev-explorer 工作空间革命）：特殊标签页的渲染内容。
 *
 * 组织模式 = 今日页（TodayPage）原样移植 + 顶部两层新能力：
 *   「继续上次」工作恢复条（OneGO 工作区 chips + 最近 3 个页标签）；
 *   ③ 「功能目录」卡（侧边栏删除后的完整功能兜底入口，NAV_CATEGORIES 分组）；
 *   ④ <TodayPage /> 原样渲染（自定义卡片系统、信息流、快捷入口全在它身上）。
 *
 * 视觉对齐 Today 的 .home-card 体系（.card / h2 标题 / 行尾文字钮 / 灰字 note），
 * 只在 explorer-home.css 里补少量布局样式，不造新视觉语言。
 */
import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  allTabs,
  explorerSnapshot,
  focusTab,
  openTab,
  openWorkspace,
  subscribeExplorer,
} from "../../state/explorer.js";
import { TodayPage } from "../../pages/Today.js";
import { HomeSpheres } from "./HomeSpheres.js";

/** store 快照类型（explorer.ts 未导出内部接口，用 ReturnType 推导） */
type ExplorerStateSnapshot = ReturnType<typeof explorerSnapshot>;

/** store 订阅（恢复条用）：explorerSnapshot 引用随 setState 换新，useSyncExternalStore 直读即可 */
function useExplorerState(): ExplorerStateSnapshot {
  return useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
}



/* ══════════ ② 继续上次（工作区 + 最近页标签） ══════════ */

function HomeResume(): ReactNode {
  const state = useExplorerState();
  const recentTabs = allTabs()
    .filter((t) => t.kind === "page")
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, 3);
  const hasContent = state.workspaces.length > 0 || recentTabs.length > 0;
  if (!hasContent) return null;
  return (
    <div className="home-resume" role="region" aria-label="继续上次">
      <span className="home-resume-label">继续上次</span>
      <div className="home-resume-chips">
        {state.workspaces.slice(0, 4).map((w) => (
          <button
            key={w.id}
            type="button"
            className="home-resume-chip is-workspace"
            title={"恢复工作区「" + w.name + "」（" + w.tabs.length + " 个标签页）"}
            onClick={() => openWorkspace(w.id)}
          >
            {w.name}
            <span className="home-resume-chip-count">{w.tabs.length}</span>
          </button>
        ))}
        {recentTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className="home-resume-chip"
            title={"回到「" + t.title + "」标签页"}
            onClick={() => focusTab(t.id)}
          >
            {t.title}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ══════════ 首页标签页整体 ══════════ */

export function HomeTab(): ReactNode {
  return (
    <div className="home-tab">
      {/* 球型功能目录：右上角锚点 + 外置球层（详细目录收进球窗的「··· 详情」） */}
      <HomeSpheres />
      <HomeResume />
      <TodayPage />
    </div>
  );
}
