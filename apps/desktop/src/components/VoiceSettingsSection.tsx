/**
 * 设置页「语音合成」区块（需求 4）——用户要的两件事在这里落地：
 *   ① 静音 / 自动播放二选一：开关「自动朗读 OH 的回复」，**默认关（静音）**；
 *   ② 音色与音效调节：音色下拉（系统引擎的中文嗓音）+ 语速/音高滑杆 + 试听，改完当场能听见。
 *
 * 挂载方式与兄弟区块完全一致（不要自带 Card/SectionHead，否则套两层卡片）：
 *   <SectionHead title="语音" />
 *   <Card><VoiceSettingsSection /></Card>
 *
 * 平台口径：只有 Android 有承载（系统 TextToSpeech）。桌面端**不摆假开关**——照旧显示区块，
 * 但明确写「当前平台不支持」，滑杆与试听一并禁用（与 WidgetSettingsSection 同一套诚实降级）。
 *
 * 滑杆写盘时机：拖动过程只更新本地显示，松手（pointerup/keyup/blur）才落偏好——否则一次拖动
 * 会往 localStorage 写几十次、并让订阅了偏好的聊天坞跟着重渲染。
 */
import { useEffect, useState, type ReactNode } from "react";
import { Switch } from "./Layout.js";
import {
  PITCH_MAX, PITCH_MIN, RATE_MAX, RATE_MIN,
  resetVoicePrefs, setVoicePrefs, useVoicePrefs,
} from "../state/voicePrefs.js";
import {
  lastTtsError, onTtsDone, previewSpeak, prettyVoiceName,
  ttsPrepare, ttsSetBackend, ttsStatus, ttsStop, ttsVoices,
  type TtsStatus,
} from "../lib/tts.js";

/** 试听用的固定句子：能同时听出音色与语速差异，又不长到烦人 */
const PREVIEW_TEXT = "你好，我是 OH。现在用的就是这个音色、这个语速。";

/** 引擎状态 →（标题，说明）人话。null = 还没读到 */
function engineCopy(st: TtsStatus | null, busy: boolean): { title: string; desc: string } {
  if (st === null) {
    return busy
      ? { title: "正在准备朗读引擎…", desc: "系统引擎首次初始化需要一两秒。" }
      : { title: "正在读取引擎状态…", desc: "" };
  }
  switch (st.state) {
    case "unsupported":
      return {
        title: "当前平台不支持语音合成",
        desc: "语音合成走 Android 系统自带的文字转语音引擎（华为/荣耀小艺、小爱、Google TTS 等），桌面端没有这条通道。",
      };
    case "initializing":
      return { title: "引擎正在初始化…", desc: "稍等一下，初始化完成后试听与朗读才会出声。" };
    case "ready":
      return {
        title: "引擎就绪",
        desc: (st.engine ? `本机使用的引擎：${st.engine}` : "本机系统引擎可用。") + (st.note ? `（${st.note}）` : ""),
      };
    case "speaking":
      return { title: "正在朗读", desc: st.engine ? `本机使用的引擎：${st.engine}` : "说完会自动停下。" };
    case "error":
      return {
        title: "引擎不可用",
        desc: `${st.reason ?? "系统没有可用的文字转语音引擎"}。可在系统设置 → 无障碍/语言 → 文字转语音 里安装或启用引擎与中文语音数据，再回来点「重新检查」。`,
      };
    default:
      return { title: "引擎尚未初始化", desc: "点「重新检查」触发一次初始化。" };
  }
}

