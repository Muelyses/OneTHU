import { getCurrentWindow } from "@tauri-apps/api/window";

/** One session/facade owner per native app. The orb sends commands to the shared
 * native host; only the main document may start it or execute host callbacks.
 * In dev phone-frame mode the outer document is presentation only; its inner
 * document adopts the same main-window bridge and owns the app runtime. */
export function isPluginRuntimeOwner(): boolean {
  if (typeof window === "undefined") return false;
  const query = new URLSearchParams(window.location.search);
  if (query.get("window") === "overlay" || query.has("phone-frame")) return false;
  if (!("__TAURI_INTERNALS__" in window)) return true;
  try { return getCurrentWindow().label === "main"; }
  catch { return false; }
}

export function requirePluginRuntimeOwner(): void {
  if (!isPluginRuntimeOwner()) throw new Error("PLUGIN_MAIN_WINDOW_REQUIRED");
}
