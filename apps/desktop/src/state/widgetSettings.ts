/**
 * 桌面小组件的「显示什么」配置（纯存储层，无 React / Tauri 依赖）。
 *
 * 为什么单独成文件：这份配置同时被三处消费——小组件运行时（决定推什么快照）、
 * 设置页（让用户改）、收藏夹页（把当前收藏夹一键设为小组件内容）；它还需要跨重启
 * 保留。集中在一处，改字段时只需改这里。
 */
export type WidgetSourceKind = "today" | "folder" | "atom";

export interface WidgetSourceConfig {
  /** today = 今日课程与截止（缺省）；folder = 某收藏夹；atom = 某个收藏原子 */
  kind: WidgetSourceKind;
  /** kind = folder 时的收藏夹 id */
  folderId?: string | null;
  /** kind = atom 时的原子引用 */
  atom?: { kind: string; key: string } | null;
}

export interface WidgetSettings {
  source: WidgetSourceConfig;
  /** 点击小组件打开的页面；空 = 跟随内容（今天 → 今日页，收藏夹 → 该收藏夹） */
  openPage: string | null;
}

const KEY = "onethu.widget.v1";

export const WIDGET_DEFAULTS: WidgetSettings = {
  source: { kind: "today" },
  openPage: null,
};

/** 读配置：坏存储一律回落默认（配置坏掉顶多是小组件显示默认内容，不该崩） */
export function loadWidgetSettings(): WidgetSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<WidgetSettings> | null;
    if (!raw || typeof raw !== "object") return { ...WIDGET_DEFAULTS, source: { kind: "today" } };
    const kind = raw.source?.kind;
    const source: WidgetSourceConfig =
      kind === "folder" && typeof raw.source?.folderId === "string" && raw.source.folderId
        ? { kind: "folder", folderId: raw.source.folderId }
        : kind === "atom" && raw.source?.atom && typeof raw.source.atom.key === "string" && typeof raw.source.atom.kind === "string"
          ? { kind: "atom", atom: { kind: raw.source.atom.kind, key: raw.source.atom.key } }
          : { kind: "today" };
    return {
      source,
      openPage: typeof raw.openPage === "string" && raw.openPage.trim() ? raw.openPage : null,
    };
  } catch {
    return { ...WIDGET_DEFAULTS, source: { kind: "today" } };
  }
}

export function saveWidgetSettings(patch: Partial<WidgetSettings>): WidgetSettings {
  const next: WidgetSettings = { ...loadWidgetSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 配额/隐私模式：内存态照常工作 */
  }
  emit();
  return next;
}

/** 变更订阅：改完配置要立刻重推快照，否则桌面要等下一次定时重算 */
const listeners = new Set<() => void>();

export function subscribeWidgetSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(): void {
  for (const fn of [...listeners]) fn();
}

/** 配置的人类可读摘要（设置页与调试用） */
export function describeWidgetSource(s: WidgetSettings, names: { folder?: string; atom?: string } = {}): string {
  if (s.source.kind === "folder") return `收藏夹「${names.folder ?? s.source.folderId ?? "?"}」`;
  if (s.source.kind === "atom") return `收藏原子「${names.atom ?? s.source.atom?.key ?? "?"}」`;
  return "今天（课程与截止）";
}
