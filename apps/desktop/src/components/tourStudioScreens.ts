import { t as i18n, getLocale } from "../i18n/index.js";
/** Bundled captures of the running OneTHU app. Never synthesize a screen here. */
const bundledUrls = import.meta.glob<string>("../assets/tour/real-ui/**/*.png", {
  eager: true, query: "?url", import: "default",
});
export const STUDIO_SCREEN_KEYS = [
  "simple-home", "simple-home-done", "practical-home", "practical-home-done",
  "practical-more", "practical-home-customized", "schedule", "vault",
  "vault-send-preview", "vault-send-code", "vault-receive", "vault-received",
  "board-full", "organization", "full-home-mobile",
  "workspaces", "onego", "plugins", "appearance", "learn", "data", "xiaoda-chat", "xiaoda-skills", "search", "oh", "vault-drag-start", "vault-drag-done", "search-simple", "oh-simple", "search-practical", "oh-practical",
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
const bundledVideos = import.meta.glob<string>("../assets/tour/real-ui/**/vault-drag.mp4", {
  eager: true, query: "?url", import: "default",
});
/** Non-Chinese locales use the English demonstration, never a Chinese screen. */
export const studioAssetLocale = (locale = getLocale()): "zh-CN" | "en-US" => locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
export function studioScreenUrls(locale = getLocale()): Readonly<Record<StudioScreenKey, string>> {
  const folder = studioAssetLocale(locale) === "zh-CN" ? "" : "en-US/";
  return Object.fromEntries(STUDIO_SCREEN_KEYS.map(key => [key, bundledUrls[`../assets/tour/real-ui/${folder}${key}.png`] ?? ""])) as Record<StudioScreenKey, string>;
}
export function studioVaultVideo(locale = getLocale()): string {
  const folder = studioAssetLocale(locale) === "zh-CN" ? "" : "en-US/";
  return bundledVideos[`../assets/tour/real-ui/${folder}vault-drag.mp4`] ?? "";
}

/** Used by the physical models and the CSS fallback, so both show the same UI. */
export function selectStudioScreen(
  lesson: string, mode: "simple" | "practical" | "full" = "full", after = false,
): StudioScreenSelection {
  const urls = studioScreenUrls();
  const source = (key: StudioScreenKey): StudioScreenSource => ({ key, url: urls[key] });
  const home: StudioScreenKey = mode === "practical" ? "practical-home" : mode === "simple" ? "simple-home" : "full-home-mobile";
  if (lesson === "nfc") return {
    primary: source(after ? "vault-send-code" : "vault-send-preview"),
    secondary: source(after ? "vault-received" : "vault-receive"),
  };
  let key: StudioScreenKey = home;
  if (lesson === "board" || lesson === "mode-full") key = "board-full";
  else if (lesson === "organization") key = "organization";
  else if (lesson === "vault") key = after ? "vault-drag-done" : "vault-drag-start";
  else if (lesson === "essentials") key = mode === "full" ? after ? "oh" : "search" : `${after ? "oh" : "search"}-${mode}`;
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
const pending = new Map<string, Promise<StudioScreenAssets>>();
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
export function loadStudioScreenAssets(locale = getLocale()): Promise<StudioScreenAssets> {
  const language = studioAssetLocale(locale), cached = pending.get(language);
  if (cached) return cached;
  const urls = studioScreenUrls(locale);
  const result = Promise.all(STUDIO_SCREEN_KEYS.map(async key => {
    const url = urls[key];
    if (!url) throw new Error(i18n("components.tourstudioscreens.fca0380c4f7e", { key: String(key) }));
    return [key, await decodeScreen(url)] as const;
  })).then(entries => Object.fromEntries(entries) as StudioScreenAssets).catch((error: unknown) => {
    pending.delete(language);
    throw error;
  });
  pending.set(language, result);
  return result;
}
