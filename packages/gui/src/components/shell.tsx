/* OneGUI · 应用壳（AppShell）+ 导航件（NavRail / TabStrip / MobileTabBar）
 *
 * 全站唯一的外框：桌面=左竖栏 + 顶栏 + 内容；手机=顶栏 + 内容 + 底部标签条。
 * 旧实现（Layout.tsx + explorer-ui.css 等 4 个文件）里这些是手写 DOM + 手写 class，
 * 现在收成一个受控模式组件：应用只喂 tabs/active/回调，样式与几何全归库。
 *
 * 与旧实现对齐的 UX（不许变）：
 *   · 首页标签恒在且不可关（pinned）；标签条放不下时横向可滑，鼠标按住可拖动；
 *   · 「…」打开标签抽屉；手机底部条最多 5 个目的地，激活项有滑动胶囊；
 *   · 关闭标签点在 ×，中键/长按菜单仍由调用方接管。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./chip.js";
import { IconBtn } from "./button.js";
import { cx, one, scopeProps } from "./kit.js";
import { useAxes } from "../pipeline/react.js";

export interface ShellTab {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** 不可关闭（首页） */
  pinned?: boolean;
  badge?: ReactNode;
  onClose?: () => void;
}

export interface NavRailProps {
  tabs: ShellTab[];
  activeTab: string;
  onSelect: (id: string) => void;
  /** 窄栏模式（悬停展开） */
  narrow?: boolean;
  /** 竖栏底部动作区（复制 / 设置 / 宽窄） */
  actions?: ReactNode;
  brand?: ReactNode;
  scope?: string;
  className?: string;
}

/** 桌面左竖栏：一行一个标签页，激活项是整行胶囊 */
export function NavRail({ tabs, activeTab, onSelect, narrow, actions, brand, scope, className }: NavRailProps): ReactNode {
  return (
    <aside {...scopeProps(scope)} className={cx("og-rail", narrow ? "og-rail--narrow" : "", className)} aria-label="标签页">
      {brand ? <div className="og-rail-brand">{brand}</div> : null}
      <div className="og-rail-list" role="tablist" aria-orientation="vertical">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === activeTab}
            title={typeof t.label === "string" ? t.label : undefined}
            className={cx("og-rail-item", t.id === activeTab ? "is-active" : "")}
            onClick={() => onSelect(t.id)}
            onAuxClick={(e) => { if (e.button === 1 && !t.pinned) t.onClose?.(); }}
          >
            {t.icon ? <span className="og-rail-icon" aria-hidden="true">{t.icon}</span> : null}
            <span className="og-rail-label">{t.label}</span>
            {t.badge ? <span className="og-rail-badge">{t.badge}</span> : null}
            {!t.pinned && t.onClose ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label="关闭标签页"
                className="og-rail-close"
                onClick={(e) => { e.stopPropagation(); t.onClose?.(); }}
              >
                ×
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {actions ? <div className="og-rail-actions">{actions}</div> : null}
    </aside>
  );
}

export interface TabStripProps {
  tabs: ShellTab[];
  activeTab: string;
  onSelect: (id: string) => void;
  /** 「…」抽屉入口 */
  onMore?: () => void;
  /** 标签条首位之前的动作（复制当前标签页） */
  leading?: ReactNode;
  scope?: string;
  className?: string;
}

/** 横版标签条：可横滑 + 鼠标拖动，激活项下有滑动指示条 */
export function TabStrip({ tabs, activeTab, onSelect, onMore, leading, scope, className }: TabStripProps): ReactNode {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; scrollLeft: number; moved: boolean } | null>(null);

  // 激活项滚进视野（切换标签时不许"看不见当前页"）
  useLayoutEffect(() => {
    const row = rowRef.current;
    const el = row?.querySelector<HTMLElement>(".og-tabitem.is-active");
    if (!row || !el) return;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    if (left < row.scrollLeft) row.scrollLeft = left - 8;
    else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth + 8;
  }, [activeTab, tabs.length]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const row = rowRef.current;
    if (!row) return;
    drag.current = { x: e.clientX, scrollLeft: row.scrollLeft, moved: false };
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const row = rowRef.current;
    if (!d || !row) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 3) d.moved = true;
    row.scrollLeft = d.scrollLeft - dx;
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
    setDragging(false);
  }, []);

  return (
    <div {...scopeProps(scope)} className={cx("og-tabstrip", dragging ? "is-dragging" : "", className)}>
      {leading}
      <div
        ref={rowRef}
        className="og-tabstrip-row"
        role="tablist"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === activeTab}
            className={cx("og-tabitem", t.id === activeTab ? "is-active" : "")}
            onClick={(e) => { if (!drag.current?.moved) { e.stopPropagation(); onSelect(t.id); } }}
            onAuxClick={(e) => { if (e.button === 1 && !t.pinned) t.onClose?.(); }}
          >
            {t.icon ? <span className="og-tabitem-icon" aria-hidden="true">{t.icon}</span> : null}
            <span className="og-tabitem-label">{t.label}</span>
            {t.badge ? <span className="og-tab-badge">{t.badge}</span> : null}
            {!t.pinned && t.onClose ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label="关闭标签页"
                className="og-tabitem-close"
                onClick={(e) => { e.stopPropagation(); t.onClose?.(); }}
              >
                ×
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {onMore ? <IconBtn label="全部标签页" size="sm" variant="ghost" onClick={onMore} icon={<Icon size="sm"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></Icon>} /> : null}
    </div>
  );
}

