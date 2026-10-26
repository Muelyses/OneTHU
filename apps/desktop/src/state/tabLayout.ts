/**
 * 标签栏布局：横版（顶部一排）/ 竖版（左侧栏）。
 * - 当前布局：标签栏按钮/TabDrawer 可随时切换，**立即落盘**（用户习惯，下次启动沿用）；
 * - 默认布局：设置 → 外观与布局 里定；设置默认值时同时把当前布局切过去并落盘。
 */
import { useSyncExternalStore } from "react";
import { isPhoneNow } from "./phoneSheets.js";

export type TabLayoutMode = "h" | "v";
const DEFAULT_KEY = "explorer.tabLayout.default";
const CURRENT_KEY = "explorer.tabLayout.current";

const listeners = new Set<() => void>();
function emit(): void {
  for (const f of listeners) f();
}

function readDefault(): TabLayoutMode {
  try {
    return localStorage.getItem(DEFAULT_KEY) === "v" ? "v" : "h";
  } catch {
    return "h";
  }
}

function readCurrent(): TabLayoutMode | null {
  try {
    const v = localStorage.getItem(CURRENT_KEY);
    return v === "v" || v === "h" ? v : null;
  } catch {
    return null;
  }
}
let defaultMode: TabLayoutMode = readDefault();
let mode: TabLayoutMode = readCurrent() ?? defaultMode;

/** 当前布局 = 用户习惯，切一次就记住（手机端仍由 getTabLayoutMode 强制横版，不覆盖存储）。 */
function persistCurrent(m: TabLayoutMode): void {
  try {
    localStorage.setItem(CURRENT_KEY, m);
  } catch {
    /* 存储不可用：仅本次会话生效 */
  }
}

export function getTabLayoutMode(): TabLayoutMode {
  /* 手机端拍板（dev-explorer 二轮）：手机只能是横标签页——存过的「竖版」默认值在手机上
     一律读作横版（TabRail 不渲染、TabStrip 横排），桌面读取不变。 */
  if (isPhoneNow()) return "h";
  return mode;
}
export function getTabLayoutDefault(): TabLayoutMode {
  return defaultMode;
}
export function toggleTabLayoutMode(): void {
  mode = mode === "h" ? "v" : "h";
  persistCurrent(mode);
  emit();
}
/** 只切当前布局（不改默认值）：标签页抽屉里的分段切换用 */
export function setTabLayoutMode(m: TabLayoutMode): void {
  if (mode === m) return;
  mode = m;
  persistCurrent(mode);
  emit();
}
export function setTabLayoutDefault(m: TabLayoutMode): void {
  defaultMode = m;
  mode = m;
  try {
    localStorage.setItem(DEFAULT_KEY, m);
  } catch {
    /* 存储不可用：仅本次会话生效 */
  }
  persistCurrent(m);
  emit();
}
export function subscribeTabLayout(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
export function useTabLayoutMode(): TabLayoutMode {
  return useSyncExternalStore(subscribeTabLayout, getTabLayoutMode, getTabLayoutMode);
}
export function useTabLayoutDefault(): TabLayoutMode {
  return useSyncExternalStore(subscribeTabLayout, getTabLayoutDefault, getTabLayoutDefault);
}
