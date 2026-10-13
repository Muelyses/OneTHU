/**
 * 用户扩展层（2026-10-13 OH 自我进化的 TS 侧基座）。
 *
 * 三类用户生成物，全部数据驱动、改完即生效（无编译、无重启）：
 *   - UserTool  ：命名工具 = 工具调用序列（steps），OH 对话里 ext_tool_run 直接执行；
 *   - OneFlow   ：工作区+自动化+技能的结合体 = 触发器（手动/定时/事件）+ 步骤序列，
 *                 事件触发挂既有应用事件（作业截止/成绩更新等），定时走 30s 节拍器；
 *   - UserWidget：用户生成组件（HTML 模板 + 可选数据键），落在自由白板的
 *                 custom:usergen:<id> 上，桌面小组件管线经 widgetSource 透出（后续批次）。
 *
 * 步骤执行器：steps = [{ tool: "ns.method", args, from?: {参数名: "$1.path"} }]，
 * $N 引用第 N 步结果（点路径取值），执行序贯、失败即停并回报已完成的步数。
 * 安全：只允许调用插件门面白名单内的 ns（见 canCall），写操作走既有 gate。
 */
import { createPortal } from "react-dom";

export interface ExtStep {
  tool: string; // "ns.method"
  args?: Record<string, unknown>;
  /** 参数注入：{ 目标参数名: "$1.结果路径" } —— $N = 第 N 步（1 起）的 JSON 结果 */
  from?: Record<string, string>;
}

export interface UserTool {
  id: string;
  name: string;
  description: string;
  steps: ExtStep[];
  createdAt: number;
}

export type FlowTrigger =
  | { kind: "manual" }
  | { kind: "cron"; everyMinutes: number }
  | { kind: "event"; event: "hw-deadline" | "grades-update" | "notice" | "app-start" };

export interface UserTheme {
  id: string;
  name: string;
  /** CSS 变量覆盖（--md-sys-color-primary 等 System 名） */
  vars: Record<string, string>;
  createdAt: number;
}

export interface UserWidget {
  id: string;
  name: string;
  /** 白名单净化后的 HTML 片段（不含 script/事件属性） */
  html: string;
  createdAt: number;
}

export interface UserFlow {
  id: string;
  name: string;
  trigger: FlowTrigger;
  steps: ExtStep[];
  createdAt: number;
  lastRun?: number;
  lastOk?: boolean;
}

const KEY = "onethu.userext.v1";

export interface UserExtDoc {
  v: 1;
  tools: UserTool[];
  flows: UserFlow[];
  widgets: UserWidget[];
  themes: UserTheme[];
  /** 当前生效的用户生成主题 id（null = 跟随系统主题） */
  activeThemeId: string | null;
}

function empty(): UserExtDoc {
  return { v: 1, tools: [], flows: [], widgets: [], themes: [], activeThemeId: null };
}

function load(): UserExtDoc {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<UserExtDoc>;
      if (p.v === 1 && Array.isArray(p.tools) && Array.isArray(p.flows)) {
        return {
          v: 1,
          tools: p.tools,
          flows: p.flows,
          widgets: Array.isArray(p.widgets) ? p.widgets : [],
          themes: Array.isArray(p.themes) ? p.themes : [],
          activeThemeId: typeof p.activeThemeId === "string" ? p.activeThemeId : null,
        };
      }
    }
  } catch {
    /* 脏数据当没有 */
  }
  return empty();
}

export interface WidgetDef {
  id: string;
  name: string;
  html: string;
}

/** 白名单净化：去 <script>/<style>/iframe/事件属性/javascript: 链接。
 *  用户生成内容一律过这道再进 DOM（自由白板 innerHTML 渲染）。 */
export function sanitizeUserHtml(html: string): string {
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/ on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/ on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");
  return out;
}

