/**
 * 教室占用 / 洗衣机状态的**解读**（纯函数，可直测）。
 *
 * 与 state/widgetLive.ts 分开：那边负责联网抓取与读缓存（依赖 Tauri/HTTP，测不了），
 * 这边只认数据、只算文字。分开的理由很实际——「现在第几节」「哪几节空着」这类判读最容易
 * 在时间边界上出错（课间、夜里、周末），而它对用户是「桌面上一句写错的话」，必须能测。
 */
export interface LiveRow {
  text: string;
  sub?: string;
}

/** core ClassroomStatus.AVAILABLE = 5 */
export const AVAILABLE = 5;

/** 大节近似钟点（分钟）：清华本科作息 */
export const SLOT_TIMES: Array<[number, number]> = [
  [480, 585],   // 第1节 08:00–09:45
  [600, 705],   // 第2节 10:00–11:45
  [840, 945],   // 第3节 14:00–15:45
  [960, 1065],  // 第4节 16:00–17:45
  [1140, 1245], // 第5节 19:00–20:45
  [1260, 1365], // 第6节 21:00–22:45
];

/** 分钟数 → HH:MM */
export function fmtClock(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/** 某一天的 6 格状态（周一=0） */
export function todayColumn(grid: number[] | null, now: number): number[] | null {
  if (!grid) return null;
  const col = (new Date(now).getDay() + 6) % 7;
  return grid.slice(col * 6, col * 6 + 6);
}

function minutesOf(now: number): number {
  const d = new Date(now);
  return d.getHours() * 60 + d.getMinutes();
}

/** 现在落在第几个大节（0 起）；课间/夜里返回 -1 */
export function currentSlot(now: number): number {
  const mins = minutesOf(now);
  return SLOT_TIMES.findIndex(([s, e]) => mins >= s && mins < e);
}

/** 下一个还没开始的大节序号；都过了返回 -1 */
export function nextSlot(now: number): number {
  const mins = minutesOf(now);
  return SLOT_TIMES.findIndex(([s]) => mins < s);
}

/** 教室今天的状态一句话（本节 / 下一节 / 已结束） */
export function roomStatusLine(day: number[], now: number): string {
  const free = (i: number): boolean => day[i] === AVAILABLE;
  const cur = currentSlot(now);
  if (cur >= 0 && cur < day.length) return `本节${free(cur) ? "空闲" : "占用"}`;
  const next = nextSlot(now);
  if (next < 0 || next >= day.length) return "今日课程已结束";
  return `下一节（第 ${next + 1} 节）${free(next) ? "空闲" : "占用"}`;
}

/* ══════════ 三类下沉原子的详情 ══════════ */

export interface WasherInfo {
  name?: string;
  location?: string;
  type?: string;
  status?: string;
  eta?: number;
  floor?: string;
}

/** 单台洗衣机：状态 + 本楼空闲数 */
export function washerMachineDetail(device: WasherInfo, all: WasherInfo[], buildingName: string): { rows: LiveRow[]; footer: string } {
  const state = device.status === "idle"
    ? "空闲"
    : device.status === "working"
      ? (device.eta && device.eta > 0 ? `使用中 · 剩 ${device.eta} 分钟` : "使用中")
      : "状态未知";
  const idle = all.filter((x) => x.status === "idle").length;
  return {
    rows: [
      { text: state, sub: device.floor ?? undefined },
      { text: `${buildingName} 共 ${all.length} 台 · 空闲 ${idle} 台` },
    ],
    footer: device.status === "working" && device.eta && device.eta > 0 ? `约 ${device.eta} 分钟后可用` : "点开可换一台",
  };
}

/** 楼栋洗衣机：空闲总数 + 空闲最多的两层 */
export function washerBuildingDetail(all: WasherInfo[], buildingName: string): { rows: LiveRow[]; footer: string } {
  const idleList = all.filter((x) => x.status === "idle");
  const byFloor = new Map<string, number>();
  for (const w of idleList) byFloor.set(w.floor ?? "—", (byFloor.get(w.floor ?? "—") ?? 0) + 1);
  const rows: LiveRow[] = [{ text: `空闲 ${idleList.length} / ${all.length} 台` }];
  for (const [floor, n] of [...byFloor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    rows.push({ text: `${floor} 空闲 ${n} 台` });
  }
  return { rows, footer: buildingName };
}

/** 单间教室：本节 / 下一节状态 + 今日空闲节次 */
export function roomDetail(day: number[], roomName: string, now: number): { rows: LiveRow[]; footer: string } | null {
  if (!day || day.length === 0) return null;
  const rows: LiveRow[] = [{ text: roomStatusLine(day, now), sub: roomName }];
  const freeSlots = day.map((s, i) => (s === AVAILABLE ? i + 1 : 0)).filter((n) => n > 0);
  rows.push({ text: freeSlots.length ? `今日空闲：第 ${freeSlots.join("、")} 节` : "今日已排满" });
  const cur = currentSlot(now);
  if (cur >= 0 && cur < day.length) {
    const [from, to] = SLOT_TIMES[cur]!;
    rows.push({ text: `现在第 ${cur + 1} 节 ${fmtClock(from)}–${fmtClock(to)}`, sub: "点开看整周占用" });
  }
  return { rows, footer: `${roomName ? roomName + " · " : ""}今日占用总览` };
}

/** 教学楼：本节（或下一节）空闲间数 + 全天空闲分布 */
export function buildingDetail(rooms: Array<{ name: string; day: number[] }>, buildingName: string, now: number): { rows: LiveRow[]; footer: string } | null {
  if (rooms.length === 0) return null;
  const counts = SLOT_TIMES.map((_, i) => rooms.filter((r) => r.day[i] === AVAILABLE).length);
  const cur = currentSlot(now);
  const at = cur >= 0 ? cur : nextSlot(now);
  const rows: LiveRow[] = [];
  if (at >= 0) rows.push({ text: `${cur >= 0 ? "本节" : "下一节"}空闲 ${counts[at]} / ${rooms.length} 间`, sub: buildingName });
  rows.push({ text: `全天空闲：${counts.map((c, i) => `第${i + 1}节 ${c}`).join(" · ")}` });
  return { rows, footer: `${buildingName}楼 · 实时占用` };
}
