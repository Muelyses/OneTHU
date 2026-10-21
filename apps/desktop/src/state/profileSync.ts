/** Private account profile replication, independent of public cards/invitations.
 * Every device writes only its own file. No credentials or API settings are read.
 */
import { invoke } from "@tauri-apps/api/core";
import { logLine } from "../lib/clients.js";
import { ensureOwnedCloudRepo } from "../lib/ownedCloudRepo.js";
import { cardsSnapshot, restoreCardsFromSync, subscribeCards, type PersonalCard } from "./nameCard.js";
import { orgSnapshot, restoreOrgsFromSync, subscribeOrgs } from "./org.js";
import { ensureSeafileLoaded, getSeafileCredentialVersion, getSeafileToken, subscribeSeafile, type SeafileAccount, type SeafileEntry } from "./seafile.js";
import { experienceMode, experienceRevision, subscribeExperience } from "./experienceMode.js";
import { captureProfile, flattenProfile, materializeProfile, mergeProfile, newProfileState, parseProfileState, profileConflicts, profileConflictPaths, profileConflictId, resolveProfileConflict, PROFILE_MAX_BYTES, type ProfileState, type ProfileConflict } from "./profileSyncCore.js";

const REPO = "OneTHU-Profile";
const OWNER_KEY = "onethu.profile.owner.v1";
const DEVICE_KEY = "onethu.profile.device.v1";
const STATE_PREFIX = "onethu.profile.state.v1:";
const blank = (): PersonalCard => ({ name: "", avatar: "", website: "", social: "", phone: "", bio: "", updatedAt: 0 });
let activeStop: (() => void) | undefined;
let activeRequest: (() => void) | undefined;
let activeResolve: ((key: string, choice: "local" | "remote") => void) | undefined;
let conflicts: ProfileConflict[] = [];
let selectedConflict: string | null = null;
export const profileSyncSelection = () => selectedConflict;
export function selectProfileConflict(id: string | null) { selectedConflict = id; statusListeners.forEach(f=>f()); }
export const profileSyncConflicts = () => conflicts;
export const resolveProfileSync = (key: string, choice: "local" | "remote") => activeResolve?.(key, choice);
function setConflicts(next: ProfileConflict[]) {
  conflicts = next;
  if (!next.some(c=>profileConflictId(c)===selectedConflict)) selectedConflict = null;
  statusListeners.forEach(f => f());
}
export type ProfileSyncStatus = "offline" | "pending" | "syncing" | "synced" | "paused" | "conflict";
let status: ProfileSyncStatus = "offline";
const statusListeners = new Set<() => void>();
export const profileSyncStatus = () => status;
export const subscribeProfileSync = (listener: () => void) => { statusListeners.add(listener); return () => { statusListeners.delete(listener); }; };
export const requestProfileSync = () => activeRequest?.();
function setStatus(next: ProfileSyncStatus) { status = next; statusListeners.forEach(f => f()); }

