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
 *   ① 拖动：按住球移动超过 DRAG_PX 就交给原生 `overlay_drag_start()`（拖到任意位置），
 *      原生不可用时退回 `overlay_nudge()` 逐帧移动（只认 `[data-oh-ball]` 内的按压）。
 *   ② `closed` / `drag` / `geometry`：Rust 侧发（窗口生命周期、位置与落位几何是原生才知道的事）。
 *   桌面**不再有长按语音**（用户 2026-10-11 口径）：这里不合成 hold/release，也不碰语音插件；
 *   桌面要说话走面板输入框 + 系统听写。
 *
 * ## 红线
 * 本文件任何路径都不 show/unminimize/聚焦主窗口；`overlay_focus` 只在**用户点面板输入框**
 * （focusin 命中 input/textarea/contenteditable）时才调，且失焦立刻退回不可聚焦。
 * 拖动/切形态/显示隐藏全程不碰焦点。
 */
import type { OverlayAdapter, OverlayEvent, OverlayMode } from "./overlay.js";
import { isAndroidNavigator } from "./androidHost.js";

/** 原生事件名（Rust `overlay_win::OVERLAY_EVENT`） */
const EVENT_NAME = "onethu-overlay://event";
/** 按住后位移超过该值（逻辑 px，|dx|+|dy| 曼哈顿）= 拖动，不再算「点一下」。
 *  2026-10-11 实测问题：6px 在手握鼠标时极易被微抖触发 → 一开拖就清掉长按定时器，
 *  长按 450ms 永远进不了语音。12px 与 GlobalOrb 的 DRAG_PX 严格一致（两处必须同值）。 */
const DRAG_PX = 12;

/** 本次按压是否已升级为拖动（桌面唯一的手势状态；长按语音已按用户要求下线） */
const drag = { active: false };

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
 * 手势补洞（只在悬浮球窗口里装，且**只认从球体内按下**的按压）：
 *   按住球 → 位移 > DRAG_PX → 原生拖窗（不可用则退 JS 逐帧 `overlay_nudge`）。
 * 长按语音已按用户口径（2026-10-11「把电脑悬浮球长按语音关了」）整体下线：
 * 这里不再合成长按/release，也不再碰语音插件——桌面要说话就用面板输入框 + 系统听写。
 * `[data-oh-ball]` 闸门同时保证：拖把手/划消息/点输入框都不会误触发拖窗。
 */
function installGestureBridge(_cb: (e: OverlayEvent) => void): () => void {
  if (!isOverlayWindow() || !inTauri()) return () => undefined;

  let pointerId = -1;
  let pressed = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let jsDrag = false;

  const isBallPress = (target: EventTarget | null): boolean => {
    const el = target as Element | null;
    return typeof el?.closest === "function" && el.closest("[data-oh-ball]") !== null;
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

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pressed = isBallPress(e.target);
    moved = false;
    jsDrag = false;
    drag.active = false;
    if (!pressed) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    lastX = e.clientX;
    lastY = e.clientY;
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

  const onUp = (): void => {
    pressed = false;
    moved = false;
    jsDrag = false;
    drag.active = false;
  };

  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerup", onUp, true);
  document.addEventListener("pointercancel", onUp, true);
  window.addEventListener("blur", onUp);

  return () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerup", onUp, true);
    document.removeEventListener("pointercancel", onUp, true);
    window.removeEventListener("blur", onUp);
  };
}

/**
 * 输入框焦点桥（只在悬浮球窗口里装）：用户点面板输入框 → `overlay_focus(true)`（唯一允许
 * 激活本体的路径）；失焦 → `overlay_focus(false)`（窗口退回「永不成 key」状态）。
 * 命令没注册（Lead 选择不启用键盘输入）时静默降级，其余功能不受影响。
 */
function installFocusBridge(): () => void {
  if (!isOverlayWindow() || !inTauri()) return () => undefined;

  const isTextField = (el: EventTarget | null): boolean => {
    const t = el as HTMLElement | null;
    const tag = t?.tagName?.toLowerCase() ?? "";
    return tag === "input" || tag === "textarea" || t?.isContentEditable === true;
  };
  /** 只有**用户真的点了输入框**才允许 activate 本体（原用 focusin，太宽：
   *  窗口被别的原因激活时浏览器可能自动把焦点给首个可聚焦元素 → 又 activate 一次，红线反复踩）。 */
  const onPointerDown = (e: Event): void => {
    if (isTextField(e.target)) void invoke("overlay_focus", { on: true }).catch(() => undefined);
  };
  const onFocusOut = (): void => {
    void invoke("overlay_focus", { on: false }).catch(() => undefined);
  };

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("focusout", onFocusOut, true);
  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
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
    if (!(await adapter.supported())) return;
    try {
      await invoke("overlay_hide");
    } catch (e) {
      await log(`overlay_hide 失败：${errText(e)}`);
    }
  },

  async setMode(m: OverlayMode): Promise<void> {
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
