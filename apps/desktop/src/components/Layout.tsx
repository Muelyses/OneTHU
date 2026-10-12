/** Explorer 顶栏 + 内容骨架 + 基础 UI 件（卡片 / 徽标 / 骨架屏 / 开关）。
 *  dev-explorer 革命（2026-10-12）：侧边栏、移动抽屉、五格底栏整体退役——
 *  顶栏 = 首页 Logo（恒在）+ 标签条 + 搜索 + 设置齿轮；底栏三入口（标签页 | OH | OneGO）
 *  在 explorer/BottomBar；设置/插件/OH 是高于任何标签页的浮层（state/explorer.ts 的
 *  overlay store 即旧 Entry 状态机，goEntry/useEntry 在此薄重导出保持全库兼容）。 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useThemes } from "../state/theme.js";
import { useApp } from "../state/context.js";
import { topLevelPage, type LearnNav, type Page } from "../state/app.js";
import { useExpanded } from "../state/usePlatformLayout.js";
import {
  HOME_TAB_ID,
  activeTab,
  closeSettings,
  duplicateTab,
  focusTab,
  openSettings,
  overlaySnapshot,
  subscribeOverlay,
  useExplorerState,
  useOverlayEntry,
  type OverlayEntry,
} from "../state/explorer.js";
import { HarnessMark } from "./HarnessMark.js";
import { NAV_REGISTRY } from "../state/navigation.js";
import { DESENSITIZE_BUILD } from "../lib/privacy.js";
import { IconArrowUp, IconChevron, IconFolder, IconFolderPlus, IconInfo, IconLearn, IconPen, IconPlug, IconRefresh, IconSchedule, IconSettings, IconStar, IconToday, IconXk, IconCard, IconCalendar, FolderIcon, IconExternal, IconThos, IconTrace, IconMail, IconCloud, IconBook } from "./Icons.js";
import { useFavs } from "../state/favs.js";
import { pluginTabsSnapshot, subscribePluginTabs } from "../plugins/tabs.js";
import { showToast } from "../state/toast.js";
import { checkUpdateSilently } from "../lib/update.js";
import { useSegPill } from "../lib/motion.js";
import { ErrorLine } from "./Details.js";
import { CommandPalette } from "./CommandPalette.js";
import { TabStrip } from "./explorer/TabStrip.js";
import { BottomBar } from "./explorer/BottomBar.js";
import { TabDrawer } from "./explorer/TabDrawer.js";
import { OneGoSheet } from "./explorer/OneGoSheet.js";
import { SettingsOverlay } from "./explorer/SettingsOverlay.js";
import "../styles/explorer.css";
import "../styles/explorer-ui.css";
import "../styles/explorer-home.css";

/** 开发者面板（仅 dev 构建）：右上角 commit 徽标 + 前端日志/诊断/导出。
 *  正式版里 __ONETHU_DEV__ 折叠为 false → 这句动态 import 被 rollup 删除，
 *  dev 面板整块不进产物（守卫 tools/devtools-test.mjs，构建后再 grep dist 复核）。 */
const DevPanel = __ONETHU_DEV__ ? lazy(() => import("./DevPanel.js")) : null;
/* 检索落点自查（仅 dev）：?searchland=selfcheck 逐行程序化搜+点击，console 打 45 行 hit/fallback 表。 */
const SearchLandingSelfcheck = __ONETHU_DEV__ ? lazy(() => import("./SearchLandingSelfcheck.js")) : null;

/**
 * 一级功能目录（全库导入的数据源，保持原数组不动）：完整目录现渲染在首页
 * 「功能目录」卡（explorer/HomeTab），侧栏已退役但这份数据仍是唯一事实来源。
 */
