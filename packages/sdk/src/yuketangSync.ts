/** Private desktop credential transfer. Never register as a service/MCP operation. */
import { createHash } from "node:crypto";
import type { ExtHwCreds } from "@onethu/core";
import type { RuntimeStore } from "./store.js";
export interface YuketangSyncInput { credential: { cookie: string; uvId?: string; days?: number } | null }
export async function syncDesktopYuketang(store: RuntimeStore, account: string, input: YuketangSyncInput, fence: () => void) {
  fence();
  const value = input?.credential;
  if (value !== null && (!value || typeof value !== "object" || Object.keys(value).some(k => !["cookie", "uvId", "days"].includes(k))
    || typeof value.cookie !== "string" || !value.cookie.trim() || value.cookie.length > 16384 || /[\x00-\x1f\x7f]/.test(value.cookie)
    || (value.uvId !== undefined && (typeof value.uvId !== "string" || !/^\d{1,100}$/.test(value.uvId)))
    || (value.days !== undefined && (!Number.isSafeInteger(value.days) || value.days < 1 || value.days > 3660)))) throw new Error("CLI_BRIDGE_INVALID");
  const owner = createHash("sha256").update(account).digest("hex");
  const key = `exthw-${owner.slice(0, 24)}`, ledgerKey = `desktop-yuketang-${owner}`;
  const config = await store.read<ExtHwCreds>(key, {});
  const ledger = await store.read<{ fingerprint?: string; status?: string }>(ledgerKey, {});
  fence();
  const fingerprint = (row: { cookie: string; uvId?: string }) => createHash("sha256").update(JSON.stringify([row.cookie, row.uvId ?? ""])).digest("hex");
  const prior = config.yuketang;
  const owned = !!prior && ledger.fingerprint === fingerprint(prior);
  if (value && prior && !owned && fingerprint(value) !== fingerprint(prior)) {
    fence(); await store.write(ledgerKey, { ...ledger, status: "conflict" }); fence();
    return { configured: true, status: "conflict" };
  }
  if (!value && prior && !owned) {
    fence(); await store.write(ledgerKey, { ...ledger, status: "independent" }); fence();
    return { configured: true, status: "independent" };
  }
  if (value) {
    config.yuketang = { cookie: value.cookie, ...(value.uvId ? { uvId: value.uvId } : {}) };
    if (value.days !== undefined) config.days = value.days;
  } else delete config.yuketang;
  fence(); await store.write(key, config); fence();
  await store.write(ledgerKey, value ? { fingerprint: fingerprint(value), status: "synced" } : { status: "disconnected" }); fence();
  if (!value) {
    const cacheKey = `exthw-cache-${owner.slice(0, 24)}`;
    const cache = await store.read<{ items?: { source: string }[]; [key: string]: unknown }>(cacheKey, {});
    fence(); await store.write(cacheKey, { ...cache, items: (cache.items ?? []).filter(row => row.source !== "yuketang"), complete: false }); fence();
  }
  return { configured: !!value, status: value ? "synced" : "disconnected" };
}
export async function desktopYuketangSyncStatus(store: RuntimeStore, account: string): Promise<string> {
  const key = `desktop-yuketang-${createHash("sha256").update(account).digest("hex")}`;
  const ledger = await store.read<{ status?: string }>(key, {});
  return ["synced", "disconnected", "conflict", "independent"].includes(ledger.status ?? "") ? ledger.status! : "not-shared";
}
