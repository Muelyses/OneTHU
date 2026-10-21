/** Shared by manual login and library-driven recovery. Only timestamps are stored. */
const STORAGE_KEY = "onethu.login-attempt-at";
const COOLDOWN_MS = 20_000;
let lastLoginAttemptAt = 0;

export class LoginCooldownError extends Error {
  readonly code = "AUTH_COOLDOWN";
  constructor(readonly retryAfterMs: number) {
    super("Please wait before starting another login attempt.");
    this.name = "LoginCooldownError";
  }
}

export function loginCooldownLeftMs(): number {
  const now = Date.now();
  let saved = 0;
  try { saved = Number(globalThis.sessionStorage?.getItem(STORAGE_KEY)); } catch { /* memory fallback */ }
  // A clock change or corrupt storage must not lock the user out indefinitely.
  const valid = (at: number): number => Number.isFinite(at) && at > 0 && at <= now ? at : 0;
  lastLoginAttemptAt = Math.max(valid(lastLoginAttemptAt), valid(saved));
  return Math.max(0, COOLDOWN_MS - (now - lastLoginAttemptAt));
}

/** Call once before a new full login chain, never for a 2FA continuation. */
export function markLoginAttempt(): void {
  const remaining = loginCooldownLeftMs();
  if (remaining > 0) throw new LoginCooldownError(remaining);
  lastLoginAttemptAt = Date.now();
  // Survives refresh in this WebView; no credentials or account identifier.
  try { globalThis.sessionStorage?.setItem(STORAGE_KEY, String(lastLoginAttemptAt)); } catch { /* memory fallback */ }
}

/** A verified completed login is not a failed attempt awaiting another password. */
export function markLoginSucceeded(): void {
  lastLoginAttemptAt = 0;
  try { globalThis.sessionStorage?.removeItem(STORAGE_KEY); } catch { /* memory fallback */ }
}
