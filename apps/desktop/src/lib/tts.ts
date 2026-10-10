/**
 * 原生语音合成（TTS）客户端 —— 需求 4「她合成的话要不要念出来」的前端唯一入口。
 *
 * 链路：本文件 → Tauri 命令 `plugin:onethu-tts|*` → 插件 Rust 壳（`src-tauri/plugins/onethu-tts`）
 * → Android `TextToSpeech`（各 ROM 自带引擎：华为/荣耀小艺、小爱、Google TTS…，零下载零体积）。
 * 播放结束/出错由原生反过来推事件 `onethu-tts://done { reason }`，用 onTtsDone() 订阅。
 *
 * 三条设计口径：
 *  1) **命令名不做平台分支**：插件在所有平台都注册，桌面端由 Rust 壳诚实回
 *     `tts_supported=false` / `tts_state="unsupported"`（见 PLAN §3.2）——比前端按 UA 猜平台可靠
 *     （本仓库主窗口 UA 被 tauri.conf 伪装成 Windows，见 lib/androidHost.ts 的长注释）。
 *  2) **失败不清空界面**：ttsSpeak 出错会 reject（调用方能解释原因）；speakReply 吞错只回 false
 *     （聊天坞里自动朗读失败不该弹错），最近一次失败原因留给 lastTtsError() 给设置页显示。
 *  3) **不喊口号**：所有能力都先问原生「到底行不行」，不支持就给 false，不假装支持。
 *
 * 偏好（音色/音高/语速/要不要自动念）在 state/voicePrefs.ts；本文件只负责「怎么念」。
 */
import { clampPitch, clampRate, readVoicePrefs, type TtsBackend } from "../state/voicePrefs.js";

/** 原生推的合成结束事件（Kotlin `trigger("onethu-tts://done", …)`） */
export const TTS_DONE_EVENT = "onethu-tts://done";

/**
 * 引擎状态：
 *  - unsupported  本平台没有原生 TTS（桌面 / 浏览器）
 *  - none         通道在，但引擎还没初始化（首次调用尚未发生）
 *  - initializing TextToSpeech 正在异步 onInit（此期间 ttsSpeak 会排队，见插件 Kotlin）
 *  - ready        引擎就绪、空闲
 *  - speaking     正在出声
 *  - error        引擎不可用（ROM 没装 TTS 引擎/中文语音数据，或 onInit 失败）
 */
export type TtsState = "unsupported" | "none" | "initializing" | "ready" | "speaking" | "error";

export interface TtsStatus {
  ready: boolean;
  backend: TtsBackend;
  state: TtsState;
  /** 附加字段（契约的加项，前端可选读）：系统引擎包名，设置页用来显示「用的是哪家引擎」 */
  engine?: string;
  /** 附加字段：state=error 时的原因（给用户一句能看懂的话） */
  reason?: string;
  /** 附加字段：非致命提示（如「引擎未声明支持中文」，就绪时也可能有） */
  note?: string;
}

export interface SpeakOptions {
  /** 语速 0.5~2.0；省略 = 用偏好里的值 */
  rate?: number;
  /** 音高 0.5~2.0；省略 = 用偏好里的值 */
  pitch?: number;
  /** 音色名；省略 = 用偏好里的值（空串 = 引擎默认音色） */
  voice?: string;
  /**
   * 绕过「自动朗读」开关强制出声 —— 只有用户当场按了「试听」这类显式动作才传 true。
   * 默认 false：偏好里 autoSpeak=false 时 speakReply() 直接返回 false（静音优先）。
   */
  force?: boolean;
}

/** 单次朗读的最大字数：OH 的长回复全念完要好几分钟，截到句子边界并提示看屏幕 */
export const MAX_SPEAK_CHARS = 800;

const cmd = (name: string): string => `plugin:onethu-tts|${name}`;

const UNSUPPORTED: TtsStatus = { ready: false, backend: "system", state: "unsupported" };

