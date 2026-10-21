/**
 * OH 搜索二合一的共享检索层（dev-explorer，explorer-oh 专属）：
 * ChatDock 搜索模式与悬浮球（GlobalOrb）搜索模式共用的：
 *  - useOhSearch(query)：searchAll 的防抖包装（160ms）；
 *  - 统一跳转通道 shipJump/applyJump：主窗口直接执行（设置行/页签 → 设置浮层；
 *    功能/实体 → openTab 开新标签页）；悬浮球是独立 webview（独立 JS 运行时），
 *    它只能经 Tauri 事件把「开标签页/开设置浮层」递给主窗口执行。
 *    主窗口侧的监听也在本文件注册（ChatDock 只在主窗口挂载，模块初始化即生效），
 *    不动 App.tsx / NotifyBridge（那是 Lead 的写域）。
 *  - 设置行跨窗口只传 **id**（SearchRow 带 go/visible 函数不可序列化），主窗口按 id
 *    从 allSearchRows() 还原——同一份注册表，天然同源。
 */
import { useEffect, useRef, useState } from "react";
import { useExperienceMode } from "../state/experienceMode.js";
import { searchAll, type SearchAllResult } from "../state/searchAll.js";
import { openTab, openSettings } from "../state/explorer.js";
import { recordSearchJump } from "../state/explorerPrefs.js";
import { resolveAtom, pageAtomRef } from "../state/atoms.js";
import { goSearchRow, allSearchRows, familyOf, type SearchRow } from "../state/searchRows.js";
import { requestSettingsTab } from "../state/settingsMode.js";
import { showToast } from "../state/toast.js";
import type { LearnNav, Page } from "../state/app.js";

/** 悬浮球窗口（?window=overlay）判定：它没有主窗口的 explorer 状态 */
export const IS_ORB_WINDOW = typeof window !== "undefined"
  && new URLSearchParams(window.location.search).get("window") === "overlay";

/* ══════════ 跳转消息（跨窗口可序列化） ══════════ */

type JumpMsg =
  | { k: "tab"; page: Page; params: LearnNav | null; title: string; query: string }
  | { k: "row"; id: string; query: string }
  | { k: "settings-tab"; tab: string };

const JUMP_EVENT = "onethu-explorer-jump";
const JUMP_LS_KEY = "onethu.explorer.jumpq.v1";

/** 主窗口：真正执行跳转（record + openTab / openSettings） */
function applyJump(msg: JumpMsg): void {
  if (msg.k === "tab") {
    recordSearchJump({ query: msg.query, page: msg.page, params: msg.params, title: msg.title });
    openTab(msg.page, msg.params, { title: msg.title });
    return;
  }
  if (msg.k === "settings-tab") {
    requestSettingsTab(msg.tab);
    openSettings("settings");
    return;
  }
  // 行级命中：按 id 从注册表还原（悬浮球只传 id）
  const row = allSearchRows().find((r) => r.id === msg.id);
  if (!row) return;
  const res = goSearchRow(row);
  /* 入口态由 goSearchRow 决定（OH 行 = entry "oh"）。这里再 openSettings(family) 会把
     OH 行全部打回「插件」段——2026-10-17 实测 22 个 OH 行全部不可达的根因。 */
  recordSearchJump({ query: msg.query, page: familyOf(row) === "plugins" ? "plugins" : "settings", params: null, title: row.title });
  if (res.note) showToast(res.note); // 条件隐藏行落到分节根时明说（本地路径同样走这里，统一反馈）
}

/** 悬浮球侧递送：Tauri 事件；非 Tauri 环境退 localStorage+storage 事件 */
function shipJump(msg: JumpMsg): void {
  if (!IS_ORB_WINDOW) {
    applyJump(msg);
    return;
  }
  void (async () => {
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit(JUMP_EVENT, msg);
      return;
    } catch {
      /* 非 Tauri（浏览器直接开 overlay 页）：走 localStorage 兜底 */
    }
    try {
      localStorage.setItem(JUMP_LS_KEY, JSON.stringify(msg));
    } catch {
      /* 忽略 */
    }
  })();
}

