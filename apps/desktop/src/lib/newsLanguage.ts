import type { NewsItem } from "@onethu/core";

/** The portal supplies Chinese and English labels. Other UI languages use its
 * English labels while news headlines and article text stay in their source language. */
export function newsLanguage(locale: string): "zh" | "en" {
  return /^zh(?:-|$)/i.test(locale) ? "zh" : "en";
}

/** v2 deliberately leaves legacy, unlabelled English/Chinese cache entries behind. */
export function newsCacheKey(locale: string, page: number, length: number): string {
  return `news:v2:${newsLanguage(locale)}:${page}:${length}`;
}

export function todayNewsCacheKey(locale: string, subscriptions: string): string {
  return `todaynews:v2:${newsLanguage(locale)}:${subscriptions}`;
}

/** Detail metadata can come from a search or subscription page as well as the
 * main list. Only the current language may fill it; article text is separate. */
export function newsMetadataForLanguage(id: string, language: "zh" | "en", pages: Array<{ language: "zh" | "en"; items: NewsItem[] | null | undefined }>): NewsItem | undefined {
  for (const page of pages) {
    const item = page.language === language ? page.items?.find(item => item.xxid === id) : undefined;
    if (item) return item;
  }
  return undefined;
}
