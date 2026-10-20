import { createElement, Fragment, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { Locale, LocaleDef, MessageDescriptor, MessageParams, PluralMessages, RichSlots, UiText } from "./types.js";
import { hasMessageValue, interpolateMessage, messageTokens, messageValue } from "./messageFormat.js";
import zhSeed from "./locales/zh-CN.js";
import enSeed from "./locales/en-US.js";

export type { Locale, LocaleDef, MessageDescriptor, MessageParams, PluralMessages, RichSlots, UiText } from "./types.js";
export type MessageKey = keyof typeof zhSeed.messages;
export const DEFAULT_LOCALE = "zh-CN";
export const LOCALE_STORAGE_KEY = "onethu.locale";

// The literal glob is expanded by Vite. Node tests use the same built-in seeds.
const modules: Record<string, { default?: LocaleDef }> = typeof import.meta.env !== "undefined"
  ? import.meta.glob("./locales/*.ts", { eager: true })
  : {};
const registry = new Map<Locale, LocaleDef>([[DEFAULT_LOCALE, zhSeed], ["en-US", enSeed]]);
for (const [path, module] of Object.entries(modules)) {
  const code = path.slice(path.lastIndexOf("/") + 1, -3);
  const def = module.default;
  if (!def || typeof def.label !== "string" || !def.messages || typeof def.messages !== "object") continue;
  try { new Intl.DateTimeFormat(code); } catch { continue; }
  registry.set(code, def);
}

export const LOCALES: readonly Locale[] = Object.freeze([
  DEFAULT_LOCALE, ...[...registry.keys()].filter(code => code !== DEFAULT_LOCALE).sort(),
]);
export const LOCALE_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(LOCALES.map(code => [code, registry.get(code)!.label])),
);
export function availableLocales(): ReadonlyArray<{ code: Locale; label: string }> {
  return LOCALES.map(code => ({ code, label: LOCALE_LABELS[code]! }));
}
export const localeCodes = (): readonly Locale[] => LOCALES;
export const localeTable = (locale: Locale): Readonly<Record<string, string>> => registry.get(locale)?.messages ?? {};

function readLocale(): Locale {
  try {
    const saved = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    return saved && registry.has(saved) ? saved : DEFAULT_LOCALE;
  } catch { return DEFAULT_LOCALE; }
}
let current = readLocale();
const listeners = new Set<() => void>();
let installed = 0;
let channel: BroadcastChannel | null = null;
let uninstall: (() => void) | undefined;

export const getLocale = (): Locale => current;
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function applyLocale(next: Locale): void {
  if (!registry.has(next)) return;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  if (next === current) return;
  current = next;
  listeners.forEach(listener => listener());
}
/** Unknown codes are rejected; storage failure leaves the current session usable. */
export function setLocale(next: Locale): void {
  if (!registry.has(next)) return;
  applyLocale(next);
  try { globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, next); } catch { /* session only */ }
  try { channel?.postMessage(next); } catch { /* storage events remain available */ }
}

/** Install once per document. StrictMode setup/cleanup and sibling roots are safe. */
export function installI18n(): () => void {
  installed++;
  if (installed === 1 && typeof window !== "undefined") {
    applyLocale(current);
    const storage = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== LOCALE_STORAGE_KEY) return;
      try { if (event.storageArea && event.storageArea !== window.localStorage) return; } catch { return; }
      const next = event.key === null ? DEFAULT_LOCALE : event.newValue;
      applyLocale(next && registry.has(next) ? next : DEFAULT_LOCALE);
    };
    window.addEventListener("storage", storage);
    try {
      channel = new BroadcastChannel("onethu.locale");
      channel.onmessage = event => { if (typeof event.data === "string") applyLocale(event.data); };
    } catch { channel = null; }
    uninstall = () => {
      window.removeEventListener("storage", storage);
      channel?.close();
      channel = null;
    };
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    installed--;
    if (installed === 0) { uninstall?.(); uninstall = undefined; }
  };
}

const reported = new Set<string>();
function report(message: string): void {
  if (!import.meta.env?.DEV || reported.has(message)) return;
  reported.add(message);
  console.warn(`[i18n] ${message}`);
}
function templateFor(key: string, fallback?: string): string {
  for (const code of [current, DEFAULT_LOCALE]) {
    const messages = registry.get(code)?.messages;
    if (messages && Object.hasOwn(messages, key) && typeof messages[key] === "string" && messages[key] !== "") {
      return messages[key]!;
    }
  }
  if (fallback !== undefined) return fallback;
  report(`Missing message: ${key}`);
  return key;
}

/** Named interpolation only; replacement values are never reparsed or executed. */
export function t(key: string, params?: MessageParams): string {
  return interpolateMessage(templateFor(key), params, name => report(`Missing parameter ${name} in ${key}`));
}
/** Strict key entry point for new code; generated extraction can keep using t(string). */
export const typedT = (key: MessageKey, params?: MessageParams): string => t(key, params);
export function tOr(key: string, fallback: string, params?: MessageParams): string {
  return interpolateMessage(templateFor(key, fallback), params, name => report(`Missing parameter ${name} in ${key}`));
}
export function msg(key: string, params?: MessageParams): MessageDescriptor {
  return Object.freeze({ kind: "i18n", key, ...(params ? { params: Object.freeze({ ...params }) } : {}) });
}
export const message = msg;
/** Module-level label arrays stay arrays, but each index resolves at access time. */
export function localizedList(keys: readonly string[]): string[] {
  const labels: string[] = new Array(keys.length);
  keys.forEach((key, index) => {
    Object.defineProperty(labels, index, { enumerable: true, configurable: false, get: () => key ? t(key) : "" });
  });
  return Object.freeze(labels) as unknown as string[];
}
export function resolveMessage(value: UiText | null | undefined): string {
  return typeof value === "string" ? value : value ? t(value.key, value.params) : "";
}
/** Text stays React text. Named slots supply trusted React nodes, never translated markup. */
export function rich(key: string, slots: RichSlots, params?: MessageParams): ReactNode {
  return messageTokens(templateFor(key)).map((token, index) => {
    if ("text" in token) return token.text;
    if (Object.hasOwn(slots, token.name)) return createElement(Fragment, { key: `${token.name}-${index}` }, slots[token.name]);
    if (hasMessageValue(params, token.name)) return messageValue(params![token.name]);
    report(`Missing slot or parameter ${token.name} in ${key}`);
    return `{${token.name}}`;
  });
}
/** Branches are explicit keys, not ICU strings. `other` is required for every locale. */
export function plural(keys: PluralMessages, count: number, params?: MessageParams): string {
  const category = new Intl.PluralRules(current).select(count);
  const key = count === 0 && keys.zero ? keys.zero : keys[category] ?? keys.other;
  return t(key, { ...params, count });
}
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return Number.isFinite(value) ? new Intl.NumberFormat(current, options).format(value) : "—";
}
/** UI locale changes formatting, never the campus timezone or stored event timestamps. */
export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(current, { timeZone: "Asia/Shanghai", ...options }).format(date)
    : "—";
}
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, () => DEFAULT_LOCALE);
}
export function useT(): typeof t { useLocale(); return t; }
export function useI18n() {
  const locale = useLocale();
  return useMemo(() => ({ locale, t, msg, resolveMessage, rich, plural, formatDate, formatNumber }), [locale]);
}
