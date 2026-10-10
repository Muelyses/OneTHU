/**
 * 安卓系统级悬浮球适配器（需求 5，ball-overlay-android）。
 *
 * 契约：实现 lib/overlay.ts 的 OverlayAdapter 五方法（supported/show/hide/setMode/onEvent），
 * 命令面走 Tauri 插件 `plugin:onethu-overlay|overlay_*`（Kotlin 侧见
 * src-tauri/plugins/onethu-overlay/android/src/main/java/app/onethu/overlay/）。
 *
 * 事件通道（原生 → 前端）两条并行，id 单调去重：
 *   ① 主通道：原生直接对宿主 WebView evaluateJavascript 调 window.__onethuOverlayEvent(json)。
 *      不走定时器，所以应用在后台（WebView 定时器被限流）时仍然低延迟。
 *   ② 兜底：1.5s 轮询 overlay_poll_event(since)，把没被 ack 的事件捞回来（TTL 6s）。
 *   前端处理完一批后 overlay_ack_events(maxId) 清队列。
 *
 * 界面内容（原生 → 前端反向）：原生面板是纯 View，靠 pushUi() 把消息/转写/电平推过去渲染；
 * 面板输入框与语音条抬手则变成事件 submit{text} / hold / release 回到这里。
 * **因此 GlobalOrb 需要两处接线**（详见交付报告「需要 Lead 做的」）：
 *   - onOverlayEvent 里处理 "submit"（text 字段）→ 走 send(text)；
 *   - 消息/转写变化时调 overlayPushUi({ messages, transcript, level, listening, theme })。
 *
 * 红线：本文件任何路径都不得把主窗口拉到前台（不调 WebviewWindow.show/set_focus、
 * 不跳 Activity）。show() 只在缺授权时拉起系统「显示在其他应用上层」设置页。
 */
import type { OverlayAdapter, OverlayEvent, OverlayMode } from "./overlay.js";

/** 原生事件的真实形状：比 OverlayEvent 多一个 submit（带 text）与单调 id */
type NativeOverlayEventType = OverlayEvent["type"] | "submit";

interface NativeOverlayEvent {
  id?: number;
  type?: string;
  x?: number;
  y?: number;
  text?: string;
}

/** 推给原生界面的状态（原生面板/语音条据此渲染） */
export interface OverlayUiState {
  messages?: Array<{ role: "user" | "oh"; text: string }>;
  /** 语音条上的实时转写 */
  transcript?: string;
  /** 0..1 实时电平，驱动点点波纹 */
  level?: number;
  listening?: boolean;
  busy?: boolean;
  theme?: "light" | "dark";
}

export interface AndroidOverlayStatus {
  supported: boolean;
  hasPermission: boolean;
  showing: boolean;
  mode: string;
  closedByUser: boolean;
}

declare global {
  interface Window {
    /** 原生（Kotlin OverlayBridge）直推事件用的全局回调；未挂载时事件留在原生队列里 */
    __onethuOverlayEvent?: (ev: unknown) => void;
  }
}

const PLUGIN = "plugin:onethu-overlay";
const POLL_MS = 1500;

/** 动态 import Tauri API：非 Tauri 环境（纯浏览器预览）下本模块依然可安全加载 */
async function invokePlugin<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(`${PLUGIN}|${cmd}`, args);
}

/* ───────────────────────── 事件扇出中心 ───────────────────────── */

const handlers = new Set<(e: OverlayEvent) => void>();
let lastAck = 0;
let installed = false;
let pollTimer: number | null = null;
let pollBusy = false;

function dispatch(raw: NativeOverlayEvent): void {
  const type = typeof raw.type === "string" ? raw.type : "";
  if (!type || handlers.size === 0) return;
  const ev = {
    type: type as NativeOverlayEventType,
    x: typeof raw.x === "number" ? raw.x : undefined,
    y: typeof raw.y === "number" ? raw.y : undefined,
    text: typeof raw.text === "string" ? raw.text : undefined,
  };
  for (const h of Array.from(handlers)) {
    try {
      // submit 尚未写进 overlay.ts 的联合类型（需要 Lead 放宽，见报告）；
      // 这里先按 OverlayEvent 投出去，字段照旧带 text。
      h(ev as unknown as OverlayEvent);
    } catch {
      /* 单个订阅者出错不影响其他订阅者 */
    }
  }
}

