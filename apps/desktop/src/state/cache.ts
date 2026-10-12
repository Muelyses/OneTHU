/**
 * 轻量 SWR 式数据缓存（thu-info-app redux-persist / learnX 全量持久化的桌面端等价物，
 * 2026-09 性能专项）：
 * - 模块级 Map（内存）+ 可选 localStorage 持久化（小体积关键数据，冷启动即时可用）
 * - cacheGet 挂载即取旧值 → 页面立即渲染上次数据，不闪骨架屏
 * - cacheFetch 单飞去重：同 key 并发共享同一个 Promise
 * - 条目带时间戳，hook 据此决定「新鲜跳过 / 过期静默重验证」（SWR 语义）
 * 安全边界：只缓存非敏感展示数据（余额/课表/新闻等），凭据类数据一律不进缓存。
 */

export interface CacheEntry<T> {
  data: T;
  /** 写入时间戳（Date.now()） */
  at: number;
}

const mem = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/** 单条持久化上限：超过则只留内存（防 localStorage 配额爆掉） */
const PERSIST_LIMIT = 200 * 1024;

function lsKey(key: string): string {
  return `onethu.cache.${key}.v1`;
}

/** 全部缓存键（内存 ∪ localStorage）：跨键聚合快照用（如系统日历 SWR 兜底） */
export function cacheKeys(): string[] {
  const keys = new Set(mem.keys());
  try {
    const n = globalThis.localStorage?.length ?? 0;
    for (let i = 0; i < n; i++) {
      const k = globalThis.localStorage?.key(i);
      if (k?.startsWith("onethu.cache.") && k.endsWith(".v1")) {
        keys.add(k.slice("onethu.cache.".length, -".v1".length));
      }
    }
  } catch { /* 无 localStorage 环境静默 */ }
  return [...keys];
}

/** 读缓存：内存优先，未命中回落 localStorage（并回填内存） */
export function cacheGet<T>(key: string): CacheEntry<T> | null {
  const hit = mem.get(key) as CacheEntry<T> | undefined;
  if (hit) return hit;
  try {
    const raw = globalThis.localStorage?.getItem(lsKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed || typeof parsed.at !== "number" || parsed.data === undefined) return null;
    mem.set(key, parsed as CacheEntry<unknown>);
    return parsed;
  } catch {
    return null;
  }
}

/** 写缓存：内存必写；键在持久化名单则尝试落盘（超限/异常静默降级为仅内存） */
export function cacheSet<T>(key: string, data: T, persist?: boolean): void {
  const entry: CacheEntry<T> = { data, at: Date.now() };
  mem.set(key, entry as CacheEntry<unknown>);
  const doPersist = persist ?? isPersistedKey(key);
  if (!doPersist) return;
  try {
    const raw = JSON.stringify(entry);
    if (raw.length <= PERSIST_LIMIT) {
      globalThis.localStorage?.setItem(lsKey(key), raw);
    }
  } catch {
    /* 配额满/隐私模式：内存缓存仍有效 */
  }
}

/**
 * 预览模式专用：写入一条**永不判过期**的示例数据，并返回还原函数（霖 2026-10-12）。
 *
 * 用途：抽屉里的组件预览不该现爬数据。各数据 hook 都是 SWR 语义——
 * `cacheGet` 命中且 `Date.now() - at` 未超 TTL 就不会发起请求；
 * 时间戳取远未来，于是**一次真实请求都不会发**，组件代码一行不用改。
 *
 * 只在内存里写（不落 localStorage），还原时把原条目放回去（原本没有则删掉），
 * 因此不会污染真实缓存与持久化数据。
 */
export function cacheSeedPreview<T>(key: string, data: T): () => void {
  const prev = mem.get(key) as CacheEntry<unknown> | undefined;
  mem.set(key, { data, at: PREVIEW_AT } as CacheEntry<unknown>);
  return () => {
    if (prev) mem.set(key, prev);
    else mem.delete(key);
  };
}

/** 示例数据的时间戳：远未来 → 永不过期（见 cacheSeedPreview） */
const PREVIEW_AT = Number.MAX_SAFE_INTEGER;

/**
 * 预览模式开关（霖 2026-10-12）。预览数据层挂载时置位，卸载时复位。
 *
 * 为什么还需要它：多数 hook 的加载判据是「缓存命中且不过期就不拉」（seed 就够），
 * 但个别 hook（如 useLearnData）是**挂载即拉**，只能显式让它在预览期跳过。
 * 放在这个叶子模块里，数据层与预览层都能引用，不产生循环依赖。
 */
let previewMode = false;
export function setPreviewMode(on: boolean): void {
  previewMode = on;
}
export function isPreviewMode(): boolean {
  return previewMode;
}

export function cacheInvalidate(key: string): void {
  mem.delete(key);
  try {
    globalThis.localStorage?.removeItem(lsKey(key));
  } catch {
    /* 忽略 */
  }
}

/** SWR：stale 即时上屏（localStorage 持久化，冷启动也秒开）+ 后台重验证。
 *  apply(stale, true) 先行渲染旧值；fetcher 完成后 apply(fresh, false)。
 *  陈旧度由调用方自判（hit.at），本层只管「先旧后新」。 */
export async function swrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  apply: (data: T, stale: boolean) => void,
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit) apply(hit.data, true);
  const fresh = await cacheFetch(key, fetcher);
  apply(fresh, false);
  return fresh;
}

/** 单飞：同 key 并发请求共享同一个 Promise；成功写缓存，失败不驻留 */
export function cacheFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fetcher()
    .then((data) => {
      cacheSet(key, data);
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p as Promise<unknown>);
  return p;
}

/** 一次性清空选课缓存课表（v3：2026-09-02 二次清空——旧种子时间列缺失）。
 *  只清派生缓存（core 种子/学期解析），绝不动草稿/暂存等用户数据。 */
export function purgeXkCaches(): void {
  try {
    const ls = globalThis.localStorage;
    if (!ls || ls.getItem("onethu.xk.purged.v3")) return;
    for (const key of [...mem.keys()]) {
      if (key.startsWith("xk:core:") || key === "xk:semester") mem.delete(key);
    }
    const stale: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && (k.includes("xk:core:") || k.includes("xk:semester"))) stale.push(k);
    }
    for (const k of stale) ls.removeItem(k);
    ls.setItem("onethu.xk.purged.v3", "1");
  } catch {
    /* 忽略配额/隐私模式 */
  }
}

/** 持久化名单：这些 key 的缓存落 localStorage（冷启动即时渲染） */
const PERSISTED = new Set(["card", "profile", "calendar", "semesters", "exams", "report", "dorm", "xk", "library"]);

function isPersistedKey(key: string): boolean {
  const head = key.split(/[\u0001:]/)[0];
  return PERSISTED.has(head ?? key);
}
