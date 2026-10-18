/**
 * 碰一碰 NFC 桥（Android）：能力探测 / 读取一张标签或对方 HCE 的 NDEF 文本。
 * 桌面端命令恒返回不可用；Android 发送端使用 HCE 模拟 NDEF 标签。
 */
import { invoke } from "@tauri-apps/api/core";

export interface NfcStatus {
  available: boolean;
  enabled: boolean;
  reason?: string;
}

export async function nfcStatus(): Promise<NfcStatus> {
  try {
    const r = await invoke<{ available?: boolean; enabled?: boolean; reason?: string }>("nfc_available");
    return { available: r?.available === true, enabled: r?.enabled === true, reason: r?.reason };
  } catch (e) {
    return { available: false, enabled: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** 读取一次 NFC 文本（10s 超时由 Android 侧控制）。 */
export async function nfcReadText(): Promise<string> {
  return invoke<string>("nfc_read_tag");
}

/** 把一段文本放进 HCE 发送端；对方手机用 NFC 接收端贴近读取。 */
export async function nfcShareText(text: string): Promise<void> {
  // HCE 的 NDEF 文件上限约 32 KiB，禁止大头像/内联箱子被原生端截断成坏口令。
  if (new TextEncoder().encode(text).length > 30_000) throw new Error("内容太大，无法通过 NFC 完整传送；请复制口令分享，或缩小名片头像后重试");
  await invoke("nfc_share_text", { text });
}
