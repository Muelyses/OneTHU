/**
 * 云同步状态层 —— 清华邮箱 CalDAV 日程（M2/M3 地基）。
 *
 * 存储布局（Tauri state 文件，绕开 WKWebView localStorage 驱逐）：
 * - caldav.cfg    { email, authCode(混淆) }        —— 与 credentials 同通道
 * - caldav.cache  { savedAt, events: IcsEvent[] }   —— 云端事件全量镜像（含 href/etag）
 * - caldav.local  { events: IcsEvent[] }            —— 不上云的本地手动日程
 *
 * 同步策略（服务器无 CTAG/sync-token）：每次全量 Depth:1 etag 扫描，本地
 * etag 缓存比对，仅 GET 变更资源 —— 学生量级毫秒级。
 */
import { useCallback, useEffect, useState } from "react";
import { CalDavClient, caldav, parseLearnTime } from "@onethu/core";
import { universalFetch } from "../lib/transport.js";
import { fileRead, fileWrite, fileDelete, obfuscateSecret, deobfuscateSecret, info } from "../lib/clients.js";
import { getLearnSnapshot, subscribeLearnData, getCalendarSnapshot, subscribeCampusData, subscribeCalendarData } from "./data.js";
import { getHwRemindState, subscribeHwRemind, type HwRemindState } from "./hwRemind.js";

const CFG_FILE = "caldav.cfg";
const CACHE_FILE = "caldav.cache";
const LOCAL_FILE = "caldav.local";

export interface CloudCalConfig {
  email: string;
  authCode: string;
}

interface CacheShape {
  savedAt: number;
  events: caldav.IcsEvent[];
}

/* -------------- 模块级单例（跨页面/组件共享同一份内存） -------------- */

let loaded = false;
let cfg: CloudCalConfig | null = null;
let cloudEvents: caldav.IcsEvent[] = [];
let localEvents: caldav.IcsEvent[] = [];
let lastSyncAt = 0;
let syncing = false;
let lastError: string | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((fn) => fn());
/** 内容变更订阅（真变了才触发；见 onCloudCalChange 注释） */
const changeListeners = new Set<() => void>();

/**
 * 批量变更闸门：批量期间只记账、不广播，结束时统一广播一次。
 *
 * 为什么必须成批：课表上云 / 作业上云都是「清旧 + 全量重写」的循环，逐条广播会把**中途的
 * 半成品镜像**（旧数据已删、新数据还没写完）暴露给跟随方——系统日历照着它重建，就会算出
 * 一份"少了全部课程事件"的载荷并真的写进去，等重写完成再写回来（两次无谓写入 + 一段
 * 日历被清空的窗口）。原本这些循环一次都不广播，反倒是安全的；加了逐条广播就必须收口。 */
let batchDepth = 0;
let batchDirty = false;
function emitChange(): void {
  if (batchDepth > 0) {
    batchDirty = true;
    return;
  }
  changeListeners.forEach((fn) => fn());
}
/** 把一段会多次改动镜像的操作收成一次广播（成功与否都收口，失败时已改的部分照常广播） */
async function withBatch<T>(fn: () => Promise<T>): Promise<T> {
  batchDepth++;
  try {
    return await fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0 && batchDirty) {
      batchDirty = false;
      changeListeners.forEach((f) => f());
    }
  }
}

async function persistCfg(): Promise<void> {
  if (!cfg) {
    await fileDelete(CFG_FILE);
    return;
  }
  await fileWrite(CFG_FILE, JSON.stringify({ email: cfg.email, secret: obfuscateSecret(cfg.authCode, cfg.email) }));
}
async function persistCache(): Promise<void> {
  await fileWrite(CACHE_FILE, JSON.stringify({ savedAt: lastSyncAt, events: cloudEvents } satisfies CacheShape));
}
async function persistLocal(): Promise<void> {
  await fileWrite(LOCAL_FILE, JSON.stringify({ events: localEvents }));
}

