/**
 * 在线服务「常用服务」预置（首启把真正高频的两项铆上）。
 *
 * 事故原型：预置按严格子串匹配（「亲友来访」），而学校侧的正式名可能是「亲友入校报备」
 * /「亲友来访人员报备」——前者直接漏掉；漏掉的那一项**不会再试**（旧实现只要有一项
 * 命中就写了「已预置」标记），于是用户看到的「常用」里永远少一项。
 *
 * 现在：
 *  - 复用 serviceMatch 的口语容错分档（≥20 取最像的一条）；
 *  - 预置状态**按关键词记账**（哪些关键词已经预置过），漏掉的下次进页面继续补；
 *  - 带版本号：匹配规则升级（v1 → v2）时，老用户也会重新补一次——正是为了修这次的事故。
 */
import { serviceScore } from "./serviceMatch.js";

/** 匹配规则版本：改动匹配逻辑就 +1（老用户会按新规则补一次漏掉的预置项） */
export const SEED_VERSION = 2;

/** 预置关键词：按名称匹配（服务 id 由学校侧分配，名称更稳定） */
export const SEED_KEYWORDS = ["亲友来访", "缓考"];

export interface SeedState {
  v: number;
  /** 已经预置过的关键词（逐项记账：漏掉的下次还能补） */
  done: string[];
}

/** 解析预置标记：老格式 "1" = v1（当时不知道哪项命中了，一律视为未记账 → 重新补一次） */
export function loadSeedState(raw: string | null): SeedState {
  if (!raw) return { v: SEED_VERSION, done: [] };
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as { v?: unknown; done?: unknown };
      const done = Array.isArray(o.done) ? o.done.filter((x): x is string => typeof x === "string") : [];
      const ver = typeof o.v === "number" ? o.v : 0;
      // 版本不同：记账作废（重新补），但已铆上的服务不会重复添加（调用方按 id 去重）
      return { v: SEED_VERSION, done: ver === SEED_VERSION ? done : [] };
    }
  } catch {
    /* 旧格式 "1" 落到这里：视为 v1 → 记账清空，按新规则补一次 */
  }
  return { v: SEED_VERSION, done: [] };
}

export interface SeedItem {
  id: string;
  name: string;
  department?: string;
}

/** 挑出本次要补进「常用服务」的服务：每个未预置的关键词取最像的一条（分数 ≥20） */
export function pickSeedServices(
  items: SeedItem[],
  pinned: string[],
  done: string[],
): { ids: string[]; done: string[] } {
  const ids: string[] = [];
  const nowDone = [...done];
  const has = new Set(pinned);
  for (const kw of SEED_KEYWORDS) {
    if (nowDone.includes(kw)) continue;
    let best: { id: string; score: number } | null = null;
    for (const it of items) {
      const score = Math.max(serviceScore(it.name, kw), serviceScore(it.department ?? "", kw));
      if (score < 20) continue;
      if (!best || score > best.score) best = { id: it.id, score };
    }
    if (!best) continue; // 目录里没有相近的：不记账，下次进页面再试
    if (!has.has(best.id)) ids.push(best.id);
    has.add(best.id);
    nowDone.push(kw);
  }
  return { ids, done: nowDone };
}
