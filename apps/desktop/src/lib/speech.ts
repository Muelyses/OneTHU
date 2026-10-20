import { t as i18n } from "../i18n/index.js";
/**
 * 原生语音识别客户端（灵动岛长按）。
 * macOS：SFSpeechRecognizer 桥（speech.m，需 .app bundle + 麦克风/语音识别描述串）。
 * 其他平台/纯浏览器：speechAvailable() = false，长按给出提示而非静默失败。
 * 电平 speechLevel()：安卓 SpeechRecognizer.onRmsChanged → 0..1，驱动灵动岛波纹点；
 * 取不到（桌面/主 crate 无该命令/识别器不给 rms）恒 0，前端退化为时间正弦。
 */
let cachedSupported: boolean | null = null;

/**
 * 命令名路由：Android 走 onethu-speech 插件（Kotlin SpeechRecognizer），
 * 其余平台走 app 主 crate 命令（macOS speech.m / SFSpeechRecognizer 桥）。
 * R21：判定走多信号（UA + userAgentData + platform）——主窗口 UA 被 tauri.conf
 * 伪装成 Windows Chrome/79（webvpn 票绑定），裸 UA 判定在真机恒 false，
 * 会让 Android 永远去调不存在的 app-crate 命令（语音整条静默失效）。
 */
import { isAndroidNavigator } from "./androidHost.js";
const isAndroid = isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined);
const cmd = (name: string): string => (isAndroid ? `plugin:onethu-speech|${name}` : name);

export async function speechAvailable(): Promise<boolean> {
  if (cachedSupported !== null) return cachedSupported;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    cachedSupported = await invoke<boolean>(cmd("speech_supported"));
  } catch {
    cachedSupported = false;
  }
  return cachedSupported;
}

/** 开始一次识别（Android 弹麦克风权限；macOS 首次弹系统授权窗；失败抛带原因的 Error） */
export async function speechStart(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(cmd("speech_start"));
}

/** 当前转写（部分结果，识别中持续更新） */
export async function speechPoll(): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>(cmd("speech_poll"));
  } catch {
    return "";
  }
}

/** 停止（此后 poll 仍能拿到一次最终文本，直到下次 start） */
export function speechStop(): void {
  void import("@tauri-apps/api/core")
    .then((m) => m.invoke(cmd("speech_stop")))
    .catch(() => {
      /* 已尽力 */
    });
}

/** 长按语音不可用时的降级说明（桌面端 / 未提供系统识别服务的安卓机），直接上屏给用户看 */
export function speechUnavailableHint(): string {
  return isAndroid
    ? i18n("lib.speech.4eb4956de694")
    : i18n("lib.speech.1737f29c47c1");
}

/** 电平链路失败一次即永久降级（如 macOS 走主 crate，没有 speech_level 命令）：
 *  免得每个轮询周期都打一次必败的 invoke；降级后恒 0，波纹点退化为时间正弦。 */
let levelUnsupported = false;

/**
 * 当前输入电平 0..1（SpeechRecognizer.onRmsChanged，Kotlin 侧已归一化）。
 * 恒返回有限数：取不到就返回 0（调用方据此退化为时间正弦，不会 NaN / 不会空转）。
 */
export async function speechLevel(): Promise<number> {
  if (levelUnsupported) return 0;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const v = await invoke<number>(cmd("speech_level"));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  } catch {
    levelUnsupported = true;
    return 0;
  }
}
