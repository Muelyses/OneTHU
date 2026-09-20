/**
 * 桌面小组件快照（纯计算，可测）：把「今天还剩什么」压成原生能画的三行字。
 *
 * 小组件进程里没有 WebView、没有会话，凭据又是 WebCrypto 加密存在 localStorage 的，
 * 原生拿不到明文——所以**凡是需要网络或解析的判断都必须在 App 前台算完**，原生只负责
 * 把这份快照摆进 RemoteViews。快照结构是与 Kotlin 侧的契约（见 OnethuWidget.kt 顶部
 * 注释），改动需两端同步。
 */
import { parseLearnTime } from "@onethu/core/src/learn/time.js";
import { encodeWidgetTarget } from "./widgetTarget.js";
import { effectiveRemind, type HwRemindState } from "./hwRemind.js";
import { scheduleStart, type PlanHomework, type PlanScheduleEntry } from "./notifyPlan.js";

/** 与 Kotlin 侧约定的快照结构 */
export interface WidgetRow {
  text: string;
  sub?: string;
}

/** 插件小组件的槽位内容（snapshot 里的形态，槽位号为 map 键） */
export interface WidgetSlotContent {
  title: string;
  rows: WidgetRow[];
  footer: string;
  target: string;
}

/** 槽位输入（结构上对应 plugins/pluginWidgets.ts 的 ResolvedWidgetSlot） */
export interface WidgetSlotInput extends WidgetSlotContent {
  slot: string;
}

export interface WidgetSnapshot {
  title: string;
  updatedAt: number;
  /** 点击小组件要落的页面（App 启动后经 widget_take_target 取走） */
  target: string;
  rows: WidgetRow[];
  footer: string;
  /** 插件小组件槽位（槽位号 → 内容）；为空时不写该字段。
   *  宿主小组件不读它，槽位小组件（原生 OnethuWidgetSlotNProvider）读自己那一键。 */
  slots?: Record<string, WidgetSlotContent>;
}

export interface WidgetSnapshotInput {
  schedule?: PlanScheduleEntry[] | null;
  homework?: PlanHomework[] | null;
  remind: HwRemindState;
  now: number;
  /** 最多几行（原生布局三行；多余的在 footer 里计数体现） */
  maxRows?: number;
  /** 插件声明的小组件条目：插到课程/DDL 之后（宿主小组件里的插件行） */
  extraRows?: WidgetRow[];
  /** 插件小组件的槽位内容（来自 plugins/pluginWidgets.ts 的 collectWidgetSlots） */
  slots?: WidgetSlotInput[];
  /** 点击落点覆盖（设置里指定「点开哪个页面」；给了就无视内容来源的默认落点） */
  targetOverride?: string | null;
  /** 自定义内容来源（用户把小组件设为「某收藏夹 / 某原子」时由 widgetSource 解析得到）。
   *  给定时宿主小组件显示它，而不是默认的「今天」视图。 */
  custom?: { title: string; rows: WidgetRow[]; footer: string; target: string; params?: Record<string, unknown> } | null;
}