/** 首次使用时从文件恢复（hook 挂载触发） */
async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fileRead(CFG_FILE);
    if (raw) {
      const j = JSON.parse(raw) as { email?: string; secret?: string };
      if (j.email && j.secret) cfg = { email: j.email, authCode: deobfuscateSecret(j.secret, j.email) ?? "" };
    }
  } catch {
    /* 坏文件视作未配置 */
  }
  try {
    const raw = await fileRead(CACHE_FILE);
    if (raw) {
      const j = JSON.parse(raw) as Partial<CacheShape>;
      if (Array.isArray(j.events)) cloudEvents = j.events;
      if (typeof j.savedAt === "number") lastSyncAt = j.savedAt;
    }
  } catch {
    /* 忽略 */
  }
  try {
    const raw = await fileRead(LOCAL_FILE);
    if (raw) {
      const j = JSON.parse(raw) as { events?: caldav.IcsEvent[] };
      if (Array.isArray(j.events)) localEvents = j.events;
    }
  } catch {
    /* 忽略 */
  }
  emit();
  // 首次从盘上装载出内容 = 跟随方（系统日历等）第一次见到这批事件，广播一次；
  // 空镜像不广播（没有任何可写的内容）
  if (cloudEvents.length > 0 || localEvents.length > 0) emitChange();
}

/** 已配置的 CalDAV / 邮箱地址（同步可读，未配置为 null）。 */
export function getCloudCalEmail(): string | null {
  return cfg?.email ?? null;
}

/** 配置就绪（邮件 tab 复用同一凭据：email + authCode） */
export async function ensureCloudCalLoaded(): Promise<void> {
  await ensureLoaded();
}

/**
 * 订阅云/本日程**内容变更**（同步后发现真变了、增删改、首次从盘上装载）——
 * 系统日历自动跟随、通知/小组件重算用。返回退订函数。
 *
 * 与 emit()（React 状态：syncing / lastSyncAt，每次同步都要走一遍）**分开**：
 * 原先两者共用 emit()，于是「云同步扫了一遍、added/updated/removed 全 0」也把跟随方
 * 叫醒一次——白跑一轮载荷重建（拉整学期课表），叠上指纹失效就是白写一遍系统日历。
 * 现在只有内容真变了才广播。
 */
export function onCloudCalChange(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => {
    changeListeners.delete(fn);
  };
}

export function getCloudCalConfig(): CloudCalConfig | null {
  return cfg;
}

/** 门面（OH）读取用：当前云端事件镜像 */
export function getCloudEvents(): caldav.IcsEvent[] {
  return cloudEvents;
}

/** 门面（OH）读取用：距上次同步毫秒数（Infinity=从未） */
export function msSinceSync(): number {
  return lastSyncAt ? Date.now() - lastSyncAt : Number.POSITIVE_INFINITY;
}

function makeClient(): CalDavClient | null {
  if (!cfg) return null;
  return new CalDavClient(universalFetch, { email: cfg.email, authCode: cfg.authCode });
}

/* -------------- 动作 -------------- */

/** 配置并立即验证（设置页「保存并测试」） */
export async function configureCloudCal(email: string, authCode: string): Promise<string[]> {
  const probe = new CalDavClient(universalFetch, { email, authCode });
  const names = (await probe.testConnection()).calendars; // 授权失败在这里抛 CalDavError
  cfg = { email, authCode };
  await persistCfg();
  emit();
  return names;
}

/** 断开：清配置与云缓存（云端事件不动，本地手动日程保留） */
export async function disconnectCloudCal(): Promise<void> {
  const had = cloudEvents.length > 0;
  cfg = null;
  cloudEvents = [];
  lastSyncAt = 0;
  lastError = null;
  await persistCfg();
  await fileDelete(CACHE_FILE);
  emit();
  if (had) emitChange(); // 清空也是内容变化（系统日历要把对应事件撤掉）
}

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