export function VoiceSettingsSection(): ReactNode {
  const prefs = useVoicePrefs();
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [voices, setVoices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  /** 拖动中只动本地显示，松手才落偏好 */
  const [dragging, setDragging] = useState<"rate" | "pitch" | null>(null);
  const [dragValue, setDragValue] = useState(1);

  const ready = status?.ready === true;
  const usable = status !== null && status.state !== "unsupported" && status.state !== "error";

  /** 检查/初始化引擎，并就绪后拉一次音色表 */
  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      const st = await ttsPrepare();
      setStatus(st);
      setVoices(st.ready ? await ttsVoices() : []);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void (async () => {
      // 后端自愈：神经档本期没有实现，偏好里留着它只会卡在一个用不了的档位上
      if (prefs.backend !== "system") {
        void ttsSetBackend("system");
        setVoicePrefs({ backend: "system" });
      }
      await refresh();
    })();
    // 只在挂载时跑一次：prefs 的改动由下面的控件自己负责同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 原生念完/出错 → 状态从「正在朗读」回到就绪
  useEffect(() => {
    let alive = true;
    let off: (() => void) | null = null;
    void onTtsDone((reason) => {
      setSpeaking(false);
      if (reason.startsWith("error")) {
        setMsg(`朗读出错（${reason}）`);
        void ttsStatus().then(setStatus);
      }
    }).then((f) => {
      if (alive) off = f;
      else f();
    });
    return () => {
      alive = false;
      if (off) off();
    };
  }, []);

  const commitSlider = (): void => {
    if (dragging === "rate") setVoicePrefs({ rate: dragValue });
    else if (dragging === "pitch") setVoicePrefs({ pitch: dragValue });
    setDragging(null);
  };

  const shownRate = dragging === "rate" ? dragValue : prefs.rate;
  const shownPitch = dragging === "pitch" ? dragValue : prefs.pitch;

  const preview = async (): Promise<void> => {
    setMsg(null);
    if (speaking) {
      await ttsStop();
      setSpeaking(false);
      return;
    }
    const ok = await previewSpeak(PREVIEW_TEXT);
    if (ok) setSpeaking(true);
    else setMsg(`试听失败：${lastTtsError() ?? "引擎未就绪"}`);
  };

  const copy = engineCopy(status, busy);

  return (
    <>
      {/* ① 静音 / 自动播放 */}
      <div className="setting-row">
        <div>
          <div className="setting-title">自动朗读 OH 的回复</div>
          <div className="setting-desc">
            打开后，OH 每答完一段就念出来（聊天坞与全局悬浮球里的回复都算）；关闭则完全静音。
            <span style={{ color: "var(--text-3)" }}>　默认关闭，不会自己出声。</span>
          </div>
        </div>
        <Switch
          on={prefs.autoSpeak}
          label="自动朗读 OH 的回复"
          onChange={(v) => {
            setVoicePrefs({ autoSpeak: v });
            if (!v) {
              void ttsStop(); // 关掉就立刻闭嘴，不用等这一句念完
              setSpeaking(false);
            }
          }}
        />
      </div>

      {/* ② 引擎状态 */}
      <div className="setting-row">
        <div>
          <div className="setting-title">{copy.title}</div>
          <div className="setting-desc">
            {copy.desc}
            {ready && voices.length > 0 ? (
              <span style={{ color: "var(--text-3)" }}>　可选音色 {voices.length} 个。</span>
            ) : null}
          </div>
        </div>
        <button className="btn btn-ghost" disabled={busy} onClick={() => void refresh()}>
          {busy ? "检查中…" : "重新检查"}
        </button>
      </div>

      {/* ③ 音色 */}
      <div className="setting-row">
        <div>
          <div className="setting-title">音色</div>
          <div className="setting-desc">
            {voices.length === 0
              ? "系统引擎没有报出可选的普通话嗓音，用引擎默认音色朗读。"
              : "不同 ROM 自带的嗓音不同（如小艺、小爱、Google 的普通话嗓音）。"}
          </div>
        </div>
        <select
          className="input"
          aria-label="音色"
          style={{ maxWidth: 220, flex: "none" }}
          disabled={voices.length === 0 || !usable}
          value={prefs.voiceName}
          onChange={(e) => setVoicePrefs({ voiceName: e.target.value })}
        >
          <option value="">引擎默认音色</option>
          {voices.map((v) => (
            <option key={v} value={v}>
              {prettyVoiceName(v)}
            </option>
          ))}
        </select>
      </div>

      {/* ④ 语速 */}
      <div className="setting-row">
        <div>
          <div className="setting-title">语速</div>
          <div className="setting-desc">0.5×（慢一半）到 2.0×（快一倍），松手即生效。</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-3)", minWidth: 44, textAlign: "right" }}>
            {shownRate.toFixed(2)}×
          </span>
          <input
            type="range"
            aria-label="语速"
            min={RATE_MIN}
            max={RATE_MAX}
            step={0.05}
            disabled={!usable}
            value={shownRate}
            style={{ width: 168, accentColor: "var(--accent)" }}
            onChange={(e) => {
              setDragging("rate");
              setDragValue(Number(e.target.value));
            }}
            onPointerUp={commitSlider}
            onPointerCancel={commitSlider}
            onMouseUp={commitSlider}
            onTouchEnd={commitSlider}
            onKeyUp={commitSlider}
            onBlur={commitSlider}
          />
          <button className="btn btn-ghost" disabled={prefs.rate === 1} onClick={() => setVoicePrefs({ rate: 1 })}>
            复位
          </button>
        </div>
      </div>

      {/* ⑤ 音高 */}
      <div className="setting-row">
        <div>
          <div className="setting-title">音高</div>
          <div className="setting-desc">1.00 是原声；调低更沉稳，调高更清亮。</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-3)", minWidth: 44, textAlign: "right" }}>
            {shownPitch.toFixed(2)}
          </span>
          <input
            type="range"
            aria-label="音高"
            min={PITCH_MIN}
            max={PITCH_MAX}
            step={0.05}
            disabled={!usable}
            value={shownPitch}
            style={{ width: 168, accentColor: "var(--accent)" }}
            onChange={(e) => {
              setDragging("pitch");
              setDragValue(Number(e.target.value));
            }}
            onPointerUp={commitSlider}
            onPointerCancel={commitSlider}
            onMouseUp={commitSlider}
            onTouchEnd={commitSlider}
            onKeyUp={commitSlider}
            onBlur={commitSlider}
          />
          <button className="btn btn-ghost" disabled={prefs.pitch === 1} onClick={() => setVoicePrefs({ pitch: 1 })}>
            复位
          </button>
        </div>
      </div>

      {/* ⑥ 试听 / 停止 */}
      <div className="setting-row">
        <div>
          <div className="setting-title">试听</div>
          <div className="setting-desc">
            用当前的音色、语速、音高念一句，确认听着顺耳。
            <span style={{ color: "var(--text-3)" }}>　试听不看「自动朗读」开关，随时可以点。</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "none" }}>
          <button className="btn" disabled={!usable} onClick={() => void preview()}>
            {speaking ? "停止" : "试听"}
          </button>
          <button
            className="btn btn-ghost"
            title="音色、语速、音高全部回到原声，并关闭自动朗读"
            onClick={() => {
              void ttsStop();
              setSpeaking(false);
              resetVoicePrefs();
              setMsg("已恢复默认（静音 · 原声原速 · 引擎默认音色）");
            }}
          >
            全部恢复默认
          </button>
        </div>
      </div>

      {msg ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-3)", padding: "6px 16px" }}>{msg}</div>
      ) : null}
    </>
  );
}
