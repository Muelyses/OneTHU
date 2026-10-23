/** Authentication cookies belong to an account, while the device fingerprint
 * belongs to this installation. Re-login may reuse cookies only for a known owner. */
export function createAuthCookieBoundary(deps: {
  readOwner: () => Promise<string | null>;
  clearCookies: () => Promise<void>;
  clearAccountTrust: () => void;
  recordOwner: (username: string | null) => Promise<void>;
}) {
  let owner: string | null | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    prepare: (username: string): Promise<"reused" | "isolated"> => serialize(async () => {
      if (!username.trim()) throw new Error("Authentication requires an account.");
      if (owner === undefined) owner = await deps.readOwner().catch(() => null);
      if (owner === username) return "reused";
      // Fail closed: a failed clear never authorizes the next account to use
      // cookies from the previous account or from an unidentifiable session.
      owner = null;
      deps.clearAccountTrust();
      await deps.clearCookies();
      await deps.recordOwner(username);
      owner = username;
      return "isolated";
    }),
    logout: (): Promise<void> => serialize(async () => {
      owner = null;
      deps.clearAccountTrust();
      // Persist signed-out intent even when cookie clearing fails. Either
      // surviving tombstone prevents the next boot from reviving an old account.
      const results = await Promise.allSettled([deps.clearCookies(), deps.recordOwner(null)]);
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    }),
  };
}
