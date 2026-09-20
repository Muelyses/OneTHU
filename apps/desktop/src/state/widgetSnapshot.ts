/**
 * 桌面小组件快照（纯计算，可测）：把「这块小组件要显示的东西」压成原生能画的数据。
 *
 * 内容**按实例**（appWidgetId）各算一份：桌面上可以同时放「日程与 DDL」「一个原子占满的
 * 详情」「收藏夹图标组」「1×1 快捷方式」，互不影响。推送载荷形如
 * `{ instances: { "<appWidgetId>": {…} }, slots: { "1": {…} }, prune }`。
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
  /** 列表形态标记：原生据此选布局（缺省即 list，兼容插件槽位内容） */
  kind?: "list";
}

/** 图标组形态：若干原子图标并列（收藏夹 = 内嵌的文件夹）。
 *  落点一律是已编码字符串（`encodeWidgetTarget` 的产物），构造器不再拆开重组。 */
export interface WidgetGridSnapshot {
  kind: "grid";
  updatedAt: number;
  title: string;
  /** 点击标题落的页面（通常是那个收藏夹） */
  target: string;
  /** 每个格子：标签 + 图标（data URL PNG）+ 自己的落点 */
  items: Array<{ label: string; icon?: string; target: string }>;
}

/** 快捷方式形态：一个图标 + 一行名称（1×1 起；拖大后图标居中显示） */
export interface WidgetShortcutSnapshot {
  kind: "shortcut";
  updatedAt: number;
  label: string;
  sub?: string;
  icon?: string;
  target: string;
}

export type WidgetInstanceContent = WidgetSnapshot | WidgetGridSnapshot | WidgetShortcutSnapshot;

/** 推送载荷：实例内容 + 插件槽位内容 + 是否允许原生修剪已移除实例的内容 */
export interface WidgetPushPayload {
  instances: Record<string, WidgetInstanceContent>;
  slots: Record<string, WidgetSlotContent>;
  /** 只有在成功读到「桌面上有哪些实例」时才允许修剪——
   *  取实例列表失败时若还修剪，会把所有小组件内容误删。 */
  prune: boolean;
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

  return {
    title: `今天 ${new Date(now).getMonth() + 1}月${new Date(now).getDate()}日`,
    updatedAt: now,
    target: "today",
    rows,
    footer,
  };
}

/** 序列化为推送用的 JSON（原生只认字符串载荷） */
/** 空列表内容（绑定不可用时的兜底：不推空卡，直接回落日程与 DDL） */
export function buildGridSnapshot(input: {
  title: string;
  items: Array<{ label: string; icon?: string; target: string }>;
  target: string;
  params?: Record<string, unknown>;
  now: number;
}): WidgetGridSnapshot {
  return {
    kind: "grid",
    updatedAt: input.now,
    title: String(input.title || "收藏"),
    target: encodeWidgetTarget(input.target || "folder", input.params ?? null),
    items: input.items.slice(0, 8).map((it) => ({ label: String(it.label ?? ""), icon: it.icon, target: it.target })),
  };
}

export function buildShortcutSnapshot(input: {
  label: string;
  sub?: string;
  icon?: string;
  target: string;
  params?: Record<string, unknown>;
  now: number;
}): WidgetShortcutSnapshot {
  return {
    kind: "shortcut",
    updatedAt: input.now,
    label: String(input.label ?? ""),
    sub: input.sub ? String(input.sub) : undefined,
    icon: input.icon,
    target: encodeWidgetTarget(input.target || "today", input.params ?? null),
  };
}

/** 详情形态：就是列表形态（标题 + 若干行 + 脚注），拉得越高行数越多 */
export function buildDetailSnapshot(input: {
  title: string;
  rows: WidgetRow[];
  footer?: string;
  target: string;
  params?: Record<string, unknown>;
  now: number;
  maxRows?: number;
}): WidgetSnapshot {
  return {
    kind: "list",
    title: String(input.title || "详情"),
    updatedAt: input.now,
    target: encodeWidgetTarget(input.target || "today", input.params ?? null),
    rows: input.rows.slice(0, Math.max(1, input.maxRows ?? 5)).map((r) => ({ text: String(r.text ?? ""), sub: r.sub ? String(r.sub) : undefined })),
    footer: String(input.footer ?? ""),
  };
}

/** 推送载荷序列化：实例 + 槽位 + prune 标记 */
export function serializeWidgetPush(p: WidgetPushPayload): string {
  const instances: Record<string, unknown> = {};
  for (const [id, content] of Object.entries(p.instances ?? {})) {
    if (!content) continue;
    instances[String(id)] = content;
  }
  return JSON.stringify({ instances, slots: p.slots ?? {}, prune: p.prune === true });
}

export function serializeWidgetSnapshot(s: WidgetSnapshot): string {
  return JSON.stringify(s);
}
