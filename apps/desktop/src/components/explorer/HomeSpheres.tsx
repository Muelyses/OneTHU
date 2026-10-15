import { Chip } from "@onethu/gui";
/**
 * 首页固定层（2026-10-13 定稿）：居中大时间 + 时间下的一级功能区 + 两个功能按钮。
 *
 * 两块都**不可移动、不可删除**（它们是首页的骨架），但各自可调不透明度——
 * 在块上右键（桌面）/长按（触屏）弹出菜单调档；调低后透出下方的自由白板组件。
 * 「更多功能」弹居中小窗：全部一级圆球，右上角红叉＝从首页移除、绿加号＝添加到首页，
 * 直接点球 = 跳转。「详细功能」弹完整功能目录（分类列表）。
 *
 * 交互层的其余部分（时间/日期/天气/卡片/便笺/画笔…）全部是自由白板组件，
 * 走 FreeBoard 的自由画布（HomeTab 里 `<HomeChrome/> + <FreeBoard boardId/>`），z 序在 chrome 之下。
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  allSphereEntries,
  dockSphere,
  setDockOpacity,
  setTimeOpacity,
  sphereEntry,
  spheresSnapshot,
  subscribeSpheres,
  undockSphere,
} from "../../state/homeSpheres.js";
import { byCategory, NAV_CATEGORIES, pluginCatalogEntries } from "../../state/navigation.js";
import { pluginTabsSnapshot, subscribePluginTabs } from "../../plugins/tabs.js";
import { openTab } from "../../state/explorer.js";
import { IconChevron, IconMore, IconX } from "../Icons.js";

const OPACITY_STEPS = [1, 0.75, 0.5, 0.3] as const;

/** 大时间（每秒走字）+ 日期行 */
function ChromeClock(): ReactNode {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const week = "日一二三四五六"[now.getDay()] ?? "";
  return (
    <div className="chrome-clock" aria-label="当前时间">
      <div className="chrome-clock-time">
        {hh}<span className="chrome-clock-colon">:</span>{mm}
      </div>
      <div className="chrome-clock-date">
        {now.getMonth() + 1} 月 {now.getDate()} 日 · 周{week}
      </div>
    </div>
  );
}

/** 功能区里的一颗球 */
function DockSphere({
  entry,
  onNavigate,
}: {
  entry: { page: import("../../state/app.js").Page; label: string; icon: (p: object) => ReactNode; note?: string };
  onNavigate: () => void;
}): ReactNode {
  const Icon = entry.icon as (p: { width?: number; height?: number }) => ReactNode;
  return (
    <button type="button" className="sphere hs-dock-sphere" title={entry.label} onClick={onNavigate}>
      <span className="sphere-ball">
        <Icon width={20} height={20} />
      </span>
      <span className="sphere-name">{entry.label}</span>
    </button>
  );
}

/**
 * 首页固定层几何诊断（**仅 dev**，2026-10-15）：用户报「时钟和程序坞向左漂移」，
 * 合成探针复现不出（挂载结构与真 app 有差），于是让真 app 自己把数字写进调试日志
 * （dev 下 /tmp/onethu-debug.log），一次拿到窗口/层/钟/坞/竖栏变量/各祖先让位量。
 * 生产构建里 `import.meta.env.DEV` 为 false → 直接 return，不产生任何开销与副作用。
 */
function useHomeLayoutProbe(): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const t = window.setTimeout(() => {
      const pick = (sel: string) => document.querySelector<HTMLElement>(sel);
      const box = (el: HTMLElement | null) => {
        if (!el) return "null";
        const r = el.getBoundingClientRect();
        return `{l:${Math.round(r.left)} w:${Math.round(r.width)} mid:${Math.round((r.left + r.right) / 2)}}`;
      };
      const layer = pick(".home-chrome-layer");
      const content = pick(".explorer-content");
      const tab = pick(".home-tab");
      const cadence = layer ? getComputedStyle(layer) : null;
      const line = [
        "[home-layout]",
        `win=${window.innerWidth}x${window.innerHeight}`,
        `clientW=${document.documentElement.clientWidth}`,
        `vMid=${Math.round(window.innerWidth / 2)}`,
        `htmlCls="${document.documentElement.className}"`,
        `layer=${box(layer)}`,
        `clock=${box(pick(".chrome-time"))}`,
        `dock=${box(pick(".hs-dock-row"))}`,
        `tab=${box(tab)}`,
        `content=${box(content)}`,
        `contentML=${content ? getComputedStyle(content).marginLeft : "-"}`,
        `rowML=${tab ? getComputedStyle(tab).marginLeft : "-"}`,
        `railVar=${cadence?.getPropertyValue("--ex-rail-w").trim() || "undef"}`,
        `layerML=${cadence?.marginLeft ?? "-"}`,
        `layerPos=${cadence?.position ?? "-"}`,
        `layerW=${cadence?.width ?? "-"}`,
      ].join(" ");
      void import("@tauri-apps/api/core")
        .then((m) => m.invoke("log_debug", { line: new Date().toISOString() + " | " + line }))
        .catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(t);
  }, []);
}

