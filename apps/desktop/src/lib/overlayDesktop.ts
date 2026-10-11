/**
 * 桌面全局悬浮球适配器（需求 5，桌面侧；macOS 优先，Windows/Linux 兼容）
 * —— ball-overlay-desktop 写域，实现 `lib/overlay.ts` 的 OverlayAdapter（五方法同名）。
 *
 * 后端 = 主 crate 的新模块 `src-tauri/src/overlay_win.rs`（同属本写域）：
 *   窗口 label `oh-orb`，装载 `index.html?window=overlay`（App.tsx 在该 query 下只渲染 GlobalOrb）。
 *   命令（以 Rust 为准，名字一一对应）：
 *     overlay_supported() -> bool
 *     overlay_show() / overlay_hide()
 *     overlay_set_mode({ mode: "hidden"|"ball"|"bar"|"panel" })
 *     overlay_move({ x, y })      物理像素绝对坐标（与 OverlayEvent.x/y 同坐标系）
 *     overlay_nudge({ dx, dy })   逻辑 px 增量（JS 逐帧拖动兜底）
 *     overlay_drag_start()        原生拖窗（macOS performWindowDragWithEvent）
 *     overlay_focus({ on })       唯一允许抢焦点的入口：用户点面板输入框
 *   事件 `onethu-overlay://event`，payload 形状（Rust `serde_json::json!` 实发）：
 *     { "type": "drag", "x": <number>, "y": <number> }   球窗被移动（物理像素，50ms 节流）
 *     { "type": "geometry", "mode", "x", "y", "w", "h" } 每次形态落位后一次；x/y = 球心相对本窗
 *                                                       左上角的逻辑 px（GlobalOrb 拿它当动画 origin）
 *     { "type": "closed" }                              「本次关闭」（窗口已隐藏）
 *   注：`geometry` 不在 lib/overlay.ts 的 OverlayEvent 联合里（Lead 若要收编，加一个字符串即可）；
 *   本适配器按「type + x/y」透传，未知 type 也照发，GlobalOrb 侧用 `(e.type as string)` 判。
 *
 * ## 桌面与安卓的分工差异（重要，写给后来人）
 * 桌面悬浮窗本身就是**真 webview**，GlobalOrb 的 tap/hold 手势由它自己的 DOM
 * onPointerDown/onPointerUp 处理（无需原生手势识别）；原生侧只补三件 DOM 做不到的事：
 *   ① `release`：GlobalOrb 的 bar 态容器 `pointer-events:none`、球又已卸载，松手事件没有
 *      任何元素接着 → 由本文件在悬浮窗内用 document 级 pointerup 合成 `release` 回传。
 *   ② 拖动：按住移动超过 DRAG_PX 就交给原生 `overlay_drag_start()`（拖到任意位置），
 *      原生不可用时退回 `overlay_nudge()` 逐帧移动。
 *   ③ `closed` / `drag`：Rust 侧发（窗口生命周期与位置是原生才知道的事）。
 *
 * ## 红线
 * 本文件任何路径都不 show/unminimize/聚焦主窗口；`overlay_focus` 只在**用户点面板输入框**
 * （focusin 命中 input/textarea/contenteditable）时才调，且失焦立刻退回不可聚焦。
 * 拖动/切形态/显示隐藏全程不碰焦点。
 */
import type { OverlayAdapter, OverlayEvent, OverlayMode } from "./overlay.js";
import { isAndroidNavigator } from "./androidHost.js";
import { speechStop } from "./speech.js";

/** 原生事件名（Rust `overlay_win::OVERLAY_EVENT`） */
const EVENT_NAME = "onethu-overlay://event";
/** 长按阈值：与 GlobalOrb 的 HOLD_MS 对齐（这里只用来判断「松手要不要补 release」） */
const HOLD_MS = 450;
/** 按住后位移超过该值（逻辑 px）= 拖动，不再算「长按说话」 */
const DRAG_PX = 6;

/** 拖动会话（tag 全局，供 setMode 与手势桥共享一次按压的状态） */
interface DragSession {
  /** 本次按压已升级为拖动 */
  active: boolean;
  /**
   * 拖动期间收到了 bar 形态请求 ⇒ GlobalOrb 的 450ms 长按定时器在拖动途中误开语音条。
   * 桌面侧无权改 GlobalOrb（写域在 Lead），这里只做收尾自愈（见 recoverHoldMisfire）。
   */
  holdMisfire: boolean;
}

