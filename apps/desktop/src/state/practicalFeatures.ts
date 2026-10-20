/** Shared intent for the practical service directory (OneShot and onboarding). */
export const PRACTICAL_FEATURES_EVENT = "onethu.practical-features";
export function showPracticalFeatures(open = true): void {
  window.dispatchEvent(new CustomEvent(PRACTICAL_FEATURES_EVENT, { detail: open }));
}
