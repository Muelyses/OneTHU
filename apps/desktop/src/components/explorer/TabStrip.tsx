/**
 * 顶栏标签条（dev-explorer 工作空间革命）：首页恒在第一（不可关闭、不可多开），
 * 其后是打开的工作标签页（同页同实例复用，「复制」才多开），行尾「+」= 回首页。
 *
 * v2（用户拍板「tab 上只写『通知』是偷懒」）：标题走 state/tabTitles.ts 的
 * resolveTabTitle —— tab 上显示实体级短标签（label），完整路径（full）挂 title
 * 属性 hover 可见；数据快照就绪后由 useTabTitleTick 的 15s 节拍升级为实体名。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  activeTab,
  allTabs,
  closeTab,
  duplicateTab,
  explorerSnapshot,
  focusTab,
  HOME_TAB_ID,
  openSettings,
  subscribeExplorer,
  type ExplorerTab,
} from "../../state/explorer.js";
import { resolveTabTitle, useTabTitleTick } from "../../state/tabTitles.js";
import { enc, PAGE_ATOMS } from "../../state/atoms.js";
import { getLearnSnapshot } from "../../state/data.js";
import { atomKeyOf, type AtomRef } from "../../state/favorites.js";
import { useFavs } from "../../state/favs.js";
import type { LearnNav, Page } from "../../state/app.js";
import { IconPlus, IconX } from "../Icons.js";
import { BrandLogo } from "../Layout.js";

/** 订阅 explorer store 的共享小钩子（TabDrawer/BottomBar 复用，别各自再写一遍） */
export function useExplorerTabs(): { tabs: ExplorerTab[]; activeId: string } {
  const snap = useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
  return { tabs: allTabs(), activeId: snap.activeId };
}

/** 首页图标：小房子（内联 SVG，不引库） */



/* ══════════ ⑧ 悬停小窗（鼠标专属；touch/pen 不启用） ══════════ */

type TipState = { kind: "copy" | "tab" | "gear"; tabId?: string; rect: DOMRect };

const HOVER_TIP_MS = 600;