/** 全量 etag 扫描同步（无增量通道；学生量级毫秒级） */
export async function syncCloudCal(): Promise<SyncResult> {
  if (!cfg || syncing) {
    if (syncing) return { added: 0, updated: 0, removed: 0, total: cloudEvents.length };
    throw new Error("未配置云同步");
  }
  syncing = true;
  lastError = null;
  emit();
  /** 本轮是否真把镜像改了（added/updated/removed 任一非 0）：只有真变了才广播内容变更，
   *  否则「扫了一遍啥也没变」也会唤醒系统日历跟随，白拉一轮整学期课表。 */
  let changed = false;
  try {
    const client = makeClient()!;
    const metas = await client.listEvents();
    const oldMap = new Map(cloudEvents.map((e) => [e.uid, e]));
    const next: caldav.IcsEvent[] = [];
    let added = 0;
    let updated = 0;
    for (const m of metas) {
      const old = oldMap.get(m.uid);
      if (old && old.etag === m.etag) {
        next.push({ ...old, href: m.href, etag: m.etag });
        continue;
      }
      const ics = await client.getIcs(m.href);
      for (const ev of caldav.parseIcs(ics)) next.push({ ...ev, href: m.href, etag: m.etag });
      if (old) updated++;
      else added++;
    }
    const removed = cloudEvents.filter((e) => !metas.some((m) => m.uid === e.uid)).length;
    changed = added + updated + removed > 0;
    cloudEvents = next;
    lastSyncAt = Date.now();
    await persistCache();
    return { added, updated, removed, total: next.length };
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    syncing = false;
    emit();
    // 内容变更广播放在状态广播之后：跟随方读到的镜像已是本轮结果
    if (changed) emitChange();
  }
}

/** 新建/覆盖云端事件（UID 规范：onethu-<rand>@onethu） */
export async function putCloudEvent(ev: caldav.IcsEvent): Promise<void> {
  const client = makeClient();
  if (!client) throw new Error("未配置云同步");
  await client.putIcs(ev.uid, caldav.serializeCalendar([ev]));
  cloudEvents = [...cloudEvents.filter((e) => e.uid !== ev.uid), { ...ev }];
  lastSyncAt = Date.now();
  await persistCache();
  emit();
  emitChange();
}

/** 删除云端事件（按 UID） */
export async function deleteCloudEvent(uid: string): Promise<void> {
  const client = makeClient();
  if (!client) throw new Error("未配置云同步");
  const target = cloudEvents.find((e) => e.uid === uid);
  const href = target?.href ?? (await client.mainCalendar()).url.replace(/\/?$/, "/") + encodeURIComponent(uid) + ".ics";
  await client.deleteEvent(href);
  cloudEvents = cloudEvents.filter((e) => e.uid !== uid);
  await persistCache();
  emit();
  emitChange();
}

/* -------------- 本地手动日程（不上云） -------------- */

export function getLocalEvents(): caldav.IcsEvent[] {
  return localEvents;
}

export async function putLocalEvent(ev: caldav.IcsEvent): Promise<void> {
  localEvents = [...localEvents.filter((e) => e.uid !== ev.uid), ev];
  await persistLocal();
  emit();
  emitChange();
}

export async function deleteLocalEvent(uid: string): Promise<void> {
  const next = localEvents.filter((e) => e.uid !== uid);
  if (next.length === localEvents.length) return; // 没这条：内容没变，不惊动跟随方
  localEvents = next;
  await persistLocal();
  emit();
  emitChange();
}

/* -------------- React 钩子 -------------- */

export interface CloudCalState {
  ready: boolean;
  configured: boolean;
  email: string | null;
  cloudEvents: caldav.IcsEvent[];
  localEvents: caldav.IcsEvent[];
  lastSyncAt: number;
  syncing: boolean;
  error: string | null;
}

