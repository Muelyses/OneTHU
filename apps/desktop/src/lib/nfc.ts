/**
 * 碰一碰 NFC 桥（Android）：能力探测 / 读取一张标签或对方 HCE 的 NDEF 文本。
 * 桌面端命令恒返回不可用；发送端 HCE 服务下一批接入。
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
