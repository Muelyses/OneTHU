/**
 * 通知计划（纯计算，可测）：日程 + 未交作业 + 两级提醒规则 → 未来 N 天要投递的系统通知。
 *
 * 投递后端（Android AlarmManager / macOS UNUserNotificationCenter / Windows toast）只做两件
 * 事：按计划把通知排进系统、按 id 撤销。规则全部在这里算——算错会半夜吵醒用户或漏掉 DDL，
 * 而这类问题靠真机试不出来，只能拿断言钉住。
 *
 * 稳定 id：`<kind>:<key>:<offset>`。同一事件同一提前量重复排程时 id 不变，重排前按 id 撤销
 * 即幂等（系统通知层唯一的去重手段：Android PendingIntent 与 macOS identifier 都按 id 覆盖）。
 */
// 只从窄模块取时间解析：core 索引会拉进 SM2（sm-crypto 是 CJS）与 HTTP 客户端，
// 纯计算内核必须能在无构建产物下直测，故走 ./learn/time.js 这个依赖无关的入口。
import { parseLearnTime } from "@onethu/core/src/learn/time.js";
import { effectiveRemind, type HwRemindState } from "./hwRemind.js";

export type NotifyKind = "class" | "exam" | "ddl" | "briefing";

/** 通知渠道（Android NotificationChannel 分档口径；三端共用同一套分档） */
export type NotifyChannel = "course" | "ddl" | "briefing";

export const NOTIFY_CHANNEL_NAMES: Record<NotifyChannel, string> = {
  course: "课程与考试",
  ddl: "作业截止",
  briefing: "每日早报",
};

/** 通知属于哪个渠道（后端据此选 Android 渠道 / 前端据此分组显示） */
export function channelOf(kind: NotifyKind): NotifyChannel {
  return kind === "ddl" ? "ddl" : kind === "briefing" ? "briefing" : "course";
}

export interface NotifyPlanItem {
  /** 稳定 id：`<kind>:<key>:<offset>`，重排幂等的依据 */
  id: string;
  kind: NotifyKind;
  /** 触发时刻（毫秒） */
  at: number;
  title: string;
  body: string;
  /** 点击通知打开的页面（宿主 nav.go 口径；空 = 只打开应用） */
  page?: string;
  params?: Record<string, unknown>;
  /** 因静默时段顺延到时段结束（调试可见；顺延后事件已过的条目直接丢弃） */
  shifted?: boolean;
}

export interface NotifySettings {
  /** 总开关：默认关，装完不打扰，用户在设置页显式打开 */
  enabled: boolean;
  /** 课程与考试提前量（分钟）；0 = 不提醒 */
  classLead: number;
  /** 作业 DDL 提醒开关（提前量沿用 hwRemind 的两级模型：全局默认 + 单作业覆盖） */
  ddl: boolean;
  /** 每日早报时刻 "HH:MM"；null = 关闭 */
  briefingAt: string | null;
  /** 静默时段的起止 "HH:MM"（跨夜为常态：23:00 → 07:00；起止相同 = 不静默） */
  quietFrom: string;
  quietTo: string;
  /** 计划时间窗（天） */
  horizonDays: number;
  /** 计划条数上限：macOS 待投递通知上限 64，默认留余量给滚动补充 */
  maxItems: number;
}

export const NOTIFY_DEFAULTS: NotifySettings = {
  enabled: false,
  classLead: 15,
  ddl: true,
  briefingAt: "07:30",
  quietFrom: "23:00",
  quietTo: "07:00",
  horizonDays: 7,
  maxItems: 56,
};

/* ── 日程 / 作业的最小输入形状（鸭子类型：调用方传快照即可，测试无需构造完整领域对象） ── */

export interface PlanScheduleEntry {
  date?: string;
  startTime?: string | null;
  endTime?: string | null;
  courseName?: string;
  location?: string | null;
  category?: string | null;
}

export interface PlanHomework {
  id?: string;
  title?: string;
  deadline?: string | number | null;
  submitted?: boolean;
  courseName?: string;
}

/* ── 时间与文本工具 ── */