const drag: DragSession = { active: false, holdMisfire: false };

/** 支持性探测缓存（平台不会变，只探一次） */
let supportCache: boolean | null = null;

const isAndroid =
  isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined) ||
  /Android/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");

function inTauri(): boolean {
  const g = globalThis as unknown as Record<string, unknown>;
  return Boolean(g["__TAURI_INTERNALS__"] || g["__TAURI__"]);
}

/** 是否悬浮球窗口（`index.html?window=overlay`）——手势补洞/焦点桥只在这里生效，主窗口绝不介入 */
function isOverlayWindow(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("window") === "overlay";
  } catch {
    return false;
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return args === undefined ? await core.invoke<T>(cmd) : await core.invoke<T>(cmd, args);
}

/** 落 Rust 调试日志（/tmp/onethu-debug.log + Android logcat）——这是真机排查的唯一现场 */
async function log(line: string): Promise<void> {
  try {
    const { logLine } = await import("./clients.js");
    await logLine(`[overlay] ${line}`);
  } catch {
    /* 日志失败不影响功能 */
  }
}

async function probeSupported(): Promise<boolean> {
  if (!inTauri()) return false; // 纯浏览器（vite dev / 单测）→ 诚实降级
  if (isAndroid) return false; // 安卓走 overlayAndroid.ts；这里只是防御性兜底
  try {
    return await invoke<boolean>("overlay_supported");
  } catch {
    return false; // 主 crate 未注册该命令（旧构建）→ 降级，不抛给调用方
  }
}

/**
 * 手势补洞（只在悬浮球窗口里装）：
 *   - 按住移动 > DRAG_PX → 原生拖窗（失败退 JS 逐帧）
 *   - 长按（≥HOLD_MS）后松手 → 合成 `release`（GlobalOrb 的 bar 态接不到 pointerup）
 *   - 拖动途中被 450ms 定时器误开语音条 → 收尾自愈
 */
function installGestureBridge(cb: (e: OverlayEvent) => void): () => void {
  if (!isOverlayWindow() || !inTauri()) return () => undefined;

  let pointerId = -1;
  let pressed = false;
  let moved = false;
  let holdFired = false;
  let holdTimer = 0;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let jsDrag = false;

  const clearHold = (): void => {
    if (holdTimer) {
      window.clearTimeout(holdTimer);
      holdTimer = 0;
    }
  };

  const beginDrag = (): void => {
    drag.active = true;
    void (async () => {
      try {
        await invoke("overlay_drag_start");
      } catch {
        // 原生拖窗不可用（非 macOS / 旧内核）→ JS 逐帧兜底：指针捕获 + overlay_nudge
        jsDrag = true;
        try {
          document.documentElement.setPointerCapture(pointerId);
        } catch {
          /* 旧 WebView 无指针捕获：拖快了会跟丢，已尽力 */
        }
        void log("原生 start_dragging 不可用，退回 JS 逐帧拖动");
      }
    })();
  };

  /**
   * 拖动途中被长按定时器误开语音（GlobalOrb 的 450ms 定时器不会因拖动取消）的收尾：
   * 停识别 → 窗口变回球 → 刷回干净的球态。不做这步会卡在「全宽语音条 + 麦克风长开」。
   * 修根要 Lead 在 GlobalOrb 里加「pointermove 超阈值即清掉 holdTimer」，见交付报告。
   */
  const recoverHoldMisfire = (): void => {
    try {
      speechStop();
    } catch {
      /* 无原生语音桥时忽略 */
    }
    void (async () => {
      void log("拖动期间被 450ms 长按定时器误开语音条 → 已停识别并刷回球态");
      try {
        await invoke("overlay_set_mode", { mode: "ball" });
      } catch {
        /* 忽略 */
      }
      try {
        window.location.reload();
      } catch {
        /* 忽略 */
      }
    })();
  };

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pressed = true;
    moved = false;
    holdFired = false;
    jsDrag = false;
    drag.active = false;
    drag.holdMisfire = false;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    lastX = e.clientX;
    lastY = e.clientY;
    clearHold();
    holdTimer = window.setTimeout(() => {
      holdTimer = 0;
      holdFired = true;
    }, HOLD_MS);
  };

  const onMove = (e: PointerEvent): void => {
    if (!pressed) return;
    if (!moved && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > DRAG_PX) {
      moved = true;
      beginDrag();
      return;
    }
    if (moved && jsDrag) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (dx !== 0 || dy !== 0) void invoke("overlay_nudge", { dx, dy }).catch(() => undefined);
    }
  };

  const finish = (): void => {
    if (!pressed) return;
    pressed = false;
    clearHold();
    if (holdFired && !moved) {
      // 长按松手：GlobalOrb 只认原生 release（DOM 那条路没有可接事件的元素）
      cb({ type: "release" });
    }
    if (moved && drag.holdMisfire) recoverHoldMisfire();
    moved = false;
    holdFired = false;
    jsDrag = false;
    drag.active = false;
    drag.holdMisfire = false;
  };

  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerup", finish, true);
  document.addEventListener("pointercancel", finish, true);
  // 按住期间窗口被切走/隐藏（切 Space、系统弹窗）→ 视为松手，避免麦克风悬着
  window.addEventListener("blur", finish);

  return () => {
    clearHold();
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerup", finish, true);
    document.removeEventListener("pointercancel", finish, true);
    window.removeEventListener("blur", finish);
  };
}

