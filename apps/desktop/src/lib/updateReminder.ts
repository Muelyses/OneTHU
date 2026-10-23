import type { UpdateCheckResult } from "./updater.js";

export const UPDATE_REMINDER_CHANGED = "onethu.update.reminder-changed";
export const UPDATE_REVIEW_REQUESTED = "onethu.update.review-requested";
/** Login and 2FA screens can open the installer without entering authenticated settings. */
export function requestUpdateCenter(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(UPDATE_REVIEW_REQUESTED));
}
export const UPDATE_SNOOZE_MS = { hour: 3_600_000, day: 86_400_000, week: 604_800_000 } as const;
export type UpdateSnooze = keyof typeof UPDATE_SNOOZE_MS;
export const SNOOZE_KEY = "onethu.update.snooze.v1";
export const LEGACY_KEY = "onethu.update.dismissed";
type Snooze = { version: string; until: number };
let memorySnooze: Snooze | null = null;
let pendingReview: UpdateCheckResult | null = null;

export function normalizeUpdateVersion(version: string): string { return version.trim().replace(/^v/i, ""); }

function readSnooze(): Snooze | null {
  if (memorySnooze) return memorySnooze;
  try {
    const value = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? "null") as Snooze | null;
    return value && typeof value.version === "string" && Number.isFinite(value.until) && value.until > 0 ? value : null;
  } catch { return memorySnooze; }
}

/** Device-local delay, scoped to a specific release. Existing explicit skips remain respected. */
export function updateReminderDelay(version: string, now = Date.now()): number {
  const normalized = normalizeUpdateVersion(version);
  const snooze = readSnooze();
  if (snooze && normalizeUpdateVersion(snooze.version) === normalized) {
    return Math.max(0, Math.min(UPDATE_SNOOZE_MS.week, snooze.until - now));
  }
  try { if (normalizeUpdateVersion(localStorage.getItem(LEGACY_KEY) ?? "") === normalized) return Infinity; } catch { /* unavailable storage */ }
  return 0;
}

export function isDismissed(version: string): boolean { return updateReminderDelay(version) > 0; }

function notify(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(UPDATE_REMINDER_CHANGED));
}

export function snoozeUpdate(version: string, duration: UpdateSnooze, now = Date.now()): void {
  const value = { version: normalizeUpdateVersion(version), until: now + UPDATE_SNOOZE_MS[duration] };
  memorySnooze = value;
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(value));
    memorySnooze = null;
    if (normalizeUpdateVersion(localStorage.getItem(LEGACY_KEY) ?? "") === value.version) localStorage.removeItem(LEGACY_KEY);
  } catch { /* Keep the same-session delay when storage is unavailable. */ }
  notify();
}

/** Retained for older integrations that explicitly skip a release. */
export function dismissTag(version: string): void {
  try { localStorage.setItem(LEGACY_KEY, normalizeUpdateVersion(version)); localStorage.removeItem(SNOOZE_KEY); } catch { /* unavailable storage */ }
  memorySnooze = null;
  notify();
}

/** Hand the already checked result to the existing, user-triggered installer UI. */
export function stageUpdateReview(result: UpdateCheckResult): void { pendingReview = result; }
export function consumeUpdateReview(): UpdateCheckResult | null {
  const result = pendingReview; pendingReview = null; return result;
}
