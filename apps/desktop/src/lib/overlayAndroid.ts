/**
 * 安卓系统级悬浮球适配器（需求 5，ball-overlay-android；task-11 返工版）。
 *
 * 契约：实现 lib/overlay.ts 的 OverlayAdapter 五方法（supported/show/hide/setMode/onEvent），
 * 命令面走 Tauri 插件 `plugin:onethu-overlay|overlay_*`（Kotlin 侧见
 * src-tauri/plugins/onethu-overlay/android/src/main/java/app/onethu/overlay/）。
 *
 * task-11 真机反馈后的口径（用户四条）：
 *   ① 样式由**原生**对齐 OH「雾中の裸文字」（球 54dp 径向雾 + 模糊、面板无气泡裸文字、
 *      底部无框下划线输入行、浅色 #FFFFFF/#1C1F24、深色按 uiMode #151517/#ECECF1）；
 *   ② **本体在前台时悬浮层整体隐藏**（原生按 ActivityLifecycleCallbacks 判定；`overlay_status`
 *      带 `appForeground` 便于区分「按设计隐藏」与「没启动成功」）；
 *   ③ **默认只出球**，未点击时不出现任何面板/雾块；雾画在原生自定义 View 的径向渐变 + 羽化里，
 *      窗口尺寸按内容算、窗口之外完全透明；
 *   ④ **长按语音由原生自己做**（本进程 SpeechRecognizer + microphone 前台服务类型）；取不到麦时
 *      条内给文案并自动展开面板。故原生**不再回传 hold/release**（避免前端再起一个识别器抢麦）。
 *
 * 事件通道（原生 → 前端）两条并行，id 单调去重：
 *   ① 主通道：原生直接对宿主 WebView evaluateJavascript 调 window.__onethuOverlayEvent(json)。
 *      不走定时器，所以应用在后台（WebView 定时器被限流）时仍然低延迟。
 *   ② 兜底：3s 轮询 overlay_poll_event(since)，把没被 ack 的事件捞回来（原生侧 TTL 6s）。
 *   前端处理完一批后 overlay_ack_events(maxId) 清队列。
 *
 * **发送通道**：原生面板/语音条只说一句话 —— `submit{text}`。它由本适配器消费（不扇出给订阅者）：
 * 交给 `askOh()` → 把消息列表经 `overlay_push_ui` 回推原生渲染。这样安卓侧**零前端接线**即可完整对话；
 * 因此前端也不要再挂 submit 处理器（会双发）。
 *
 * 红线：本文件任何路径都不得把主窗口拉到前台（不调 WebviewWindow.show/set_focus、
 * 不跳 Activity）。show() 只在缺授权时拉起系统「显示在其他应用上层」设置页。
 */
import type { OverlayAdapter, OverlayEvent, OverlayMode } from "./overlay.js";
import { askOh } from "../im/oh.js";

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
  /** 语音条上的实时转写（原生自己做识别时一般不用传） */
  transcript?: string;
  /** 0..1 实时电平，驱动点点波纹（原生自己做识别时由原生驱动） */
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
  /** 本体是否在前台：true 时悬浮层按设计隐藏（不是启动失败） */
  appForeground: boolean;
}

declare global {
  interface Window {
    /** 原生（Kotlin OverlayBridge）直推事件用的全局回调；未挂载时事件留在原生队列里 */
    __onethuOverlayEvent?: (ev: unknown) => void;
  }
}

const PLUGIN = "plugin:onethu-overlay";
const POLL_MS = 3000;

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
/** 是否需要兜底轮询：有人订阅、刚显示过、或刚推过状态时置真（省掉长期空转的 IPC） */
let pollWanted = false;

function dispatch(raw: NativeOverlayEvent): void {
  const type = typeof raw.type === "string" ? raw.type : "";
  if (!type) return;
  // submit 是「原生面板/语音条 → OH」的唯一入口：适配器消费掉，不扇出给订阅者
  if (type === "submit") {
    if (typeof raw.text === "string") void askNative(raw.text);
    return;
  }
  if (handlers.size === 0) return;
  const ev = {
    type: type as NativeOverlayEventType,
    x: typeof raw.x === "number" ? raw.x : undefined,
    y: typeof raw.y === "number" ? raw.y : undefined,
  };
  for (const h of Array.from(handlers)) {
    try {
      // submit 未写进 overlay.ts 的联合类型（不需要了：适配器自己消费）；
      // 其余类型仍是 OverlayEvent 的正常成员。
      h(ev as unknown as OverlayEvent);
    } catch {
      /* 单个订阅者出错不影响其他订阅者 */
    }
  }
}

function acceptBatch(list: unknown): void {
  const arr = Array.isArray(list) ? list : [];
  let maxId = lastAck;
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
    pollWanted = true;
    // ack 失败不致命：TTL 内轮询会重复投一次，dispatch 侧已按 id 去重
    void invokePlugin("overlay_ack_events", { id: maxId }).catch(() => undefined);
  }
}

