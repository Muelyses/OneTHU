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
import { NAV } from "../components/Layout.js";

/** 一级页条目（Layout 的 NAV 数组元素形状：page + label + icon，纯页面无参数） */
export type SphereNavEntry = (typeof NAV)[number];

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
  const known = new Set<string>(NAV.map((n) => n.page as string));
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
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    /* 存储满：纯偏好，静默 */
  }
  listeners.forEach((f) => f());
}

export function spheresSnapshot(): SpheresDoc {
  return currentDoc();
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

/** 按 id 找 NAV 行 */
export function sphereEntry(id: string): SphereNavEntry | null {
  return NAV.find((n) => n.page === id) ?? null;
}

/** 全部一级页（更多功能小窗的数据源，保持 NAV 顺序） */
export function allSphereEntries(): SphereNavEntry[] {
  return NAV;
}
