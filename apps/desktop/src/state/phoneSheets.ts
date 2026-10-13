/**
 * 手机抽屉形态单源（palette.ts 同款模块级订阅源，不动 explorer.ts 本体）：
 *  - `is-phone` 判定：与 main.tsx 的 markPhone 同口径（触屏 + 非宽窗 §2.8.1），
 *    本模块给出响应式的 `useIsPhone()`，别再各组件自写一份 matchMedia；
 *  - 底部抽屉的「半屏 ⟷ 全屏」档位（seeking 两档 0.6vh / 0.94vh）：
 *    每个抽屉用自己的 id（tabdrawer / onego / onepage）自持，落 localStorage，
 *    拖动结束时由 PhoneSheet 的把手写入，开抽屉时读上次档位。
 */
import { useSyncExternalStore } from "react";
import { platformOf } from "./platform.js";

/* ══════════ is-phone：触屏 + 非宽窗（与 main.tsx markPhone 一字不差） ══════════ */

function computePhone(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || window.matchMedia?.("(pointer: coarse)").matches === true;
  return !!touch && platformOf(window.innerWidth) !== "expanded";
}

const listeners = new Set<() => void>();
let current = computePhone();

function emit(): void {
  for (const f of listeners) f();
}

const sync = (): void => {
  const next = computePhone();
  if (next !== current) {
    current = next;
    emit();
  }
};
if (typeof window !== "undefined") {
  window.addEventListener("resize", sync);
}

export function isPhoneNow(): boolean {
  return current;
}

export function subscribePhone(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/** 组件用：html.is-phone 的 TS 同源镜像（手机分流的唯一读点） */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, isPhoneNow, () => false);
}

/* ══════════ 抽屉档位：half（0.6vh）/ full（0.94vh） ══════════ */

export type PhoneSheetSnap = "half" | "full";

const KEY_PREFIX = "explorer.phoneSheet.";
const snapCache = new Map<string, PhoneSheetSnap>();

function readSnap(id: string): PhoneSheetSnap {
  const hit = snapCache.get(id);
  if (hit) return hit;
  let v: PhoneSheetSnap = "half";
  try {
    if (localStorage.getItem(KEY_PREFIX + id) === "full") v = "full";
  } catch {
    /* 存不下就用默认半屏 */
  }
  snapCache.set(id, v);
  return v;
}

const snapListeners = new Set<() => void>();

export function getSheetSnap(id: string): PhoneSheetSnap {
  return readSnap(id);
}

export function setSheetSnap(id: string, snap: PhoneSheetSnap): void {
  if (readSnap(id) === snap) return;
  snapCache.set(id, snap);
  try {
    localStorage.setItem(KEY_PREFIX + id, snap);
  } catch {
    /* 存储不可用：仅本次会话生效 */
  }
  for (const f of snapListeners) f();
}

export function subscribeSheetSnap(f: () => void): () => void {
  snapListeners.add(f);
  return () => {
    snapListeners.delete(f);
  };
}

/** 组件用：某抽屉当前的档位；SSR 快照给 half 兜底 */
export function useSheetSnap(id: string): PhoneSheetSnap {
  return useSyncExternalStore(subscribeSheetSnap, () => readSnap(id), (): PhoneSheetSnap => "half");
}
