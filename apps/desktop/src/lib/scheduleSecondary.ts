import type { ScheduleEntry } from "@onethu/core";

/** 二级课表和一级 JSONP 共用的窗口合并；保留原始数组供其他订阅者使用。 */
export async function appendSecondarySchedule(
  primary: ScheduleEntry[], firstDay: string, from: string, to: string,
): Promise<ScheduleEntry[]> {
  const { getSecondaryEntries } = await import("./infoLib.js");
  const { http } = await import("./clients.js");
  const secondary = await getSecondaryEntries(http, firstDay, from, to);
  const rows = [...primary];
  for (const c of secondary) {
    if (rows.some((r) => r.courseName === c.name && r.date === c.date && r.startTime === c.startTime)) continue;
    rows.push({
      courseName: c.name, location: c.location, date: c.date, dayOfWeek: c.dayOfWeek,
      startTime: c.startTime, endTime: c.endTime, category: "二级课表", raw: { source: "secondary" },
    });
  }
  return rows;
}
