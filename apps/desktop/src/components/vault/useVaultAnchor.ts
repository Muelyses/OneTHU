import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { claimGesture, releaseGesture } from "../../lib/gestureArena.js";
import { hasCoarsePointer, isPhoneViewport } from "../../state/platform.js";
import { clamp, DEFAULT_VAULT_ANCHOR, readVaultAnchor, resolveVaultAnchor, saveVaultAnchor, type AnchorRect, type VaultAnchorPreference, type VaultAnchorProfile } from "../../state/vaultAnchor.js";

export const VAULT_OBSTACLES = ".explorer-topbar, .ex-bbar, .onego-bookmarks, .oneshot, .board-viewport-tools, .hard-refresh-fab, .top-fab, [data-oh-drop], .dock-panel, .ex-rail";
const OWNER = "vault-anchor", HOLD_MS = 300, MOVE_SLOP = 8, SWIPE_DISTANCE = 32;
type Placement = { left: number; top: number; side: "left" | "right" };
type Gesture = { pointerId: number; element: HTMLElement; touch: boolean; x: number; y: number; left: number; top: number; width: number; height: number; side: "left" | "right"; held: boolean; moved: boolean; swipe: boolean; cancelled: boolean; timer?: ReturnType<typeof setTimeout> };
const profileNow = (): VaultAnchorProfile => isPhoneViewport() || (hasCoarsePointer() && Math.min(innerWidth, innerHeight) < 600) ? "phone" : "desktop";

export function visibleVaultObstacles(selector = VAULT_OBSTACLES): AnchorRect[] {
  return [...document.querySelectorAll<HTMLElement>(selector)].flatMap(el => {
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    return rect.width && rect.height && style.visibility !== "hidden" && style.display !== "none" ? [rect] : [];
  });
}

export function vaultViewport(safe: HTMLElement | null): AnchorRect {
  const view = visualViewport, styles = safe ? getComputedStyle(safe) : null;
  const left = view?.offsetLeft ?? 0, top = view?.offsetTop ?? 0;
  const inset = (name: "paddingTop" | "paddingLeft" | "paddingRight" | "paddingBottom"): number => parseFloat(styles?.[name] ?? "0") || 0;
  const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--og-vault-anchor-gap")) || 6;
  return { left: left + inset("paddingLeft") + gutter, top: top + inset("paddingTop") + gutter,
    right: left + Math.min(view?.width ?? innerWidth, document.documentElement.clientWidth) - inset("paddingRight") - gutter,
    bottom: top + (view?.height ?? innerHeight) - inset("paddingBottom") - gutter };
}

