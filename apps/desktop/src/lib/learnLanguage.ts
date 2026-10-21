import { getLocale } from "../i18n/index.js";

export type BilingualCourse = { name: string; englishName?: string };
/**
 * Use the school's own bilingual title. The cached course, matching identity,
 * and the remote website language preference are never modified.
 */
export function courseDisplayName(course: BilingualCourse, locale?: string): string;
export function courseDisplayName(course: BilingualCourse | null | undefined, locale?: string): string | undefined;
export function courseDisplayName(course: BilingualCourse | null | undefined, locale = getLocale()): string | undefined {
  if (!course) return undefined;
  const english = course.englishName?.trim();
  return !/^zh(?:-|$)/i.test(locale) && english ? english : course.name;
}
/** Search stays bilingual even when the displayed title changes. */
export function courseSearchNames(course: BilingualCourse): string {
  return [course.name, course.englishName].filter(Boolean).join(" ");
}
