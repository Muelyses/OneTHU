/** Device-specific, viewport-relative placement; content layout never persists a forced adjustment. */
export type VaultAnchorPreference = { side: "left" | "right"; ratio: number };
export type VaultAnchorProfile = "phone" | "desktop";
export type AnchorRect = { left: number; top: number; right: number; bottom: number };
export const DEFAULT_VAULT_ANCHOR: VaultAnchorPreference = { side: "right", ratio: .4 };
export const vaultAnchorKey = (profile: VaultAnchorProfile): string => `onethu.vault-anchor.${profile}.v1`;
export function readVaultAnchor(profile: VaultAnchorProfile): VaultAnchorPreference {
  try {
    const value = JSON.parse(localStorage.getItem(vaultAnchorKey(profile)) ?? "null") as Partial<VaultAnchorPreference> | null;
    if (value && (value.side === "left" || value.side === "right") && typeof value.ratio === "number" && Number.isFinite(value.ratio)) return { side: value.side, ratio: clamp(value.ratio, 0, 1) };
  } catch { /* Unavailable storage or old malformed values use the default. */ }
  return { ...DEFAULT_VAULT_ANCHOR };
}
export function saveVaultAnchor(profile: VaultAnchorProfile, value: VaultAnchorPreference): void {
  try { localStorage.setItem(vaultAnchorKey(profile), JSON.stringify(value)); } catch { /* Placement still works for the current session. */ }
}
export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, Math.max(min, max)));

/** Find the nearest clear edge slot, considering fixed navigation and editing controls. */
export function resolveVaultAnchor(preference: VaultAnchorPreference, bounds: AnchorRect, width: number, height: number, obstacles: AnchorRect[], gap: number): { left: number; top: number; side: "left" | "right" } {
  const desired = bounds.top + (bounds.bottom - bounds.top) * preference.ratio - height / 2;
  const min = bounds.top, max = Math.max(min, bounds.bottom - height);
  const positions = [clamp(desired, min, max), min, max, ...obstacles.flatMap(rect => [clamp(rect.top - gap - height, min, max), clamp(rect.bottom + gap, min, max)])];
  const opposite = preference.side === "left" ? "right" : "left";
  let fallback: { left: number; top: number; side: "left" | "right"; score: number } | undefined;
  for (const side of [preference.side, opposite] as const) {
    const left = side === "left" ? bounds.left : Math.max(bounds.left, bounds.right - width);
    const candidates = positions.map(top => {
      const overlap = obstacles.reduce((sum, rect) => sum + Math.max(0, Math.min(left + width, rect.right + gap) - Math.max(left, rect.left - gap)) * Math.max(0, Math.min(top + height, rect.bottom + gap) - Math.max(top, rect.top - gap)), 0);
      return { left, top, side, overlap, score: overlap * 1000 + Math.abs(top - desired) };
    }).sort((a, b) => a.score - b.score);
    if (candidates[0]!.overlap === 0) return candidates[0]!;
    if (!fallback || candidates[0]!.score < fallback.score) fallback = candidates[0]!;
  }
  return fallback!;
}
