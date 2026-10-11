/**
 * 全量搜索的组合层（§2.2 / §2.8.4）：功能（注册表）+ 原子（页面/实体/在线服务）+ 设置页签。
 *
 * 为什么单独一层：服务页的顶部搜索结果与 PC 的命令面板**必须是同一份结果**——
 * 两处各写一套，迟早出现「面板搜得到、服务页搜不到」或者反过来（ADR 第 6 条防的就是这个）。
 * 这里只做组合；匹配实现仍在 navigation.ts（matchNavQuery）与 atoms.tsx（searchAtoms）。
 */
import { searchAtoms, type AtomHit } from "./atoms.js";
import { matchNavQuery, type NavEntry } from "./navigation.js";
import { SETTINGS_TAB_ORDER } from "./settingsMode.js";
import { matchSearchRows, type SearchRow } from "./searchRows.js";

export interface SearchAllResult {
  /** **设置行级命中（最高优先级）**：声明式注册表，不依赖 DOM/是否可见 */
  rows: Array<{ row: SearchRow; score: number }>;
  /** 注册表命中（功能） */
  entries: NavEntry[];
  /** 原子命中（页面 / 实体 / 在线服务），已与注册表去重 */
  atoms: AtomHit[];
  /** 设置页签命中 */
  tabs: string[];
}

export function searchAll(q: string, limit = 14): SearchAllResult {
  const query = q.trim();
  /* ③ 行级命中排在最前：搜「音色」第一跳就是那一行，而不是先蹦出 OH 大页 */
  const rows = query ? matchSearchRows(query, 8) : [];
  const rowKeys = new Set(rows.map((x) => x.row.title));
  const entries = matchNavQuery(query);
  // 与导航命中去重：页面/组件原子已在注册表里的不再重复出
  const navIds = new Set(entries.map((e) => e.id));
  const atoms = searchAtoms(query, limit).filter(
    (a) => !((a.kind === "page" || a.kind === "widget") && navIds.has(a.key)),
  );
  // 高级模式退役后页签不再分层（2026-10-11）：全量即可
  const standard = SETTINGS_TAB_ORDER;
  const tabs = query ? standard.filter((t) => t.includes(query)) : [];
  return { rows, entries, atoms, tabs };
}
