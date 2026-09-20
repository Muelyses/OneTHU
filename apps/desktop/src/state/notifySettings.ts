/**
 * 通知设置（用户可见的那几个开关）与「已排程指纹」持久化。
 *
 * 设置项本身极薄，单独成文件是为了让调度器保持纯净：调度器只吃一个 NotifySettings
 * 对象，不关心它从哪来（localStorage / 测试构造）。
 *
 * 已排程指纹（onethu.notify.sched.v1）记录「每个 id 上次排的是什么内容」：原生侧只知道
 * 排了哪些 id（notify_pending），不知道内容是否变过。跨重启比对指纹才能既不做无谓重排、
 * 又不漏掉内容变化（例如作业标题被老师改了）。
 */
import { NOTIFY_DEFAULTS, type NotifySettings } from "./notifyPlan.js";

const KEY_SETTINGS = "onethu.notify.v1";
const KEY_SCHED = "onethu.notify.sched.v1";

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 配额/隐私模式：内存态照常工作 */
  }
}

/** 读设置（缺字段用默认补齐；非法值一律回落默认，不让坏存储影响提醒） */
export function loadNotifySettings(): NotifySettings {
  const raw = readJson<Partial<NotifySettings>>(KEY_SETTINGS) ?? {};
  const num = (v: unknown, dflt: number): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : dflt;
  const str = (v: unknown, dflt: string): string => (typeof v === "string" && v.trim() ? v : dflt);
  return {
    enabled: raw.enabled === true,
    classLead: num(raw.classLead, NOTIFY_DEFAULTS.classLead),
    ddl: raw.ddl !== false,
    briefingAt: raw.briefingAt === null ? null : str(raw.briefingAt, NOTIFY_DEFAULTS.briefingAt ?? "07:30"),
    quietFrom: str(raw.quietFrom, NOTIFY_DEFAULTS.quietFrom),
    quietTo: str(raw.quietTo, NOTIFY_DEFAULTS.quietTo),
    horizonDays: Math.min(30, Math.max(1, num(raw.horizonDays, NOTIFY_DEFAULTS.horizonDays))),
    maxItems: Math.min(200, Math.max(1, num(raw.maxItems, NOTIFY_DEFAULTS.maxItems))),
  };
}

export function saveNotifySettings(patch: Partial<NotifySettings>): NotifySettings {
  const next = { ...loadNotifySettings(), ...patch };
  writeJson(KEY_SETTINGS, next);
  return next;
}

/** 已排程指纹表：id → 指纹字符串 */
export function loadScheduledFingerprints(): Record<string, string> {
  return readJson<Record<string, string>>(KEY_SCHED) ?? {};
}

export function saveScheduledFingerprints(map: Record<string, string>): void {
  writeJson(KEY_SCHED, map);
}