export const NAV: Array<{ page: Page; label: string; icon: (p: object) => ReactNode; activePages?: Page[] }> = [
  { page: "today", label: "今日", icon: IconToday },
  { page: "tasks", label: "待办", icon: IconPen, activePages: ["tasks", "learn-assignments", "learn-assignment-detail", "learn-ykt-detail"] },
  { page: "learn", label: "网络学堂", icon: IconLearn },
  { page: "schedule", label: "日程", icon: IconSchedule },
  { page: "trace", label: "寻迹", icon: IconTrace },
  { page: "mail", label: "邮箱", icon: IconMail },
  { page: "cloud", label: "云盘", icon: IconCloud },
  { page: "thubook", label: "THUbook", icon: IconBook },
  { page: "info", label: "信息", icon: IconInfo },
  { page: "life", label: "生活", icon: IconCard },
  { page: "reserve", label: "预约", icon: IconCalendar },
  { page: "zhjwxk", label: "选课", icon: IconXk },
  { page: "thos", label: "在线服务", icon: IconThos },
  { page: "otherinfo", label: "其他 Info 应用", icon: IconExternal },
];

/** (One / THU) 品牌标识：五列网格，括号代码体，One 衬线紧凑撑满与 THU 逐列对齐。
 *  主题插件可整体替换（theme.logo 提供 inline SVG 时优先渲染）。 */
export function BrandLogo({ size = 14 }: { size?: number }) {
  const themed = useThemes().logoSvg;
  if (themed) {
    return (
      <span
        className="brand-logo brand-logo-themed"
        style={{ fontSize: size, display: "inline-flex", alignItems: "center" }}
        aria-label="OneTHU"
        /* 主题受信代码，同插件边界 */
        dangerouslySetInnerHTML={{ __html: themed }}
      />
    );
  }
  return (
    <span className="brand-logo" style={{ fontSize: size }} aria-label="OneTHU">
      <span className="p">(</span>
      <span className="word"><i>O</i><i>n</i><i>e</i></span>
      <span />
      <span className="p"> </span>
      <span className="u">T</span>
      <span className="u">H</span>
      <span className="u">U</span>
      <span className="p">)</span>
    </span>
  );
}

/** 顶栏：首页 Logo（点击回首页，恒在不变）+ 标签条 + 搜索 + 设置齿轮（恒在不变）。
 *  滚过 8px 浮起阴影（沿用旧顶栏的层次手法）。 */
/** 复制当前标签页（用户拍板：已存在实例默认复用，只有明确点「复制」才出第二实例） */
function CopyGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7" y="7" width="9.5" height="9.5" rx="1.8" />
      <path d="M13 4.5V4a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v6.5A1.5 1.5 0 0 0 5 12h.5" />
    </svg>
  );
}

function TopBar(): ReactNode {
  const [scrolled, setScrolled] = useState(false);
  const { activeId } = useExplorerState();
  const canDup = activeId !== HOME_TAB_ID;
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={"explorer-topbar" + (scrolled ? " is-scrolled" : "")}>
      {/* dev-explorer（用户拍板）：OneTHU 品牌标与「首页」标签并成 TabStrip 首位，左上单独的
          Logo 钮退役——复制按钮成为顶栏最左；首页仍恒在（TabStrip 首位不可关） */}
      <button
        className="icon-btn"
        onClick={() => duplicateTab(activeId)}
        disabled={!canDup}
        aria-label="复制当前标签页（独立实例）"
      >
        <CopyGlyph />
      </button>
      <TabStrip />
      <span className="tb-spring" aria-hidden="true" />
      <button className="icon-btn" onClick={() => openSettings("settings")} title="设置" aria-label="设置">
        <IconSettings width={16} height={16} />
      </button>
    </header>
  );
}

/**
 * SegmentedOverflow（滑动 + 位置指示条）：
 * - 分段条放不下时整条横向滑动（触摸直接滑；鼠标按住拖动，拖动期间抑制误触点击）；
 * - 可滑时条下方显示一个位置指示条（非滚动条）：按 scrollLeft 比例移动的圆角滑块，
 *   宽度下限 104px——比单个胶囊更宽，避免被误读为「当前 tab 下划线」；
 * - 整条放得下时指示条不出现；左右箭头方案已废弃。
 */