function TabstripTip({ tip, onClose }: { tip: TipState; onClose: () => void }): ReactNode {
  useTabTitleTick();
  const { tabs } = useExplorerTabs();
  const tab = tip.tabId ? tabs.find((t) => t.id === tip.tabId) ?? null : null;
  const isHome = tab?.kind === "home";
  const full = tab ? (isHome ? "首页" : resolveTabTitle(tab.page, tab.params).full) : "";
  const act = tip.kind === "copy" ? resolveTabTitle(activeTab().page, activeTab().params).full : full;
  /* 位置：标签条下方 4px，水平以锚点为中心、左右夹紧不越屏 */
  const strip = document.querySelector(".ex-tabstrip")?.getBoundingClientRect();
  const top = (strip?.bottom ?? tip.rect.bottom) + 4;
  const width = 264;
  const left = Math.min(Math.max(tip.rect.left + tip.rect.width / 2 - width / 2, 8), Math.max(window.innerWidth - width - 8, 8));
  return createPortal(
    <div className="ex-tip" role="tooltip" style={{ top, left, width }} onClick={(e) => e.stopPropagation()}>
      {tip.kind === "copy" ? (
        <>
          <div className="ex-tip-title">复制当前页面</div>
          <div className="ex-tip-full">{act}</div>
        </>
      ) : tip.kind === "gear" ? (
        <div className="ex-tip-title">设置</div>
      ) : (
        <>
          <div className="ex-tip-full">{isHome ? "首页 · 不可关闭" : full}</div>
          <div className="ex-tip-actions">
            {isHome ? null : (
              <>
                <button className="btn btn-ghost ex-btn-sm" onClick={() => { if (tip.tabId) duplicateTab(tip.tabId); onClose(); }}>复制</button>
                <button className="btn btn-ghost ex-btn-sm ex-danger" onClick={() => { if (tip.tabId) closeTab(tip.tabId); onClose(); }}>关闭</button>
              </>
            )}
            <button className="btn btn-ghost ex-btn-sm" onClick={() => { openSettings("settings"); onClose(); }}>设置</button>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}


/* ══════════ ⑨ 首页星标：把「当前活动标签页」收进「首页收藏」OnePage ══════════ */

const HOME_FAV_TITLE = "首页收藏";

/** 活动 tab → AtomRef（只产既有原子体系认识的引用，不造野原子）：
 *  实体详情页走 atoms.tsx 的 enc 编码形态；其余页按 PAGE_ATOMS 打分匹配
 *  （recordPageAtomUse 同款口径）；两者都不中的页面不支持收藏（星恒灰禁用）。 */
function atomRefOfTab(tab: ExplorerTab): AtomRef | null {
  if (tab.kind !== "page") return null;
  const params = (tab.params ?? {}) as LearnNav;
  switch (tab.page) {
    case "learn-course": {
      const c = getLearnSnapshot()?.courses.find((x) => x.id === params.courseId);
      return c ? { kind: "course", key: enc(c.id, c.name, c.teacherName) } : null;
    }
    case "learn-assignment-detail": {
      const hw = getLearnSnapshot()?.homework.find((h) => h.id === params.itemId);
      return hw ? { kind: "assignment", key: enc(hw.courseId, hw.id, hw.title) } : null;
    }
    case "learn-notice-detail": {
      const n = getLearnSnapshot()?.notifications.find((x) => x.id === params.itemId);
      return n ? { kind: "notice", key: enc(n.courseId, n.id, n.title) } : null;
    }
    case "learn-file-detail": {
      const f = getLearnSnapshot()?.files.find((x) => x.id === params.itemId);
      return f ? { kind: "file", key: enc(f.courseId, f.id, f.title) } : null;
    }
    default: {
      const same = PAGE_ATOMS.filter((a) => a.page === (tab.page as Page));
      if (same.length === 0) return null;
      const keys = Object.keys(params) as Array<keyof LearnNav>;
      let best: (typeof same)[number] | null = null;
      let bestScore = -1;
      for (const a of same) {
        const ap = (a.params ?? {}) as LearnNav;
        let score = 0;
        for (const k of keys) if (ap[k] !== undefined && ap[k] === params[k]) score += 2;
        if (score > bestScore) {
          bestScore = score;
          best = a;
        }
      }
      return best ? { kind: "page", key: best.key } : null;
    }
  }
}

/** 星形图标：未收藏描边灰，收藏点亮起（fill 随 .is-lit） */
function StarGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width={13} height={13} aria-hidden="true">
      <path
        d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3.1-3 4.3-.6z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TabStrip(): ReactNode {
  useTabTitleTick(); // 15s 节拍：数据快照晚于开 tab 时，实体名自动升级
  const { tabs, activeId } = useExplorerTabs();
  /* ① 横向滚动进度条（Layout 旧 SegmentedOverflow 的 indi/thumb 同款）：
     放不下（scrollWidth > clientWidth）才渲染，scrollLeft 比例驱动 thumb 宽/位；
     resize（ResizeObserver）+ scroll 双监听，开关标签后 tabs.length 变化再补一拍。 */
  const stripRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const update = useCallback((): void => {
    const el = stripRef.current;
    const thumb = thumbRef.current;
    if (!el || !thumb) return;
    const overflow = el.scrollWidth - el.clientWidth;
    const can = overflow > 2 && el.clientWidth >= 60;
    setScrollable(can);
    if (!can) return;
    const frac = Math.min(Math.max(el.scrollLeft / overflow, 0), 1);
    const trackW = el.clientWidth;
    const w = (el.clientWidth / el.scrollWidth) * trackW;
    const thumbW = Math.max(24, Math.min(w, 88));
    thumb.style.width = `${thumbW}px`;
    thumb.style.left = `${frac * (trackW - thumbW)}px`;
  }, []);
  useLayoutEffect(() => {
    update();
    const el = stripRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [update]);
  useEffect(() => {
    update();
  }, [tabs.length, update]);

  /* ⑧ 悬停小窗：pointerenter 计 600ms、leave/滚动清除；事件委托在顶栏上
     （复制钮/齿轮是 Layout 的 DOM，不改它的文件）；只认 pointerType === "mouse"。 */
  /* ⑨ 星标状态：亮 = 活动 tab 的原子已在「首页收藏」OnePage 里 */
  const favs = useFavs();
  const activeT = tabs.find((t) => t.id === activeId) ?? null;
  const starRef = activeT ? atomRefOfTab(activeT) : null;
  const starKey = starRef ? atomKeyOf(starRef) : null;
  const homeFavId = favs.data.order.find((id) => favs.data.folders[id]?.title === HOME_FAV_TITLE) ?? null;
  const starLit = homeFavId !== null && starKey !== null && (favs.data.folders[homeFavId]?.items ?? []).some((it) => it.t === "a" && atomKeyOf(it.atom) === starKey);
  const onStar = (): void => {
    if (!starRef || !starKey || !activeT) return;
    if (!starLit) {
      const fid = favs.data.order.find((id) => favs.data.folders[id]?.title === HOME_FAV_TITLE) ?? null;
      const id = fid ?? favs.create(HOME_FAV_TITLE, null);
      if (id) favs.addAtom(id, starRef);
      return;
    }
    if (homeFavId === null) return;
    const items = favs.data.folders[homeFavId]?.items ?? [];
    const idx = items.findIndex((it) => it.t === "a" && atomKeyOf(it.atom) === starKey);
    if (idx < 0) return;
    const name = resolveTabTitle(activeT.page, activeT.params);
    /* alert 无取消，确认一律 window.confirm（用户口径） */
    if (window.confirm(`确定从 OnePage 中移除「${name.label}」（${name.full}）？\n如果这是您的定制 OnePage，其内容和在其他 OnePage 中的入口都会永久消失！`)) {
      favs.removeAt(homeFavId, idx);
    }
  };

  const [tip, setTip] = useState<TipState | null>(null);
  const tipTimer = useRef<number | null>(null);
  const tipKey = useRef<string>("");
  const clearTip = useCallback((): void => {
    if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
    tipTimer.current = null;
    tipKey.current = "";
    setTip(null);
  }, []);
  useLayoutEffect(() => {
    const resolve = (el: Element): TipState | null => {
      const tabEl = el.closest(".ex-tab");
      if (tabEl) {
        const id = tabEl.getAttribute("data-tab-id") ?? undefined;
        return { kind: "tab", tabId: id, rect: tabEl.getBoundingClientRect() };
      }
      const icon = el.closest(".tb-icon");
      if (icon) {
        const label = icon.getAttribute("aria-label") ?? icon.getAttribute("title") ?? "";
        if (label.includes("复制")) return { kind: "copy", rect: icon.getBoundingClientRect() };
        if (label.includes("设置")) return { kind: "gear", rect: icon.getBoundingClientRect() };
      }
      return null;
    };
    const onOver = (e: PointerEvent): void => {
      if (e.pointerType !== "mouse") return;
      const target = e.target instanceof Element ? e.target : null;
      const topbar = target?.closest?.(".explorer-topbar");
      if (!topbar) return;
      const next = resolve(target!);
      const key = next ? `${next.kind}:${next.tabId ?? ""}` : "";
      if (!next || key === tipKey.current) return;
      if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
      tipKey.current = key;
      tipTimer.current = window.setTimeout(() => setTip(next), HOVER_TIP_MS);
    };
    const onOut = (e: PointerEvent): void => {
      if (e.pointerType !== "mouse") return;
      const to = e.relatedTarget instanceof Element ? e.relatedTarget : null;
      if (!to || !to.closest(".explorer-topbar")) clearTip(); // 真正离开顶栏才清；钮内移动交给 onOver 重置
    };
    const topbar = stripRef.current?.closest(".explorer-topbar") ?? null;
    topbar?.addEventListener("pointerover", onOver as EventListener);
    topbar?.addEventListener("pointerout", onOut as EventListener);
    window.addEventListener("scroll", clearTip, { passive: true, capture: true });
    window.addEventListener("resize", clearTip);
    return () => {
      topbar?.removeEventListener("pointerover", onOver as EventListener);
      topbar?.removeEventListener("pointerout", onOut as EventListener);
      window.removeEventListener("scroll", clearTip, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", clearTip);
      if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
    };
  }, [clearTip]);
  return (
    <div className="ex-tabstrip" role="tablist" aria-label="标签页" ref={stripRef}>
      {tabs.map((t) => {
        const active = t.id === activeId;
        const isHome = t.kind === "home";
        const label = isHome ? "首页" : resolveTabTitle(t.page, t.params).label;
        const full = isHome ? "首页" : resolveTabTitle(t.page, t.params).full;
        return (
          <div
            key={t.id}
            data-tab-id={t.id}
            className={"ex-tab" + (active ? " is-active" : "") + (isHome ? " is-home" : "")}
            role="tab"
            aria-selected={active}
          >
            {isHome ? (
              <button
                className={"ex-tab-star" + (starLit ? " is-lit" : "")}
                disabled={!starRef}
                title={!starRef ? "该页面暂不支持收藏" : starLit ? "从「首页收藏」OnePage 移除当前页面" : "把当前页面收进「首页收藏」OnePage"}
                aria-label={starLit ? "从首页收藏移除当前页面" : "把当前页面收进首页收藏"}
                aria-pressed={starLit}
                onClick={(e) => {
                  e.stopPropagation();
                  onStar();
                }}
              >
                <StarGlyph />
              </button>
            ) : null}
            <button className="ex-tab-main" title={full} onClick={() => focusTab(t.id)}>
              {isHome ? <BrandLogo size={12} /> : null}
              <span className="ex-tab-title">{label}</span>
            </button>
            {isHome ? null : (
              <button
                className="ex-tab-close"
                aria-label={`关闭 ${label}`}
                title={`关闭 · ${full}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
              >
                <IconX width={11} height={11} />
              </button>
            )}
          </div>
        );
      })}
      <button
        className="ex-tab-add"
        title="新标签页（回首页）"
        aria-label="新标签页"
        onClick={() => focusTab(HOME_TAB_ID)}
      >
        <IconPlus width={14} height={14} />
      </button>
      {scrollable ? (
        <div className="ex-tabstrip-indi" aria-hidden="true">
          <i ref={thumbRef} />
        </div>
      ) : null}
      {tip ? <TabstripTip tip={tip} onClose={clearTip} /> : null}
    </div>
  );
}
