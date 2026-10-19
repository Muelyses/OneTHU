import { useSyncExternalStore } from "react";
import type { LearnNav, Page } from "./app.js";
export type ExperienceMode = "full" | "simple";
const KEY = "onethu.experience.v1";
function read(): ExperienceMode { try { return localStorage.getItem(KEY) === "simple" ? "simple" : "full"; } catch { return "full"; } }
let mode = read();
let route: { page: Page; params: LearnNav | null } = { page: "homepage", params: null };
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
function emit() { listeners.forEach(f => f()); }
export const experienceMode = () => mode;
export const simpleRoute = () => route;
export const useExperienceMode = () => useSyncExternalStore(subscribe, experienceMode, experienceMode);
export const useSimpleRoute = () => useSyncExternalStore(subscribe, simpleRoute, simpleRoute);
export function setExperienceMode(next: ExperienceMode): void {
  if (next === mode) return;
  mode = next;
  try { localStorage.setItem(KEY, next); } catch { /* retain in memory */ }
  // Never write explorer, whiteboard, OneShot or plugin preferences here.
  emit();
}
export function navigateSimple(page: Page, params?: LearnNav | null): void {
  if (["board", "vault", "contacts", "plugins"].includes(page)) return;
  route = { page, params: params ?? null };
  emit();
}
