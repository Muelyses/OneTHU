/** Small, version-tolerant text contract shared with Android. No account or event identifiers. */
import { getLocale, localeTable } from "../i18n/index.js";
import { interpolateMessage } from "../i18n/messageFormat.js";

export const WIDGET_TEXT_KEYS = [
  "today",
  "title",
  "date",
  "ongoing",
  "completed",
  "empty",
  "course",
  "homework",
  "event",
  "favorites",
  "detail",
  "classRow",
  "ddlRow",
  "eventRow",
  "relativeRow",
  "joiner",
  "choose",
  "chooseContent",
  "pluginTitle",
  "emptySlot",
  "minutes.zero",
  "minutes.one",
  "minutes.two",
  "minutes.few",
  "minutes.many",
  "minutes.other",
  "hours.zero",
  "hours.one",
  "hours.two",
  "hours.few",
  "hours.many",
  "hours.other",
  "days.zero",
  "days.one",
  "days.two",
  "days.few",
  "days.many",
  "days.other",
  "classes.zero",
  "classes.one",
  "classes.two",
  "classes.few",
  "classes.many",
  "classes.other",
  "ddls.zero",
  "ddls.one",
  "ddls.two",
  "ddls.few",
  "ddls.many",
  "ddls.other",
  "events.zero",
  "events.one",
  "events.two",
  "events.few",
  "events.many",
  "events.other",
  "more.zero",
  "more.one",
  "more.two",
  "more.few",
  "more.many",
  "more.other"
] as const;
export type WidgetTextKey = typeof WIDGET_TEXT_KEYS[number];
export interface WidgetLocaleSnapshot {
  /** Missing fields mean a legacy Chinese snapshot, regardless of the current application locale. */
  locale?: string;
  widgetText?: Partial<Record<WidgetTextKey, string>>;
}

export function buildWidgetLocale(locale = getLocale()): Required<WidgetLocaleSnapshot> {
  const selected = localeTable(locale);
  const fallback = localeTable("zh-CN");
  return { locale, widgetText: Object.fromEntries(WIDGET_TEXT_KEYS.map(key => {
    const messageKey = `native.widget.${key}`;
    return [key, selected[messageKey] || fallback[messageKey] || messageKey];
  })) };
}

export function widgetText(snapshot: WidgetLocaleSnapshot = {}) {
  const locale = snapshot.locale || "zh-CN";
  const fallback = localeTable("zh-CN");
  let numbers: Intl.NumberFormat;
  let plurals: Intl.PluralRules;
  try { numbers = new Intl.NumberFormat(locale, { useGrouping: false }); plurals = new Intl.PluralRules(locale); }
  catch { numbers = new Intl.NumberFormat("zh-CN", { useGrouping: false }); plurals = new Intl.PluralRules("zh-CN"); }
  const text = (key: WidgetTextKey, params: Record<string, string | number> = {}): string => {
    const supplied = snapshot.widgetText?.[key];
    const template = typeof supplied === "string" && supplied ? supplied : fallback[`native.widget.${key}`] || key;
    const formatted = Object.fromEntries(Object.entries(params).map(([name, value]) => [name, typeof value === "number" ? numbers.format(value) : value]));
    return interpolateMessage(template, formatted, () => undefined);
  };
  const count = (key: "minutes" | "hours" | "days" | "classes" | "ddls" | "events" | "more", n: number): string => {
    const category = plurals.select(n);
    const selected = `${key}.${category}` as WidgetTextKey;
    const supplied = snapshot.widgetText;
    // Partial third-party/older payloads may only carry `other`; never pick an unrelated locale.
    const branch = supplied && !supplied[selected] && supplied[`${key}.other`] ? `${key}.other` as WidgetTextKey : selected;
    return text(branch, { count: n });
  };
  const left = (ms: number): string => {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    return minutes < 60 ? count("minutes", minutes) : minutes < 2880 ? count("hours", Math.round(minutes / 60)) : count("days", Math.round(minutes / 1440));
  };
  const date = (at: number): string => { const d = new Date(at); return text("date", { month: d.getMonth() + 1, day: d.getDate() }); };
  const title = (at: number): string => { const d = new Date(at); return text("title", { month: d.getMonth() + 1, day: d.getDate() }); };
  const join = (parts: string[]): string => parts.filter(Boolean).join(text("joiner"));
  return { text, count, left, date, title, join };
}
