import { useSyncExternalStore } from "react";
import type { ExperienceMode } from "./experienceMode.js";
export type MobileNavigationLayout = "bottom" | "side";
const KEY = "onethu.mobile-navigation.v1";
type Preferences = { full: MobileNavigationLayout; practical: MobileNavigationLayout };
const listeners = new Set<() => void>();
function load(): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { full: p.full === "side" ? "side" : "bottom", practical: p.practical === "side" ? "side" : "bottom" };
  } catch { return { full: "bottom", practical: "bottom" }; }
}
let preferences = load();
export function mobileNavigationFor(mode: ExperienceMode): MobileNavigationLayout { return mode === "simple" ? "bottom" : preferences[mode]; }
export function setMobileNavigation(mode: ExperienceMode, layout: MobileNavigationLayout): void {
  if (mode === "simple") return;
  preferences = { ...preferences, [mode]: layout };
  try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* In-memory preference remains usable. */ }
  listeners.forEach(f => f());
}
export function useMobileNavigation(mode: ExperienceMode): MobileNavigationLayout {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => mobileNavigationFor(mode), () => "bottom");
}
if (typeof window !== "undefined") window.addEventListener("storage", e => { if (e.key === KEY) { preferences = load(); listeners.forEach(f => f()); } });
