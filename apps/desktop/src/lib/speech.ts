/**
 * 原生语音识别客户端（灵动岛长按）。
 * macOS：SFSpeechRecognizer 桥（speech.m，需 .app bundle + 麦克风/语音识别描述串）。
 * 其他平台/纯浏览器：speechAvailable() = false，长按给出提示而非静默失败。
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
