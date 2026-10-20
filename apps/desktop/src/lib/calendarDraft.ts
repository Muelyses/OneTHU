import { t as i18n } from "../i18n/index.js";
import { CAMPUS_TZ, wallToEpoch } from "../../../../packages/core/src/caldav/ics.js";

/** Validate native date/time fields before constructing calendar timestamps.
 * Empty strings must not silently become year 1899 or midnight. */
export function calendarDraftRange(draft: {
  date: string; endDate: string; start: string; end: string; allDay: boolean;
}): { start: number; end: number } {
  const date = (value: string): Date => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new Error(i18n("lib.calendardraft.c1388c78407f"));
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const result = new Date(Date.UTC(year, month - 1, day));
    if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day) {
      throw new Error(i18n("lib.calendardraft.781062bdc95c"));
    }
    return result;
  };
  const time = (value: string): [number, number] => {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error(i18n("lib.calendardraft.5f8b49175a54"));
    return [Number(match[1]), Number(match[2])];
  };
  const from = date(draft.date), to = date(draft.endDate);
  if (draft.allDay) to.setUTCDate(to.getUTCDate() + 1);
  else {
    const [sh, sm] = time(draft.start), [eh, em] = time(draft.end);
    from.setUTCHours(sh, sm); to.setUTCHours(eh, em);
  }
  const epoch = (d: Date): number => wallToEpoch(CAMPUS_TZ, {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: 0,
  });
  const start = epoch(from), end = epoch(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error(i18n("lib.calendardraft.000e00815ce9"));
  return { start, end };
}
