/**
 * 「一个原子占满一块小组件」时，除了原子自己的说明还能写什么。
 *
 * 这是小组件「拉长能看到细节」的来源：原生没有业务语义，算不了「这门课下次什么时候上」
 * 「这台洗衣机还要多久」。能算的只有应用——但只能在**已有数据**里算：
 *   · 课表 / 作业是应用自己在内存与缓存里就有的；
 *   · 洗衣机状态来自实时缓存（用户打开过洗衣机页就有），拿不到就老实不写这一行。
 * 宁可少一行，也不要猜一个数字写到桌面上。
 *
 * 纯函数 + 注入依赖，故可直测。
 */
import type { AtomRef } from "./favorites.js";
import type { PlanHomework, PlanScheduleEntry } from "./notifyPlan.js";

export interface DetailRow {
  text: string;
  sub?: string;
}

export interface WidgetDetailDeps {
  schedule: PlanScheduleEntry[];
  homework: PlanHomework[];
  /** 读实时缓存（洗衣机等）：拿不到返回 null */
  readCache: (key: string) => unknown;
  now: number;
  /** 最多补几行（原生按占位决定；这里给个上界免得白算） */
  maxRows?: number;
}

function hm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dayLabel(ms: number, now: number): string {
  const a = new Date(ms);
  const b = new Date(now);
  const sameDay = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const tomorrow = new Date(now + 86_400_000);
  const isTomorrow = a.getFullYear() === tomorrow.getFullYear() && a.getMonth() === tomorrow.getMonth() && a.getDate() === tomorrow.getDate();
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][a.getDay()];
  if (sameDay) return "今天";
  if (isTomorrow) return "明天";
  return `${a.getMonth() + 1}/${a.getDate()} ${week}`;
}

/** 「还有 40 分钟」/「还有 3 小时」/「还有 2 天」 */
function left(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `还有 ${m} 分钟`;
  if (m < 2880) return `还有 ${Math.round(m / 60)} 小时`;
  return `还有 ${Math.round(m / 1440)} 天`;
}

function clip(s: unknown, n: number): string {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 课程原子的 key：id~name~teacher~sem */
function courseNameOf(key: string): string {
  return key.split("~")[1] ?? "";
}

/**
 * 补详情行。返回 null 表示「这个原子没有额外可算的」——调用方只用原子自己的说明，
 * 而不是硬凑一行废话。
 */
export function atomDetail(
  ref: AtomRef,
  meta: { title: string; sub?: string },
  deps: WidgetDetailDeps,
): { rows: DetailRow[]; footer?: string } | null {
  const max = Math.max(1, deps.maxRows ?? 4);

  /* 课程：这门课接下来什么时候上、在哪 */
  if (ref.kind === "course") {
    const name = courseNameOf(ref.key);
    const upcoming = deps.schedule
      .filter((e) => String(e.courseName ?? "") === name && (e.date ?? "") >= ymdOf(deps.now))
      .sort((a, b) => `${a.date ?? ""}${a.startTime ?? ""}`.localeCompare(`${b.date ?? ""}${b.startTime ?? ""}`));
    if (upcoming.length === 0) return { rows: [], footer: "近期没有安排" };
    const rows: DetailRow[] = [];
    for (const e of upcoming.slice(0, Math.min(3, max))) {
      const at = new Date(`${e.date}T${String(e.startTime ?? "00:00").replace("：", ":")}:00`).getTime();
      rows.push({
        text: `${dayLabel(at, deps.now)} ${String(e.startTime ?? "")} ${clip(e.location ?? "待定", 12)}`,
        sub: Number.isFinite(at) && at > deps.now ? left(at - deps.now) : undefined,
      });
    }
    return { rows, footer: `${upcoming.length} 次待上` };
  }

  /* 作业：截止与提交状态 */
  if (ref.kind === "assignment") {
    const itemId = ref.key.split("~")[1] ?? "";
    const hw = deps.homework.find((h) => String(h.id ?? "") === itemId);
    if (!hw) return { rows: [], footer: "已提交或已过期" };
    const d = new Date(String(hw.deadline ?? "").replace(" ", "T"));
    const at = Number.isFinite(d.getTime()) ? d.getTime() : 0;
    return {
      rows: at > 0 ? [{ text: `截止 ${dayLabel(at, deps.now)} ${hm(at)}`, sub: at > deps.now ? left(at - deps.now) : undefined }] : [],
      footer: hw.submitted ? "已提交" : "未提交",
    };
  }

  /* 洗衣机（单台）：还要多久 / 是否空闲 */
  if (ref.kind === "washer-m" || ref.kind === "washer-b") {
    const [bId, bName, hlsh, dev] = ref.key.split("~");
    const cached = deps.readCache(`fav.washer.${bId}.${hlsh === "1" ? "h" : "j"}`) as
      | Array<{ name?: string; floor?: string; washers?: Array<{ name?: string; location?: string; type?: string; status?: string; eta?: number }> }>
      | null;
    if (!Array.isArray(cached)) return null;                 // 没打开过洗衣机页：不猜
    const all = cached.flatMap((f) => (f.washers ?? []).map((w) => ({ w, floor: f.floor })));
    if (ref.kind === "washer-b") {
      const idle = all.filter((x) => x.w.status === "idle").length;
      return { rows: [{ text: `空闲 ${idle} / ${all.length} 台` }], footer: clip(bName, 12) };
    }
    const hit = all.find((x) => (x.w.name || x.w.location || x.w.type || "设备") === dev);
    if (!hit) return null;
    const text = hit.w.status === "idle" ? "空闲" : hit.w.status === "working" ? (hit.w.eta && hit.w.eta > 0 ? `使用中 · 剩 ${hit.w.eta} 分钟` : "使用中") : "状态未知";
    return { rows: [{ text, sub: clip(hit.floor ?? "", 10) }], footer: clip(bName, 12) };
  }

  return null;   // 其余原子：原子自己的说明已经够了，不硬凑
}

function ymdOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
