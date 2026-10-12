/**
 * Explorer 偏好（dev-explorer）：OH 胶囊条默认动作 + 搜索跳转记录。
 *
 * 用户 2026-10-12 拍板：
 * - 胶囊条 = 搜索与 OH 二合一：点击/长按语音；「点击默认打开什么」「长按语音发到哪」
 *   都是可设置的默认值（search | oh），也能在弹出小窗里临时切换；
 * - 搜索保留最近 10 条「搜索跳转记录」（跨入口共享：胶囊小窗、悬浮球、⌘K）。
 */
import { useSyncExternalStore } from "react";
import type { LearnNav, Page } from "./app.js";

/* ══════════ 胶囊默认动作 ══════════ */

export type CapsuleDefault = "search" | "oh";
const PREFS_KEY = "onethu.explorer.prefs.v1";

export interface ExplorerPrefs {
  /** 点击胶囊默认打开：search=搜索模式 / oh=OH 对话 */
  capsuleTap: CapsuleDefault;
  /** 长按语音识别完成后默认发送到：search / oh */
  voiceTarget: CapsuleDefault;
}

const DEFAULT_PREFS: ExplorerPrefs = { capsuleTap: "search", voiceTarget: "oh" };

let prefs: ExplorerPrefs = loadPrefs();
const prefsListeners = new Set<() => void>();

function loadPrefs(): ExplorerPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const p = JSON.parse(raw) as Partial<ExplorerPrefs>;
    return {
      capsuleTap: p.capsuleTap === "oh" ? "oh" : "search",
      voiceTarget: p.voiceTarget === "search" ? "search" : "oh",
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function emitPrefs(): void {
  for (const f of prefsListeners) f();
}

export function setExplorerPrefs(patch: Partial<ExplorerPrefs>): void {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* 忽略持久化失败 */
  }
  emitPrefs();
}

export function explorerPrefsSnapshot(): ExplorerPrefs {
  return prefs;
}

export function subscribeExplorerPrefs(f: () => void): () => void {
  prefsListeners.add(f);
  return () => {
    prefsListeners.delete(f);
  };
}

export function useExplorerPrefs(): ExplorerPrefs {
  return useSyncExternalStore(subscribeExplorerPrefs, explorerPrefsSnapshot, () => DEFAULT_PREFS);
}

// 跨窗口同步（悬浮球=独立 webview）：另一窗口写了偏好 → 本窗口跟随
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === PREFS_KEY) {
      prefs = loadPrefs();
      emitPrefs();
    }
  });
}

/* ══════════ 搜索跳转记录（最近 10 条，去重按 query+page+folderId/courseId） ══════════ */

const HIST_KEY = "onethu.explorer.searchhist.v1";
const HIST_MAX = 10;

export interface SearchJump {
  query: string;
  /** 命中目标：page + params（实体深链原样保留） */
  page: Page;
  params: LearnNav | null;
  title: string;
  at: number;
}

let history: SearchJump[] = loadHistory();
const histListeners = new Set<() => void>();

function loadHistory(): SearchJump[] {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.filter((x): x is SearchJump => !!x && typeof x.query === "string" && typeof x.page === "string").slice(0, HIST_MAX) : [];
  } catch {
    return [];
  }
}

function emitHist(): void {
  for (const f of histListeners) f();
}

function jumpKey(j: Pick<SearchJump, "query" | "page" | "params">): string {
  return `${j.query}\u0000${j.page}\u0000${j.params?.folderId ?? j.params?.courseId ?? j.params?.itemId ?? ""}`;
}

/** 记录一次搜索跳转（点命中/点记录时调用；同目标提到最前） */
export function recordSearchJump(j: Omit<SearchJump, "at">): void {
  const k = jumpKey(j);
  history = [{ ...j, at: Date.now() }, ...history.filter((x) => jumpKey(x) !== k)].slice(0, HIST_MAX);
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(history));
  } catch {
    /* 忽略 */
  }
  emitHist();
}

export function clearSearchHistory(): void {
  history = [];
  try {
    localStorage.removeItem(HIST_KEY);
  } catch {
    /* 忽略 */
  }
  emitHist();
}

export function searchHistorySnapshot(): SearchJump[] {
  return history;
}

export function subscribeSearchHistory(f: () => void): () => void {
  histListeners.add(f);
  return () => {
    histListeners.delete(f);
  };
}

export function useSearchHistory(): SearchJump[] {
  return useSyncExternalStore(subscribeSearchHistory, searchHistorySnapshot, () => [] as SearchJump[]);
}

// 跨窗口同步：另一窗口记录/清空了搜索历史 → 本窗口跟随
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === HIST_KEY) {
      history = loadHistory();
      emitHist();
    }
  });
}
