/**
 * 语音合成偏好（需求 4）：设置页里「她合成的话要不要自动念出来、用什么嗓音念」。
 *
 * 五项一起存本机（localStorage 单键 JSON）：
 *  - autoSpeak  是否自动朗读 OH 的回复。**默认 false（静音）**：用户原话是「可以选择静音
 *               或者自动播放」，默认出声会打扰（教室、图书馆、深夜尤其），必须由用户主动打开。
 *               所有自动朗读路径（ChatDock）都要先看这个值；lib/tts.ts 的 speakReply() 也
 *               自己再兜一层（怕调用方漏判），要强制出声（试听按钮）得显式传 force。
 *  - voiceName  系统引擎音色名（Android TextToSpeech 的 Voice.name；空串 = 引擎默认音色）
 *  - pitch      音高 0.5~2.0（1.0 原声）
 *  - rate       语速 0.5~2.0（1.0 原速）
 *  - backend    引擎后端：system（Android 自带 TTS 引擎，本期唯一实现）/ neural（神经档，预留位）
 *
 * 为什么单独成模块（而不是散在设置页里）：写入方是设置页（VoiceSettingsSection），读取方是
 * 常驻的聊天坞（ChatDock 收到 OH 回复时决定念不念）与试听按钮——两边必须是同一份键，否则又会
 * 变成「设置了没人用」。只碰 localStorage、零依赖，useSyncExternalStore 让多处同时生效。
 */
import { useSyncExternalStore } from "react";

export const VOICE_PREFS_KEY = "onethu.voice.prefs.v1";

/** 引擎后端：system = 系统自带引擎（本期唯一实现）；neural = 神经档（预留，未实现） */
export type TtsBackend = "system" | "neural";

export interface VoicePrefs {
  /** 自动朗读 OH 的回复（默认 false = 静音） */
  autoSpeak: boolean;
  /** 音色名；空串 = 引擎默认音色 */
  voiceName: string;
  /** 音高倍率 0.5~2.0 */
  pitch: number;
  /** 语速倍率 0.5~2.0 */
  rate: number;
  backend: TtsBackend;
}

export const PITCH_MIN = 0.5;
export const PITCH_MAX = 2;
export const RATE_MIN = 0.5;
export const RATE_MAX = 2;

/** 默认全静音、原声原速、系统引擎——用户没进过设置页时就是这个状态 */
export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  autoSpeak: false,
  voiceName: "",
  pitch: 1,
  rate: 1,
  backend: "system",
};

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  const c = Math.min(max, Math.max(min, n));
  return Math.round(c * 100) / 100; // 两位小数即可，滑杆不会给出更细的值
}

/** 音高收进 0.5~2.0（引擎侧还会再收一次，这里先保证存进去的就是合法值） */
export function clampPitch(v: number): number {
  return clampNumber(v, PITCH_MIN, PITCH_MAX, DEFAULT_VOICE_PREFS.pitch);
}

/** 语速收进 0.5~2.0 */
export function clampRate(v: number): number {
  return clampNumber(v, RATE_MIN, RATE_MAX, DEFAULT_VOICE_PREFS.rate);
}

/** 把任意读到的值整成合法偏好（坏字段各自回默认，不整份丢弃） */
function normalize(raw: unknown): VoicePrefs {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<VoicePrefs>;
  return {
    autoSpeak: o.autoSpeak === true,
    voiceName: typeof o.voiceName === "string" ? o.voiceName : DEFAULT_VOICE_PREFS.voiceName,
    pitch: clampPitch(typeof o.pitch === "number" ? o.pitch : DEFAULT_VOICE_PREFS.pitch),
    rate: clampRate(typeof o.rate === "number" ? o.rate : DEFAULT_VOICE_PREFS.rate),
    backend: o.backend === "neural" ? "neural" : "system",
  };
}

/** getSnapshot 必须返回稳定引用：只在真正变更时重建 */
let snapshot: VoicePrefs | null = null;
const listeners = new Set<() => void>();

/** 读当前偏好（React 外也用它；返回稳定引用，勿就地改） */
export function readVoicePrefs(): VoicePrefs {
  if (snapshot) return snapshot;
  let raw: unknown = null;
  try {
    const s = globalThis.localStorage?.getItem(VOICE_PREFS_KEY);
    raw = s ? JSON.parse(s) : null;
  } catch {
    raw = null; // 存坏了 / 隐私模式：当没设置过（= 静音），不影响功能可用
  }
  snapshot = normalize(raw);
  return snapshot;
}

/** 打补丁式写入（只给要改的字段），返回写入后的完整偏好 */
export function setVoicePrefs(patch: Partial<VoicePrefs>): VoicePrefs {
  const next = normalize({ ...readVoicePrefs(), ...patch });
  snapshot = next;
  try {
    globalThis.localStorage?.setItem(VOICE_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* 存不下也要让界面本次会话内生效（与 state/settingsMode.ts 同取舍） */
  }
  for (const l of listeners) l();
  return next;
}

/** 恢复默认（= 静音 + 原声原速 + 系统引擎 + 引擎默认音色） */
export function resetVoicePrefs(): VoicePrefs {
  return setVoicePrefs(DEFAULT_VOICE_PREFS);
}

export function subscribeVoicePrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React 侧读取：设置页、聊天坞共用同一份快照 */
export function useVoicePrefs(): VoicePrefs {
  return useSyncExternalStore(subscribeVoicePrefs, readVoicePrefs, () => DEFAULT_VOICE_PREFS);
}
