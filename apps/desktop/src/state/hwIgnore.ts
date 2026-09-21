/**
 * 作业「忽略」状态（R21c 用户定案）。
 *
 * 语义（用户口径）：忽略后的作业**不再在作业区与日程里提醒/显示**，也不再进任何
 * 通知（DDL 提醒、早报、小组件计数）；但可在「全部作业 → 已忽略」分组里找回并恢复——
 * 不是删除，数据源一行没动。
 *
 * 为什么按 id 而不是课程+id：网络学堂的 xszyid 全局唯一，外部源 id 已带 `ext:` 前缀
 * （state/exthw.ts toHomework），提醒计划（PlanHomework.id）用的也是同一个 id ——
 * 单一键才能让「列表过滤」与「提醒过滤」用的是同一份事实。
 *
 * 零依赖（只碰 localStorage）+ useSyncExternalStore：多处列表同时生效。
 */
import { useSyncExternalStore } from "react";

const KEY = "onethu.hw.ignored.v1";
/** 上限：忽略是长期状态，但不该无限膨胀（超出丢最旧的） */
const MAX = 500;

export interface IgnoredHw {
  id: string;
  title: string;
  at: number;
}

let cache: IgnoredHw[] | null = null;
const listeners = new Set<() => void>();
/** getSnapshot 必须返回稳定引用：仅在真正变更时重建 */
let snapshot: Map<string, IgnoredHw> = new Map();

function read(): IgnoredHw[] {
  if (cache) return cache;
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(arr)
      ? arr
          .filter((x): x is IgnoredHw => Boolean(x) && typeof x === "object" && typeof (x as IgnoredHw).id === "string")
          .map((x) => ({ id: x.id, title: typeof x.title === "string" ? x.title : "", at: Number(x.at) || 0 }))
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(list: IgnoredHw[]): void {
  cache = list.slice(-MAX);
  snapshot = new Map(cache.map((e) => [e.id, e]));
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* 存不下不影响本次会话内生效 */
  }
  listeners.forEach((l) => l());
}

function ensureSnapshot(): Map<string, IgnoredHw> {
  if (snapshot.size === 0 && read().length > 0) snapshot = new Map(read().map((e) => [e.id, e]));
  return snapshot;
}

/** 丢弃内存缓存并重新从存储读取（数据导入/恢复后调用；测试也用它验证坏数据路径） */
export function resetHwIgnoreCache(): void {
  cache = null;
  snapshot = new Map();
  listeners.forEach((l) => l());
}

export function isHwIgnored(id: string): boolean {
  return Boolean(id) && ensureSnapshot().has(id);
}

/** 忽略一条作业（需先经用户确认——UI 层负责弹确认框） */
export function ignoreHw(id: string, title: string): void {
  if (!id || ensureSnapshot().has(id)) return;
  write([...read(), { id, title, at: Date.now() }]);
}

/** 恢复（从「已忽略」里移出，重新参与提醒与显示） */
export function unignoreHw(id: string): void {
  if (!id) return;
  const next = read().filter((e) => e.id !== id);
  if (next.length !== read().length) write(next);
}

export function ignoredHwList(): IgnoredHw[] {
  return read();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 列表/提醒过滤用：当前被忽略的 id 映射（含标题，供「已忽略」分组展示） */
export function useIgnoredHw(): Map<string, IgnoredHw> {
  return useSyncExternalStore(subscribe, ensureSnapshot, () => snapshot);
}

/** 单条判定（行组件用；订阅同一份快照，忽略/恢复立刻反映到所有列表） */
export function useHwIgnored(id: string): boolean {
  const map = useIgnoredHw();
  return map.has(id);
}