export function SegmentedOverflow({
  ariaLabel,
  style,
  children,
}: {
  ariaLabel?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [rowRef, pillRef] = useSegPill();
  const indiRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; sl: number } | null>(null);
  const dragThumb = useRef<{ x: number; sl: number } | null>(null);
  const moved = useRef(false);

  const update = useCallback(() => {
    const el = rowRef.current;
    const thumb = thumbRef.current;
    const indi = indiRef.current;
    if (!el || !indi || !thumb) return;
    const overflow = el.scrollWidth - el.clientWidth;
    const scrollable = overflow > 2 && el.clientWidth >= 60;
    indi.style.display = scrollable ? "block" : "none";
    if (!scrollable) return;
    const frac = Math.min(Math.max(el.scrollLeft / overflow, 0), 1);
    const trackW = indi.clientWidth;
    const w = el.clientWidth / el.scrollWidth * trackW;
    const thumbW = Math.max(32, Math.min(w, 72)); // 滑块短一点：按比例但封顶 72px
    thumb.style.width = `${thumbW}px`;
    thumb.style.left = `${frac * (trackW - thumbW)}px`;
  }, []);

  const seekTo = useCallback((clientX: number) => {
    const el = rowRef.current;
    const indi = indiRef.current;
    const thumb = thumbRef.current;
    if (!el || !indi || !thumb) return;
    const overflow = el.scrollWidth - el.clientWidth;
    if (overflow <= 0) return;
    const rect = indi.getBoundingClientRect();
    const thumbW = thumb.getBoundingClientRect().width;
    const frac = Math.min(Math.max((clientX - rect.left - thumbW / 2) / Math.max(rect.width - thumbW, 1), 0), 1);
    el.scrollLeft = frac * overflow;
  }, []);

  useLayoutEffect(() => {
    update();
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [update]);

  return (
    <div className="seg-ov" style={style}>
      <div
        className="segmented seg-track"
        role="tablist"
        aria-label={ariaLabel}
        ref={rowRef}
        onPointerDown={(e) => {
          // 关键：down 时不捕获——立即 setPointerCapture 会把后续 click 重定向到容器，
          // 胶囊按钮收不到点击。捕获推迟到移动超阈值（确认是拖动）那一刻。
          if (e.pointerType !== "mouse") return;
          drag.current = { x: e.clientX, sl: e.currentTarget.scrollLeft };
          moved.current = false;
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const el = e.currentTarget;
          const dx = e.clientX - d.x;
          if (!moved.current && Math.abs(dx) > 5) {
            moved.current = true;
            el.setPointerCapture(e.pointerId); // 此时才接管，拖动期间滑出条外也不丢
          }
          if (moved.current) el.scrollLeft = d.sl - dx;
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onClickCapture={(e) => {
          if (moved.current) {
            e.stopPropagation();
            e.preventDefault();
            moved.current = false;
          }
        }}
      >
        {/* 滑动块：位置/宽度由 useSegPill 量出后写入内联样式，量不到时不显形 */}
        <span className="seg-pill" ref={pillRef} aria-hidden="true" />
        {children}
      </div>
      {/* 真滚动条：滑块可抓取拖动，点槽任意处跳转（拇指中心对齐点击点） */}
      <div
        className="seg-indi"
        ref={indiRef}
        onPointerDown={(e) => {
          const el = rowRef.current;
          if (!el) return;
          e.preventDefault(); // 防选中/焦点
          e.currentTarget.setPointerCapture(e.pointerId);
          seekTo(e.clientX);
          dragThumb.current = { x: e.clientX, sl: el.scrollLeft };
        }}
        onPointerMove={(e) => {
          const d = dragThumb.current;
          if (!d) return;
          const el = e.currentTarget;
          const indi = indiRef.current;
          const thumb = thumbRef.current;
          if (!el || !indi || !thumb) return;
          const overflow = el.scrollWidth - el.clientWidth;
          if (overflow <= 0) return;
          const trackW = indi.clientWidth;
          const thumbW = thumb.getBoundingClientRect().width;
          el.scrollLeft = d.sl + (e.clientX - d.x) * (overflow / Math.max(trackW - thumbW, 1));
        }}
        onPointerUp={() => { dragThumb.current = null; }}
        onPointerCancel={() => { dragThumb.current = null; }}
      >
        <i ref={thumbRef} />
      </div>
    </div>
  );
}

/** Slogan：One 衬线 · THUer 现代黑体 · 其余等宽 · 句尾 OneTHU 用完整品牌标识 */
export function Slogan({ size = 13 }: { size?: number }) {
  return (
    <span className="slogan" style={{ fontSize: size }}>
      <span className="s-one">One</span>
      <span className="s-thuer">THUer</span>
      <span className="s-mono">should have</span>
      <BrandLogo size={Math.round(size * 1.25)} />
      <span className="s-mono">.</span>
    </span>
  );
}

/** Explorer 外壳：顶栏 + 内容（TabHost）+ 底栏三入口 + 命令面板 + 设置浮层。 */
export function Shell({ children }: { children: ReactNode }) {
  /* 启动：GitHub Releases 静默检查新版本（一次；失败静默，不打扰） */
  useEffect(() => {
    void checkUpdateSilently(showToast);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="shell explorer-shell">
      <TopBar />
      <main className="content explorer-content">{children}</main>
      <BottomBar />
      {/* 标签页抽屉与 OneGO 抽屉（portal 自管理开合，挂一次即可） */}
      <TabDrawer />
      <OneGoSheet />
      {/* 命令面板：⌘/Ctrl+K 或顶栏按钮唤起；挂在 shell 顶层，任何页面都能用 */}
      <CommandPalette />
      {/* 设置浮层（个人设置 / 插件 / OneTHU Harness）：不是标签页，高于任何标签页 */}
      <SettingsOverlay />
      {/* dev 构建「检索落点自查路由」(?searchland=selfcheck)：release 里整块被 rollup 剥离，不进导航 */}
      {SearchLandingSelfcheck ? (
        <Suspense fallback={null}>
          <SearchLandingSelfcheck />
        </Suspense>
      ) : null}
      <HardRefreshButton />
      {DevPanel ? (
        <Suspense fallback={null}>
          <DevPanel />
        </Suspense>
      ) : null}
    </div>
  );
}

/** 硬刷新悬浮按钮：固定右下角，所有页面可见（含登录/双因素页）。
 *  生产环境 tauri 资源走自定义协议不进 HTTP 缓存，reload 即全量重载；
 *  移动端没有右键/⌘R，这是页面卡死/白屏后的唯一恢复出口。 */
export function HardRefreshButton() {
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const on = () => setShowTop(window.scrollY > 240);
    window.addEventListener("scroll", on, { passive: true });
    on();
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <>
      {showTop ? (
        <button
          className="hard-refresh-fab top-fab"
          title="回到顶层"
          aria-label="回到顶层"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <IconArrowUp width={18} height={18} />
        </button>
      ) : null}
      <button
      className="hard-refresh-fab"
      title="硬刷新（整页重载）"
      aria-label="硬刷新"
      onClick={() => window.location.reload()}
    >
      <IconRefresh width={18} height={18} />
    </button>
    </>
  );
}

export function PageHead({
  title,
  meta,
  actions,
}: {
  /** 页标题；收藏夹重命名等场景可传受控输入（ReactNode） */
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  const { page } = useApp();
  // 窄屏顶栏标签条已展示当前页名：与导航名相同的标题不再重复渲染（详情页等子标题不受影响）
  const navLabel = NAV.find((n) => n.page === page)?.label ?? (page === "plugins" ? "插件" : undefined);
  // 统一断点读取（§2.8.1）：此前各组件自写 matchMedia，改断点必漏
  const expanded = useExpanded();
  const dupOnTopbar = !expanded && typeof title === "string" && title === navLabel;
  return (
    <header className="page-head">
      <div>
        {dupOnTopbar ? null : <h1>{title}</h1>}
        {meta ? <div className="page-head-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="page-head-actions">{actions}</div> : null}
    </header>
  );
}

/* ══════════ Entry 状态机（薄重导出）：store 本体在 state/explorer.ts 的设置浮层 ══════════
   旧语义映射：entry = "settings"|"plugins"|"oh" 即浮层的三段；goEntry = 打开/切换浮层。
   全库既有调用方（searchRows 落点 / OhSettingsPage / Plugins.tsx）零改动。 */
export type Entry = OverlayEntry;

export function goEntry(next: Entry): void {
  openSettings(next);
}
export function entrySnapshot(): Entry {
  return overlaySnapshot() ?? "plugins";
}
export function subscribeEntry(f: () => void): () => void {
  return subscribeOverlay(f);
}
/** 组件里读当前入口态（只在浮层挂载的页面里用；关闭时兜底 "plugins" 与旧默认一致） */
export function useEntry(): Entry {
  return useOverlayEntry() ?? "plugins";
}

/** 设置浮层内用的关闭（✕ / Esc） */
export { closeSettings };

/** 行级直达用的稳定 id：`row-<slug>`（对设置行）/ `sec-<slug>`（对分节）。 */
export function slugOf(text: string): string {
  const t = text.trim().replace(/\s+/g, "-").replace(/[「」（）()·:：,，.。/]/g, "").slice(0, 24);
  return t || "item";
}

/** 给当前 DOM 里的设置行/分节打 id（幂等；路由变化时重跑）。
 *  设置行文字 = 标题 + 说明（搜索按这两个字段匹配，所以 id 也从标题出）。 */
export function markSettingsRows(): void {
  const heads = Array.from(document.querySelectorAll<HTMLElement>(".section-head"));
  heads.forEach((h) => {
    const t = (h.textContent ?? "").trim();
    if (t && !h.dataset.setId) h.dataset.setId = "sec-" + slugOf(t);
  });
  const rows = Array.from(document.querySelectorAll<HTMLElement>(".setting-row"));
  rows.forEach((r) => {
    if (r.dataset.setId) return;
    const title = (r.querySelector(".setting-title")?.textContent ?? "").trim();
    if (title) r.dataset.setId = "row-" + slugOf(title);
  });
}

/** 滚动并高亮某个设置行 / 分节（复用既有请求机制；`.sec-focus` 的分节版已在 Settings.tsx）。
 *  解析顺序 = 行/分节的稳定 id → 行文本 → **动作按钮文本**。 */
export function focusSettingsTarget(target: string): boolean {
  const want = target.trim();
  const byId = document.querySelector<HTMLElement>(`[data-set-id="row-${slugOf(want)}"],[data-set-id="sec-${slugOf(want)}"]`);
  let hit = byId ?? Array.from(document.querySelectorAll<HTMLElement>(".setting-row,.section-head"))
    .find((el) => (el.textContent ?? "").includes(want));
  if (!hit) {
    const btn = Array.from(document.querySelectorAll<HTMLElement>(".explorer-settings-body .btn, .explorer-settings-body button"))
      .find((el) => {
        const t = (el.textContent ?? "").trim();
        if (!t || !el.offsetParent || el.classList.contains("plg-danger")) return false;
        return t === want || t.replace(/\s+/g, "") === want.replace(/\s+/g, "");
      });
    if (btn) hit = btn;
  }
  if (!hit) return false;
  hit.scrollIntoView({ block: "center", behavior: "smooth" });
  hit.classList.add("row-focus");
  window.setTimeout(() => hit?.classList.remove("row-focus"), 1800);
  return true;
}

/** 窄栏判定（**容器实际宽度**驱动）：< threshold 就降级，避免文字挤成竖排糊字。
 *  用 ResizeObserver 实测被包裹容器的宽度；无法测量时按"宽"处理（不误伤大屏）。 */
export function useNarrowBox(threshold = 300): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth > 0 && el.clientWidth < threshold));
    ro.observe(el);
    setNarrow(el.clientWidth > 0 && el.clientWidth < threshold);
    return () => ro.disconnect();
  }, [threshold]);
  return [ref, narrow];
}

