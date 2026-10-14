/**
 * 设置项的**声明式检索注册表**（2026-10-12 task-19 彻查后重做）。
 *
 * 为什么不再靠 DOM：旧实现用 `markSettingsRows()` 扫当前可见的 `.setting-row`，
 * 结果**未挂载/未展开**的设置（OH 子页、插件态、折叠分节）根本进不了索引 →
 * 用户实测「设置里那么多子选项都搜不到」。现在改为**模块加载时显式注册**：
 *   - 各 section 组件（Settings / OhSettingsPage / Im / Voice / Overlay / Widget / Plugins）在模块顶层调用 `defineSearchRow()`
 *   - `state/searchAll.ts` 聚合全部行（CommandPalette 与底栏检索条**同一份**）
 *   - 点击直达复用既有请求机制（requestSettingsTab / requestSettingsSection / requestPluginsView / goEntry）
 * **不依赖 DOM、不依赖页面是否挂载**；DOM 侧只负责"滚到并高亮"。
 *
 * 三段式落点契约（2026-10-12 `goSearchRow`，检索条直达的红线）：
 *   ① 家族（切页签）：breadcrumb[0]="设置" → requestSettingsTab+navGo("settings")；
 *      = "插件" → goEntry("plugins")（OH 表现成插件页的 OH 分节，但由独立 entry 态驱动）。
 *   ② 二级（切档 / 切视图）：行自带 `go` 负责——OH 行切 OH 基础/高级档；
 *      插件行切 我的插件/市场/主题筛选 + 展开安装面板分流。
 *   ③ 三级（行定位）：默认 requestSettingsSection(title)（滚到 + .row-focus）；
 *      **条件隐藏行**（`visible` 为 false）不是错：落**分节根** + `fallbackNote` 一句解释，
 *      由调用方（面板/门面/selfcheck）转述给用户——不许静默把分节头当命中。
 */
import { requestSettingsSection, requestSettingsTab } from "./settingsMode.js";
import { goEntry } from "../components/Layout.js";
import { navGo } from "../plugins/bridges.js";
import { requestPluginsFocus } from "./pluginsFocus.js";

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
  /** 条件隐藏行：点击时有函数则先判可见性；false → 落**分节根**（不冒充命中该行），
   *  配 `fallbackNote` 说明 为什么看不到它。桌面/手机的落点行为完全一致。 */
  visible?: () => boolean;
  /** 条件隐藏行落到分节根时的一句话解释（调用方 toast / 交回 OH 复述） */
  fallbackNote?: string;
  /** 条件隐藏行 / landOn 行的**分节根锚点**（插件家族用）。**只写裸 slug，别自带 "sec-"/"row-" 前缀**
   *  —— 解析器（Layout.focusSettingsTarget）自己会拼 `sec-<slug>`/`row-<slug>`，自带一遍就是
   *  `sec-sec-…`：永不命中且不报错（2026-10-15 一次扫出 7 处，护栏第 ⑨ 组现已静态拦截）。
   *  例：`root: "我的插件"` / `root: "高级配置"`；设置家族默认走 row.section（不填 root 也行）。 */
  root?: string;
  /** 该行在当前 UI **没有独立控件**（按钮收在别的控件里/该行此时不需要）：
   *  注册时就声明「落分节根 + 解释」，不许静默把分节头当命中。 */
  landOn?: { section: string; note: string };
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

/* ═══ OH / 插件直达的路由表（2026-10-12：检索条能到的，OH 也必须能到）══════════ */

/** 路由表行：JSON 可序列化（routes.json / nav.routeTable 同一份形状，函数一律不出现在这里）。
 *  kind = "settings"（设置页行）| "plugins"（插件页行）| "oh"（OneTHU Harness 子页行）；
 *  tier/view 把"二级切档"表达成数据：oh 行带 tier（basic|advanced），插件行带 view（mine|market）。 */
