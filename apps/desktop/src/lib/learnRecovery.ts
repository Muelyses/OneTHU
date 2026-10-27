import { HttpClient, LearnClient, webvpnWrap, type FetchLike } from "@onethu/core";

/** A startup probe owns an isolated CSRF candidate and never owns a password
 * or host relogin hook. A deadline retires all its later reads and cookie seeds. */
export async function probeLearnSession(options: {
  fetch: FetchLike;
  seed?: HttpClient["nativeSeedHook"];
  check?: () => void;
  timeoutMs?: number;
}): Promise<{ ready: boolean; csrf: string | null; page: string; diagnostic: string }> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 8_000;
  let finished = false;
  const expired = () => Object.assign(new Error("LEARN_PROBE_TIMEOUT"), { code: "LEARN_PROBE_TIMEOUT" });
  const check = () => {
    if (finished || controller.signal.aborted) throw expired();
    options.check?.();
  };
  const http = new HttpClient({ fetch: async (url, init = {}) => {
    check();
    if ((init.method ?? "GET").toUpperCase() !== "GET") throw new Error("LEARN_PROBE_READ_ONLY");
    const response = await options.fetch(url, { ...init, method: "GET", signal: controller.signal, timeoutMs } as RequestInit);
    check();return response;
  } });
  http.webVPNEncoder = webvpnWrap;
  http.nativeSeedHook = async (...args) => { check();await options.seed?.(...args);check(); };
  const candidate = new LearnClient(http);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort();reject(expired()); }, timeoutMs);
  });
  try {
    const ready = await Promise.race([candidate.resume(), deadline]);
    check();
    return { ready, csrf: candidate.csrfToken, page: candidate.lastDebug, diagnostic: candidate.lastCsrfDebug };
  } finally {
    finished = true;controller.abort();
    if (timer) clearTimeout(timer);
  }
}