export function HomeChrome(): ReactNode {
  useHomeLayoutProbe();
  const doc = useSyncExternalStore(subscribeSpheres, spheresSnapshot, spheresSnapshot);
  /* 插件功能页也进「详细功能」目录：订阅它们的增删（注册/卸载即时反映） */
  const pluginTabs = useSyncExternalStore(subscribePluginTabs, pluginTabsSnapshot, pluginTabsSnapshot);
  const [moreOpen, setMoreOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [opacityMenu, setOpacityMenu] = useState<"time" | "dock" | null>(null);

  const docked = doc.docked
    .map((id) => sphereEntry(id))
    .filter((e): e is NonNullable<ReturnType<typeof sphereEntry>> => e !== null);
  const dockedSet = new Set(doc.docked);

  const go = (e: { page: import("../../state/app.js").Page; label: string }): void => {
    openTab(e.page, null, { title: e.label });
    setMoreOpen(false);
    setDetailOpen(false);
  };

  /** 不透明度菜单（右键/长按两块固定区弹出） */
  const opacityItems = (which: "time" | "dock", current: number): ReactNode =>
    createPortal(
      <div className="hs-op-mask" onClick={() => setOpacityMenu(null)} onContextMenu={(e) => { e.preventDefault(); setOpacityMenu(null); }}>
        <div className="hs-op" role="menu" aria-label="不透明度" onClick={(e) => e.stopPropagation()}>
          <div className="hs-op-title">不透明度（{which === "time" ? "大时间" : "功能区"}）</div>
          {OPACITY_STEPS.map((v) => (
            <button
              key={v}
              type="button"
              className={"hs-op-item" + (Math.abs(current - v) < 0.01 ? " is-on" : "")}
              role="menuitemradio"
              aria-checked={Math.abs(current - v) < 0.01}
              onClick={() => {
                (which === "time" ? setTimeOpacity : setDockOpacity)(v);
                setOpacityMenu(null);
              }}
            >
              {Math.round(v * 100)}%
            </button>
          ))}
          <div className="hs-op-hint">调低后能透出下面的白板组件</div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <div className="home-chrome-layer">
        {/* 固定层 ①：居中大时间（可调透明度；不可移动/删除） */}
        <div
          className="chrome-block chrome-time"
          style={{ opacity: doc.timeOpacity }}
          onContextMenu={(e) => {
            e.preventDefault();
            setOpacityMenu("time");
          }}
        >
          <ChromeClock />
        </div>

        {/* 固定层 ②：一级功能区 + 更多功能 + 详细功能（可调透明度；不可移动/删除） */}
        <div
          className="chrome-block chrome-dock"
          style={{ opacity: doc.dockOpacity }}
          onContextMenu={(e) => {
            e.preventDefault();
            setOpacityMenu("dock");
          }}
        >
          <div className="hs-dock-row">
            {docked.map((entry) => (
              <DockSphere key={entry.page} entry={entry} onNavigate={() => go(entry)} />
            ))}
          </div>
          <div className="hs-dock-actions">
            {/* 2026-10-14：这俩曾是"透明文字"（旧 .hs-dock-btn 的 ghost 收口在壁纸上看不见）——
                收进 OG Chip 后有实底胶囊，开合态 selected 高亮跟随 */}
            <Chip
              size="sm"
              selected={moreOpen}
              onClick={() => { setMoreOpen((v) => !v); setDetailOpen(false); }}
              icon={<IconMore width={14} height={14} />}
            >
              更多功能
            </Chip>
            <Chip size="sm" selected={detailOpen} onClick={() => { setDetailOpen((v) => !v); setMoreOpen(false); }}>
              详细功能
            </Chip>
          </div>
        </div>
      </div>

      {/* 更多功能：居中小窗 = 全部一级球（× 移出首页 / ＋ 添加到首页；点球跳转） */}
      {moreOpen
        ? createPortal(
            <div className="hs-more-mask" onClick={() => setMoreOpen(false)}>
              <div className="hs-more" role="dialog" aria-label="更多功能" onClick={(e) => e.stopPropagation()}>
                <div className="hs-more-head">
                  <span>全部一级功能</span>
                  <button type="button" className="hs-close" aria-label="关闭" onClick={() => setMoreOpen(false)}>
                    <IconX width={14} height={14} />
                  </button>
                </div>
                <div className="hs-more-grid">
                  {allSphereEntries().map((entry) => {
                    const inHome = dockedSet.has(entry.page);
                    const Icon = entry.icon as (p: { width?: number; height?: number }) => ReactNode;
                    return (
                      <div key={entry.page} className="hs-more-cell">
                        {inHome ? (
                          <button
                            type="button"
                            className="hs-cell-badge is-remove"
                            aria-label={"从首页移除 " + entry.label}
                            title="从首页移除"
                            onClick={() => undockSphere(entry.page)}
                          >
                            ×
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="hs-cell-badge is-add"
                            aria-label={"添加到首页 " + entry.label}
                            title="添加到首页"
                            onClick={() => dockSphere(entry.page)}
                          >
                            ＋
                          </button>
                        )}
                        <button type="button" className="sphere" title={entry.label} onClick={() => go(entry)}>
                          <span className="sphere-ball">
                            <Icon width={20} height={20} />
                          </span>
                          <span className="sphere-name">{entry.label}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="hs-op-hint">右上角 ×／＋ 管理首页功能区；点球直接前往</div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* 详细功能：完整功能目录（分类列表） */}
      {detailOpen
        ? createPortal(
            <div className="hs-more-mask" onClick={() => setDetailOpen(false)}>
              <div className="hs-more hs-more-detail" role="dialog" aria-label="详细功能" onClick={(e) => e.stopPropagation()}>
                <div className="hs-more-head">
                  <span>详细功能目录</span>
                  <button type="button" className="hs-close" aria-label="关闭" onClick={() => setDetailOpen(false)}>
                    <IconX width={14} height={14} />
                  </button>
                </div>
                <div className="hs-detail-body">
                  {NAV_CATEGORIES.map((cat) => {
                    const entries = byCategory(cat);
                    if (entries.length === 0) return null;
                    return (
                      <div key={cat} className="hs-detail-group">
                        <div className="hs-detail-group-name">{cat}</div>
                        {entries.map((e2) => (
                          <button
                            key={e2.id}
                            type="button"
                            className="hs-detail-row"
                            title={e2.note ? e2.name + "：" + e2.note : e2.name}
                            onClick={() => go({ page: e2.page, label: e2.name })}
                          >
                            <span>{e2.name}</span>
                            <IconChevron width={12} height={12} className="hs-detail-caret" />
                          </button>
                        ))}
                      </div>
                    );
                  })}
                  {/* 插件功能页（动态类目，2026-10-15）：与一级页同一套目录行，
                      以前它们只在服务页「插件功能页」里出现，详细目录查不到。 */}
                  {pluginCatalogEntries(pluginTabs).length > 0 ? (
                    <div className="hs-detail-group">
                      <div className="hs-detail-group-name">插件</div>
                      {pluginCatalogEntries(pluginTabs).map((e2) => (
                        <button
                          key={e2.id}
                          type="button"
                          className="hs-detail-row"
                          title={e2.note ? e2.name + "：" + e2.note : e2.name}
                          onClick={() => go({ page: e2.page, label: e2.name })}
                        >
                          <span>{e2.name}</span>
                          <IconChevron width={12} height={12} className="hs-detail-caret" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {opacityMenu ? opacityItems(opacityMenu, opacityMenu === "time" ? doc.timeOpacity : doc.dockOpacity) : null}
    </>
  );
}