/** 主窗口侧监听注册（本模块被 ChatDock import 即生效；悬浮球窗口不注册） */
if (!IS_ORB_WINDOW && typeof window !== "undefined") {
  void (async () => {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      await listen<JumpMsg>(JUMP_EVENT, (e) => {
        const m = e.payload as JumpMsg | undefined;
        if (m && (m.k === "tab" || m.k === "row" || m.k === "settings-tab")) applyJump(m);
      });
    } catch {
      /* 非 Tauri：靠下面的 storage 兜底 */
    }
  })();
  // storage 兜底（同源多 webview / 浏览器多开）
  window.addEventListener("storage", (e) => {
    if (e.key !== JUMP_LS_KEY || !e.newValue) return;
    try {
      const m = JSON.parse(e.newValue) as JumpMsg;
      if (m && (m.k === "tab" || m.k === "row" || m.k === "settings-tab")) applyJump(m);
    } catch {
      /* 脏数据忽略 */
    }
  });
}

/* ══════════ 具体落点（ChatDock / GlobalOrb 渲染层各自调用） ══════════ */

/** 功能（注册表条目）命中：原子视图自带 (page, params) 组装，组装不了退回注册表目标 */
export function jumpEntry(id: string, fallbackPage: Page, fallbackParams: LearnNav | null | undefined, name: string, query: string): void {
  const ref = pageAtomRef(id);
  const view = ref ? resolveAtom(ref) : null;
  if (view) {
    // 借道一个「开新标签页」的 navigate 适配器拿真实 (page, params)（可能带实体深链参数）
    let shipped = false;
    view.open((page, params) => {
      shipped = true;
      shipJump({ k: "tab", page, params: params ?? null, title: name, query });
    });
    if (shipped) return;
  }
  shipJump({ k: "tab", page: fallbackPage, params: fallbackParams ?? null, title: name, query });
}

/** 实体原子命中（AtomHit = {kind, key, title}） */
export function jumpAtom(kind: string, key: string, title: string, query: string): void {
  const view = resolveAtom({ kind: kind as never, key });
  if (!view) return;
  view.open((page, params) => shipJump({ k: "tab", page, params: params ?? null, title, query }));
}

/** 直接开一个 (page, params) 工作实例（最近搜索记录 chips 用：记录里存的就是它） */
export function jumpTabPayload(page: Page, params: LearnNav | null, title: string, query: string): void {
  shipJump({ k: "tab", page, params, title, query });
}

/** 设置行级命中：跨窗口只传 id */
export function jumpSearchRow(row: SearchRow, query: string): void {
  shipJump({ k: "row", id: row.id, query });
}

/** 设置页签命中 */
export function jumpSettingsTab(tab: string): void {
  shipJump({ k: "settings-tab", tab });
}

/* ══════════ 防抖检索 hook ══════════ */

export interface OhSearchState {
  /** null = 还在防抖/没输入；有值 = searchAll 结果 */
  result: SearchAllResult | null;
  total: number;
}

/** 160ms 防抖的 searchAll（两处搜索模式共用；输入变化丢弃过期结果） */
export function useOhSearch(query: string, delayMs = 160): OhSearchState {
  const mode = useExperienceMode();
  const [st, setSt] = useState<OhSearchState>({ result: null, total: 0 });
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSt({ result: null, total: 0 });
      return;
    }
    const my = ++seq.current;
    const t = window.setTimeout(() => {
      const r = searchAll(q, 20);
      if (seq.current !== my) return;
      const total = r.rows.length + r.entries.length + r.atoms.length + r.tabs.length;
      setSt({ result: r, total });
    }, delayMs);
    return () => window.clearTimeout(t);
  }, [query, delayMs, mode]);
  return st;
}
