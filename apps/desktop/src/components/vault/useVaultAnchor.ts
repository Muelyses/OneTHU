import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useFloatingButtonDrag } from "../useFloatingButtonDrag.js";
import { hasCoarsePointer, isPhoneViewport } from "../../state/platform.js";
import { clamp, DEFAULT_VAULT_ANCHOR, readVaultAnchor, resolveVaultAnchor, saveVaultAnchor, type AnchorRect, type VaultAnchorPreference, type VaultAnchorProfile } from "../../state/vaultAnchor.js";

export const VAULT_OBSTACLES = ".explorer-topbar, .ex-bbar, .onego-bookmarks, .oneshot, .board-viewport-tools, .hard-refresh-fab, .top-fab, [data-oh-drop], .dock-panel, .ex-rail";
type Placement = { left: number; top: number; side: "left" | "right" };
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

/** Vault positioning only; pointer behavior is shared with the hard-refresh button. */
export function useVaultAnchor(anchor: RefObject<HTMLDivElement | null>, closeMenu: () => void) {
  const safe = useRef<HTMLSpanElement>(null);
  const [profile, setProfile] = useState(profileNow);
  const [preference, setPreference] = useState<VaultAnchorPreference>(() => readVaultAnchor(profile));
  const [placement, setPlacement] = useState<Placement>({ left: 0, top: 0, side: "right" });
  const [ready, setReady] = useState(false);
  const measureRef = useRef<() => void>(() => {});
  const floating = useFloatingButtonDrag({
    position: placement,
    move: (start, dx, dy, button): Placement => {
      const bounds = vaultViewport(safe.current);
      const width = anchor.current?.offsetWidth ?? button.offsetWidth;
      const height = anchor.current?.offsetHeight ?? button.offsetHeight;
      const left = clamp(start.left + dx, bounds.left, bounds.right - width);
      const top = clamp(start.top + dy, bounds.top, bounds.bottom - height);
      return { left, top, side: left + width / 2 < (bounds.left + bounds.right) / 2 ? "left" : "right" };
    },
    onChange: setPlacement,
    onCommit: next => {
      const bounds = vaultViewport(safe.current);
      const width = anchor.current?.offsetWidth ?? 0, height = anchor.current?.offsetHeight ?? 0;
      const preference: VaultAnchorPreference = {
        side: next.side,
        xRatio: clamp((next.left + width / 2 - bounds.left) / Math.max(1, bounds.right - bounds.left), 0, 1),
        ratio: clamp((next.top + height / 2 - bounds.top) / Math.max(1, bounds.bottom - bounds.top), 0, 1),
      };
      saveVaultAnchor(profile, preference); setPreference(preference);
    },
    onPress: closeMenu,
    onRelease: () => measureRef.current(),
  });
  const { pressedRef } = floating;
  useLayoutEffect(() => {
    let frame = 0;
    const measure = (): void => {
      // Default avoidance must not move a target between pointerdown and up.
      if (!anchor.current || pressedRef.current) return;
      const nextProfile = profileNow();
      if (nextProfile !== profile) { setProfile(nextProfile); setPreference(readVaultAnchor(nextProfile)); return; }
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
    const shell = document.querySelector(".explorer-shell");
    if (shell) mutation.observe(shell, { childList: true, subtree: true });
    measure(); window.addEventListener("resize", schedule); window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule); window.visualViewport?.addEventListener("scroll", schedule);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true); window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule); };
  }, [profile, preference, anchor, pressedRef]);
  const reset = (): void => { const next = { ...DEFAULT_VAULT_ANCHOR }; saveVaultAnchor(profile, next); setPreference(next); };
  return { ...floating, safe, placement, ready, moving: floating.dragging, reset };
}
