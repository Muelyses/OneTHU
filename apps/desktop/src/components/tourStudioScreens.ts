import { t as i18n } from "../i18n/index.js";
/** Bundled captures of the running OneTHU app. Never synthesize a screen here. */
const bundledUrls = import.meta.glob<string>("../assets/tour/real-ui/*.png", {
  eager: true, query: "?url", import: "default",
});
export const STUDIO_SCREEN_KEYS = [
  "simple-home", "simple-home-done", "practical-home", "practical-home-done",
  "practical-more", "practical-home-customized", "schedule", "vault",
  "vault-send-preview", "vault-send-code", "vault-receive", "vault-received",
  "board-full", "organization", "full-home-mobile",
  "workspaces", "onego", "plugins", "appearance", "learn", "data", "xiaoda-chat", "xiaoda-skills",
] as const;
export type StudioScreenKey = typeof STUDIO_SCREEN_KEYS[number];
export type StudioScreenAssets = Readonly<Record<StudioScreenKey, HTMLImageElement>>;
export interface StudioScreenSource { key: StudioScreenKey; url: string }
export interface StudioScreenSelection {
  /** The sender for a two-phone NFC demonstration. */
  primary: StudioScreenSource;
  /** The receiver, when the scene has two phones. */
  secondary?: StudioScreenSource;
}
export const STUDIO_SCREEN_URLS = Object.fromEntries(STUDIO_SCREEN_KEYS.map(key => [
  key, bundledUrls[`../assets/tour/real-ui/${key}.png`] ?? "",
])) as Readonly<Record<StudioScreenKey, string>>;

/** Used by the physical models and the CSS fallback, so both show the same UI. */
export function selectStudioScreen(
  lesson: string, mode: "simple" | "practical" | "full" = "full", after = false,
): StudioScreenSelection {
  const source = (key: StudioScreenKey): StudioScreenSource => ({ key, url: STUDIO_SCREEN_URLS[key] });
  const home: StudioScreenKey = mode === "practical" ? "practical-home" : mode === "simple" ? "simple-home" : "full-home-mobile";
  if (lesson === "nfc") return {
    primary: source(after ? "vault-send-code" : "vault-send-preview"),
    secondary: source(after ? "vault-received" : "vault-receive"),
  };
  let key: StudioScreenKey = home;
  if (lesson === "board" || lesson === "mode-full") key = "board-full";
  else if (lesson === "organization") key = "organization";
  else if (lesson === "vault") key = "vault";
  else if (lesson === "code") key = after ? "vault-send-code" : "vault-send-preview";
  else if (lesson === "today") key = after && mode !== "full" ? mode === "practical" ? "practical-home-done" : "simple-home-done" : home;
  else if (lesson === "quick") key = after ? "schedule" : home;
  else if (lesson === "more" || lesson === "mode-practical") key = after ? "practical-more" : "practical-home";
  else if (lesson === "swap") key = after ? "practical-home-customized" : "practical-more";
  else if (lesson === "mode-simple") key = "simple-home";
  else if (lesson === "explorer") key = "workspaces";
  else if (lesson === "onego") key = "onego";
  else if (lesson === "plugin") key = "plugins";
  else if (lesson === "customize") key = "appearance";
  else if (lesson === "campus") key = "learn";
  else if (lesson === "data") key = "data";
  else if (lesson === "xiaoda") key = after ? "xiaoda-skills" : "xiaoda-chat";
  return { primary: source(key) };
}

const decoded = new Map<string, Promise<HTMLImageElement>>();
let pending: Promise<StudioScreenAssets> | undefined;
function decodeScreen(url: string): Promise<HTMLImageElement> {
  const cached = decoded.get(url);
  if (cached) return cached;
  const result = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      void image.decode().then(() => {
        image.onload = image.onerror = null;
        resolve(image);
      }, (error: unknown) => { image.onload = image.onerror = null; reject(error); });
    };
    image.onerror = () => { image.onload = image.onerror = null; reject(new Error(i18n("components.tourstudioscreens.18455d8d7822"))); };
    image.src = url;
  }).catch((error: unknown) => { decoded.delete(url); throw error; });
  decoded.set(url, result);
  return result;
}

/** CPU images are shared; each assembly creates and disposes its own GPU textures. */
export function loadStudioScreenAssets(): Promise<StudioScreenAssets> {
  if (pending) return pending;
  pending = Promise.all(STUDIO_SCREEN_KEYS.map(async key => {
    const url = STUDIO_SCREEN_URLS[key];
    if (!url) throw new Error(i18n("components.tourstudioscreens.fca0380c4f7e", { key: String(key) }));
    return [key, await decodeScreen(url)] as const;
  })).then(entries => Object.fromEntries(entries) as StudioScreenAssets).catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
