/**
 * OneGUI · 浮层相位与宿主（内部工具，不对外导出）
 *
 * 退场动画必须有相位：open 变 false 时不能立刻卸载，否则"啪"地消失。
 * 旧的实现散在 lib/useExitPhase.ts + 各弹层里，现在只有这一份（EXIT_MS 与 --og-dur-2 同源）。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** 与 --og-dur-2（180ms）同源：退场相位时长 */
export const EXIT_MS = 200;

export interface ExitPhase {
  /** 是否应该渲染节点（含退场期间） */
  mounted: boolean;
  /** 正在退场（用于挂 .is-closing） */
  closing: boolean;
}

export function useExitPhase(open: boolean, ms = EXIT_MS): ExitPhase {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setClosing(false);
      setMounted(false);
    }, ms);
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
    // mounted 只在内部状态机里用，不进依赖，避免"关闭→重开"时相位抖动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ms]);

  return { mounted, closing };
}

/* ── 滚动锁：多个浮层同时打开时只锁一次 ─────────────────────────────── */

let locks = 0;
let savedOverflow = "";

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    locks += 1;
    return () => {
      locks = Math.max(0, locks - 1);
      if (locks === 0) document.body.style.overflow = savedOverflow;
    };
  }, [active]);
}

/* ── Portal：一律挂到 body（祖先 transform 会困住 fixed） ───────────── */

export function Portal({ children }: { children: ReactNode }): ReactNode {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setHost(document.body);
  }, []);
  return host ? createPortal(children, host) : null;
}

/* ── 焦点：打开时把焦点移进浮层，关闭时还给原来的元素 ───────────────── */

export function useFocusTrap(active: boolean, ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, [active, ref]);
}

/* ── 点击外部 / Escape ─────────────────────────────────────────────── */

export function useDismiss(active: boolean, onDismiss: () => void, ref: React.RefObject<HTMLElement | null>, opts?: { clickOutside?: boolean }): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
    };
    const onDown = (e: MouseEvent): void => {
      if (opts?.clickOutside === false) return;
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [active, onDismiss, ref, opts?.clickOutside]);
}

/* ── 视口内钳位（锚定菜单/气泡用） ─────────────────────────────────── */

export interface Rect { top: number; left: number; width: number; height: number }

export function anchorRect(anchor: HTMLElement | Rect | null | undefined): Rect | null {
  if (!anchor) return null;
  if (anchor instanceof HTMLElement) {
    const r = anchor.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }
  return anchor;
}

export function clampToViewport(el: HTMLElement | null, rect: Rect, side: "bottom-start" | "bottom-end" | "top-start"): { top: number; left: number } {
  const pad = 8;
  const w = el?.offsetWidth ?? 0;
  const h = el?.offsetHeight ?? 0;
  let top = side === "top-start" ? rect.top - h - 6 : rect.top + rect.height + 6;
  let left = side === "bottom-end" ? rect.left + rect.width - w : rect.left;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  left = Math.max(pad, Math.min(left, vw - w - pad));
  if (top + h > vh - pad) top = Math.max(pad, vh - h - pad);
  return { top, left };
}

export { EXIT_MS as EXIT_DURATION };