/** 1.5 级入口框：设置 | 插件 | OneTHU Harness —— 现挂在设置浮层内部做快速换段。
 *  手机与桌面同款（LevelBox 原样保留，goEntry 直接换浮层段）。 */
export function LevelBox(): ReactNode {
  const entry = useEntry(); // 高亮**唯一来源**
  const [boxRef, narrow] = useNarrowBox(300);
  /* 窄栏：只渲染图标（title/aria-label 承载全名），**禁止文字换行**；宽栏：文字完整不截断 */
  const cells: Array<{ id: Entry; label: string; icon: ReactNode }> = [
    { id: "settings", label: "设置", icon: <IconSettings /> },
    { id: "plugins", label: "插件", icon: <IconPlug /> },
    { id: "oh", label: "OneTHU Harness", icon: <HarnessMark size={13} /> },
  ];
  const cell = (c: { id: Entry; label: string; icon: ReactNode }): ReactNode => (
    <button
      className={"nav-item" + (entry === c.id ? " is-active" : "")}
      title={c.label}
      aria-label={c.label}
      style={{
        flex: narrow ? "1 1 0" : c.id === "oh" ? "1.5 1 0" : "1 1 0",
        minWidth: 0,
        height: 26,
        justifyContent: "center",
        padding: 0,
        fontSize: narrow ? undefined : "var(--text-xs)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "clip",
      }}
      onClick={() => goEntry(c.id)}
    >
      {narrow ? c.icon : c.label}
    </button>
  );
  return (
    <div
      ref={boxRef}
      style={{
        display: "flex", alignItems: "center", gap: 2, padding: 2, marginBottom: 12,
        border: "1px solid var(--border)", borderRadius: "var(--md-sys-shape-corner-large, 12px)",
        background: "var(--md-sys-color-surface-container-lowest)",
      }}
    >
      {cells.map((c) => cell(c))}
    </div>
  );
}

