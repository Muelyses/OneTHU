/**
 * R18c：扫码期间 Android 前台服务保活（前端桥 + 可测试的生命周期编排）。
 *
 * 纯逻辑模块——**不直接依赖 Tauri / React**：调用方注入 invoke 与 isAndroid，
 * 因此 tools/ykt-qr-test.mjs 可用 stub 断言「保活启停随面板生命周期」的调用序列。
 *
 * 语义（对应需求 26.2/26.3）：
 *  - 二维码就绪（phase:"qr"）→ start；成功 / 取消 / 过期 / 卸载 → stop；
 *  - 仅 Android 调用，非 Android 平台零行为变化（不 invoke、不报错）；
 *  - 通知权限被拒 / 服务启动失败 → 返回 { ok:false, reason }，不抛错（前端静默降级）；
 *  - 幂等：重复 start 不重复 invoke，未生效时 stop 不 invoke。
 */

/** 保活命令名（Rust 侧再经 run_mobile_plugin 调 Kotlin startQrKeepAlive / stopQrKeepAlive） */
export type QrKeepAliveCommand = "start_qr_keep_alive" | "stop_qr_keep_alive";

export type QrKeepAliveInvoke = (cmd: QrKeepAliveCommand) => Promise<unknown>;

export interface QrKeepAliveStatus {
  /** 保活是否生效（Android 且服务已启动、通知权限未被拒） */
  ok: boolean;
  /** 未生效原因：not-android / notifications-denied / start-failed / invoke-error / bad-response */
  reason?: string;
}

export interface QrKeepAliveOptions {
  invoke: QrKeepAliveInvoke;
  isAndroid: boolean;
  /** 生效状态变化（true=生效）→ 面板据此切换提示文案 */
  onStatus?: (on: boolean) => void;
}

/** 归一化插件返回：只认 { ok:true, ... }；异常形状一律视为未生效。 */
function normalize(raw: unknown): QrKeepAliveStatus {
  if (raw && typeof raw === "object" && "ok" in raw) {
    const o = raw as { ok?: unknown; reason?: unknown };
    return { ok: o.ok === true, reason: typeof o.reason === "string" ? o.reason : undefined };
  }
  return { ok: false, reason: "bad-response" };
}

export interface QrKeepAliveController {
  /** 请求启动（幂等）。返回最终是否生效。 */
  start(): Promise<QrKeepAliveStatus>;
  /** 请求停止（幂等）：启动仍在途时先等其落定，避免 start 晚于 stop 落地。 */
  stop(): Promise<void>;
  /** 当前是否生效 */
  readonly on: boolean;
}

export function createQrKeepAlive(opts: QrKeepAliveOptions): QrKeepAliveController {
  let on = false;
  let inflight: Promise<QrKeepAliveStatus> | null = null;

  function setOn(next: boolean): void {
    if (on === next) return;
    on = next;
    opts.onStatus?.(next);
  }

  async function start(): Promise<QrKeepAliveStatus> {
    if (!opts.isAndroid) return { ok: false, reason: "not-android" };
    if (on) return { ok: true, reason: "already-on" };
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const st = normalize(await opts.invoke("start_qr_keep_alive"));
        if (st.ok) setOn(true);
        return st;
      } catch {
        // 权限被拒 / 服务失败 / IPC 异常：静默降级，不阻塞扫码
        return { ok: false, reason: "invoke-error" };
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  async function stop(): Promise<void> {
    if (!opts.isAndroid) return;
    if (inflight) {
      try {
        await inflight;
      } catch {
        /* start 已自行吞错 */
      }
    }
    if (!on) return;
    setOn(false);
    try {
      await opts.invoke("stop_qr_keep_alive");
    } catch {
      /* 停止失败不影响扫码主流程 */
    }
  }

  return {
    start,
    stop,
    get on() {
      return on;
    },
  };
}

/** 面板生命周期事件 → 保活启停。 */
export interface QrKeepAliveBinding {
  /** 状态机 onPhase：qr → start；expired → stop；loading 等其余阶段忽略。 */
  onPhase(phase: string): void;
  /** 成功 / 取消 / 卸载统一收口 → stop。 */
  stop(): void;
}

export function bindQrKeepAlive(ctrl: QrKeepAliveController): QrKeepAliveBinding {
  return {
    onPhase(phase: string): void {
      if (phase === "qr") void ctrl.start();
      else if (phase === "expired") void ctrl.stop();
    },
    stop(): void {
      void ctrl.stop();
    },
  };
}