export interface OhRouteEntry {
  id: string;
  title: string;
  desc: string;
  aliases: string[];
  breadcrumb: string[];
  kind: "settings" | "plugins" | "oh";
  /** OH 行的档位 / 插件行的视图（其余空串） */
  tier: "basic" | "advanced" | "";
  view: "mine" | "market" | "";
  /** 设置行的页签 + 分节（从 tab/section 平铺，便于 OH 端不解析面包屑也能读） */
  tab: string;
  section: string;
  /** 条件隐藏行的解释（非空 = 该行有可能看不见，命中时提醒用户） */
  note: string;
}

/** 唯一真源的**只读投影**：`tools/gen-oh-routes.mjs` 离线生成 routes.json（submodule 资产），
 *  `plugins/facade.ts` 的 nav.routeTable 走本函数在线取——两头同源，护栏防止脱同。 */
export function ohRouteTable(): OhRouteEntry[] {
  return allSearchRows().map((r) => {
    const tab = r.tab;
    const kind: OhRouteEntry["kind"] = tab === "OneTHU Harness" ? "oh" : (tab === "插件" ? "plugins" : "settings");
    const bc = breadcrumbOf(r);
    const tier = kind === "oh" && bc[2] === "高级配置" ? "advanced" : (kind === "oh" ? "basic" : "");
    const view = kind === "plugins" ? (r.section === "插件市场" ? "market" : "mine") : "";
    return {
      id: r.id,
      title: r.title,
      desc: r.desc ?? "",
      aliases: r.aliases ?? [],
      breadcrumb: bc,
      kind,
      tier,
      view,
      tab,
      section: r.section,
      note: r.fallbackNote ?? "",
    };
  });
}

/** ① **唯一跳转函数**：家族 → 二级（tier/view/category）→ 三级（分节/行高亮）。
 *  家族只从面包屑推导；行自带的 go 负责二级/三级定位（tier / view / section）。
 *  返回 `landedOn`：行级命中（"row"）或**条件隐藏行**落到分节根（"section-root"，note 随行）。
 *  note 的展示由调用方做（toast / 气泡），searchRows 保持可离线评估、不碰 UI。 */
export function goSearchRow(row: SearchRow): { family: "settings" | "plugins"; breadcrumb: string[]; landedOn: "row" | "section-root"; note?: string } {
  const breadcrumb = breadcrumbOf(row);
  const family = familyOf(row);
  /* 条件隐藏行：家族照常把用户带到正确的页面，但**不落行**——落分节根 + 解释 */
  const hidden = typeof row.visible === "function" && row.visible() === false;
  /* ① 家族/页签：OH 行一律落 OH 一级入口（插件页的 OH 分节由 entry="oh" 渲染）；
     hidden 时也先到 OH 分节——分节根/档位根就在那里面，note 由该页 focus 通道转述 */
  if (family === "plugins") {
    goEntry(row.tab === "OneTHU Harness" ? "oh" : "plugins");
  } else {
    requestSettingsTab(row.tab);
    navGo("settings");
  }
  /* ②/③ 二级（切档/切视图）与三级（行定位）都在 go 里；注册表只声明不走 go 的兜底 */
  if (hidden) {
    if (family === "plugins") {
      requestPluginsFocus({ fallbackTarget: row.root, note: row.fallbackNote });
    } else {
      requestSettingsSection(row.section);
    }
    return { family, breadcrumb, landedOn: "section-root", note: row.fallbackNote ?? "" };
  }
  if (row.landOn) {
    /* 注册时声明「没有独立控件」的行：落分节根 + 一句解释，绝不冒充行级命中 */
    if (family === "plugins") {
      requestPluginsFocus({ fallbackTarget: row.root, note: row.landOn.note });
    } else {
      requestSettingsSection(row.landOn.section);
    }
    return { family, breadcrumb, landedOn: "section-root", note: row.landOn.note };
  }
  if (row.go) {
    row.go(); // 二级/三级：OH 切档、插件切视图/分类、分节/行滚动高亮都在这里
    return { family, breadcrumb, landedOn: "row" };
  }
  requestSettingsSection(row.title);
  return { family, breadcrumb, landedOn: "row" };
}
