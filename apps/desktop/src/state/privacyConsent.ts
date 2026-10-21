/** Device-local consent. Never included in profile/cloud sync. Deny until initialized. */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n/index.js";
export const PRIVACY_KEY = "onethu.privacy.v1";
export interface PrivacyConsent { acknowledged: boolean; cloud: boolean; oh: boolean }
const denied: PrivacyConsent = { acknowledged: false, cloud: false, oh: false };
function parse(raw: unknown): PrivacyConsent {
  if (!raw || typeof raw !== "object") return denied;
  const v = raw as Partial<PrivacyConsent>;
  return { acknowledged: v.acknowledged === true, cloud: v.acknowledged === true && v.cloud === true, oh: v.acknowledged === true && v.oh === true };
}
const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
let consent: PrivacyConsent = denied;
if (!native) { try { consent = parse(JSON.parse(localStorage.getItem(PRIVACY_KEY) ?? "null")); } catch {} }
const listeners = new Set<() => void>();
export const subscribePrivacy = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const privacyConsent = () => consent;
export const usePrivacyConsent = () => useSyncExternalStore(subscribePrivacy, privacyConsent, privacyConsent);
export const cloudAuthorized = () => consent.cloud;
export const ohAuthorized = () => consent.oh;
function publish(next: PrivacyConsent) {
  consent = next;
  try { localStorage.setItem(PRIVACY_KEY, JSON.stringify(next)); } catch {}
  listeners.forEach(fn => fn());
  if (!next.oh) void import("../plugins/rust.js").then(m => m.notifyRust("onethu.harness", "interrupt")).catch(() => undefined);
}
let loading: Promise<void> | undefined;
export function initPrivacyConsent(): Promise<void> {
  return loading ??= (async () => {
    if (native) { try { publish(parse(await invoke("privacy_consent_read"))); } catch { publish(denied); } }
  })();
}
let tail = Promise.resolve();
export function savePrivacyConsent(next: PrivacyConsent): Promise<void> {
  const safe = parse(next);
  // Revocation applies immediately in the UI; grants only follow a successful native write.
  if (!safe.cloud || !safe.oh) publish({ ...consent, cloud: consent.cloud && safe.cloud, oh: consent.oh && safe.oh });
  const op = tail.catch(() => undefined).then(async () => {
    await initPrivacyConsent();
    if (native) await invoke("privacy_consent_write", { consent: safe });
    publish(safe);
  });
  tail = op;
  return op;
}
export function requireCloudConsent(): void { if (!cloudAuthorized()) throw new Error(t("privacy.cloudRequired")); }
export function requireOhConsent(): void { if (!ohAuthorized()) throw new Error(t("privacy.ohRequired")); }
