/**
 * 通知调度器（与 Tauri / React 解耦，依赖注入，可直测）。
 *
 * 职责只有一件：把 JS 算好的「通知计划」与「原生实际排了什么」对齐——
 *   · 内容变了或原生没排过 → 排
 *   · 计划里没有而原生排着 → 撤
 *   · 完全一致 → 一次 invoke 都不发（省电，也避免高频重排触发系统限流）
 *
 * 平台差异全部收敛在 deps.isAndroid 上：桌面端目前不投递（macOS / Windows 后端接入后
 * 只需把 isAndroid 换成「后端可用」的判定，调度逻辑不变）。
 *
 * 为什么调度不放在原生：原生只认「什么时候发什么」，判断「今天第几节课、作业还剩几天」
 * 需要课表与会话数据，那些只在 WebView 里。原生排程 = 纯投递，规则永远只有一份。
 */
import { channelOf, type NotifyPlanItem } from "./notifyPlan.js";
import { loadScheduledFingerprints, saveScheduledFingerprints } from "./notifySettings.js";
import { isPluginNotifyId } from "./notifyIds.js";

export type NotifyInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface NotifySchedulerDeps {
  invoke: NotifyInvoke;
  /** 本平台是否有可用后端（当前只有 Android 实现） */
  backendAvailable: boolean;
  /** 覆盖时钟（测试用） */
  now?: () => number;
  onError?: (message: string) => void;
}

export interface NotifySyncResult {
  ok: boolean;
  scheduled: number;
  cancelled: number;
  /** 未执行的原因：not-android / error */
  skipped?: string;
  error?: string;
}

/** 指纹：内容变化（标题/正文/时刻/落点/渠道）都要重排，故全部入指纹 */
function fingerprint(it: NotifyPlanItem): string {
  return [it.at, it.kind, it.title, it.body, it.page ?? "", it.params ? JSON.stringify(it.params) : ""].join("|");
}

function asArray(raw: unknown, key: string): string[] {
  if (!raw || typeof raw !== "object") return [];
  const v = (raw as Record<string, unknown>)[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function createNotifyScheduler(deps: NotifySchedulerDeps) {
  /** 上次成功排程的指纹（跨重启持久化） */
  let fingerprints: Record<string, string> = loadScheduledFingerprints();

  /** 计划条目 → 原生载荷（渠道名由 kind 映射，原生不再判断业务语义） */
  function payload(it: NotifyPlanItem): Record<string, unknown> {
    return {
      id: it.id,
      at: it.at,
      title: it.title,
      body: it.body,
      channel: channelOf(it.kind),
      target: it.page ?? "",
      params: it.params ?? {},
    };
  }

  /** 系统侧待投递的**宿主**通知 id。插件通知（plugin: 前缀）不属于宿主 id 空间：
   *  认领它们会导致下一轮同步把插件排的通知当"计划外"撤掉。 */
  async function pendingIds(): Promise<string[]> {
    try {
      return asArray(await deps.invoke("notify_pending"), "ids").filter((id) => !isPluginNotifyId(id));
    } catch {
      return [];
    }
  }

  /**
   * 对齐计划与原生状态。
   *
   * 失败时**不更新指纹**：宁可下一轮重排一次，也不能因为一次失败就认为「已经排好了」。
   */
  async function sync(plan: NotifyPlanItem[]): Promise<NotifySyncResult> {
    if (!deps.backendAvailable) return { ok: false, scheduled: 0, cancelled: 0, skipped: "not-android" };

    const want = new Map<string, NotifyPlanItem>();
    for (const it of plan) want.set(it.id, it);

    let pending: string[] = [];
    try {
      pending = await pendingIds();
    } catch {
      pending = [];
    }

    const toSchedule = plan.filter((it) => fingerprints[it.id] !== fingerprint(it) || !pending.includes(it.id));
    const known = new Set([...Object.keys(fingerprints), ...pending]);
    const toCancel = [...known].filter((id) => !want.has(id));

    try {
      if (toCancel.length) {
        await deps.invoke("notify_cancel", { ids: JSON.stringify(toCancel) });
      }
      if (toSchedule.length) {
        await deps.invoke("notify_schedule", { items: JSON.stringify(toSchedule.map(payload)) });
      }
    } catch (e) {
      const error = String(e).slice(0, 160);
      deps.onError?.(error);
      return { ok: false, scheduled: 0, cancelled: 0, error };
    }

    // 只有这一轮确实排进去的条目才记指纹；撤销掉的一并清掉
    const next: Record<string, string> = {};
    for (const [id, fp] of Object.entries(fingerprints)) {
      if (want.has(id) && !toSchedule.some((it) => it.id === id)) next[id] = fp;
    }
    for (const it of toSchedule) next[it.id] = fingerprint(it);
    fingerprints = next;
    saveScheduledFingerprints(fingerprints);

    return { ok: true, scheduled: toSchedule.length, cancelled: toCancel.length };
  }

  /** 全部撤销（用户关掉总开关时调用） */
  async function cancelAll(): Promise<NotifySyncResult> {
    if (!deps.backendAvailable) return { ok: false, scheduled: 0, cancelled: 0, skipped: "not-android" };
    try {
      const ids = [...new Set([...Object.keys(fingerprints), ...(await pendingIds())])];
      if (ids.length) await deps.invoke("notify_cancel", { ids: JSON.stringify(ids) });
      fingerprints = {};
      saveScheduledFingerprints({});
      return { ok: true, scheduled: 0, cancelled: ids.length };
    } catch (e) {
      const error = String(e).slice(0, 160);
      deps.onError?.(error);
      return { ok: false, scheduled: 0, cancelled: 0, error };
    }
  }

  async function permission(): Promise<{ ok: boolean; granted: boolean; exact: boolean }> {
    if (!deps.backendAvailable) return { ok: false, granted: false, exact: false };
    try {
      const raw = (await deps.invoke("notify_permission")) as Record<string, unknown> | null;
      return {
        ok: raw?.ok === true,
        granted: raw?.granted === true,
        exact: raw?.exact === true,
      };
    } catch {
      return { ok: false, granted: false, exact: false };
    }
  }

  /** 立即发一条测试通知（设置页「试一下」）：把权限、渠道、投递链一次验完 */
  async function test(): Promise<boolean> {
    if (!deps.backendAvailable) return false;
    try {
      const raw = (await deps.invoke("notify_test")) as Record<string, unknown> | null;
      return raw?.ok === true;
    } catch {
      return false;
    }
  }

  return {
    sync,
    cancelAll,
    permission,
    test,
    /** 测试与调试用：当前指纹表快照 */
    fingerprints: (): Record<string, string> => ({ ...fingerprints }),
    /** 重载持久化指纹（App 重启后的冷启动路径） */
    reload: (): void => {
      fingerprints = loadScheduledFingerprints();
    },
  };
}
