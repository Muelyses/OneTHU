/**
 * 本机使用统计（「最近使用 / 猜你喜欢」的唯一数据源）。
 *
 * 为什么单独一个模块、单独一个键：原子收藏是用户的显式意图（立身之本），**绝不被
 * 统计自动改写**。这里只记「点过什么」，用来在今日页推荐；推荐卡只跳到目标，从不
 * 替用户收藏任何东西。
 *
 * - onethu.usage.counts.v1 = { "<kind>~<key>": { n, last, title?, sub?, group? } }
 *   title/sub/group 是**点的当时**记下来的副本：动态原子（课程/在线服务）过一学期
 *   可能解析不出来，卡片仍要显示得出名字，不至于剩一行空白。
 * - 只存最近 120 条、次数封顶 9999（防止键无限膨胀）。
 * - 读写全部 try/catch 静默降级（隐私模式 / 无 localStorage 时整个模块空转）。
 */
import type { AtomRef } from "../state/favorites.js";

const USAGE_KEY = "onethu.usage.counts.v1";
const MAX_ENTRIES = 120;
const MAX_COUNT = 9999;

export interface UsageEntry {
  kind: string;
  key: string;
  n: number;
  /** 最近一次使用时间（ms） */
  last: number;
  title?: string;
  sub?: string;
  group?: string;
}

type UsageTable = Record<string, UsageEntry>;

function idOf(ref: AtomRef): string {
  return ref.kind + "~" + ref.key;
}

function read(): UsageTable {
  try {
    const raw = globalThis.localStorage?.getItem(USAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: UsageTable = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const e = v as Partial<UsageEntry> | null;
      if (!e || typeof e !== "object") continue;
      if (typeof e.n !== "number" || typeof e.last !== "number") continue;
      const at = k.indexOf("~");
      if (at <= 0) continue;
      out[k] = {
        kind: typeof e.kind === "string" ? e.kind : k.slice(0, at),
        key: typeof e.key === "string" ? e.key : k.slice(at + 1),
        n: Math.max(1, Math.min(MAX_COUNT, Math.round(e.n))),
        last: e.last,
        title: typeof e.title === "string" ? e.title : undefined,
        sub: typeof e.sub === "string" ? e.sub : undefined,
        group: typeof e.group === "string" ? e.group : undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function write(table: UsageTable): void {
  try {
    const entries = Object.entries(table);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1].last - a[1].last);
      const next: UsageTable = {};
      for (const [k, v] of entries.slice(0, MAX_ENTRIES)) next[k] = v;
      globalThis.localStorage?.setItem(USAGE_KEY, JSON.stringify(next));
      return;
    }
    globalThis.localStorage?.setItem(USAGE_KEY, JSON.stringify(table));
  } catch {
    /* 隐私模式：统计不可用，功能照旧 */
  }
}

/** 记一次使用（同一次会话内重复点击照记，用来体现真实使用强度） */
export function recordAtomUse(
  ref: AtomRef,
  meta?: { title?: string; sub?: string; group?: string },
): void {
  if (!ref?.kind || !ref.key) return;
  const table = read();
  const id = idOf(ref);
  const prev = table[id];
  table[id] = {
    kind: ref.kind,
    key: ref.key,
    n: Math.min(MAX_COUNT, (prev?.n ?? 0) + 1),
    last: Date.now(),
    title: meta?.title ?? prev?.title,
    sub: meta?.sub ?? prev?.sub,
    group: meta?.group ?? prev?.group,
  };
  write(table);
}

/** 补记标题（导航后才知道标题的场合；**不增加计数**） */
export function labelAtomUse(
  ref: AtomRef,
  meta: { title?: string; sub?: string; group?: string },
): void {
  const table = read();
  const id = idOf(ref);
  const prev = table[id];
  if (!prev) return;
  table[id] = {
    ...prev,
    title: meta.title ?? prev.title,
    sub: meta.sub ?? prev.sub,
    group: meta.group ?? prev.group,
  };
  write(table);
}

/** 按最近使用排序（最多 limit 条） */
export function recentAtomUses(limit = 8): UsageEntry[] {
  return Object.values(read())
    .sort((a, b) => b.last - a.last)
    .slice(0, Math.max(0, limit));
}

/** 按使用次数排序（最多 limit 条） */
export function topAtomUses(limit = 8): UsageEntry[] {
  return Object.values(read())
    .sort((a, b) => b.n - a.n || b.last - a.last)
    .slice(0, Math.max(0, limit));
}

/** 使用统计快照（OH / 设置页展示用；只有本机点击记录，不含任何校园数据） */
export function usageStats(): {
  total: number;
  kinds: number;
  top: Array<{ kind: string; key: string; title: string; group: string; n: number; last: number }>;
} {
  const all = Object.values(read());
  return {
    total: all.reduce((s, e) => s + e.n, 0),
    kinds: new Set(all.map((e) => e.kind)).size,
    top: topAtomUses(10).map((e) => ({
      kind: e.kind,
      key: e.key,
      title: e.title ?? e.key,
      group: e.group ?? "",
      n: e.n,
      last: e.last,
    })),
  };
}

/** 清空统计（设置页里的用户可控开关；**不影响收藏夹**） */
export function clearUsage(): void {
  try {
    globalThis.localStorage?.removeItem(USAGE_KEY);
  } catch {
    /* 忽略 */
  }
}