function ymd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function clip(s: string, n: number): string {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 「还有 40 分钟」/「还有 3 小时」/「还有 2 天」 */
function left(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `还有 ${m} 分钟`;
  if (m < 2880) return `还有 ${Math.round(m / 60)} 小时`;
  return `还有 ${Math.round(m / 1440)} 天`;
}

/**
 * 生成快照。
 *
 * 排序取「今天最先发生的事」：课程按上课时间，DDL 按截止时间，两者合排后取前 N 行——
 * 用户瞄一眼小组件要看到的是「接下来干什么」，而不是分类清单。
 */
export function buildWidgetSnapshot(input: WidgetSnapshotInput): WidgetSnapshot {
  const now = input.now;
  // 用户指定了内容来源：直接用它（widgetRuntime 已把收藏夹/原子解析成行）
  if (input.custom) {
    const { title, rows, footer, target, params } = input.custom;
    return {
      title: String(title || "我的收藏"),
      updatedAt: now,
      target: input.targetOverride
        ? encodeWidgetTarget(input.targetOverride, null)
        : encodeWidgetTarget(target || "folder", params ?? null),
      rows: (rows ?? []).slice(0, 3).map((r) => ({ text: String(r.text ?? ""), sub: r.sub ? String(r.sub) : undefined })),
      footer: String(footer ?? ""),
    };
  }
  const today = ymd(now);
  const maxRows = Math.max(1, input.maxRows ?? 3);

  interface Entry {
    at: number;
    row: WidgetRow;
    kind: "class" | "ddl";
  }
  const entries: Entry[] = [];

  /* 今天的课（已开始的也算进来：正在上的课是此刻最该看到的一条） */
  for (const e of input.schedule ?? []) {
    const start = scheduleStart(e);
    if (start == null || String(e.date ?? "") !== today) continue;
    const end = String(e.endTime ?? "").trim().replace("：", ":");
    const isOngoing = end.length >= 4 && (() => {
      const t = new Date(`${today}T${end.length === 4 ? `0${end}` : end}:00`).getTime();
      return Number.isFinite(t) && t > now && start <= now;
    })();
    const loc = clip(e.location ?? "", 12);
    entries.push({
      at: start,
      kind: "class",
      row: {
        text: `${hm(start)} ${clip(e.courseName ?? "课程", 14)}`,
        sub: isOngoing ? "正在上课" : loc || undefined,
      },
    });
  }

  /* 未交作业的 DDL：只取今天到未来 7 天内的（更远的放进来只会挤掉眼前的事） */
  const horizon = now + 7 * 86_400_000;
  for (const h of input.homework ?? []) {
    if (h.submitted) continue;
    const d = parseLearnTime(h.deadline);
    if (!d) continue;
    const dl = d.getTime();
    if (dl <= now || dl > horizon) continue;
    const lead = effectiveRemind(input.remind, String(h.id ?? ""));
    entries.push({
      at: dl,
      kind: "ddl",
      row: {
        text: `DDL ${clip(h.title ?? "作业", 14)}`,
        sub: `${ymd(dl) === today ? "今天" : `${new Date(dl).getMonth() + 1}/${new Date(dl).getDate()}`} ${hm(dl)} · ${left(dl - now)}`,
      },
    });
  }

  entries.sort((a, b) => a.at - b.at);

  const rows = entries.slice(0, maxRows).map((e) => e.row);
  for (const extra of input.extraRows ?? []) {
    if (rows.length >= maxRows) break;
    rows.push(extra);
  }

  const classCount = entries.filter((e) => e.kind === "class").length;
  const ddlCount = entries.filter((e) => e.kind === "ddl").length;
  const parts: string[] = [];
  if (classCount) parts.push(`${classCount} 节课`);
  if (ddlCount) parts.push(`${ddlCount} 个截止`);
  const more = entries.length - rows.length;
  const footer = parts.length === 0
    ? "今天没有课与截止"
    : `${parts.join(" · ")}${more > 0 ? ` · 还有 ${more} 项` : ""}`;

  const slotMap: Record<string, WidgetSlotContent> = {};
  for (const slot of input.slots ?? []) {
    if (!slot?.slot) continue;
    slotMap[String(slot.slot)] = {
      title: String(slot.title ?? "插件小组件"),
      rows: (slot.rows ?? []).map((r) => ({ text: String(r.text ?? ""), sub: r.sub ? String(r.sub) : undefined })),
      footer: String(slot.footer ?? ""),
      target: String(slot.target ?? ""),
    };
  }

  return {
    title: `今天 ${new Date(now).getMonth() + 1}月${new Date(now).getDate()}日`,
    updatedAt: now,
    target: input.targetOverride ? encodeWidgetTarget(input.targetOverride, null) : "today",
    rows,
    footer,
    ...(Object.keys(slotMap).length ? { slots: slotMap } : {}),
  };
}

/** 序列化为推送用的 JSON（原生只认字符串载荷） */
export function serializeWidgetSnapshot(s: WidgetSnapshot): string {
  return JSON.stringify(s);
}
