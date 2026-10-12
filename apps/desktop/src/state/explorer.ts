/**
 * Explorer（工作空间革命 · dev-explorer）核心状态机：标签页 / 工作区 / 设置浮层。
 *
 * 交互模型（2026-10-12 提案 + 用户四点补充）：
 * - 首页是特殊标签页：默认进入、不可删除、不可多开（id 恒为 "home"）；
 * - 其余每个标签页 = 一个独立工作实例（同页可多开，各自保留导航参数）；
 * - navigate() 的语义升级：在页内标签中 = 当前标签页内导航；在首页 = 开新标签页；
 *   settings / plugins 永远不是标签页 —— 走「设置浮层」（高于任何标签页）；
 * - OneGO 工作区 = 一组标签页快照，可一键恢复；
 * - 整个标签列表 + 活动页 + 工作区持久化（localStorage），启动恢复。
 *
 * 实现约束：
 * - 模块级 store（与 palette.ts 同一写法），不依赖 React Provider；
 * - 对 app.tsx 只暴露纯函数；hash 由本模块统一写（外部深链进来 = 开新标签页）；
 * - 本模块只在事件回调里跨模块调用（无模块初始化期跨界调用），允许与 app.tsx 互相 import。
 */
import { useSyncExternalStore } from "react";
import type { LearnNav, Page } from "./app.js";
import { topLevelPage } from "./app.js";
import { NAV_REGISTRY } from "./navigation.js";

/* ══════════ 类型 ══════════ */

/** 标签页：一个独立工作实例。home 是恒存在的特殊页。 */
export interface ExplorerTab {
  id: string;
  kind: "home" | "page";
  /** kind=page 时有效；home 恒为 "today"（首页内容即今日页，组织模式原样移植） */
  page: Page;
  params: LearnNav | null;
  /** 打开时定下的静态标题（组件侧可按 favs 等数据 refine 显示名） */
  title: string;
  createdAt: number;
  lastActiveAt: number;
}

/** OneGO 工作区：一组标签页的快照（可一键恢复） */
export interface ExplorerWorkspace {
  id: string;
  name: string;
  createdAt: number;
  tabs: Array<{ page: Page; params: LearnNav | null; title: string }>;
}

/** 设置浮层入口（高于任何标签页；Entry 语义与旧 Layout 一致） */
export type OverlayEntry = "settings" | "plugins" | "oh";

interface ExplorerState {
  /** 不含 home（home 隐式恒在，渲染时拼在最前） */
  tabs: ExplorerTab[];
  activeId: string; // "home" 或某 tab id
  workspaces: ExplorerWorkspace[];
}

/* ══════════ 常量 ══════════ */

export const HOME_TAB_ID = "home";
const STORE_KEY = "onethu.explorer.v2";
const MAX_TABS = 30;
/** 设置/插件不是标签页（用户 2026-10-12 拍板：高于任何标签页） */
const OVERLAY_PAGES: ReadonlySet<string> = new Set(["settings", "plugins"]);

/* ══════════ 模块级 store ══════════ */

let state: ExplorerState = loadStore();
const listeners = new Set<() => void>();

function loadStore(): ExplorerState {
  const fallback: ExplorerState = { tabs: [], activeId: HOME_TAB_ID, workspaces: [] };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<ExplorerState>;
    const tabs = Array.isArray(p.tabs)
      ? p.tabs
          .filter((t): t is ExplorerTab => !!t && typeof t.id === "string" && typeof t.page === "string" && t.kind === "page")
          .slice(0, MAX_TABS)
      : [];
    return {
      tabs,
      activeId: typeof p.activeId === "string" ? p.activeId : HOME_TAB_ID,
      workspaces: Array.isArray(p.workspaces) ? p.workspaces.slice(0, 50) : [],
    };
  } catch {
    return fallback;
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ tabs: state.tabs, activeId: state.activeId, workspaces: state.workspaces }));
  } catch {
    /* 隐私模式/配额：丢持久化不影响本会话 */
  }
}

function emit(): void {
  for (const f of listeners) f();
}

function setState(next: ExplorerState): void {
  state = next;
  persist();
  emit();
}

