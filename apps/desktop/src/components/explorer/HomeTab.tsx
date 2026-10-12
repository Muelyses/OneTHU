/**
 * 首页标签页（dev-explorer 工作空间革命）：特殊标签页的渲染内容。
 *
 * 组织模式 = 今日页（TodayPage）原样移植 + 顶部两层新能力：
 *   ① 全局搜索条（假输入框 → OH 二合一搜索小窗，requestOhPanel("search")）；
 *   ② 「继续上次」工作恢复条（OneGO 工作区 chips + 最近 3 个页标签）；
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
import { byCategory, NAV_CATEGORIES, type NavEntry } from "../../state/navigation.js";
import { requestOhPanel } from "../../plugins/ohControl.js";
import { TodayPage } from "../../pages/Today.js";
import { IconChevron, IconSearch } from "../Icons.js";

/** store 快照类型（explorer.ts 未导出内部接口，用 ReturnType 推导） */
type ExplorerStateSnapshot = ReturnType<typeof explorerSnapshot>;

/** store 订阅（恢复条用）：explorerSnapshot 引用随 setState 换新，useSyncExternalStore 直读即可 */
function useExplorerState(): ExplorerStateSnapshot {
  return useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
}

/* ══════════ ① 搜索条 ══════════ */

function HomeSearchBar(): ReactNode {
  return (
    <button
      type="button"
      className="home-searchbar"
      onClick={() => requestOhPanel("search")}
      aria-label="搜索校园服务、文件、新闻"
      title="搜索（胶囊条同款：搜不到可直接问 OH）"
    >
      <IconSearch width={16} height={16} />
      <span className="home-searchbar-placeholder">搜索校园服务、文件、新闻…</span>
      <kbd className="home-searchbar-kbd">搜索 / OH</kbd>
    </button>
  );
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

/* ══════════ ③ 功能目录卡（完整功能兜底入口） ══════════ */

function CatalogRow({ entry }: { entry: NavEntry }): ReactNode {
  return (
    <button
      type="button"
      className="home-catalog-row"
      title={entry.note ? entry.name + "：" + entry.note : entry.name}
      onClick={() => openTab(entry.page, entry.params, { title: entry.name })}
    >
      <span className="home-catalog-name">{entry.name}</span>
      {entry.note ? <span className="home-catalog-note">{entry.note}</span> : null}
      <IconChevron width={13} height={13} className="row-caret" />
    </button>
  );
}

function HomeCatalog(): ReactNode {
  const [open, setOpen] = useState(true);
  return (
    <section className="home-card" data-card="home-catalog">
      <div className="home-card-head">
        <button
          type="button"
          className="home-card-title"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title={open ? "收起功能目录" : "展开功能目录"}
        >
          <h2>功能目录</h2>
          <span className="home-card-aside">全部功能按类分组</span>
        </button>
        <button type="button" className="btn btn-ghost home-catalog-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "收起" : "展开"}
        </button>
      </div>
      {open ? (
        <div className="home-card-body">
          <div className="home-catalog-groups">
            {NAV_CATEGORIES.map((cat) => {
              const entries = byCategory(cat);
              if (entries.length === 0) return null;
              return (
                <div key={cat} className="home-catalog-group">
                  <div className="home-catalog-group-name">{cat}</div>
                  <div className="home-catalog-rows">
                    {entries.map((e) => (
                      <CatalogRow key={e.id} entry={e} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="home-catalog-hint">常用功能可固定到下方今日卡片（编辑模式添加卡片），或收进 OneGO! 页面。</div>
        </div>
      ) : null}
    </section>
  );
}

/* ══════════ 首页标签页整体 ══════════ */

export function HomeTab(): ReactNode {
  return (
    <div className="home-tab">
      <HomeSearchBar />
      <HomeResume />
      <HomeCatalog />
      <TodayPage />
    </div>
  );
}