/**
 * 输入框焦点桥（只在悬浮球窗口里装）：用户点面板输入框 → `overlay_focus(true)`（唯一允许
 * 激活本体的路径）；失焦 → `overlay_focus(false)`（窗口退回「永不成 key」状态）。
 * 命令没注册（Lead 选择不启用键盘输入）时静默降级，其余功能不受影响。
 */
function installFocusBridge(): () => void {
  if (!isOverlayWindow() || !inTauri()) return () => undefined;

  const onFocusIn = (e: Event): void => {
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName?.toLowerCase() ?? "";
    if (tag === "input" || tag === "textarea" || t?.isContentEditable === true) {
      void invoke("overlay_focus", { on: true }).catch(() => undefined);
    }
  };
  const onFocusOut = (): void => {
    void invoke("overlay_focus", { on: false }).catch(() => undefined);
  };

  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  return () => {
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
  };
}

const adapter: OverlayAdapter = {
  /** 桌面（macOS/Windows/Linux 的 Tauri 环境）= true；纯浏览器 / 安卓 / 旧构建 = false */
  async supported(): Promise<boolean> {
    if (supportCache === null) supportCache = await probeSupported();
    return supportCache;
  },

  async show(): Promise<void> {
    if (!(await adapter.supported())) return;
    try {
      await invoke("overlay_show");
    } catch (e) {
      await log(`overlay_show 失败：${errText(e)}`);
    }
  },

  async hide(): Promise<void> {
    drag.active = false;
    drag.holdMisfire = false;
    if (!(await adapter.supported())) return;
    try {
      await invoke("overlay_hide");
    } catch (e) {
      await log(`overlay_hide 失败：${errText(e)}`);
    }
  },

  async setMode(m: OverlayMode): Promise<void> {
    // 拖动途中被要求变「语音条/面板」= GlobalOrb 的长按定时器误触（见 DragSession 注释）
    if (drag.active && (m === "bar" || m === "panel")) drag.holdMisfire = true;
    if (!(await adapter.supported())) return;
    try {
      await invoke("overlay_set_mode", { mode: m });
    } catch (e) {
      await log(`overlay_set_mode(${m}) 失败：${errText(e)}`);
    }
  },

  async onEvent(cb: (e: OverlayEvent) => void): Promise<() => void> {
    const offs: Array<() => void> = [];
    if (inTauri()) {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        offs.push(
          await listen<unknown>(EVENT_NAME, (ev) => {
            const p = ev.payload as { type?: unknown; x?: unknown; y?: unknown } | null;
            if (!p || typeof p.type !== "string") return;
            cb({
              type: p.type as OverlayEvent["type"],
              x: typeof p.x === "number" ? p.x : undefined,
              y: typeof p.y === "number" ? p.y : undefined,
            });
          }),
        );
      } catch (e) {
        await log(`事件订阅失败：${errText(e)}`);
      }
    }
    offs.push(installGestureBridge(cb));
    offs.push(installFocusBridge());
    return () => {
      for (const off of offs) {
        try {
          off();
        } catch {
          /* 忽略 */
        }
      }
    };
  },
};

export default adapter;