export function subscribeExplorer(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export function explorerSnapshot(): ExplorerState {
  return state;
}

/* ══════════ 查询 ══════════ */

/** 首页标签页（模块级单例：getSnapshot 必须返回稳定引用，否则 useSyncExternalStore 死循环） */
const HOME_TAB: ExplorerTab = { id: HOME_TAB_ID, kind: "home", page: "today", params: null, title: "首页", createdAt: 0, lastActiveAt: 0 };

/** 全部标签页（home 恒在最前；home 是稳定单例，数组本身仅供渲染期使用） */
export function allTabs(): ExplorerTab[] {
  return [HOME_TAB, ...state.tabs];
}

export function getTab(id: string): ExplorerTab | null {
  if (id === HOME_TAB_ID) return HOME_TAB;
  return state.tabs.find((t) => t.id === id) ?? null;
}

export function activeTab(): ExplorerTab {
  return getTab(state.activeId) ?? HOME_TAB; // 恒有 home（单例），不会为空
}

export function activeTabId(): string {
  return getTab(state.activeId) ? state.activeId : HOME_TAB_ID;
}

/* ══════════ 标题（静态推导；组件侧可 refine） ══════════ */

const PAGE_TITLES: Partial<Record<Page, string>> = {
  "learn-course": "课程详情",
  "learn-assignments": "全部作业",
  "learn-notices": "全部通知",
  "learn-files": "全部文件",
  "learn-search": "全局搜索",
  "learn-semester": "学期切换",
  "learn-assignment-detail": "作业详情",
  "learn-notice-detail": "通知详情",
  "learn-forum-thread": "讨论区",
  "learn-file-detail": "文件详情",
  "learn-ykt-detail": "雨课堂作业",
  folder: "收藏夹",
  tasks: "待办",
  services: "服务",
  favs: "收藏",
};

/** 聚合页栏目的中文短名（tab 可深链到具体栏目：信息-新闻，但主题仍是信息） */
const TAB_SUFFIX: Record<string, Record<string, string>> = {
  info: { report: "成绩", fitness: "体测", exams: "考试", evaluation: "教评", calendar: "日历", news: "新闻", profile: "个人信息", courseinfo: "课程信息" },
  life: { dorm: "宿舍", washer: "洗衣机", hygiene: "卫生", card: "校园卡", invoice: "票据", payroll: "工资", gradincome: "毕业生收入", network: "网络" },
  reserve: { lib: "图书馆", libroom: "研讨间", classroom: "空教室", sports: "体育", kongjian: "公共空间" },
};

export function titleOf(page: Page, params?: LearnNav | null, fallback?: string): string {
  if (fallback) return fallback;
  const reg = NAV_REGISTRY.find((e) => e.page === page);
  const base = reg?.name ?? PAGE_TITLES[page] ?? "页面";
  const suffixes = TAB_SUFFIX[page];
  if (suffixes) {
    const key = page === "info" ? params?.infoTab : page === "life" ? params?.lifeTab : params?.reserveTab;
    if (key && suffixes[key]) return base + " · " + suffixes[key];
  }
  if (page === "folder" && params?.folderId) return base;
  return base;
}

/* ══════════ hash（由本模块统一写；外部深链 = 开新标签页） ══════════ */

/** 本模块自己写入的 hash：hashchange 事件对账后消费，防旧事件误开标签页 */
const ownHashes = new Set<string>();

function writeHashFor(tab: ExplorerTab): void {
  const h = tab.kind === "home" ? "#/today" : tab.page === "folder" && tab.params?.folderId ? `#/folder/${tab.params.folderId}` : `#/${topLevelPage(tab.page)}`;
  if (location.hash === h) return;
  ownHashes.add(h);
  if (ownHashes.size > 8) {
    const first = ownHashes.values().next().value;
    if (first) ownHashes.delete(first);
  }
  location.hash = h;
}

/** AppProvider 挂载时注册一次：处理浏览器前进/后退与外部深链 */
export function initExplorerHashBridge(): () => void {
  const onHash = (ev: HashChangeEvent): void => {
    const target = (() => {
      try {
        return new URL(ev.newURL).hash;
      } catch {
        return location.hash;
      }
    })();
    if (ownHashes.has(target)) {
      ownHashes.delete(target);
      return;
    }
    // 外部深链（书签/插件/恢复的 hash）：开成独立标签页
    const m = /^#\/folder\/(f_[A-Za-z0-9_]+)$/.exec(target);
    if (m) {
      openTab("folder", { folderId: m[1] });
      return;
    }
    const h = target.replace(/^#\/?/, "");
    const known = (["today", "learn", "schedule", "trace", "mail", "cloud", "thubook", "info", "life", "reserve", "zhjwxk", "thos", "otherinfo", "folder", "tasks", "services", "favs"] as const).includes(h as never);
    if (h && known) openTab(h as Page);
  };
  addEventListener("hashchange", onHash);
  return () => removeEventListener("hashchange", onHash);
}

/** 启动深链：hash 里带着非首页目标时补开一个标签页（只该在 AppProvider 挂载时调一次） */
export function openTabFromBootHash(): void {
  const m = /^#\/folder\/(f_[A-Za-z0-9_]+)$/.exec(location.hash);
  if (m) {
    openTab("folder", { folderId: m[1] });
    return;
  }
  const h = location.hash.replace(/^#\/?/, "");
  if (!h || h === "today") return;
  const known = (["learn", "schedule", "trace", "mail", "cloud", "thubook", "info", "life", "reserve", "zhjwxk", "thos", "otherinfo", "folder", "tasks", "services", "favs"] as const).includes(h as never);
  if (known) openTab(h as Page);
}

/* ══════════ 标签页操作 ══════════ */

/** 本机使用统计（今日页「最近使用」的数据源；旧 navigate 的行为，这里找回来了） */
function recordUse(page: Page, params: LearnNav | null): void {
  void import("./atoms.js")
    .then((m) => m.recordPageAtomUse(page, params))
    .catch(() => undefined);
}

let seq = 0;
function newTabId(): string {
  seq += 1;
  return `t_${Date.now().toString(36)}_${seq.toString(36)}`;
}

/** 同一工作实例判定（工作区恢复/聚焦已有用）：page + 关键 params 相同 */
function sameInstance(a: { page: Page; params: LearnNav | null }, b: { page: Page; params: LearnNav | null }): boolean {
  if (a.page !== b.page) return false;
  const ka = a.params?.folderId ?? a.params?.courseId ?? "";
  const kb = b.params?.folderId ?? b.params?.courseId ?? "";
  return ka === kb;
}

/**
 * 打开新标签页（入口级导航：首页目录/快捷入口/OneGO/搜索/悬浮球都用它）。
 * - page="today" → 聚焦首页（首页不可多开）；
 * - 工作区恢复用 dedupe=true（同实例聚焦不重建）；目录/搜索默认恒开新实例。
 */
export function openTab(page: Page, params?: LearnNav | null, opts?: { title?: string; dedupe?: boolean; activate?: boolean }): string {
  if (page === "today") {
    focusTab(HOME_TAB_ID);
    return HOME_TAB_ID;
  }
  if (OVERLAY_PAGES.has(page)) {
    openSettings(page === "settings" ? "settings" : "plugins");
    return "";
  }
  const dedupe = opts?.dedupe === true;
  if (dedupe) {
    const hit = state.tabs.find((t) => sameInstance(t, { page, params: params ?? null }));
    if (hit) {
      focusTab(hit.id);
      return hit.id;
    }
  }
  const tab: ExplorerTab = {
    id: newTabId(),
    kind: "page",
    page,
    params: params ?? null,
    title: titleOf(page, params, opts?.title),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  const tabs = [...state.tabs, tab].slice(-MAX_TABS);
  setState({ ...state, tabs, activeId: opts?.activate === false ? state.activeId : tab.id });
  writeHashFor(tab);
  recordUse(page, tab.params);
  return tab.id;
}

export function focusTab(id: string): void {
  const tab = getTab(id);
  if (!tab) return;
  if (state.activeId === id) {
    writeHashFor(tab); // hash 可能被外部改过，对齐
    return;
  }
  const tabs = state.tabs.map((t) => (t.id === id ? { ...t, lastActiveAt: Date.now() } : t));
  setState({ ...state, tabs, activeId: id });
  writeHashFor(tab);
}

export function closeTab(id: string): void {
  if (id === HOME_TAB_ID) return; // 首页不可关
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const tabs = state.tabs.filter((t) => t.id !== id);
  let activeId = state.activeId;
  if (activeId === id) {
    // 关掉活动页 → 优先右侧，否则左侧，否则首页
    activeId = tabs[idx]?.id ?? tabs[idx - 1]?.id ?? HOME_TAB_ID;
  }
  setState({ ...state, tabs, activeId });
  const at = getTab(activeId);
  if (at) writeHashFor(at);
}

/** 关闭其他（首页除外） */
export function closeOtherTabs(keepId: string): void {
  const keep = getTab(keepId);
  if (!keep) return;
  const tabs = state.tabs.filter((t) => t.id === keepId);
  setState({ ...state, tabs, activeId: keepId });
  writeHashFor(keep);
}

/** 标签页内导航（更新 page/params，标签身份不变——工作上下文保留） */
export function navigateInTab(id: string, page: Page, params?: LearnNav | null, title?: string): void {
  const tab = getTab(id);
  if (!tab || tab.kind === "home") return;
  const tabs = state.tabs.map((t) => (t.id === id ? { ...t, page, params: params ?? null, title: titleOf(page, params, title), lastActiveAt: Date.now() } : t));
  const next = tabs.find((t) => t.id === id) ?? tab;
  setState({ ...state, tabs });
  if (state.activeId === id) writeHashFor(next);
}

/** 标签页重排序（TabStrip 长按/抽屉 ↑↓） */
export function moveTab(id: string, dir: -1 | 1): void {
  const i = state.tabs.findIndex((t) => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.tabs.length) return;
  const tabs = [...state.tabs];
  [tabs[i], tabs[j]] = [tabs[j]!, tabs[i]!];
  setState({ ...state, tabs });
}

/* ══════════ 应用级 navigate（app.tsx 的 navigate 实现转发到这里） ══════════ */

/**
 * navigate(page, params) 的新语义：
 * - settings/plugins → 设置浮层（不是标签页）；
 * - 当前活动标签是首页（或无活动页标签）→ 开新标签页；
 * - 其余 → 当前标签页内导航（工作上下文保留）。
 * 数百个既有调用点零改动。
 */
export function explorerNavigate(page: Page, params?: LearnNav | null): void {
  if (OVERLAY_PAGES.has(page)) {
    openSettings(page === "settings" ? "settings" : "plugins");
    return;
  }
  const t = activeTab();
  if (t.kind === "home") {
    openTab(page, params);
    return;
  }
  navigateInTab(t.id, page, params);
  recordUse(page, params ?? null);
}

/* ══════════ OneGO 工作区 ══════════ */

export function saveWorkspace(name: string, tabIds?: string[]): string {
  const source = (tabIds ? state.tabs.filter((t) => tabIds.includes(t.id)) : state.tabs).filter((t) => t.kind === "page");
  const ws: ExplorerWorkspace = {
    id: `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || "工作区",
    createdAt: Date.now(),
    tabs: source.map((t) => ({ page: t.page, params: t.params, title: t.title })),
  };
  if (ws.tabs.length === 0) return "";
  setState({ ...state, workspaces: [ws, ...state.workspaces].slice(0, 50) });
  return ws.id;
}

/** 一键恢复：同实例聚焦、缺的补开，最后聚焦工作区最后一项 */
export function openWorkspace(id: string): void {
  const ws = state.workspaces.find((w) => w.id === id);
  if (!ws) return;
  let last = "";
  for (const entry of ws.tabs) {
    last = openTab(entry.page, entry.params, { title: entry.title, dedupe: true, activate: false }) || last;
  }
  if (last) focusTab(last);
}

export function deleteWorkspace(id: string): void {
  setState({ ...state, workspaces: state.workspaces.filter((w) => w.id !== id) });
}

export function renameWorkspace(id: string, name: string): void {
  const n = name.trim();
  if (!n) return;
  setState({ ...state, workspaces: state.workspaces.map((w) => (w.id === id ? { ...w, name: n } : w)) });
}

/* ══════════ 设置浮层（高于任何标签页） ══════════ */

let overlayEntry: OverlayEntry | null = null;
const overlayListeners = new Set<() => void>();

function emitOverlay(): void {
  for (const f of overlayListeners) f();
}

/** 打开设置浮层：entry = 个人设置 / 插件 / OneTHU Harness（三段同一浮层内切换） */
export function openSettings(entry: OverlayEntry = "settings"): void {
  overlayEntry = entry;
  emitOverlay();
}

export function closeSettings(): void {
  if (overlayEntry !== null) {
    overlayEntry = null;
    emitOverlay();
  }
}

export function overlaySnapshot(): OverlayEntry | null {
  return overlayEntry;
}

export function subscribeOverlay(f: () => void): () => void {
  overlayListeners.add(f);
  return () => {
    overlayListeners.delete(f);
  };
}

/* ══════════ React 钩子（组件侧订阅入口） ══════════ */

/** 订阅整个 explorer 状态（tabs+activeId+workspaces；TabHost/TabStrip/抽屉共用一份订阅） */
export function useExplorerState(): ExplorerState {
  return useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
}

/** 设置浮层入口态（null=关闭）；Entry 兼容别名见 components/Layout.tsx 的 useEntry */
export function useOverlayEntry(): OverlayEntry | null {
  return useSyncExternalStore(subscribeOverlay, overlaySnapshot, () => null);
}