export function startProfileSync(): () => void {
  if (new URLSearchParams(window.location.search).get("window") === "overlay") return () => {};
  activeStop?.();
  let stopped = false, applying = false, running = false, queued = false;
  let state: ProfileState | null = null;
  let observed = flattenProfile(cardsSnapshot(), orgSnapshot());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let device = localStorage.getItem(DEVICE_KEY);
  if (!device || !/^[a-zA-Z0-9-]{8,80}$/.test(device)) {
    device = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, device);
  }
  const key = (email: string) => STATE_PREFIX + encodeURIComponent(email);
  const persist = () => { if (state) localStorage.setItem(key(state.owner), JSON.stringify(state)); };
  function apply() {
    if (!state) return;
    const merged = materializeProfile(state, blank());
    applying = true;
    try { restoreCardsFromSync(merged.cards); restoreOrgsFromSync(merged.orgs); }
    finally { observed = flattenProfile(cardsSnapshot(), orgSnapshot()); applying = false; }
  }
  function bind(email: string) {
    if (state?.owner === email) return;
    const previousOwner = localStorage.getItem(OWNER_KEY);
    const raw = localStorage.getItem(key(email));
    state = raw ? parseProfileState(raw, email) : newProfileState(email, device!);
    // Restored browser storage may contain another device's id: this writer is ours.
    state.device = device!;
    if (!previousOwner || previousOwner === email) {
      const before = raw ? materializeProfile(state, blank()) : null;
      state = captureProfile(state, flattenProfile(cardsSnapshot(), orgSnapshot()), before ? flattenProfile(before.cards, before.orgs) : undefined);
    }
    persist();
    localStorage.setItem(OWNER_KEY, email);
    apply();
  }
  function schedule(delay = 2500) {
    if (stopped || experienceMode() !== "full") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void sync(); }, delay);
  }
  function localChanged() {
    if (applying || stopped) return;
    const current = flattenProfile(cardsSnapshot(), orgSnapshot());
    if (state && localStorage.getItem(OWNER_KEY) === state.owner) {
      state = captureProfile(state, current, observed);
      try { persist(); } catch { void logLine("[PROFILE] local checkpoint could not be saved"); }
    }
    observed = current;
    setStatus("pending");
    schedule();
  }
  async function sync() {
    if (running) { queued = true; return; }
    if (stopped || experienceMode() !== "full") return;
    running = true;
    const revision = experienceRevision();
    const version = getSeafileCredentialVersion();
    let token = "";
    const current = () => !stopped && experienceMode() === "full" && experienceRevision() === revision
      && version === getSeafileCredentialVersion() && token === getSeafileToken();
    const check = () => { if (!current()) throw new Error("Profile sync superseded"); };
    try {
      await ensureSeafileLoaded();
      token = getSeafileToken();
      if (!token) { setStatus("offline"); return; }
      check();
      setStatus("syncing");
      const account = await invoke<SeafileAccount>("seafile_account", { token });
      check();
      const email = account.email.trim().toLowerCase();
      if (!email.includes("@")) throw new Error("Profile account unavailable");
      bind(email);
      const repo = await ensureOwnedCloudRepo(token, REPO);
      check();
      if (repo.owner?.toLowerCase() !== email) throw new Error("Profile library owner mismatch");
      // The dedicated profile library must not have public, group, folder OR user grants.
      await invoke("seafile_assert_account_acl", { token, repoId: repo.id });
      check();
      const grants = await invoke<unknown[]>("seafile_repo_user_shares", { token, repoId: repo.id });
      check();
      if (!Array.isArray(grants) || grants.length) throw new Error("Profile library is shared; sync paused");
      const rows = await invoke<SeafileEntry[]>("seafile_dir", { token, repoId: repo.id, path: "/" });
      check();
      const files = rows.filter(r => r.kind === "file" && /^device-[a-zA-Z0-9-]{8,80}\.json$/.test(r.name));
      if (files.length > 100) throw new Error("Too many profile devices");
      let ownText: string | undefined;
      const remoteStates: ProfileState[] = [];
      const fileName = `device-${device}.json`;
      for (const file of files) {
        if (file.size > PROFILE_MAX_BYTES) throw new Error("Profile document too large");
        const b64 = await invoke<string>("seafile_read_bytes", { token, repoId: repo.id, path: "/" + file.name, maxBytes: PROFILE_MAX_BYTES });
        check();
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const text = new TextDecoder().decode(bytes);
        const remote = parseProfileState(text, email);
        if (file.name !== `device-${remote.device}.json`) throw new Error("Profile device mismatch");
        if (file.name === fileName) ownText = text;
        remoteStates.push(remote);
      }
      check();
      const problems: ProfileConflict[] = [];
      for (const remote of remoteStates) {
        const concurrent = profileConflicts(state!, remote);
        const safe = concurrent.filter(c => profileConflictPaths(c).length === 0);
        for (const conflict of safe) state = resolveProfileConflict(state!, conflict, "merge");
        const blocked = concurrent.filter(c => profileConflictPaths(c).length > 0);
        problems.push(...blocked);
        const blockedKeys = new Set(blocked.map(c => c.key));
        state = mergeProfile(state!, { ...remote, records: Object.fromEntries(Object.entries(remote.records).filter(([key]) => !blockedKeys.has(key))) });
      }
      setConflicts(problems);
      const content = JSON.stringify(state);
      if (new TextEncoder().encode(content).length > PROFILE_MAX_BYTES) throw new Error("Profile document too large");
      persist();
      apply();
      if (content !== ownText) {
        await invoke("seafile_upload_profile", { token, repoId: repo.id, name: fileName, content });
        check();
      }
      setStatus(problems.length ? "conflict" : JSON.stringify(state) === content ? "synced" : "pending");
    } catch (error) {
      if (current()) {
        setStatus("paused");
        // A server error may echo submitted profile data. Log categories only.
        const message = error instanceof Error ? error.message : "";
        const http = /\bHTTP\s+(\d{3})\b/i.exec(message)?.[1];
        const known = ["Profile sync superseded", "Profile account unavailable", "Profile library owner mismatch", "Profile library is shared; sync paused", "Too many profile devices", "Profile document too large", "Profile device mismatch", "Invalid profile document", "Invalid profile record", "Profile account mismatch"];
        const reason = known.includes(message) ? message
          : /command .*seafile_upload_profile.*not found/i.test(message) ? "native profile command unavailable"
          : http ? `HTTP ${http}` : "native request failed";
        void logLine(`[PROFILE] sync paused: ${reason}`);
      }
    } finally {
      running = false;
      if (queued) { queued = false; schedule(); }
    }
  }
  let watchedVersion = getSeafileCredentialVersion();
  const onAccount = () => {
    const version = getSeafileCredentialVersion();
    if (version === watchedVersion) return;
    watchedVersion = version;
    setConflicts([]);
    setStatus("offline");
    state = null;
    // Keep the previous account's checkpoint, but never show/upload its index
    // under a newly connected account. A token rotation will restore its own copy.
    if (localStorage.getItem(OWNER_KEY)) {
      localStorage.setItem(OWNER_KEY, "__none__");
      applying = true;
      try { restoreCardsFromSync({ v: 1, personal: blank(), contacts: [], orgs: [] }); restoreOrgsFromSync({ v: 1, orgs: [] }); }
      finally { observed = flattenProfile(cardsSnapshot(), orgSnapshot()); applying = false; }
    }
    if (running) queued = true;
    schedule(100);
  };
  const onMode = () => {
    if (timer) clearTimeout(timer);
    if (experienceMode() === "full") { setStatus("pending"); schedule(100); }
  };
  const onFocus = () => schedule(100);
  const cleanups = [subscribeCards(localChanged), subscribeOrgs(localChanged), subscribeSeafile(onAccount), subscribeExperience(onMode)];
  window.addEventListener("focus", onFocus);
  const interval = setInterval(() => schedule(100), 60_000);
  schedule(0);
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    clearInterval(interval);
    cleanups.forEach(f => f());
    window.removeEventListener("focus", onFocus);
    if (activeStop === stop) { activeStop = undefined; activeRequest = undefined; activeResolve = undefined; setConflicts([]); }
  };
  activeStop = stop;
  activeRequest = () => { setStatus("pending"); schedule(0); };
  activeResolve = (key, choice) => {
    // Manual decisions must choose a side; automatic merging only handles compatible edits.
    if (choice !== "local" && choice !== "remote") return;
    if (experienceMode() !== "full" || !state || !getSeafileToken()) return;
    const conflict = conflicts.find(c => profileConflictId(c) === key || c.key === key);
    if (!conflict) return;
    // A local edit made while the preview was open needs a fresh comparison.
    if (JSON.stringify(state.records[conflict.key]) !== JSON.stringify(conflict.local)) { schedule(0); return; }
    state = resolveProfileConflict(state, conflict, choice);
    persist();
    setConflicts(conflicts.filter(c => c.key !== conflict.key));
    apply();
    setStatus("pending");
    schedule(0);
  };
  return stop;
}
