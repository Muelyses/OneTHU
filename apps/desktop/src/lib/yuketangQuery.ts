import { createYuketangQueries } from "@onethu/core";
import { session } from "./clients.js";
import { universalFetch, nativeSessionEpoch, assertNativeSessionEpoch } from "./transport.js";
import { ensureExtHwCredsLoaded, getExtHwCreds, bindLegacyYuketangOwner, yuketangCredentialOwner } from "../state/exthw.js";

/** Each call captures the native account revision. No credential enters plugin results. */
export async function queryYuketang(method: keyof ReturnType<typeof createYuketangQueries>, args: unknown[], authorize: () => void) {
  authorize();
  const owner = session.username, epoch = await nativeSessionEpoch();
  const check = async () => {
    authorize();
    if (!owner || session.username !== owner || session.state !== "ready") throw new Error("AUTH_SESSION_CHANGED");
    await assertNativeSessionEpoch(epoch);
    if (session.username !== owner) throw new Error("AUTH_SESSION_CHANGED");
  };
  const queries = createYuketangQueries({ fetch: universalFetch, check, credentials: async () => {
    await ensureExtHwCredsLoaded(); await check(); bindLegacyYuketangOwner();
    if (yuketangCredentialOwner() && yuketangCredentialOwner() !== owner) throw new Error("YUKETANG_ACCOUNT_MISMATCH: Sign in to Rain Classroom again for the current account.");
    const creds = getExtHwCreds(); return creds.yuketang ? { ...creds.yuketang, days: creds.days } : null;
  } });
  return (queries[method] as (...values: any[]) => Promise<unknown>)(...args);
}
