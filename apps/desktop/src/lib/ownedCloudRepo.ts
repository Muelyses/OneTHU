import { invoke } from "@tauri-apps/api/core";
import { t as i18n } from "../i18n/index.js";
import type { SeafileAccount, SeafileRepo } from "../state/seafile.js";

/** One gate for every automatic personal-library creator. Server metadata must
 * positively identify ownership; a name, writable share or absent field cannot. */
export function hasOwnedRepoMetadata(repo: SeafileRepo): boolean {
  return ["mine", "shared", "group", "org"].includes(repo.repoType ?? "")
    && typeof repo.isVirtual === "boolean" && typeof repo.owner === "string"
    && (repo.repoType !== "mine" || repo.owner.includes("@"));
}

const pending = new Map<string, Promise<SeafileRepo>>();
const uncertainCreates = new Set<string>();
const CREATE_KEY = "onethu.cloud.pending-create.v1:";

function markerKey(email: string, name: string): string {
  return CREATE_KEY + encodeURIComponent(email.toLowerCase()) + ":" + encodeURIComponent(name);
}
function hasMarker(key: string): boolean {
  if (uncertainCreates.has(key)) return true;
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}
function markCreate(key: string): void {
  uncertainCreates.add(key);
  try { localStorage.setItem(key, "1"); } catch { /* Session guard still applies. */ }
}
function clearMarker(key: string): void {
  uncertainCreates.delete(key);
  try { localStorage.removeItem(key); } catch { /* Verified library remains usable. */ }
}

function chooseExisting(rows: SeafileRepo[], name: string, preferredId?: string): SeafileRepo | undefined {
  const owned = rows.filter((repo) => repo.name === name && hasOwnedRepoMetadata(repo)
    && repo.repoType === "mine" && repo.isVirtual === false);
  const populated = owned.filter((repo) => repo.size > 0);
  const preferred = owned.find((repo) => repo.id === preferredId);
  // Empty accidental duplicates must not shadow the original populated library.
  if (populated.length === 1) return populated[0];
  if (populated.length > 1) {
    if (preferred && preferred.size > 0) return preferred;
    throw new Error(i18n("state.seafile.duplicatePersonalLibraries"));
  }
  return preferred ?? [...owned].sort((a, b) => a.mtime - b.mtime || a.id.localeCompare(b.id))[0];
}

/** Single-flight is shared by memory, wallpaper, vault and folder/organization
 * callers. An ambiguous POST outcome is remembered across app reloads; only a
 * later authoritative listing may resolve it, never another blind POST. */
export function ensureOwnedCloudRepo(token: string, name: string, preferredId?: string): Promise<SeafileRepo> {
  const key = token + "\0" + name;
  const current = pending.get(key);
  if (current) return current;
  const operation = (async () => {
    const rows = await invoke<SeafileRepo[]>("seafile_repos", { token });
    const existing = chooseExisting(rows, name, preferredId);
    if (existing) {
      clearMarker(markerKey(existing.owner!, name));
      return existing;
    }
    if (rows.some((repo) => !hasOwnedRepoMetadata(repo))) {
      throw new Error(i18n("state.seafile.nativeRestartRequired"));
    }
    const account = await invoke<SeafileAccount>("seafile_account", { token });
    if (!account.email?.includes("@")) throw new Error(i18n("state.seafile.nativeRestartRequired"));
    const marker = markerKey(account.email, name);
    if (hasMarker(marker)) throw new Error(i18n("state.seafile.libraryCreationUnconfirmed"));
    markCreate(marker);
    let createdId: string | undefined;
    try {
      const made = await invoke<{id?: string}>("seafile_create_repo", {token, name});
      createdId = made?.id;
    } catch {
      // A timeout can arrive after the server has created the library.
    }
    const after = await invoke<SeafileRepo[]>("seafile_repos", { token });
    const made = chooseExisting(after, name, createdId ?? preferredId);
    if (!made) throw new Error(i18n("state.seafile.libraryCreationUnconfirmed"));
    clearMarker(marker);
    return made;
  })();
  pending.set(key, operation);
  void operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => undefined);
  return operation;
}