/** 最近一次朗读失败的原因（设置页「试听」失败时显示；成功后清空） */
let lastError: string | null = null;
export function lastTtsError(): string | null {
  return lastError;
}

/** 只缓存「支持」这个结论；不支持时每次都重问（用户可能中途装了 TTS 引擎/语音数据） */
let supportedCache = false;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 当前平台/引擎是否可能出声（Android 且引擎没被判死）。失败一律 false，不抛 */
export async function ttsSupported(fresh = false): Promise<boolean> {
  if (supportedCache && !fresh) return true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const ok = (await invoke<boolean>(cmd("tts_supported"))) === true;
    supportedCache = ok;
    return ok;
  } catch (e) {
    console.warn("[tts] tts_supported 调用失败：", e);
    supportedCache = false;
    return false;
  }
}

/** 读引擎状态（不触发初始化） */
export async function ttsStatus(): Promise<TtsStatus> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<Partial<TtsStatus>>(cmd("tts_status"));
    return {
      ready: raw?.ready === true,
      backend: raw?.backend === "neural" ? "neural" : "system",
      state: (raw?.state as TtsState) ?? "none",
      engine: typeof raw?.engine === "string" ? raw.engine : undefined,
      reason: typeof raw?.reason === "string" ? raw.reason : undefined,
      note: typeof raw?.note === "string" ? raw.note : undefined,
    };
  } catch {
    return UNSUPPORTED; // 桌面端插件命令直接失败 → 就是「本平台没有」
  }
}

/**
 * 触发引擎初始化，并**等到有确定结论**再返回（TextToSpeech 的 onInit 是异步的，
 * 命令一返回就报「没就绪」会把用户吓一跳）。超时就返回最后一次读到的状态。
 */
export async function ttsPrepare(waitMs = 6000): Promise<TtsStatus> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke(cmd("tts_prepare"));
  } catch (e) {
    console.warn("[tts] tts_prepare 调用失败：", e);
    return UNSUPPORTED;
  }
  const t0 = Date.now();
  let st = await ttsStatus();
  while (!st.ready && st.state === "initializing" && Date.now() - t0 < waitMs) {
    await sleep(150);
    st = await ttsStatus();
  }
  return st;
}

/** 真正下发命令的那一层：文本已经清洗过（不要再洗第二遍——截断会被叠加） */
async function invokeSpeak(clean: string, opts: SpeakOptions): Promise<void> {
  const p = readVoicePrefs();
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(cmd("tts_speak"), {
    text: clean,
    speed: clampRate(opts.rate ?? p.rate),
    pitch: clampPitch(opts.pitch ?? p.pitch),
    voice: opts.voice ?? p.voiceName ?? "",
  });
  lastError = null;
}

/** 开始朗读（失败 reject 带原因；"未开始" 也当失败，调用方好解释） */
export async function ttsSpeak(text: string, opts: SpeakOptions = {}): Promise<void> {
  const clean = plainForSpeech(text);
  if (!clean) throw new Error("空文本");
  await invokeSpeak(clean, opts);
}

/** 停止朗读（打断当前这条；停止失败不抛——关面板/关开关时调用，不该反过来弹错） */
export async function ttsStop(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke(cmd("tts_stop"));
  } catch {
    /* 已尽力 */
  }
}

/**
 * 系统引擎的中文音色名列表（仅 system 后端有意义；桌面/无引擎回空数组）。
 * 名字是 ROM 引擎自己报的（如 zh-cn-x-ccc-network），显示层用 prettyVoiceName() 美化。
 */
export async function ttsVoices(): Promise<string[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const list = await invoke<string[]>(cmd("tts_voices"));
    return Array.isArray(list) ? list.filter((v) => typeof v === "string" && v !== "") : [];
  } catch (e) {
    console.warn("[tts] tts_voices 调用失败：", e);
    return [];
  }
}

