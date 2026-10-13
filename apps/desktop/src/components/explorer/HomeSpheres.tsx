/**
 * 首页固定层（2026-10-13 定稿）：居中大时间 + 时间下的一级功能区 + 两个功能按钮。
 *
 * 两块都**不可移动、不可删除**（它们是首页的骨架），但各自可调不透明度——
 * 在块上右键（桌面）/长按（触屏）弹出菜单调档；调低后透出下方的自由白板组件。
 * 「更多功能」弹居中小窗：全部一级圆球，右上角红叉＝从首页移除、绿加号＝添加到首页，
 * 直接点球 = 跳转。「详细功能」弹完整功能目录（分类列表）。
 *
 * 交互层的其余部分（时间/日期/天气/卡片/便笺/画笔…）全部是自由白板组件，
 * 走 BoardPage 的画布（HomeTab 以无头模式嵌入），z 序在 chrome 之下。
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
import { byCategory, NAV_CATEGORIES } from "../../state/navigation.js";
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

export function HomeChrome(): ReactNode {
  const doc = useSyncExternalStore(subscribeSpheres, spheresSnapshot, spheresSnapshot);
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
            <button type="button" className="hs-dock-btn" aria-expanded={moreOpen} onClick={() => { setMoreOpen((v) => !v); setDetailOpen(false); }}>
              <IconMore width={14} height={14} />
              <span>更多功能</span>
            </button>
            <button type="button" className="hs-dock-btn" aria-expanded={detailOpen} onClick={() => { setDetailOpen((v) => !v); setMoreOpen(false); }}>
              <span>详细功能</span>
              <IconChevron width={14} height={14} />
            </button>
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
