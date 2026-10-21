/**
 * 全局悬浮球统一面（需求 5）：前端只认这一层，平台差异在 overlayAndroid.ts / overlayDesktop.ts。
 *
 * 契约（两平台适配器必须同名实现，签名一致）：
 *   overlaySupported() -> 该平台是否支持系统级悬浮层
 *   overlayShow()      -> 显示球（用户在 app 本体 OH 对话界面点「打开悬浮球」时调）
 *   overlayHide()      -> 本次关闭（需求 5：单击球后在雾状表面可选「本次关闭悬浮球」）
 *   overlaySetMode(m)  -> hidden | ball | bar | panel（球 / 语音输入条 / 半屏对话面板）
 *   onOverlayEvent(cb) -> 原生手势与生命周期回传：tap | hold | release | drag | closed
 *
 * 红线：本文件与 GlobalOrb.tsx 里的任何路径都不得调用「把主窗口拉到前台」的 API。
 */
import { isAndroidNavigator } from "./androidHost.js";

export type OverlayMode = "hidden" | "ball" | "bar" | "panel";

export interface OverlayEvent {
  type: "tap" | "hold" | "release" | "drag" | "closed" | "submit";
  /** drag 时的屏幕坐标（物理像素，右/下为正）；原生侧给多少填多少 */
  x?: number;
  y?: number;
  /** submit：原生面板里键入的文本（安卓系统悬浮层走原生 UI 时用） */
  text?: string;
}

export interface OverlayAdapter {
  supported(): Promise<boolean>;
  show(): Promise<void>;
  hide(): Promise<void>;
  setMode(m: OverlayMode): Promise<void>;
  onEvent(cb: (e: OverlayEvent) => void): Promise<() => void>;
  /** 可选：把前端状态推给原生壳渲染（安卓系统悬浮层用原生 UI 时必需）。
   *  桌面端不实现 → 天然降级；调用方不要依赖它的返回值。 */
  pushUi?(state: unknown): Promise<void>;
}

const isAndroid =
  isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined) ||
  /Android/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");

let adapterPromise: Promise<OverlayAdapter | null> | null = null;

/** 懒加载平台适配器；不支持时返回 null（调用方诚实降级） */
async function getAdapter(): Promise<OverlayAdapter | null> {
  if (!adapterPromise) {
    adapterPromise = (async () => {
      try {
        const mod = isAndroid
          ? await import("./overlayAndroid.js")
          : await import("./overlayDesktop.js");
        return (mod.default ?? mod) as unknown as OverlayAdapter;
      } catch {
        return null;
      }
    })();
  }
  return adapterPromise;
}

export async function overlaySupported(): Promise<boolean> {
  const a = await getAdapter();
  if (!a) return false;
  try {
    return await a.supported();
  } catch {
    return false;
  }
}

export async function overlayShow(): Promise<void> {
  const a = await getAdapter();
  if (a) await a.show();
}

export async function overlayHide(): Promise<void> {
  const a = await getAdapter();
  if (a) await a.hide();
}

export async function overlaySetMode(m: OverlayMode): Promise<void> {
  const a = await getAdapter();
  if (a) await a.setMode(m);
}

export async function onOverlayEvent(cb: (e: OverlayEvent) => void): Promise<() => void> {
  const a = await getAdapter();
  if (!a) return () => undefined;
  return await a.onEvent(cb);
}

/** 把前端状态（消息/转写/电平/形态/主题）推给原生壳；无该方法时静默降级。 */
export async function overlayPushUi(state: unknown): Promise<void> {
  const a = (await getAdapter()) as unknown as { pushUi?: (x: unknown) => Promise<void> } | null;
  try {
    await a?.pushUi?.(state);
  } catch {
    /* 原生壳不在/版本旧：忽略 */
  }
}

/** 启动/进入设置时按偏好真正把球显示出来（原生端不会自己 show，默认开关曾因此名不副实）。
 *  - 用户「本次关闭」→ 不自动显示；
 *  - 安卓未授权时不弹窗打扰，交给设置页里的开关/授权流程。 */
export async function syncOverlayPreference(): Promise<boolean> {
  try {
    if (!(await overlaySupported())) return false;
    if (isOverlayClosedByUser()) return false;
    if (isAndroid) {
      const { hasOverlayPermission } = await import("./overlayAndroid.js");
      const ok = await hasOverlayPermission().catch(() => false);
      if (!ok) return false;
    }
    await overlayShow();
    return true;
  } catch {
    return false;
  }
}

/** 悬浮球是否处于「本次已关闭」状态（用户在本体里重新打开前一直保持） */
const CLOSED_KEY = "onethu.overlay.closed";
export function isOverlayClosedByUser(): boolean {
  try {
    return localStorage.getItem(CLOSED_KEY) === "1";
  } catch {
    return false;
  }
}
export function setOverlayClosedByUser(v: boolean): void {
  try {
    if (v) localStorage.setItem(CLOSED_KEY, "1");
    else localStorage.removeItem(CLOSED_KEY);
  } catch {
    /* 隐私模式：忽略 */
  }
}