/** 切换后端；本期只实现 system —— neural 会返回 false（插件侧明确拒绝，不假装成功） */
export async function ttsSetBackend(backend: TtsBackend): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke(cmd("tts_set_backend"), { backend });
    return true;
  } catch (e) {
    console.warn("[tts] tts_set_backend 调用失败：", e);
    return false;
  }
}

/**
 * 订阅「念完了 / 出错了」。返回退订函数。
 * 非 Tauri 环境（浏览器预览）订阅不了——退订函数照给（no-op），不抛：调用方在 useEffect
 * 里 await 它，抛出去就是一个没人接的 rejection。
 */
export async function onTtsDone(cb: (reason: string) => void): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<{ reason?: string }>(TTS_DONE_EVENT, (ev) => {
      cb(typeof ev.payload?.reason === "string" ? ev.payload.reason : "done");
    });
  } catch (e) {
    console.warn("[tts] onTtsDone 订阅失败：", e);
    return () => {
      /* no-op */
    };
  }
}

/**
 * 念一条 OH 的回复 —— **ChatDock 的入口**（PLAN §3.2）。
 *
 * 返回 true = 已开始出声；false = 没出声（静音开关关着 / 空文本 / 引擎不可用 / 出错）。
 * 不抛错：自动朗读失败不该在聊天界面里弹东西，原因可从 lastTtsError() 取。
 */
export async function speakReply(text: string, opts: SpeakOptions = {}): Promise<boolean> {
  const clean = plainForSpeech(text);
  if (!clean) return false; // 空文本（含纯 Markdown 符号）短路，连引擎都不问
  if (!opts.force && !readVoicePrefs().autoSpeak) return false; // 默认静音的兜底闸门
  try {
    await invokeSpeak(clean, opts);
    return true;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    console.warn("[tts] 朗读失败：", e);
    return false;
  }
}

/** 试听/显式朗读用：跳过「自动朗读」开关，其余口径与 speakReply 完全一致 */
export function previewSpeak(text: string, opts: SpeakOptions = {}): Promise<boolean> {
  return speakReply(text, { ...opts, force: true });
}

/**
 * 把 Markdown 回复整成「读起来不难听」的纯文本，并在 MAX_SPEAK_CHARS 处收口。
 * 念代码块、URL、星号强调（读成「星号星号」）都会很难受，这里一次性清掉。
 */
export function plainForSpeech(text: string, max = MAX_SPEAK_CHARS): string {
  let s = typeof text === "string" ? text : "";
  s = s.replace(/```[\s\S]*?```/g, " （代码略） ");
  s = s.replace(/`([^`]*)`/g, "$1");
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/https?:\/\/[^\s，。；）)]+/g, "链接");
  s = s.replace(/^[ \t]{0,3}(#{1,6}|>|[-*+]|\d+[.)])[ \t]+/gm, ""); // 行首标记
  s = s.replace(/^\s*([-*_]\s*){3,}$/gm, ""); // 分隔线
  s = s.replace(/[*_~]{1,3}/g, ""); // 强调/删除线符号
  s = s.replace(/\|/g, " "); // 表格竖线
  s = s.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  if (s.length > max) {
    const head = s.slice(0, max);
    const cut = Math.max(
      head.lastIndexOf("。"), head.lastIndexOf("！"), head.lastIndexOf("？"),
      head.lastIndexOf("\n"), head.lastIndexOf("；"),
    );
    s = (cut > max * 0.5 ? head.slice(0, cut + 1) : head) + "……（内容较长，剩下的看屏幕吧）";
  }
  return s;
}

/** ROM 引擎报的音色名 → 用户看得懂的短标签（如 zh-cn-x-ccc-network → CCC） */
export function prettyVoiceName(name: string): string {
  const n = (name || "").trim();
  if (!n) return "引擎默认音色";
  const m = /(?:^|-)([a-z]{3})(?:-|$)/i.exec(n.split("-x-")[1] ?? "");
  if (n.includes("-x-") && m?.[1]) return m[1].toUpperCase();
  return n;
}