export interface MobileTabBarProps {
  items: ShellTab[];
  active: string;
  onSelect: (id: string) => void;
  scope?: string;
  className?: string;
}

/** 手机底部标签条：最多 5 个，激活项底下一条滑动胶囊（同一元素位移，不是各自淡入） */
export function MobileTabBar({ items, active, onSelect, scope, className }: MobileTabBarProps): ReactNode {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const pill = pillRef.current;
    const el = row?.querySelector<HTMLElement>(".og-tabbar-item.is-active");
    if (!row || !pill || !el) return;
    const rowRect = row.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const x = rect.left - rowRect.left + rect.width / 2 - rowRect.width / (items.length * 2);
    pill.style.transform = `translateX(${Math.max(0, x)}px)`;
  }, [active, items.length]);

  return (
    <nav {...scopeProps(scope)} className={cx("og-tabbar", className)}>
      <span ref={pillRef} className="og-tabbar-pill" aria-hidden="true" />
      <div ref={rowRef} className="og-tabbar-row" role="tablist">
        {items.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === active}
            className={cx("og-tabbar-item", t.id === active ? "is-active" : "")}
            onClick={() => onSelect(t.id)}
          >
            <span className="og-tabbar-icon" aria-hidden="true">{t.icon}</span>
            <span className="og-tabbar-label">{t.label}</span>
            {t.badge ? <span className="og-tabbar-badge">{t.badge}</span> : null}
          </button>
        ))}
      </div>
    </nav>
  );
}

export interface AppShellProps {
  tabs: ShellTab[];
  activeTab: string;
  onSelectTab: (id: string) => void;
  /** 桌面布局：rail = 竖栏（宽屏），strip = 顶栏横条 */
  desktopLayout?: "rail" | "strip";
  railNarrow?: boolean;
  onMore?: () => void;
  railActions?: ReactNode;
  tabLeading?: ReactNode;
  /** 顶栏右侧动作（刷新 / 设置 / 页面 ···） */
  actions?: ReactNode;
  brand?: ReactNode;
  /** 壁纸层（玻璃皮肤需要；中性皮肤留空即可） */
  wallpaper?: ReactNode;
  /** 端形态：默认跟管线 platform 轴；预览/内嵌时可以显式指定 */
  platform?: "desktop" | "mobile";
  scope?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * 应用外框：一套 DOM 两种端形态。手机（platform=mobile）自动切成顶栏 + 底部条。
 */
export function AppShell({
  tabs, activeTab, onSelectTab, desktopLayout = "rail", railNarrow, onMore, railActions, tabLeading,
  actions, brand, wallpaper, scope, className, children, platform: platformProp,
}: AppShellProps): ReactNode {
  const axisPlatform = useAxes().platform;
  const platform = platformProp ?? axisPlatform;
  const mobile = platform === "mobile";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div {...scopeProps(scope)} className={cx("og-shell", mobile ? "og-shell--mobile" : "", className)}>
      {wallpaper}
      {!mobile && desktopLayout === "rail" ? (
        <NavRail tabs={tabs} activeTab={activeTab} onSelect={onSelectTab} narrow={railNarrow} actions={railActions} brand={brand} />
      ) : null}

      <div className="og-shell-main">
        <header className={cx("og-topbar", scrolled ? "is-scrolled" : "")}>
          {mobile ? (
            <button type="button" className="og-topbar-brand" onClick={() => onSelectTab(tabs[0]?.id ?? "")} aria-label="首页">
              {brand}
            </button>
          ) : desktopLayout === "strip" ? (
            <>
              {tabLeading}
              <TabStrip tabs={tabs} activeTab={activeTab} onSelect={onSelectTab} onMore={onMore} />
            </>
          ) : null}
          {mobile ? <span className="og-topbar-title">{tabs.find((t) => t.id === activeTab)?.label}</span> : null}
          <span className="og-topbar-spring" aria-hidden="true" />
          {actions}
        </header>

        <main className="og-shell-content">{children}</main>

        {mobile && onMore ? (
          <MobileTabBar
            items={tabs.slice(0, 4)}
            active={activeTab}
            onSelect={onSelectTab}
          />
        ) : null}
      </div>
    </div>
  );
}
