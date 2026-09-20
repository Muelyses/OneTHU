/**
 * 显示同步器：把「数据变化 → 防抖 → 重算 → 推给原生」这段时机逻辑抽成一件共用件。
 *
 * 通知与小组件是两条独立链路（通知有总开关，小组件没有；小组件只在 Android 有承载），
 * 但触发时机完全一样：数据订阅、跨天滚动、冷启动各对齐一次。两份防抖/定时如果各写一遍，
 * 迟早漂移（这是本项目反复踩过的形态）。所以只留一份时机逻辑，两条链路各自注入 run。
 */
export interface SyncerDeps<T> {
  /** 取数（纯读快照） */
  collect: (now: number) => T;
  /** 数据变化订阅 */
  subscribe: (fn: () => void) => () => void;
  /** 真正要做的对齐动作（投递/推送） */
  run: (inputs: T, now: number) => Promise<void> | void;
  /** 数据变化后的防抖窗口：一次刷新会连着触发多个订阅 */
  debounceMs?: number;
  /** 定时重算间隔：跨天与滚动窗口靠它兜底 */
  tickMs?: number;
  onError?: (message: string) => void;
}

export interface Syncer {
  /** 立即对齐一次 */
  syncNow: () => Promise<void>;
  /** 停掉订阅与定时器 */
  stop: () => void;
  /** 是否已停（测试与调试用） */
  stopped: () => boolean;
}

const DEFAULT_DEBOUNCE_MS = 3000;
const DEFAULT_TICK_MS = 15 * 60 * 1000;

export function createSyncer<T>(deps: SyncerDeps<T>): Syncer {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const tickMs = deps.tickMs ?? DEFAULT_TICK_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const report = (e: unknown): void => deps.onError?.(String(e).slice(0, 160));

  async function syncNow(): Promise<void> {
    const now = Date.now();
    await deps.run(deps.collect(now), now);
  }

  function schedule(): void {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void syncNow().catch(report);
    }, debounceMs);
  }

  const unsubscribe = deps.subscribe(schedule);

  tick = setInterval(() => {
    void syncNow().catch(() => {
      /* 定时任务静默：失败下一轮自然重试（指纹不更新即会重排） */
    });
  }, tickMs);

  // 启动即对齐一次：上次运行可能残留过期状态
  void syncNow().catch(() => undefined);

  return {
    syncNow,
    stopped: () => stopped,
    stop: () => {
      stopped = true;
      unsubscribe();
      if (timer) clearTimeout(timer);
      if (tick) clearInterval(tick);
      timer = null;
      tick = null;
    },
  };
}
