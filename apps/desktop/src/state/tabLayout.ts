/**
 * 标签栏布局：横版（顶部一排）/ 竖版（左侧栏）。
 * - 当前布局：标签栏按钮可随时切换（内存态，不落盘）；
 * - 默认布局：设置 → 外观与布局 里定，落在 localStorage，启动时作为当前布局。
 */
import { useSyncExternalStore } from "react";

export type TabLayoutMode = "h" | "v";
const DEFAULT_KEY = "explorer.tabLayout.default";

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

let defaultMode: TabLayoutMode = readDefault();
let mode: TabLayoutMode = defaultMode;

export function getTabLayoutMode(): TabLayoutMode {
  return mode;
}
export function getTabLayoutDefault(): TabLayoutMode {
  return defaultMode;
}
export function toggleTabLayoutMode(): void {
  mode = mode === "h" ? "v" : "h";
  emit();
}
/** 只切当前布局（不改默认值）：标签页抽屉里的分段切换用 */
export function setTabLayoutMode(m: TabLayoutMode): void {
  if (mode === m) return;
  mode = m;
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
