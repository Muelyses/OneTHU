/**
 * 插件小组件注册表（**声明式**）——插件经 `ctx.registerWidget` 声明「桌面上要显示什么」，
 * 宿主把声明解析成原生能画的快照（`state/widgetSnapshot.ts` → 原生 RemoteViews）。
 *
 * 为什么必须声明式、不能让插件自己渲染：Android 桌面小组件由 AppWidgetHost 在**独立进程**
 * 里渲染，那里没有 WebView、没有登录会话、也没有插件的 JS 运行时——插件代码在桌面上
 * 根本跑不起来。插件只能声明内容与落点，渲染与取值必须由宿主完成。
 *
 * 为什么有「槽位」：系统不允许应用在运行时注册新的 AppWidgetProvider（provider 必须在
 * 清单里声明）。所以宿主预留固定数量的槽位（当前 3 个），插件按声明顺序占位；用户把
 * 「OneTHU 小组件 · N」放到桌面就能看到第 N 个插件小组件。绑定关系（谁在槽位几）
 * 按声明顺序确定，可预期且不需要额外的配置界面。
 */
import { getPluginAtom, pluginAtomKindOf } from "./pluginAtoms.js";

/** 一行声明：字面文本，或引用本插件注册的原子（key 约定同收藏夹："<tabId>~<原子key>"） */
export type PluginWidgetRowSpec = { text: string; sub?: string } | { atom: string };

export interface PluginWidgetDef {
  /** 插件内唯一 id（同一 id 重复声明为覆盖，便于插件更新） */
  id: string;
  pluginId: string;
  /** 插件名（宿主卡片与小组件脚注里署名用） */
  pluginName: string;
  /** 小组件标题 */
  title: string;
  rows: PluginWidgetRowSpec[];
  /** 点击落点（缺省跳到该插件第一个功能页） */
  target?: string;
}

/** 原生可画的一行（与 Kotlin 侧契约一致） */
export interface WidgetRowLike {
  text: string;
  sub?: string;
}

export interface ResolvedWidgetSlot {
  /** 槽位号 "1".."N"：对应原生的 OnethuWidgetSlotNProvider */
  slot: string;
  pluginId: string;
  widgetId: string;
  title: string;
  rows: WidgetRowLike[];
  target: string;
  footer: string;
}

/** 预留槽位数：与 AndroidManifest 里声明的 slot provider 数量必须一致 */
export const PLUGIN_WIDGET_SLOTS = 3;
/** 单个小组件最多几行（原生布局三行） */
export const PLUGIN_WIDGET_MAX_ROWS = 3;

const widgets = new Map<string, PluginWidgetDef[]>();

export function registerPluginWidget(def: PluginWidgetDef): void {
  const list = [...(widgets.get(def.pluginId) ?? [])];
  const i = list.findIndex((w) => w.id === def.id);
  // 同 id 覆盖**就地替换**：占位顺序决定槽位，插件更新自己的小组件不该把槽位让出去
  if (i >= 0) list[i] = def;
  else list.push(def);
  widgets.set(def.pluginId, list);
}

export function unregisterPluginWidgets(pluginId: string): void {
  widgets.delete(pluginId);
}

export function pluginWidgetDefs(pluginId: string): PluginWidgetDef[] {
  return [...(widgets.get(pluginId) ?? [])];
}

/** 全部插件小组件（按插件注册顺序展开；槽位分配即依此顺序） */
export function allPluginWidgetDefs(): PluginWidgetDef[] {
  const out: PluginWidgetDef[] = [];
  for (const list of widgets.values()) out.push(...list);
  return out;
}

/** 一行声明 → 原生可画的行；原子引用失效（resolve 返回 null）或空文本都丢弃 */
function resolveRow(pluginId: string, spec: PluginWidgetRowSpec): WidgetRowLike | null {
  if (spec && typeof spec === "object" && "atom" in spec) {
    const key = String((spec as { atom?: unknown }).atom ?? "").trim();
    if (!key) return null;
    const atom = getPluginAtom(pluginAtomKindOf(pluginId));
    const resolved = atom?.resolve?.(key) ?? null;
    if (!resolved) return null;      // 原子失效：宁可少一行，也不显示一行空白
    return { text: String(resolved.title ?? "").trim(), sub: resolved.sub };
  }
  const raw = spec as { text?: unknown; sub?: unknown };
  const text = String(raw?.text ?? "").trim();
  if (!text) return null;
  const sub = String(raw?.sub ?? "").trim();
  return { text, sub: sub || undefined };
}

/**
 * 收集槽位内容。
 *
 * 丢弃规则（与通知计划同口径：宁缺勿滥）：行解析失败即跳过；一个小组件解析后一行不剩
 * 就不占槽位——否则用户桌面上会出现一块写着插件名、内容全空的卡片。
 */
export function collectWidgetSlots(maxRows = PLUGIN_WIDGET_MAX_ROWS): ResolvedWidgetSlot[] {
  const out: ResolvedWidgetSlot[] = [];
  for (const def of allPluginWidgetDefs()) {
    if (out.length >= PLUGIN_WIDGET_SLOTS) break;
    const rows = (def.rows ?? [])
      .map((spec) => resolveRow(def.pluginId, spec))
      .filter((r): r is WidgetRowLike => r !== null)
      .slice(0, Math.max(1, maxRows));
    if (rows.length === 0) continue;
    out.push({
      slot: String(out.length + 1),
      pluginId: def.pluginId,
      widgetId: def.id,
      title: String(def.title ?? def.pluginName ?? "插件小组件").trim() || "插件小组件",
      rows,
      target: String(def.target ?? "").trim() || `plugin:${def.pluginId}:main`,
      footer: def.pluginName,
    });
  }
  return out;
}

/** 测试与调试用：清空注册表 */
export function __resetPluginWidgets(): void {
  widgets.clear();
}