export function upsertWidget(w: WidgetDef): void {
  const i = doc.widgets.findIndex((x) => x.id === w.id);
  const next: UserWidget = { ...w, createdAt: Date.now() };
  if (i >= 0) {
    const prev = doc.widgets[i];
    if (prev) doc.widgets[i] = next;
    else doc.widgets.push(next);
  } else doc.widgets.push(next);
  commit();
}

export function widgetById(id: string): WidgetDef | null {
  return doc.widgets.find((x) => x.id === id) ?? null;
}

let doc: UserExtDoc = load();
const listeners = new Set<() => void>();

function commit(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    /* 满：静默（用户扩展低频小体量） */
  }
  listeners.forEach((f) => f());
}

export function subscribeUserExt(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function userExtSnapshot(): UserExtDoc {
  return doc;
}

export function upsertTool(t: Omit<UserTool, "createdAt"> & { createdAt?: number }): void {
  const i = doc.tools.findIndex((x) => x.id === t.id);
  const next: UserTool = { ...t, createdAt: t.createdAt ?? Date.now() };
  if (i >= 0) {
    const prev = doc.tools[i];
    if (prev) doc.tools[i] = next;
    else doc.tools.push(next);
  } else doc.tools.push(next);
  commit();
}

export function deleteTool(id: string): void {
  doc.tools = doc.tools.filter((x) => x.id !== id);
  commit();
}

export function upsertFlow(f: Omit<UserFlow, "createdAt"> & { createdAt?: number }): void {
  const i = doc.flows.findIndex((x) => x.id === f.id);
  const next: UserFlow = { ...f, createdAt: f.createdAt ?? Date.now() };
  if (i >= 0) doc.flows[i] = next;
  else doc.flows.push(next);
  commit();
}

export function deleteFlow(id: string): void {
  doc.flows = doc.flows.filter((x) => x.id !== id);
  commit();
}

export function touchFlow(id: string, ok: boolean): void {
  const f = doc.flows.find((x) => x.id === id);
  if (!f) return;
  f.lastRun = Date.now();
  f.lastOk = ok;
  commit();
}

/* ---- 执行器 ---- */

/** 点路径取值："$1.result.items[0].id" → 第 1 步结果里的那个值 */
function pick(stepResults: unknown[], path: string): unknown {
  const m = /^\$(\d+)\.(.+)$/.exec(path);
  if (!m || !m[1] || !m[2]) return path;
  const idx0 = Number(m[1]) - 1;
  let cur: unknown = stepResults[idx0];
  for (const seg of m[2].split(".")) {
    if (cur == null) return undefined;
    const arr = /^\[(\d+)\]$/.exec(seg);
    if (arr) {
      const idx = Number(arr[1]);
      cur = Array.isArray(cur) ? cur[idx] : undefined;
    } else cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export type ExtExecutor = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

/** 执行一个步骤序列（executor 由调用方注入=插件门面的 call） */
export async function runSteps(
  steps: ExtStep[],
  exec: ExtExecutor,
): Promise<{ ok: boolean; done: number; results: unknown[]; error?: string }> {
  const results: unknown[] = [];
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (!st) continue;
    const args: Record<string, unknown> = { ...(st.args ?? {}) };
    for (const [k, tmpl] of Object.entries(st.from ?? {})) {
      args[k] = pick(results, tmpl);
    }
    try {
      results.push(await exec(st.tool, args));
    } catch (e) {
      return { ok: false, done: i, results, error: `第 ${i + 1} 步失败：${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return { ok: true, done: steps.length, results };
}

export async function runTool(id: string, exec: ExtExecutor): Promise<{ ok: boolean; error?: string }> {
  const t = doc.tools.find((x) => x.id === id);
  if (!t) return { ok: false, error: "没有这个工具" };
  const r = await runSteps(t.steps, exec);
  return { ok: r.ok, error: r.error };
}

export async function runFlow(id: string, exec: ExtExecutor): Promise<{ ok: boolean; error?: string }> {
  const f = doc.flows.find((x) => x.id === id);
  if (!f) return { ok: false, error: "没有这个 OneFlow" };
  const r = await runSteps(f.steps, exec);
  touchFlow(id, r.ok);
  return { ok: r.ok, error: r.error };
}

/* ---- 节拍器：cron 类 OneFlow 与事件类 OneFlow 的常驻驱动（应用内单实例） ---- */
let started = false;
const lastCron = new Map<string, number>();

export function startScheduler(
  exec: ExtExecutor,
  events: { onDeadline: () => void; onGrades: () => void; onStart: () => void },
): void {
  if (started) return;
  started = true;
  const fire = async (f: UserFlow): Promise<void> => {
    const r = await runFlow(f.id, exec);
    touchFlow(f.id, r.ok);
  };
  const tick = (): void => {
    const now = Date.now();
    for (const f of doc.flows) {
      if (f.trigger.kind === "cron") {
        const ms = Math.max(1, f.trigger.everyMinutes) * 60000;
        const last = lastCron.get(f.id) ?? 0;
        if (now - last >= ms) {
          lastCron.set(f.id, now);
          void fire(f);
        }
      }
    }
  };
  setInterval(tick, 30000);
  setTimeout(tick, 4000);
  events.onStart();
  window.addEventListener("onethu.hw.deadline", () => {
    for (const f of doc.flows.filter((x) => x.trigger.kind === "event" && x.trigger.event === "hw-deadline")) void fire(f);
  });
  window.addEventListener("onethu.grades.update", () => {
    for (const f of doc.flows.filter((x) => x.trigger.kind === "event" && x.trigger.event === "grades-update")) void fire(f);
  });
}

/* ---- 用户生成主题：运行时 CSS 变量注入（不走插件市场管线；OH/用户直接创建） ---- */

const THEME_STYLE_ID = "onethu.usergen-theme";

function themeCss(t: UserTheme): string {
  const lines = Object.entries(t.vars).map(([k, v]) => `  ${k}: ${v};`);
  return `:root {\n${lines.join("\n")}\n}`;
}

/** 应用当前用户主题（拖到 style 表末尾压过主题系统的注入；null = 移除覆盖） */
export function applyUserThemeStyle(): void {
  let el = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
  const t = doc.activeThemeId ? doc.themes.find((x) => x.id === doc.activeThemeId) : null;
  if (!t) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = THEME_STYLE_ID;
  }
  el.textContent = themeCss(t);
  document.head.appendChild(el); // appendChild = 挪到末尾（与主题系统同一招：末尾压轴）
}

export function activateUserTheme(id: string | null): void {
  doc.activeThemeId = id;
  commit();
  applyUserThemeStyle();
}

/** 主题系统每次换主题都会重写自己的注入样式——监听 data-theme 变化，重挂用户主题压轴 */
let watchStarted = false;
export function startUserThemeWatch(): void {
  if (watchStarted) return;
  watchStarted = true;
  applyUserThemeStyle();
  new MutationObserver(() => applyUserThemeStyle()).observe(document.documentElement, {
    attributeFilter: ["data-theme", "data-scheme"],
  });
}

export function upsertTheme(t: { id: string; name: string; vars: Record<string, string> }): void {
  const i = doc.themes.findIndex((x) => x.id === t.id);
  const next: UserTheme = { ...t, createdAt: Date.now() };
  if (i >= 0) {
    const prev = doc.themes[i];
    if (prev) doc.themes[i] = next;
    else doc.themes.push(next);
  } else doc.themes.push(next);
  commit();
  if (doc.activeThemeId === t.id) applyUserThemeStyle();
}

export function deleteTheme(id: string): void {
  doc.themes = doc.themes.filter((x) => x.id !== id);
  if (doc.activeThemeId === id) {
    doc.activeThemeId = null;
    applyUserThemeStyle();
  }
  commit();
}
