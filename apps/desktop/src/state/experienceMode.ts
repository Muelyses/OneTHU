import { useSyncExternalStore } from "react";
import type { LearnNav, Page } from "./app.js";
export type ExperienceMode = "full" | "simple" | "practical";
const KEY = "onethu.experience.v1";
function read(): ExperienceMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "simple" || v === "practical" ? v : "full";
  } catch { return "full"; }
}
let mode = read();
let revision = 0;
let route: { page: Page; params: LearnNav | null } = { page: "homepage", params: null };
const listeners = new Set<() => void>();
export const subscribeExperience = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };
function emit() { listeners.forEach(f => f()); }
export const experienceMode = () => mode;
/** Invalidates work started before a mode switch, including full → compact → full. */
export const experienceRevision = () => revision;
export const simpleRoute = () => route;
export const useExperienceMode = () => useSyncExternalStore(subscribeExperience, experienceMode, experienceMode);
export const useSimpleRoute = () => useSyncExternalStore(subscribeExperience, simpleRoute, simpleRoute);
/** 极简与实用共用简洁壳（无标签页/OneGO/白板/暂存箱入口），区别只在 OneShot 第五格。 */
export const isSimpleLike = (m: ExperienceMode): boolean => m !== "full";
export function useIsSimpleLike(): boolean {
  return isSimpleLike(useExperienceMode());
}
export function setExperienceMode(next: ExperienceMode): void {
  if (next === mode) return;
  mode = next;
  revision++;
  try { localStorage.setItem(KEY, next); } catch { /* retain in memory */ }
  // Never write explorer, whiteboard, OneShot or plugin preferences here.
  emit();
}
/** 简洁壳（极简/实用）允许的一级页：完整模式专属页 + 寻迹（地图/导航）都不进来。 */
export const compactPageAllowed = (page: string): boolean => !["board", "vault", "contacts", "org", "plugins", "xiaoda", "trace"].includes(page);
export function navigateSimple(page: Page, params?: LearnNav | null): void {
  if (!compactPageAllowed(page)) return;
  route = { page, params: params ?? null };
  emit();
}
