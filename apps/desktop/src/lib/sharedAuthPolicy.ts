/** Background availability never constitutes proof about school identity. */
export function isSharedRuntimeUnavailable(error: unknown): boolean {
  return /\bCLI_DAEMON_(?:START_FAILED|START_TIMEOUT|NOT_RUNNING|UNAVAILABLE|CONNECTION_INTERRUPTED|RUNTIME_UNAVAILABLE|INSTALL_UNAVAILABLE|INSTALL_BUSY|SHUTDOWN_PENDING)\b/.test(String(error));
}

/** An offline GUI login can bind later only to a safe, current background owner.
 * Explicit background logout, another account and active 2FA always win. The
 * daemon must still independently verify the candidate school's identity. */
export function canBindDeferredLogin(shared: {
  username: string | null; tombstone?: boolean; bootstrapAllowed?: boolean;
  session: { state: string; twoFactor?: { pending?: boolean } };
}, username: string): boolean {
  if (!username || shared.tombstone || shared.session.twoFactor?.pending || shared.session.state === "need-2fa") return false;
  return shared.username === username || (shared.username === null && shared.bootstrapAllowed === true);
}
