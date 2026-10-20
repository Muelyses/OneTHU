import { CAMPUS_TZ, wallToEpoch } from "../../../../packages/core/src/caldav/ics.js";

/** Validate native date/time fields before constructing calendar timestamps.
 * Empty strings must not silently become year 1899 or midnight. */
export function calendarDraftRange(draft: {
  date: string; endDate: string; start: string; end: string; allDay: boolean;
}): { start: number; end: number } {
  const date = (value: string): Date => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new Error("请填写完整的开始日期和结束日期");
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const result = new Date(Date.UTC(year, month - 1, day));
    if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day) {
      throw new Error("日期无效，请重新选择");
    }
    return result;
  };
  const time = (value: string): [number, number] => {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error("请填写有效的开始时间和结束时间");
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
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("结束日期和时间需要晚于开始时间");
  return { start, end };
}
