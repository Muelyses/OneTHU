import type { Homework } from "@onethu/core";
import { parseLearnTime } from "../../../../packages/core/src/learn/time.js";

/** The timeline and selected-day agenda share the same filtered deadline records. */
export interface ScheduleHomework {
  homework: Homework;
  deadline: number;
  date: string;
  time: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

const hm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export function scheduleHomework(
  homework: readonly Homework[],
  ignored: ReadonlyMap<string, unknown>,
): ScheduleHomework[] {
  const seen = new Set<string>();
  const result: ScheduleHomework[] = [];
  for (const h of homework) {
    if (seen.has(h.id) || ignored.has(h.id) || h.audited) continue;
    seen.add(h.id);
    const date = parseLearnTime(h.deadline);
    if (!date || !Number.isFinite(date.getTime())) continue;
    const minutes = date.getHours() * 60 + date.getMinutes();
    result.push({
      homework: h,
      deadline: date.getTime(),
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      time: hm(minutes),
      dayOfWeek: (date.getDay() + 6) % 7 + 1,
      // A DDL is a marker, not a work session. Keep it on its deadline day;
      // midnight gets a small visible marker rather than a backwards 22:00–00:00 block.
      startTime: hm(Math.max(0, minutes - 120)),
      endTime: hm(Math.max(15, minutes)),
    });
  }
  return result.sort((a, b) => a.deadline - b.deadline);
}