function hmToMin(hm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm ?? "").trim().replace("：", ":"));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** "2026-09-21" + "08:00" → 毫秒（本地时区）；缺任一项或非法返回 null */
export function scheduleStart(e: PlanScheduleEntry): number | null {
  const date = String(e.date ?? "").trim();
  const time = String(e.startTime ?? "").trim().replace("：", ":");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const t = new Date(`${date}T${time.length === 4 ? `0${time}` : time}:00`);
  const ms = t.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** 静默时段的一次出现：起点与终点（同日的 cur 落在跨夜窗口的哪一半决定终点在次日） */
function quietWindowOf(at: number, fromMin: number, toMin: number): { start: number; end: number } | null {
  const d = new Date(at);
  const cur = d.getHours() * 60 + d.getMinutes();
  const inQuiet = fromMin < toMin
    ? cur >= fromMin && cur < toMin          // 同日窗口（如 12:00–14:00）
    : cur >= fromMin || cur < toMin;         // 跨夜窗口（如 23:00–07:00）
  if (!inQuiet) return null;
  const start = new Date(at);
  start.setHours(Math.floor(fromMin / 60), fromMin % 60, 0, 0);
  const end = new Date(at);
  end.setHours(Math.floor(toMin / 60), toMin % 60, 0, 0);
  if (fromMin > toMin) {
    // 跨夜：已过起点（如 23:30）→ 起点当日、终点次日；未到终点（如 02:00）→ 起点在前一日
    if (cur >= fromMin) end.setDate(end.getDate() + 1);
    else start.setDate(start.getDate() - 1);
  }
  return { start: start.getTime(), end: end.getTime() };
}

/** 落在静默时段内 → 顺延到该次静默的结束时刻（不处理「顺延后已晚于事件」，见 planFireTime） */
export function shiftOutOfQuiet(at: number, fromHm: string, toHm: string): { at: number; shifted: boolean } {
  const fromMin = hmToMin(fromHm);
  const toMin = hmToMin(toHm);
  if (fromMin == null || toMin == null || fromMin === toMin) return { at, shifted: false };
  const w = quietWindowOf(at, fromMin, toMin);
  return w ? { at: w.end, shifted: true } : { at, shifted: false };
}

/**
 * 结算最终触发时刻（静默时段的三种结局）。
 *
 * 顺延到静默结束若已晚于事件本身，就只剩两条路，按事件性质分开处理：
 *  - `clamp`（作业 DDL）：改到静默开始前的最后一分钟发。用户显式设了提醒却被静默吞掉
 *    是最糟的结果——宁可早一点通知，也不能不通知。
 *  - `drop`（课程/考试）：静默里更早的时段多半在深夜，前一夜 22:59 提醒次日 07:10 的课
 *    属于噪音；课程漏提醒可接受（当晚早报与次日界面仍在）。
 */
export function planFireTime(
  rawAt: number,
  hardAt: number,
  quietFrom: string,
  quietTo: string,
  now: number,
  onQuietConflict: "clamp" | "drop",
): { at: number; shifted?: true } | null {
  const fromMin = hmToMin(quietFrom);
  const toMin = hmToMin(quietTo);
  const empty = fromMin == null || toMin == null || fromMin === toMin;
  if (empty) return { at: rawAt };
  const w = quietWindowOf(rawAt, fromMin, toMin);
  if (!w) return { at: rawAt };
  if (w.end <= hardAt) return { at: w.end, shifted: true };
  if (onQuietConflict === "drop") return null;
  const clamped = w.start - 60_000;            // 静默开始前的最后一分钟
  if (clamped <= now || clamped > hardAt) return null;
  return { at: clamped, shifted: true };
}

function clip(s: string, n: number): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts.map((p) => String(p ?? "").trim()).filter(Boolean).join(" · ");
}

function fmtHM(hm: string | null | undefined): string {
  const t = String(hm ?? "").trim().replace("：", ":");
  return /^\d{1,2}:\d{2}$/.test(t) ? (t.length === 4 ? `0${t}` : t) : "";
}

