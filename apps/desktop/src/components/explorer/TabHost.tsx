/**
 * Explorer 标签页宿主（dev-explorer 革命核心）：所有标签页常驻挂载、display 切换。
 *
 * - 首页（home）恒在、恒挂载，正文 = HomeTab（搜索/恢复条/功能目录 + 今日页组织原样移植）；
 * - 页标签页首次聚焦时才挂载（懒挂载，避免启动恢复 N 个标签页时的抓取风暴），
 *   挂过之后终身保留（display:none），工作上下文不丢；
 * - 页内导航：容器内 key=page 的 .page-anim 层重挂 → 保留原转场方向语义；
 * - 切标签页：外层 display 切换，CSS 进场动画不会重播（元素没重挂）。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { HOME_TAB_ID, allTabs, useExplorerState } from "../../state/explorer.js";
import type { ExplorerTab } from "../../state/explorer.js";
import { isSubPage, renderPage } from "./renderPage.js";
import { HomeTab } from "./HomeTab.js";

/** 本会话内已挂载过的标签页 id 集（懒挂载标记；不持久化——恢复的标签页首次聚焦再挂） */
function useMountedTabs(activeId: string, tabs: ExplorerTab[]): Set<string> {
  const [mounted, setMounted] = useState<Set<string>>(() => new Set([HOME_TAB_ID, activeId]));
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  useEffect(() => {
    setMounted((prev) => {
      if (prev.has(activeId)) return prev;
      const next = new Set(prev);
      next.add(activeId);
      return next;
    });
  }, [activeId]);
  /* 已关闭的标签页从集合里清掉（防长时间使用集合无界增长；同 id 不会复用） */
  useEffect(() => {
    setMounted((prev) => {
      const live = new Set([HOME_TAB_ID, ...tabs.map((t) => t.id)]);
      let changed = false;
      const next = new Set([...prev].filter((id) => {
        if (live.has(id)) return true;
        changed = true;
        return false;
      }));
      return changed ? next : prev;
    });
  }, [tabs]);
  return mounted;
}

export function TabHost(): ReactNode {
  const st = useExplorerState();
  const activeId = st.activeId;
  const tabs = allTabs(); // 含 home（state.tabs 不含 home，home 恒在必须显式拼上）
  const mounted = useMountedTabs(activeId, tabs);
  return (
    <>
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <div key={t.id} className="explorer-panel" data-tab-id={t.id} data-tab-page={t.page} style={active ? undefined : { display: "none" }}>
            {/* 页内导航时重挂这一层（保留 .page-anim 转场）；切标签页不动这一层 */}
            <div className="page-anim" key={t.page} data-page={t.page} data-level={isSubPage(t.page) ? "sub" : undefined}>
              {t.kind === "home" ? (
                <HomeTab />
              ) : mounted.has(t.id) ? (
                renderPage(t.page)
              ) : (
                /* 未挂载过的休眠标签页：只在被聚焦前的一瞬可见性为假——理论渲染不到，
                   兜底一个空壳避免布局跳动 */
                <div className="page-body" aria-hidden="true" />
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