export function SectionHead({
  title,
  aside,
}: {
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {aside ? <span className="section-aside">{aside}</span> : null}
    </div>
  );
}

export function Card({
  className = "",
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={`card ${className}`} style={style}>
      {children}
    </div>
  );
}

/* 空状态：text 必填，icon/hint/action 可选（B5b）。
   旧调用 <Empty text="..." /> 一字不改仍然成立；需要更完整的空状态时再加图标与副文案。 */
export function Empty({
  text,
  icon,
  hint,
  action,
}: {
  text: string;
  icon?: ReactNode;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon ? <div className="empty-icon" aria-hidden="true">{icon}</div> : null}
      <div className="empty-title">{text}</div>
      {hint ? <div className="empty-hint">{hint}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function ErrorNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="error-note">
      <ErrorLine text={text} />
      {onRetry ? (
        <button className="btn btn-ghost" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <Card>
      {Array.from({ length: rows }, (_, i) => (
        <div className="row" key={i} style={{ animation: "none" }}>
          <div className="skeleton" style={{ width: 64, height: 32 }} />
          <div className="row-main">
            <div className="skeleton" style={{ width: "55%", height: 13 }} />
            <div className="skeleton" style={{ width: "30%", height: 10, marginTop: 7 }} />
          </div>
        </div>
      ))}
    </Card>
  );
}

export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={"switch" + (on ? " on" : "")}
      onClick={() => onChange(!on)}
    />
  );
}

/* 保留未用引用防 tree-shake 误报：这些图标被 NAV 数据表引用 */
void IconFolder; void IconFolderPlus; void IconInfo; void IconLearn; void IconPen; void IconPlug; void IconSchedule; void IconStar; void IconToday; void IconXk; void IconCard; void IconCalendar; void FolderIcon; void IconExternal; void IconThos; void IconTrace; void IconMail; void IconCloud; void IconBook; void topLevelPage; void NAV_REGISTRY; void IconChevron;
