/**
 * 首页固定层状态（2026-10-13 定稿）。
 *
 * 首页 = 白板画布（自由组件）+ 一层**固定 chrome**：
 *   ① 居中大时间（时钟 + 日期行）；
 *   ② 时间下铺展的一级功能区（圆球 + 「更多功能」「详细功能」两个按钮）。
 * 两块都不可移动、不可删除，但各自可调不透明度（透明了以后能透出下面的自由组件）。
 *
 * 持久化只存「哪些球停靠、什么顺序 + 两块的不透明度」；球的图标/名字永远是
 * NAV 注册表的事实，这里不复制。旧的 loose（拖出球）随自由画布退役，字段不再写。
 */
import { createElement } from "react";
import { NAV } from "../components/Layout.js";
import { pluginTabsSnapshot, subscribePluginTabs } from "../plugins/tabs.js";

/** 一级页条目（Layout 的 NAV 数组元素形状：page + label + icon，纯页面无参数） */
export type SphereNavEntry = (typeof NAV)[number];

/**
 * 插件功能页 → 一颗球（2026-10-15 用户点名「插件创建的页面也要出现在首页一级程序坞」）。
 *
 * 插件经 `ctx.registerTab({id,title,iconSvg})` 注册的页面（pageKey = `plugin:<插件>:<页>`）
 * 以前只有一个宿主入口：服务页的「插件功能页」分组。现在让它们与 NAV 一级页**同权**：
 * 出现在「更多功能」小窗里可停靠、可取消停靠，停靠后就长在首页程序坞上。
 * 字段与 NAV 球同构（page/label/icon），`page` 直接吃 `plugin:${string}`（Page 联合里已有）。
 */
function pluginEntries(): SphereNavEntry[] {
  return pluginTabsSnapshot().map((t) => ({
    page: t.pageKey as SphereNavEntry["page"],
    label: t.title,
    /* 插件给的是 inline SVG 字符串：套一层 .plg-svg-icon（该类的 svg 规则是 100%×100%），
       并把 width/height 强制成球要的尺寸 —— 插件 SVG 若没写尺寸，SVG 默认 300×150 会把球撑爆。 */
    icon: ({ width = 16, height = 16 }: { width?: number; height?: number } = {}) =>
      createElement("span", {
        className: "plg-svg-icon",
        dangerouslySetInnerHTML: { __html: sizedPluginSvg(t.iconSvg, width, height) },
      }),
  }));
}

/** 缺省拼图占位（与 Layout 的插件条目同款）+ 强制尺寸 */
function sizedPluginSvg(svg: string | undefined, w: number, h: number): string {
  const raw =
    (svg ?? "").trim() ||
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 2.5 4.2 6l-2.4 4.5L6 13.5l3-2 3 2 2.2-3-2.4-4.5L10 2.5l-4 0z"/></svg>';
  return raw.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    const cleaned = attrs.replace(/\s(width|height)\s*=\s*"[^"]*"/g, "");
    return `<svg${cleaned} width="${w}" height="${h}">`;
  });
}

export interface SpheresDoc {
  v: 1;
  /** 功能区停靠的球（NAV page id，顺序即展示顺序） */
  docked: string[];
  /** ①大时间 的不透明度 0.15..1 */
  timeOpacity: number;
  /** ②功能区 的不透明度 0.15..1 */
  dockOpacity: number;
}

const KEY = "onethu.home.spheres.v2";

const clampOp = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0.15, n)) : 1;

function defaultDoc(): SpheresDoc {
  return {
    v: 1,
    docked: NAV.slice(0, 8).map((n) => n.page),
    timeOpacity: 1,
    dockOpacity: 1,
  };
}

function sanitize(raw: unknown): SpheresDoc {
  const base = defaultDoc();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<SpheresDoc>;
  /* 已知球 = NAV 一级页 ∪ 插件功能页（插件页 pageKey 是 `plugin:…`；不放进白名单，
     插件页的停靠会在下次读取时被 sanitize 吃掉 —— 这正是"插件页进不了程序坞"的一环） */
  const known = new Set<string>([...NAV.map((n) => n.page as string), ...pluginTabsSnapshot().map((t) => t.pageKey)]);
  const docked = Array.isArray(r.docked)
    ? (r.docked.filter((x): x is string => typeof x === "string" && known.has(x)))
    : base.docked;
  /* 旧 v1 文档里 docked 存的是 page|params 组合键；NAV 一级页无参数，取 | 前段即页 id */
  const norm = docked.map((x) => (x.includes("|") ? x.slice(0, x.indexOf("|")) : x));
  return {
    v: 1,
    docked: norm.length > 0 ? Array.from(new Set(norm)) : base.docked,
    timeOpacity: clampOp(r.timeOpacity),
    dockOpacity: clampOp(r.dockOpacity),
  };
}

function load(): SpheresDoc {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem("onethu.home.spheres.v1");
    if (raw) return sanitize(JSON.parse(raw));
  } catch {
    /* 脏数据当没有 */
  }
  return defaultDoc();
}

/* Layout imports HomeChrome, while HomeChrome consumes this store and Layout.NAV.
   Initialize lazily so the shared NAV binding is first read after the module cycle settles. */
let doc: SpheresDoc | null = null;
const listeners = new Set<() => void>();

function currentDoc(): SpheresDoc {
  return (doc ??= load());
}

function commit(next: SpheresDoc): void {
  doc = next;
  pubCache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    /* 存储满：纯偏好，静默 */
  }
  listeners.forEach((f) => f());
}

/* 对外快照：useSyncExternalStore 用 Object.is 比对，内容没变也知道不了"插件页多/少了一颗球"，
   所以插件 tab 增删时换一个新引用（内容相同）+ 通知订阅者，坞才会重渲染出/收掉那颗球。 */
let pubCache: SpheresDoc | null = null;

subscribePluginTabs(() => {
  pubCache = { ...currentDoc() };
  listeners.forEach((f) => f());
});

export function spheresSnapshot(): SpheresDoc {
  return (pubCache ??= currentDoc());
}

export function subscribeSpheres(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** 停靠 / 移除一颗球（更多功能小窗的 × / ＋） */
export function dockSphere(pageId: string): void {
  const state = currentDoc();
  if (state.docked.includes(pageId)) return;
  commit({ ...state, docked: [...state.docked, pageId] });
}

export function undockSphere(pageId: string): void {
  const state = currentDoc();
  commit({ ...state, docked: state.docked.filter((x) => x !== pageId) });
}

/** 两块固定区各自的不透明度 */
export function setTimeOpacity(v: number): void {
  commit({ ...currentDoc(), timeOpacity: clampOp(v) });
}

export function setDockOpacity(v: number): void {
  commit({ ...currentDoc(), dockOpacity: clampOp(v) });
}

/** 按 id 找球：先查 NAV 一级页，再查插件功能页 */
export function sphereEntry(id: string): SphereNavEntry | null {
  return NAV.find((n) => n.page === id) ?? pluginEntries().find((n) => n.page === id) ?? null;
}

/** 全部可停靠的球（更多功能小窗的数据源）：NAV 一级页在前，插件功能页在后 */
export function allSphereEntries(): SphereNavEntry[] {
  return [...NAV, ...pluginEntries()];
}

/* 几何复测触发点（2026-10-15，取证后删）：本文件一改会触发整页 reload，便于探针重跑。 */
