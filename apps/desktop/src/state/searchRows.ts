/**
 * 设置项的**声明式检索注册表**（2026-10-12 task-19 彻查后重做）。
 *
 * 为什么不再靠 DOM：旧实现用 `markSettingsRows()` 扫当前可见的 `.setting-row`，
 * 结果**未挂载/未展开**的设置（OH 子页、插件态、折叠分节）根本进不了索引 →
 * 用户实测「设置里那么多子选项都搜不到」。现在改为**模块加载时显式注册**：
 *   - 各 section 组件（Settings / OhSettingsPage / Im / Voice / Overlay / Widget）在模块顶层调用 `defineSearchRow()`
 *   - `state/searchAll.ts` 聚合全部行（CommandPalette 与底栏检索条**同一份**）
 *   - 点击直达复用既有请求机制（requestSettingsTab / requestSettingsSection / requestPluginsView / goEntry）
 * **不依赖 DOM、不依赖页面是否挂载**；DOM 侧只负责"滚到并高亮"。
 */
import { requestSettingsSection, requestSettingsTab } from "./settingsMode.js";

export interface SearchRow {
  /** 稳定 id（唯一） */
  id: string;
  /** 所属页签（设置页签，或 "OneTHU Harness" 这种二级页） */
  tab: string;
  /** 所属分节（用于分节高亮/面包屑） */
  section: string;
  /** 行标题（主匹配字段） */
  title: string;
  /** 说明（副匹配字段；用户搜「音色」要能落到语速语调那行） */
  desc?: string;
  /** 别名（口语/简称；如「语音」→ 语音合成那行） */
  aliases?: string[];
  /** 直达动作：默认走 requestSettingsTab + requestSettingsSection(title) */
  go?: () => void;
}

const rows = new Map<string, SearchRow>();

/** 注册一条设置行（模块加载时调用；重复 id 后者覆盖，便于热更） */
export function defineSearchRow(row: SearchRow): void {
  rows.set(row.id, row);
}

/** 批量注册（各 section 常用） */
export function defineSearchRows(list: SearchRow[]): void {
  for (const r of list) defineSearchRow(r);
}

export function allSearchRows(): SearchRow[] {
  return [...rows.values()];
}

/** 行级命中（按权重：标题前缀 > 标题包含 > 别名 > 说明） */
export function matchSearchRows(q: string, limit = 8): Array<{ row: SearchRow; score: number }> {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const out: Array<{ row: SearchRow; score: number }> = [];
  for (const r of rows.values()) {
    const title = r.title.toLowerCase();
    const desc = (r.desc ?? "").toLowerCase();
    const alias = (r.aliases ?? []).join(" ").toLowerCase();
    let score = 0;
    if (title === query) score = 100;
    else if (title.startsWith(query)) score = 80;
    else if (title.includes(query)) score = 60;
    else if (alias.includes(query)) score = 40;
    else if (desc.includes(query)) score = 20;
    if (score > 0) out.push({ row: r, score });
  }
  /* ③ 行级命中要排在页/分节级**前面**：调用方按本函数结果顺序拼接，score 决定同层排序 */
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 点击某一行 → 直达（页签 + 分节/行高亮） */
export function goSearchRow(row: SearchRow): void {
  if (row.go) {
    row.go();
    return;
  }
  requestSettingsSection(row.title);
  requestSettingsTab(row.tab);
}