/** 截止时刻的人话："今天 23:59" / "明天 09:00" / "9月21日 23:59" */
export function fmtDeadline(ms: number, now: number): string {
  const d = new Date(ms);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (t: number) => {
    const x = new Date(t);
    return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  };
  const today = new Date(now);
  const tomorrow = new Date(now + 86_400_000);
  if (day(ms) === day(today.getTime())) return `今天 ${hm}`;
  if (day(ms) === day(tomorrow.getTime())) return `明天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtMD(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 生成通知计划。
 *
 * 丢弃规则（宁缺勿扰）：触发时刻已过、超出时间窗、静默顺延后落在事件之后——一律不进计划。
 * 入参全部为快照（无网络副作用），因此可以在 tick 时反复调用，重排幂等。
 */
export function buildNotifyPlan(input: {
  schedule?: PlanScheduleEntry[] | null;
  homework?: PlanHomework[] | null;
  remind: HwRemindState;
  settings?: Partial<NotifySettings> | null;
  now: number;
}): NotifyPlanItem[] {
  const s: NotifySettings = { ...NOTIFY_DEFAULTS, ...(input.settings ?? {}) };
  if (!s.enabled) return [];
  const now = input.now;
  const nowDay = dayKey(now);
  const end = now + Math.max(1, s.horizonDays) * 86_400_000;
  const items: NotifyPlanItem[] = [];
  const seen = new Set<string>();

  /** hardAt = 事件本身发生的时刻：提醒晚于它就没有意义 */
  const push = (it: NotifyPlanItem, hardAt: number): void => {
    if (!Number.isFinite(it.at) || it.at <= now || it.at > end) return;
    if (it.at > hardAt) return;
    if (seen.has(it.id)) return;
    seen.add(it.id);
    items.push(it);
  };

  /* ① 课程与考试：提前 classLead 分钟 */
  if (s.classLead > 0) {
    for (const e of input.schedule ?? []) {
      const start = scheduleStart(e);
      if (start == null || start <= now) continue;
      const isExam = String(e.category ?? "") === "考试";
      const course = clip(e.courseName ?? (isExam ? "考试" : "课程"), 16);
      const loc = clip(e.location ?? "", 18);
      const lead = s.classLead;
      const q = planFireTime(start - lead * 60_000, start, s.quietFrom, s.quietTo, now, "drop");
      if (!q) continue;
      push({
        id: `${isExam ? "exam" : "class"}:${e.date ?? ""}:${fmtHM(e.startTime)}:${lead}`,
        kind: isExam ? "exam" : "class",
        at: q.at,
        title: `${fmtHM(e.startTime)} ${course}`,
        body: joinParts([loc, isExam ? `${lead} 分钟后开考` : `${lead} 分钟后上课`]),
        page: "schedule",
        ...(q.shifted ? { shifted: true } : {}),
      }, start);
    }
  }

  /* ② 作业 DDL：提前量取两级模型（单作业覆盖 → 全局默认） */
  if (s.ddl) {
    for (const h of input.homework ?? []) {
      if (h.submitted) continue;
      const d = parseLearnTime(h.deadline);
      if (!d) continue;
      const deadline = d.getTime();
      const key = String(h.id ?? "").trim();
      if (!key) continue;
      const lead = effectiveRemind(input.remind, key);
      const q = planFireTime(deadline - lead * 60_000, deadline, s.quietFrom, s.quietTo, now, "clamp");
      if (!q) continue;
      push({
        id: `ddl:${key}:${lead}`,
        kind: "ddl",
        at: q.at,
        title: `DDL · ${clip(h.courseName ?? "作业", 14)}`,
        body: joinParts([clip(h.title ?? "作业", 20), `${fmtDeadline(deadline, now)} 截止`]),
        page: "learn",
        ...(q.shifted ? { shifted: true } : {}),
      }, deadline);
    }
  }

  /* ③ 每日早报：当天有课或有截止才发，空日不打扰 */
  const bMin = s.briefingAt == null ? null : hmToMin(s.briefingAt);
  if (bMin != null) {
    for (let i = 0; i <= s.horizonDays; i++) {
      const cursor = new Date(now);
      cursor.setHours(0, 0, 0, 0);
      cursor.setDate(cursor.getDate() + i);
      const at = cursor.getTime() + bMin * 60_000;
      if (at <= now || at > end) continue;
      const key = dayKey(cursor.getTime());
      const courses = (input.schedule ?? [])
        .filter((e) => String(e.date ?? "") === key && scheduleStart(e) != null)
        .sort((a, b) => (scheduleStart(a) ?? 0) - (scheduleStart(b) ?? 0));
      const dues = (input.homework ?? []).filter((h) => {
        if (h.submitted) return false;
        const d = parseLearnTime(h.deadline);
        return !!d && dayKey(d.getTime()) === key;
      });
      if (courses.length === 0 && dues.length === 0) continue;
      const first = courses[0];
      const q = planFireTime(at, end, s.quietFrom, s.quietTo, now, "drop");
      if (!q) continue;
      push({
        id: `briefing:${key}:${bMin}`,
        kind: "briefing",
        at: q.at,
        title: `${i === 0 ? "今天" : i === 1 ? "明天" : fmtMD(cursor.getTime())} · ${fmtMD(cursor.getTime())}`,
        body: joinParts([
          courses.length ? `${courses.length} 节课${first ? `（${fmtHM(first.startTime)} 起）` : ""}` : null,
          dues.length ? `${dues.length} 个截止` : null,
        ]),
        page: i === 0 && key === nowDay ? "today" : "schedule",
        ...(q.shifted ? { shifted: true } : {}),
      }, end);
    }
  }

  items.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return items.length > s.maxItems ? items.slice(0, s.maxItems) : items;
}

/** 计划摘要（设置页「即将提醒」预览与测试断言共用） */
export function summarizePlan(items: NotifyPlanItem[]): Record<NotifyChannel, number> {
  const out: Record<NotifyChannel, number> = { course: 0, ddl: 0, briefing: 0 };
  for (const it of items) out[channelOf(it.kind)]++;
  return out;
}
