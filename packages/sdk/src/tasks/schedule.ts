import type { TaskSchedule } from "./types.js";
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string) {
  let value = formatters.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    if (formatters.size > 64) formatters.clear();
    formatters.set(timezone, value);
  }
  return value;
}
export function validateSchedule(input: TaskSchedule): void {
  if (!input || typeof input !== "object") throw new Error("TASK_SCHEDULE_INVALID");
  if (input.kind === "interval") {
    if (!Number.isFinite(input.everyMinutes) || input.everyMinutes < 1 || input.everyMinutes > 525_600) throw new Error("TASK_INTERVAL_INVALID");
  } else if (input.kind === "daily") {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) || typeof input.timezone !== "string" || input.timezone.length > 100) throw new Error("TASK_DAILY_INVALID");
    try { formatter(input.timezone).format(0); } catch { throw new Error("TASK_TIMEZONE_INVALID"); }
  } else if (input.kind === "once") {
    if (typeof input.runAt !== "string" || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(input.runAt) || !Number.isFinite(Date.parse(input.runAt))) throw new Error("TASK_RUN_AT_INVALID");
  } else throw new Error("TASK_SCHEDULE_INVALID");
}
/** A missed occurrence schedules one run, then advances from now. It never
 * enumerates an offline backlog. Daily times use real zone rules, including DST. */
export function nextRun(schedule: TaskSchedule, after: number): number | null {
  validateSchedule(schedule);
  if (schedule.kind === "interval") return after + schedule.everyMinutes * 60_000;
  if (schedule.kind === "once") return Date.parse(schedule.runAt) > after ? Date.parse(schedule.runAt) : null;
  const fmt = formatter(schedule.timezone);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const day = date.format(after), alreadyPassedToday = fmt.format(after) >= schedule.time;
  let candidate = Math.floor(after / 60_000) * 60_000 + 60_000;
  // Covers a skipped DST hour or a skipped civil day without guessing offsets.
  for (let i = 0; i < 60 * 24 * 3; i++, candidate += 60_000) if (fmt.format(candidate) === schedule.time && (!alreadyPassedToday || date.format(candidate) !== day)) return candidate;
  throw new Error("TASK_NEXT_RUN_UNAVAILABLE");
}