function acceptBatch(list: unknown): void {
  const arr = Array.isArray(list) ? list : [];
  let maxId = lastAck;
  // 按 id 升序处理：原生队列本就有序，但兜底轮询可能与直推交叉
  const items = arr
    .map((r) => r as NativeOverlayEvent)
    .filter((e) => typeof e.id === "number" && (e.id as number) > lastAck)
    .sort((a, b) => (a.id as number) - (b.id as number));
  for (const e of items) {
    const id = e.id as number;
    if (id > maxId) maxId = id;
    dispatch(e);
  }
  if (maxId > lastAck) {
    lastAck = maxId;
    // ack 失败不致命：TTL 内轮询会重复投一次，dispatch 侧已按 id 去重
    void invokePlugin("overlay_ack_events", { id: maxId }).catch(() => undefined);
  }
}

function install(): void {
  if (installed) return;
  installed = true;
  try {
    window.__onethuOverlayEvent = (ev: unknown) => {
      if (handlers.size === 0) return; // 没人订阅就先别消费，留在原生队列里
      if (ev && typeof ev === "object") acceptBatch([ev]);
    };
  } catch {
    /* 非浏览器环境 */
  }
  // 兜底轮询：直推成功时它基本是空转（一次 invoke 返回空数组），代价可接受
  pollTimer = window.setInterval(() => {
    if (pollBusy || handlers.size === 0) return;
    pollBusy = true;
    void invokePlugin<{ events?: unknown }>("overlay_poll_event", { since: lastAck })
      .then((r) => acceptBatch(r?.events))
      .catch(() => undefined)
      .finally(() => {
        pollBusy = false;
      });
  }, POLL_MS);
}

function uninstall(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  installed = false;
  try {
    window.__onethuOverlayEvent = undefined;
  } catch {
    /* 忽略 */
  }
}

/* ───────────────────────── 额外能力（供前端/设置页用） ───────────────────────── */

/** 把界面状态推给原生悬浮层（未接线时原生面板只显示占位与本地回显） */
export async function pushUi(state: OverlayUiState): Promise<void> {
  try {
    await invokePlugin("overlay_push_ui", { state: JSON.stringify(state ?? {}) });
  } catch {
    /* 桌面端/未注册：静默 */
  }
}

/** 是否已授予「显示在其他应用上层」 */
export async function hasOverlayPermission(): Promise<boolean> {
  try {
    const r = await invokePlugin<{ value?: unknown }>("overlay_has_permission");
    return r?.value === true;
  } catch {
    return false;
  }
}

/** 拉起系统悬浮层授权页（应用内不弹自定义弹窗） */
export async function requestOverlayPermission(): Promise<void> {
  try {
    await invokePlugin("overlay_request_permission");
  } catch {
    /* 静默：非安卓或未注册 */
  }
}

/** 诊断：权限 / 是否在显示 / 形态 / 「本次已关闭」标记（设置页与真机排查用） */
export async function overlayStatus(): Promise<AndroidOverlayStatus | null> {
  try {
    const r = await invokePlugin<Partial<AndroidOverlayStatus>>("overlay_status");
    return {
      supported: r?.supported === true,
      hasPermission: r?.hasPermission === true,
      showing: r?.showing === true,
      mode: typeof r?.mode === "string" ? r.mode : "hidden",
      closedByUser: r?.closedByUser === true,
    };
  } catch {
    return null;
  }
}

/* ───────────────────────── OverlayAdapter 五方法 ───────────────────────── */

const adapter: OverlayAdapter = {
  /** 平台能力（不含授权状态）：安卓恒 true；桌面端 Rust 侧返回 false */
  async supported(): Promise<boolean> {
    try {
      const r = await invokePlugin<{ value?: unknown }>("overlay_supported");
      return r?.value === true;
    } catch {
      return false;
    }
  },

  async show(): Promise<void> {
    const r = await invokePlugin<{ ok?: unknown; reason?: unknown }>("overlay_show").catch(() => null);
    if (r && r.ok === false && r.reason === "no-permission") {
      // 缺「显示在其他应用上层」：拉系统授权页，用户授权后回应用再点一次
      await requestOverlayPermission();
    }
  },

  async hide(): Promise<void> {
    await invokePlugin("overlay_hide").catch(() => undefined);
  },

  async setMode(m: OverlayMode): Promise<void> {
    await invokePlugin("overlay_set_mode", { mode: m }).catch(() => undefined);
  },

  async onEvent(cb: (e: OverlayEvent) => void): Promise<() => void> {
    install();
    handlers.add(cb);
    // 订阅瞬间补一次拉取：应用刚回到前台时，之前排队的手势不至于全丢（TTL 6s 内）
    void invokePlugin<{ events?: unknown }>("overlay_poll_event", { since: lastAck })
      .then((r) => acceptBatch(r?.events))
      .catch(() => undefined);
    return () => {
      handlers.delete(cb);
      if (handlers.size === 0) uninstall();
    };
  },
};

export default adapter;
