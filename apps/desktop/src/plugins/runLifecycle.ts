/** Wait for preparation without starting a run after the caller has cancelled it.
 * Once dispatched, cancellation must reach the host and the caller keeps waiting
 * for the real result: an aborted UI promise does not mean the request stopped.
 */
export async function runCancellable<T>(options: {
  signal?: AbortSignal;
  prepare: () => Promise<T | null>;
  run: () => Promise<T>;
  interrupt: () => Promise<void>;
  cancelled: () => T;
}): Promise<T> {
  const { signal } = options;
  if (signal?.aborted) return options.cancelled();
  const preparation = options.prepare();
  let removeAbort = (): void => {};
  try {
    const prepared = await Promise.race([
      preparation.then((value) => ({ cancelled: false as const, value })),
      new Promise<{ cancelled: true }>((resolve) => {
        const abort = (): void => resolve({ cancelled: true });
        signal?.addEventListener("abort", abort, { once: true });
        removeAbort = () => signal?.removeEventListener("abort", abort);
        if (signal?.aborted) abort();
      }),
    ]);
    if (prepared.cancelled || signal?.aborted) return options.cancelled();
    if (prepared.value !== null) return prepared.value;
  } finally {
    removeAbort();
  }

  const pending = options.run();
  const interrupt = (): void => {
    void options.interrupt().catch((error: unknown) => {
      console.warn("[OH] 无法发送停止请求", error);
    });
  };
  signal?.addEventListener("abort", interrupt, { once: true });
  if (signal?.aborted) interrupt();
  try {
    return await pending;
  } catch (error) {
    // A host RPC timeout ends the caller's wait, not the actual worker. Cancel
    // this run's ticket so it cannot keep occupying the shared conversation.
    await options.interrupt().catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", interrupt);
  }
}

/** Only classify an actual rate-limit error; authentication and quota wording
 * alone must not turn a different provider's failure into a MadModel renewal.
 */
export function isLlmRateLimit(error: string): boolean {
  return /\b429\b|rate[_ -]?limit|too many requests|请求过多|请求限流/i.test(error);
}