/** 挂好原生直推的接收钩子（模块加载即挂：submit 不能因为「还没人调 onEvent」而丢） */
function install(): void {
  if (installed) return;
  installed = true;
  try {
    window.__onethuOverlayEvent = (ev: unknown) => {
      if (ev && typeof ev === "object") acceptBatch([ev]);
    };
  } catch {
    /* 非浏览器环境 */
  }
  if (pollTimer === null) {
    pollTimer = window.setInterval(() => {
      if (pollBusy || !pollWanted) return;
      pollBusy = true;
      void invokePlugin<{ events?: unknown }>("overlay_poll_event", { since: lastAck })
        .then((r) => acceptBatch(r?.events))
        .catch(() => undefined)
        .finally(() => {
          pollBusy = false;
        });
    }, POLL_MS);
  }
}

/* ───────────── 原生悬浮层自己的对话（零前端接线即可用） ─────────────
 * 原生面板/语音条的唯一发送通道是 submit{text}。适配器在这里直接把它交给 OH，
 * 并把消息列表回推给原生渲染——这样安卓侧不依赖任何前端接线就能完整对话。
 * 因此：**不要**再让 GlobalOrb 也挂 submit 处理器（会双发）。 */
let nativeMsgs: Array<{ role: "user" | "oh"; text: string }> = [];
let nativeBusy = false;

function themeName(): "light" | "dark" {
  try {
    const attr =
      document.documentElement.getAttribute("data-theme") ??
      document.documentElement.getAttribute("data-color-scheme") ??
      document.documentElement.dataset.theme;
    if (attr === "dark" || attr === "light") return attr;
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

async function syncNativeUi(): Promise<void> {
  await pushUi({ messages: nativeMsgs.slice(-40), busy: nativeBusy, theme: themeName() });
}

/** 一句话 → OH → 消息列表回推原生（语音整句与键盘输入共用） */
async function askNative(text: string): Promise<void> {
  const t = text.trim();
  if (!t) return;
  nativeMsgs.push({ role: "user", text: t });
  nativeBusy = true;
  void syncNativeUi();
  try {
    const r = (await askOh(t)) as { answer?: string; error?: string };
    const reply = String(r?.answer ?? r?.error ?? "").trim() || "（没有回复）";
    nativeMsgs.push({ role: "oh", text: reply });
  } catch (e) {
    nativeMsgs.push({ role: "oh", text: `（出错了：${e instanceof Error ? e.message : String(e)}）` });
  }
  nativeBusy = false;
  void syncNativeUi();
}

/* ───────────────────────── 额外能力（供前端/设置页用） ───────────────────────── */

/** 把界面状态推给原生悬浮层（theme/messages/busy） */
export async function pushUi(state: OverlayUiState): Promise<void> {
  install();
  pollWanted = true;
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

/** 诊断：权限 / 是否在显示 / 形态 / 「本次已关闭」标记 / 本体是否在前台 */
export async function overlayStatus(): Promise<AndroidOverlayStatus | null> {
  try {
    const r = await invokePlugin<Partial<AndroidOverlayStatus>>("overlay_status");
    return {
      supported: r?.supported === true,
      hasPermission: r?.hasPermission === true,
      showing: r?.showing === true,
      mode: typeof r?.mode === "string" ? r.mode : "hidden",
      closedByUser: r?.closedByUser === true,
      appForeground: r?.appForeground === true,
    };
  } catch {
    return null;
  }
}

/* ───────────────────────── OverlayAdapter 五方法 ───────────────────────── */

const adapter: OverlayAdapter = {
  /** 平台能力（不含授权状态）：安卓恒 true；桌面端 Rust 侧返回 false */
  async supported(): Promise<boolean> {
    install();
    try {
      const r = await invokePlugin<{ value?: unknown }>("overlay_supported");
      return r?.value === true;
    } catch {
      return false;
    }
  },

  /** 显示悬浮层：**默认只出球**（缺授权则拉起系统授权页，授权后回应用再点一次） */
  async show(): Promise<void> {
    install();
    pollWanted = true;
    const r = await invokePlugin<{ ok?: unknown; reason?: unknown }>("overlay_show").catch(() => null);
    if (r && r.ok === false && r.reason === "no-permission") {
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
    pollWanted = true;
    handlers.add(cb);
    // 订阅瞬间补一次拉取：之前排队的手势不至于全丢（原生侧 TTL 6s 内）
    void invokePlugin<{ events?: unknown }>("overlay_poll_event", { since: lastAck })
      .then((r) => acceptBatch(r?.events))
      .catch(() => undefined);
    return () => {
      handlers.delete(cb);
    };
  },
};

// 模块加载即挂接收通道（不依赖任何人调用 onEvent）：原生直推的 submit 必须随到随处理
install();

export default adapter;