/** Handle hold moves the entrance; content hold belongs to vaultDrag and opens the radar. */
export function useVaultAnchor(anchor: RefObject<HTMLDivElement | null>, openManager: () => void, closePreview: () => void) {
  const safe = useRef<HTMLSpanElement>(null);
  const [profile, setProfile] = useState(profileNow);
  const [preference, setPreference] = useState<VaultAnchorPreference>(() => readVaultAnchor(profile));
  const [placement, setPlacement] = useState<Placement>({ left: 0, top: 0, side: "right" });
  const [ready, setReady] = useState(false), [moving, setMoving] = useState(false);
  const gesture = useRef<Gesture | null>(null), suppressClickUntil = useRef(0), touchUntil = useRef(0);
  const measureRef = useRef<() => void>(() => {});
  const clearGesture = (notify = true): void => {
    const g = gesture.current;
    if (g?.timer) clearTimeout(g.timer);
    gesture.current = null;
    if (g?.element.hasPointerCapture(g.pointerId)) g.element.releasePointerCapture(g.pointerId);
    releaseGesture(OWNER); if (notify) setMoving(false);
  };
  const cancelGesture = (): void => {
    if (!gesture.current) return;
    // The cancelled press can remain down while the app is unfocused. Its
    // eventual click is suppressed until a new physical pointerdown resets it.
    suppressClickUntil.current = Number.POSITIVE_INFINITY;
    clearGesture(); measureRef.current();
  };
  useLayoutEffect(() => {
    let frame = 0;
    const measure = (): void => {
      const nextProfile = profileNow();
      if (nextProfile !== profile) { setProfile(nextProfile); setPreference(readVaultAnchor(nextProfile)); return; }
      if (!anchor.current || gesture.current?.held) return;
      const rect = anchor.current.getBoundingClientRect();
      const next = resolveVaultAnchor(preference, vaultViewport(safe.current), rect.width, rect.height, visibleVaultObstacles(), 8);
      setPlacement(old => old.left === next.left && old.top === next.top && old.side === next.side ? old : next); setReady(true);
    };
    const schedule = (): void => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measureRef.current = schedule;
    const resize = new ResizeObserver(schedule);
    if (anchor.current) resize.observe(anchor.current);
    for (const el of document.querySelectorAll(VAULT_OBSTACLES)) resize.observe(el);
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    // New page controls may be mounted without a window resize.
    const shell = document.querySelector(".explorer-shell");
    if (shell) mutation.observe(shell, { childList: true, subtree: true });
    measure(); window.addEventListener("resize", schedule); window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule); window.visualViewport?.addEventListener("scroll", schedule);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true); window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule); };
  }, [profile, preference, anchor]);
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => { if (event.key === "Escape") cancelGesture(); };
    const hidden = (): void => { if (document.visibilityState === "hidden") cancelGesture(); };
    const lost = (event: PointerEvent): void => { if (event.pointerId === gesture.current?.pointerId) cancelGesture(); };
    const additionalPointer = (event: PointerEvent): void => {
      if (gesture.current && event.pointerId !== gesture.current.pointerId && event.pointerType !== "mouse") cancelGesture();
    };
    window.addEventListener("keydown", escape); window.addEventListener("blur", cancelGesture);
    window.addEventListener("lostpointercapture", lost, true); window.addEventListener("pointerdown", additionalPointer, true);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", escape); window.removeEventListener("blur", cancelGesture);
      window.removeEventListener("lostpointercapture", lost, true); window.removeEventListener("pointerdown", additionalPointer, true);
      document.removeEventListener("visibilitychange", hidden); clearGesture(false);
    };
  }, []);
  const startMove = (g: Gesture): void => {
    if (!claimGesture(OWNER)) { g.cancelled = true; return; }
    g.held = true; closePreview(); setMoving(true);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || !event.isPrimary || gesture.current) return;
    suppressClickUntil.current = 0;
    const rect = anchor.current!.getBoundingClientRect();
    const g: Gesture = { pointerId: event.pointerId, element: event.currentTarget, touch: event.pointerType !== "mouse", x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height, side: placement.side, held: false, moved: false, swipe: false, cancelled: false };
    gesture.current = g; event.currentTarget.setPointerCapture(event.pointerId);
    if (g.touch) touchUntil.current = Date.now() + 1200;
    g.timer = setTimeout(() => { if (gesture.current === g && !g.cancelled && !g.swipe && !g.held) startMove(g); }, HOLD_MS);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const g = gesture.current; if (!g || g.pointerId !== event.pointerId || g.cancelled) return;
    if (!g.touch && event.buttons === 0) { cancelGesture(); return; }
    const dx = event.clientX - g.x, dy = event.clientY - g.y, distance = Math.hypot(dx, dy);
    if (!g.held) {
      if (!g.touch && distance > MOVE_SLOP) startMove(g);
      else if (g.touch && distance > MOVE_SLOP) {
        clearTimeout(g.timer);
        const inward = g.side === "right" ? -dx : dx;
        if (inward > SWIPE_DISTANCE && inward > Math.abs(dy) * 1.4) g.swipe = true;
        // Preserve the pending inward swipe while travelling through its threshold.
        else if (Math.abs(dy) > Math.abs(dx) || inward < -MOVE_SLOP) g.cancelled = true;
      }
    }
    if (g.held) {
      event.preventDefault(); g.moved = distance > MOVE_SLOP;
      const bounds = vaultViewport(safe.current);
      setPlacement({ left: clamp(g.left + dx, bounds.left, bounds.right - g.width), top: clamp(g.top + dy, bounds.top, bounds.bottom - g.height), side: g.side });
    }
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    const g = gesture.current; if (!g || g.pointerId !== event.pointerId) return;
    const consumed = g.held || g.swipe || g.cancelled || Math.hypot(event.clientX - g.x, event.clientY - g.y) > MOVE_SLOP;
    if (consumed) { event.preventDefault(); suppressClickUntil.current = Date.now() + 700; }
    if (g.held && g.moved) {
      const bounds = vaultViewport(safe.current);
      const centerX = g.left + g.width / 2 + event.clientX - g.x, centerY = g.top + g.height / 2 + event.clientY - g.y;
      const next: VaultAnchorPreference = { side: centerX < (bounds.left + bounds.right) / 2 ? "left" : "right", ratio: clamp((centerY - bounds.top) / (bounds.bottom - bounds.top), 0, 1) };
      saveVaultAnchor(profile, next); setPreference(next);
    }
    const shouldOpen = !g.held && g.swipe && !g.cancelled;
    clearGesture();
    measureRef.current(); if (shouldOpen) openManager();
  };
  const onPointerCancel = (event: ReactPointerEvent<HTMLElement>): void => { if (event.pointerId === gesture.current?.pointerId) cancelGesture(); };
  const reset = (): void => { const next = { ...DEFAULT_VAULT_ANCHOR }; saveVaultAnchor(profile, next); setPreference(next); };
  return { safe, placement, ready, moving, reset, touchUntil, suppressClickUntil, onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
