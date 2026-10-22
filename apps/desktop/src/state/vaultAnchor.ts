/** Device-specific, viewport-relative placement; content layout never persists a forced adjustment. */
export type VaultAnchorPreference = { side: "left" | "right"; ratio: number; xRatio?: number; collapsed?: boolean; docked?: boolean };
export type VaultAnchorProfile = "phone" | "desktop";
export type AnchorRect = { left: number; top: number; right: number; bottom: number };
export const DEFAULT_VAULT_ANCHOR: VaultAnchorPreference = { side: "right", ratio: .4 };
export const vaultAnchorKey = (profile: VaultAnchorProfile): string => `onethu.vault-anchor.${profile}.v1`;
export function readVaultAnchor(profile: VaultAnchorProfile): VaultAnchorPreference {
  try {
    const value = JSON.parse(localStorage.getItem(vaultAnchorKey(profile)) ?? "null") as Partial<VaultAnchorPreference> | null;
    if (value && (value.side === "left" || value.side === "right") && typeof value.ratio === "number" && Number.isFinite(value.ratio)) return {
      side: value.side, ratio: clamp(value.ratio, 0, 1),
      ...(value.collapsed === true ? { collapsed: true } : {}),
      ...(value.docked === true ? { docked: true } : {}),
      ...(typeof value.xRatio === "number" && Number.isFinite(value.xRatio) ? { xRatio: clamp(value.xRatio, 0, 1) } : {}),
    };
  } catch { /* Unavailable storage or old malformed values use the default. */ }
  return { ...DEFAULT_VAULT_ANCHOR };
}
export function saveVaultAnchor(profile: VaultAnchorProfile, value: VaultAnchorPreference): void {
  try { localStorage.setItem(vaultAnchorKey(profile), JSON.stringify(value)); } catch { /* Placement still works for the current session. */ }
}
export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, Math.max(min, max)));

/** Only intentional near-edge releases dock; free positions remain free. */
export function commitVaultAnchor(profile: VaultAnchorProfile, point: { left: number; top: number; side: "left" | "right" }, bounds: AnchorRect, width: number, height: number): VaultAnchorPreference {
  const ratio = clamp((point.top + height / 2 - bounds.top) / Math.max(1, bounds.bottom - bounds.top), 0, 1);
  const leftDistance = point.left - bounds.left, rightDistance = bounds.right - point.left - width;
  if (profile === "phone" && Math.min(leftDistance, rightDistance) <= 24) return { side: leftDistance < rightDistance ? "left" : "right", ratio, collapsed: true, docked: true };
  return { side: point.side, ratio, xRatio: clamp((point.left + width / 2 - bounds.left) / Math.max(1, bounds.right - bounds.left), 0, 1) };
}

/** Manual placement stays where it was released. Only default/legacy edge
 * placements seek a clear slot; content changes must never move a user's handle. */
export function resolveVaultAnchor(preference: VaultAnchorPreference, bounds: AnchorRect, width: number, height: number, obstacles: AnchorRect[], gap: number): { left: number; top: number; side: "left" | "right" } {
  const desired = bounds.top + (bounds.bottom - bounds.top) * preference.ratio - height / 2;
  const min = bounds.top, max = Math.max(min, bounds.bottom - height);
  if (typeof preference.xRatio === "number" && Number.isFinite(preference.xRatio)) {
    return {
      left: clamp(bounds.left + (bounds.right - bounds.left) * preference.xRatio - width / 2, bounds.left, bounds.right - width),
      top: clamp(desired, min, max),
      side: preference.side,
    };
  }
  const positions = [clamp(desired, min, max), min, max, ...obstacles.flatMap(rect => [clamp(rect.top - gap - height, min, max), clamp(rect.bottom + gap, min, max)])];
  const opposite = preference.side === "left" ? "right" : "left";
  let fallback: { left: number; top: number; side: "left" | "right"; score: number } | undefined;
  const sides: Array<"left" | "right"> = preference.docked ? [preference.side] : [preference.side, opposite];
  for (const side of sides) {
    const left = side === "left" ? bounds.left : Math.max(bounds.left, bounds.right - width);
    const candidates = positions.map(top => {
      const overlap = obstacles.reduce((sum, rect) => sum + Math.max(0, Math.min(left + width, rect.right + gap) - Math.max(left, rect.left - gap)) * Math.max(0, Math.min(top + height, rect.bottom + gap) - Math.max(top, rect.top - gap)), 0);
      return { left, top, side, overlap, score: overlap * 1000 + Math.abs(top - desired) };
    }).sort((a, b) => a.score - b.score);
    if (candidates[0]!.overlap === 0) return collapsedPlacement(candidates[0]!, preference, width);
    if (!fallback || candidates[0]!.score < fallback.score) fallback = candidates[0]!;
  }
  return collapsedPlacement(fallback!, preference, width);
}

function collapsedPlacement<T extends { left: number; side: "left" | "right" }>(placement: T, preference: VaultAnchorPreference, width: number): T {
  if (!preference.collapsed) return placement;
  return { ...placement, left: placement.left + (placement.side === "left" ? -1 : 1) * Math.min(width / 2, Math.max(0, width - 28)) };
}
