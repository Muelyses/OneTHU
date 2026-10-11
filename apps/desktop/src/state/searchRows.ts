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
import { goEntry } from "../components/Layout.js";
import { navGo } from "../plugins/bridges.js";

export interface SearchRow {
  /** 稳定 id（唯一） */
  id: string;
  /** 所属页签（设置页签，或 "OneTHU Harness" 这种二级页） */
  tab: string;
  /** **完整亲子树面包屑**（如 ["设置","外观与布局","主题","安装主题"] / ["插件","插件市场","主题"]）。
   *  [0] 决定**家族**（"设置" → requestSettingsTab + settings；"插件" → goEntry("plugins")）；
   *  在 CommandPalette 与底栏检索条里都以 muted 小字显示在标题下。未显式填时按 tab/section/title 兜底成链。 */
  breadcrumb?: string[];
  /** **显示链的根**（面向用户）：OH 相关行写 "设置"（用户直觉：三格框第三格在"设置"概念下），
   *  插件市场的条目写 "插件"。默认按导航家族推。显示用 displayRoot，**落点验证仍以 family 为准**。 */
  displayRoot?: "设置" | "插件";
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

/* ① 面包屑兜底：显式填优先；未填时按 tab/section/title 生成**同族**链（不跨家族推断） */
export function breadcrumbOf(row: SearchRow): string[] {
  if (row.breadcrumb && row.breadcrumb.length > 0) return row.breadcrumb;
  const isPlugin = row.tab === "插件" || row.tab === "OneTHU Harness";
  return isPlugin ? ["插件", row.tab, row.section, row.title] : ["设置", row.tab, row.section, row.title];
}

/** 家族：由 breadcrumb[0] 唯一决定（"设置" | "插件"） */
/** 显示链（用 displayRoot 替换面包屑首段；仅影响展示） */
export function displayBreadcrumb(row: SearchRow): string[] {
  const bc = breadcrumbOf(row);
  const root = row.displayRoot ?? (familyOf(row) === "plugins" ? "插件" : "设置");
  return [root, ...bc.slice(1)];
}

/** 断言分组：显示根与导航家族不一致的行（如 OH：显示"设置"、实际落"插件"）——单独统计，不混入两族 */
export function familyGroup(row: SearchRow): "settings" | "plugins" | "mixed" {
  const fam = familyOf(row);
  const shown = displayBreadcrumb(row)[0];
  return (fam === "plugins" && shown === "设置") ? "mixed" : fam;
}

export function familyOf(row: SearchRow): "settings" | "plugins" {
  const head = breadcrumbOf(row)[0];
  return head === "插件" ? "plugins" : "settings";
}

/** ① **唯一跳转函数**：家族 → 二级（tier/view/category）→ 三级（分节/行高亮）。
 *  家族只从面包屑推导；行自带的 go 负责二级/三级定位（tier / view / section）。 */
export function goSearchRow(row: SearchRow): { family: "settings" | "plugins"; breadcrumb: string[] } {
  const breadcrumb = breadcrumbOf(row);
  const family = familyOf(row);
  if (family === "plugins") {
    goEntry("plugins"); // 状态机（入口态唯一来源）
  } else {
    requestSettingsTab(row.tab);
    navGo("settings");
  }
  if (row.go) {
    row.go(); // 二级/三级：OH 切档、插件切视图/分类、分节/行滚动高亮都在这里
  } else {
    requestSettingsSection(row.title);
  }
  return { family, breadcrumb };
}