export function useCloudCal(): CloudCalState {
  const [snapshot, setSnapshot] = useState<CloudCalState>(() => ({
    ready: false,
    configured: !!cfg,
    email: cfg?.email ?? null,
    cloudEvents,
    localEvents,
    lastSyncAt,
    syncing,
    error: lastError,
  }));
  useEffect(() => {
    void ensureLoaded();
    const update = (): void =>
      setSnapshot({
        ready: true,
        configured: !!cfg,
        email: cfg?.email ?? null,
        cloudEvents,
        localEvents,
        lastSyncAt,
        syncing,
        error: lastError,
      });
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return snapshot;
}

/* -------------- 课表写入云日历（M4） -------------- */

import type { ScheduleEntry } from "@onethu/core";

/** 节次兜底时刻（与课表网格 BEGIN_TIME/END_TIME 同源） */
const SECTION_BEGIN = ["", "08:00", "08:50", "09:50", "10:40", "11:30", "13:30", "14:20", "15:20", "16:10", "17:05", "17:55", "19:20", "20:10", "21:00"];
const SECTION_END = ["", "08:45", "09:35", "10:35", "11:25", "12:15", "14:15", "15:05", "16:05", "16:55", "17:50", "18:40", "20:05", "20:55", "21:45"];

function sig32(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const MIN = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const AT = (date: string, minutes: number): number => {
  const d = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return d.getTime() + minutes * 60_000;
};

/**
 * 本学期课表/考试写入云日历（每场次一个 VEVENT，按日期精确展开——单双周
 * 语义零风险）。UID 稳定派生 → 重复执行=先清理旧 course/exam 再全量重写，
 * 幂等可重入。写入后系统日历/其他设备全学期可见。
 */
/** 构建整学期逐场事件（课表上云 / 系统日历导出共用）：date|time|课名 稳定 uid */
export async function buildSemesterEvents(
  semester: { firstDay: string; weekCount: number },
  fetchSchedule: (start: string, end: string) => Promise<ScheduleEntry[]>,
): Promise<{ events: caldav.IcsEvent[]; skipped: number }> {
  const fmt = (d: Date): string => {
    const p = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const base = new Date(semester.firstDay.replace(/-/g, "/"));
  const endDate = new Date(base.getTime() + (semester.weekCount * 7 - 1) * 86_400_000);
  const entries = (await fetchSchedule(fmt(base), fmt(endDate))).filter((e) => e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? ""));
  const isExam = (e: ScheduleEntry): boolean => !!e.category && e.category.includes("考试");

  const events: caldav.IcsEvent[] = [];
  let skipped = 0;
  for (const e of entries) {
    const date = e.date!;
    const s = e.startTime ?? SECTION_BEGIN[e.startSection ?? 1];
    const t = e.endTime ?? SECTION_END[e.endSection ?? e.startSection ?? 1];
    if (!s || !t) {
      skipped++;
      continue;
    }
    const start = AT(date, MIN(s));
    const end = Math.max(AT(date, MIN(t)), start + 45 * 60_000);
    const exam = isExam(e);
    events.push({
      uid: `onethu-${exam ? "exam" : "course"}-${sig32(`${date}|${s}|${e.courseName}`)}@onethu`,
      summary: exam ? `【考试】${e.courseName}` : e.courseName,
      start,
      end,
      location: e.location,
      description: [e.teacher && `教师：${e.teacher}`, e.weekText && `周次：${e.weekText}`].filter(Boolean).join("\n") || undefined,
      categories: [exam ? "ONETHU-EXAM" : "ONETHU-COURSE"],
      onethuSource: exam ? "exam" : "course",
    });
  }
  return { events, skipped };
}

export async function exportSemesterToCloud(
  semester: { firstDay: string; weekCount: number },
  fetchSchedule: (start: string, end: string) => Promise<ScheduleEntry[]>,
  onProgress?: (done: number, total: number, phase: "清理旧数据" | "写入日程") => void,
): Promise<{ written: number; removed: number; skipped: number }> {
  const client = makeClient();
  if (!client) throw new Error("未配置云同步");
  // 清旧（逐条 deleteCloudEvent）+ 全量重写：整段收成一次广播，中途不暴露半成品镜像
  return await withBatch(async () => {
    const { events, skipped } = await buildSemesterEvents(semester, fetchSchedule);

    // 清理旧 course/exam（幂等重入）
    const stale = cloudEvents.filter((e) => e.onethuSource === "course" || e.onethuSource === "exam");
    onProgress?.(0, stale.length, "清理旧数据");
    let removed = 0;
    for (const s of stale) {
      try {
        await deleteCloudEvent(s.uid);
        removed++;
      } catch {
        /* 单条失败继续 */
      }
      onProgress?.(removed, stale.length, "清理旧数据");
    }

    // 全量写入
    onProgress?.(0, events.length, "写入日程");
    let written = 0;
    let failed = 0;
    for (const ev of events) {
      try {
        await client.putIcs(ev.uid, caldav.serializeCalendar([ev]));
        cloudEvents = [...cloudEvents.filter((c) => c.uid !== ev.uid), ev];
        written++;
      } catch {
        failed++;
      }
      onProgress?.(written, events.length, "写入日程");
    }
    lastSyncAt = Date.now();
    await persistCache();
    emit();
    return { written, removed, skipped: skipped + failed };
  });
}

/* ══════════ 作业 DDL 上云（用户 2026-09-09 拍板：DDL 不能只进本地系统日历） ══════════
 * 与课表 exportSemesterToCloud 同思路，但全自动：learn 数据 / 两级提醒任何变化
 * → 防抖重推（指纹相同跳过）。未交才写，交完即删；闹钟 = 单作业覆盖 ?? 全局默认
 * （IcsEvent.alarmMinutes → VALARM）。未配置云同步时全程静默。 */

/** 作业 DDL → 云日历事件（纯函数可测）
 *  2026-09-19 停用：作业 DDL 改由日程网格 hw 块承担（重叠自动缩略，见
 *  Schedule.tsx clusterize）。固定返回 []——syncHwToCloud 的幂等清理会把
 *  云端残留的 homework 源事件全部删掉（含 2026-09-09 起写入的旧格式），
 *  用户要恢复"作业上云"删掉这一行 return 即可。 */
export function buildHwCloudEvents(
  snap: { courses?: Array<{ id: string; name: string }>; homework?: Array<{ id: string; courseId: string; title: string; deadline: string; submitted: boolean }> } | null,
  hwRemind: HwRemindState,
): caldav.IcsEvent[] {
  void snap; void hwRemind;
  return [];
}

let hwCloudTimer: ReturnType<typeof setTimeout> | null = null;
let hwCloudSig = "";

/** 同步作业 DDL 到云日历（幂等：清旧 homework 源 → 全量重写；指纹相同跳过） */
export async function syncHwToCloud(): Promise<{ written: number; removed: number; skipped: boolean }> {
  await ensureLoaded();
  const client = makeClient();
  if (!client) return { written: 0, removed: 0, skipped: true }; // 未配置：静默
  const events = buildHwCloudEvents(getLearnSnapshot(), getHwRemindState());
  const sig = sig32(JSON.stringify(events.map((e) => [e.uid, e.start, e.alarmMinutes ?? 0])));
  if (sig === hwCloudSig) return { written: 0, removed: 0, skipped: true };
  // 清旧 + 重写：整段收成一次广播（否则逐条删除会被跟随方看成"DDL 全没了"）
  return await withBatch(async () => {
    const stale = cloudEvents.filter((e) => e.onethuSource === "homework");
    let removed = 0;
    for (const s of stale) {
      try {
        await deleteCloudEvent(s.uid);
        removed++;
      } catch {
        /* 单条失败继续 */
      }
    }
    let written = 0;
    for (const ev of events) {
      try {
        await client.putIcs(ev.uid, caldav.serializeCalendar([ev]));
        cloudEvents = [...cloudEvents.filter((c) => c.uid !== ev.uid), ev];
        written++;
      } catch {
        /* 单条失败继续：下次数据变化重推 */
      }
    }
    hwCloudSig = sig;
    lastSyncAt = Date.now();
    await persistCache();
    emit();
    return { written, removed, skipped: false };
  });
}

/* 自动跟随：learn 数据（含 30 分钟后台刷新）/ 提醒设置变化 → 防抖重推云端作业 */
function scheduleHwCloudSync(): void {
  if (hwCloudTimer) clearTimeout(hwCloudTimer);
  hwCloudTimer = setTimeout(() => {
    hwCloudTimer = null;
    void syncHwToCloud().catch(() => {
      /* 静默：设置页手动同步可见错误 */
    });
  }, 4000);
}
subscribeLearnData(scheduleHwCloudSync);
subscribeHwRemind(scheduleHwCloudSync);

/* ══════════ 课表自动上云（用户 2026-09-09 拍板：配置了云就自动上，不再手动按钮） ══════════
 * 语义：campus/校历任何变化 → 防抖重建本学期事件 → 与云端 onethu course/exam
 * 现状对账（uid→start 全等）→ 一致零请求跳过；不一致幂等清重写。
 * 手动兜底：原子「同步课表到云日历」直调同一函数。 */

let semesterCloudTimer: ReturnType<typeof setTimeout> | null = null;
let semesterCloudBusy = false;
let semesterAutoInfo: { at: number; written: number; removed: number; skipped: boolean; reason?: string } | null = null;

/** 导出目标学期：今天落在哪学期用哪个（无匹配退当前学期）——与日程页按钮口径一致 */
function pickExportSemester(cal: NonNullable<ReturnType<typeof getCalendarSnapshot>>): { firstDay: string; weekCount: number; semesterId?: string; semesterName?: string } | null {
  const list = [{ ...cal }, ...(cal.nextSemesterList ?? [])];
  const now = Date.now();
  for (const s of list) {
    const start = new Date(`${s.firstDay}T00:00:00`).getTime();
    if (!Number.isFinite(start) || !s.weekCount) continue;
    if (now >= start && now < start + s.weekCount * 7 * 86_400_000) return s;
  }
  return cal.firstDay && cal.weekCount ? cal : null;
}

/** 课表 → 云（自动；对账一致跳过）。返回给原子/状态条显示的结果。 */
export async function syncSemesterToCloudAuto(): Promise<{ written: number; removed: number; skipped: boolean; reason?: string }> {
  await ensureLoaded();
  if (semesterCloudBusy) return { written: 0, removed: 0, skipped: true, reason: "进行中" };
  if (!makeClient()) return { written: 0, removed: 0, skipped: true, reason: "未配置云同步" };
  const cal = getCalendarSnapshot();
  if (!cal) return { written: 0, removed: 0, skipped: true, reason: "校历未加载" };
  const sem = pickExportSemester(cal);
  if (!sem) return { written: 0, removed: 0, skipped: true, reason: "无学期信息" };
  semesterCloudBusy = true;
  try {
    const { events } = await buildSemesterEvents(sem, (st, en) => info.getSchedule(st, en));
    // 对账：期望 uid→start 与云端现状全等 → 一个请求都不发
    const want = new Map(events.map((e) => [e.uid, e.start] as const));
    const have = cloudEvents.filter((e) => e.onethuSource === "course" || e.onethuSource === "exam");
    if (have.length === want.size && have.every((e) => want.get(e.uid) === e.start)) {
      semesterAutoInfo = { at: Date.now(), written: 0, removed: 0, skipped: true, reason: "云端已是最新" };
      return semesterAutoInfo;
    }
    const r = await exportSemesterToCloud(sem, (st, en) => info.getSchedule(st, en));
    semesterAutoInfo = { at: Date.now(), written: r.written, removed: r.removed, skipped: false };
    emit();
    return semesterAutoInfo;
  } finally {
    semesterCloudBusy = false;
  }
}

/** 自动上云状态（日程页状态条显示用；onCloudCalChange 变化时重读） */
export function getSemesterAutoInfo(): { at: number; written: number; removed: number; skipped: boolean; reason?: string } | null {
  return semesterAutoInfo;
}

/* 课表上云已退役（2026-09-13 用户决策）：系统日历自动同步覆盖全部场景，
   云端/本地双源重复日程治理不达标准（日历紊乱实锤）。自动推送订阅与
   scheduleSemesterCloudSync 守护一并拆除；syncSemesterToCloudAuto 保留
   导出仅供清除云端残留用途，不再有任何触发点。 */
