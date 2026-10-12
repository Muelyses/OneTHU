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
import { enc, PAGE_ATOMS, tabAtomKey } from "../../state/atoms.js";
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

const HOVER_TIP_MS = 150; /* 用户实测原生 title 出得慢——自绘接管后 150ms 即现 */

function TabstripTip({ tip }: { tip: TipState }): ReactNode {
  useTabTitleTick();
  const { tabs } = useExplorerTabs();
  const tab = tip.tabId ? tabs.find((t) => t.id === tip.tabId) ?? null : null;
  const isHome = tab?.kind === "home";
  const full = tab ? (isHome ? "首页" : resolveTabTitle(tab.page, tab.params).full) : "";
  const text = tip.kind === "copy" ? ("复制当前页面 · " + resolveTabTitle(activeTab().page, activeTab().params).full) : tip.kind === "gear" ? "设置" : (isHome ? "首页 · 不可关闭" : full);
  /* 小标识（用户定案）：只要悬停出现的小行卡，不带动作与宽卡 */
  const strip = document.querySelector(".ex-tabstrip")?.getBoundingClientRect();
  const top = (strip?.bottom ?? tip.rect.bottom) + 4;
  const anchor = tip.rect.left + tip.rect.width / 2;
  const boxRef = useRef<HTMLDivElement>(null);
  /* 实测宽度后钳位：居中对准被悬停的标签，贴边时只在视口内左右让位 */
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const left = Math.min(Math.max(anchor - w / 2, 8), Math.max(window.innerWidth - w - 8, 8));
    el.style.left = `${left}px`;
  });
  return createPortal(
    <div ref={boxRef} className="ex-tip" role="tooltip" style={{ top }} onClick={(e) => e.stopPropagation()}>
      {text}
    </div>,
    document.body,
  );
}


/** 标签页 → AtomRef（用户定案：每个非首页标签都能一星收藏成独立 OnePage）。
 *  优先匹配既有 PAGE_ATOMS（参数完全一致才命中，保持既有收藏引用不断）；
 *  实体页或无对应原子的页面统一落到通用 "tab" 原子（page + params 即身份）。 */
function atomRefOfTab(tab: ExplorerTab): AtomRef | null {
  if (tab.kind !== "page") return null;
  const params = (tab.params ?? {}) as LearnNav;
  const generic: AtomRef = { kind: "tab", key: tabAtomKey(tab.page, tab.params ?? undefined) };
  let entity: AtomRef | null = null;
  switch (tab.page) {
    case "learn-course": {
      const c = getLearnSnapshot()?.courses.find((x) => x.id === params.courseId);
      entity = c ? { kind: "course", key: enc(c.id, c.name, c.teacherName) } : null;
      break;
    }
    case "learn-assignment-detail": {
      const hw = getLearnSnapshot()?.homework.find((h) => h.id === params.itemId);
      entity = hw ? { kind: "assignment", key: enc(hw.courseId, hw.id, hw.title) } : null;
      break;
    }
    case "learn-notice-detail": {
      const n = getLearnSnapshot()?.notifications.find((x) => x.id === params.itemId);
      entity = n ? { kind: "notice", key: enc(n.courseId, n.id, n.title) } : null;
      break;
    }
    case "learn-file-detail": {
      const f = getLearnSnapshot()?.files.find((x) => x.id === params.itemId);
      entity = f ? { kind: "file", key: enc(f.courseId, f.id, f.title) } : null;
      break;
    }
    default: {
      const keys = Object.keys(tab.params ?? {}).filter((k) => (tab.params as Record<string, unknown>)[k] !== undefined);
      const hit = PAGE_ATOMS.find((a) => {
        if (a.page !== (tab.page as Page)) return false;
        const ap = (a.params ?? {}) as Record<string, unknown>;
        const apKeys = Object.keys(ap);
        if (apKeys.length !== keys.length) return false;
        return apKeys.every((k) => ap[k] === (tab.params as Record<string, unknown> | null)?.[k]);
      });
      entity = hit ? { kind: "page", key: hit.key } : null;
    }
  }
  return entity ?? generic;
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
    if (!el) return;
    /* 判定与样式更新拆开：scrollable 翻转触发 Indi 挂载（thumbRef 之后才有效）；
       初版 update 头部 `if (!thumb) return` 造成死锁——首次不溢出 Indi 不渲染，之后
       溢出永远不更新（用户实测进度条压根不出现） */
    const overflow = el.scrollWidth - el.clientWidth;
    const can = overflow > 2 && el.clientWidth >= 60;
    setScrollable(can);
    const thumb = thumbRef.current;
    if (!can || !thumb) return;
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
  }, [update, scrollable]); /* scrollable 翻转 → Indi 挂载 → 补一拍 thumb 定位 */
  useEffect(() => {
    update();
  }, [tabs.length, update]);

  /* ⑧ 悬停小窗：pointerenter 计 600ms、leave/滚动清除；事件委托在顶栏上
     （复制钮/齿轮是 Layout 的 DOM，不改它的文件）；只认 pointerType === "mouse"。 */
  const favs = useFavs();
  /* 星标按行判定；一个页面=一个**独立 OnePage**（用户定案 2026-10-12 晚）：
     收藏=新建以页面名命名的 OnePage 并放入该页原子；灭星=删除该独立 OnePage 本体。 */
  const onStar = (t: ExplorerTab): void => {
    const ref = atomRefOfTab(t);
    if (!ref) return;
    const key = atomKeyOf(ref);
    const name = resolveTabTitle(t.page, t.params);
    const folder = Object.values(favs.data.folders).find((f) => f.items.some((it) => it.t === "a" && atomKeyOf(it.atom) === key));
    if (!folder) {
      const id = favs.create(name.label, null);
      if (id) favs.addAtom(id, ref);
      return;
    }
    const full = resolveTabTitle(t.page, t.params).full;
    /* alert 无取消，确认一律 window.confirm（用户口径；灭星=整页消失） */
    if (window.confirm(`确定从 OnePage 中移除「${name.label}」（${full}）？\n如果这是您的定制 OnePage，其内容和在其他 OnePage 中的入口都会永久消失！`)) {
      favs.remove(folder.id);
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
    <div className="ex-tabstrip-wrap"> {/* 定位基准层：Indi 必须在 overflow 容器外，否则随滚动跑出视口 */}
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
            {isHome ? null : (() => {
              /* 星在标题左侧（用户口径「标签页左边」）；与标题按钮并列，不嵌套 */
              const ref = atomRefOfTab(t);
              const lit = ref !== null && Object.values(favs.data.folders).some((f) => f.items.some((it) => it.t === "a" && atomKeyOf(it.atom) === atomKeyOf(ref)));
              return (
                <button
                  className={"ex-tab-star" + (lit ? " is-lit" : "")}
                  title={lit ? "取消星标：删除该 OnePage" : "一星：把当前页面收藏成 OnePage"}
                  aria-label={lit ? "取消星标" : "收藏为 OnePage"}
                  aria-pressed={lit}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStar(t);
                  }}
                >
                  <StarGlyph />
                </button>
              );
            })()}
            <button className="ex-tab-main" onClick={() => focusTab(t.id)}>
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
      {tip ? <TabstripTip tip={tip} /> : null}
      </div>
      {scrollable ? (
        <div className="ex-tabstrip-indi" aria-hidden="true">
          <i ref={thumbRef} />
        </div>
      ) : null}
    </div>
  );
}
