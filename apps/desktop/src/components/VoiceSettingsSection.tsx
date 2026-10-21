import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../i18n/index.js";
import { Btn } from "@onethu/gui";
import { Select } from "@onethu/gui";
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
import { defineSearchRows } from "../state/searchRows.js";
import { goOhRow } from "./OhSettingsPage.js";
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
      ? { title: i18n("components.voicesettingssection.5e4df038f43b"), desc: i18n("components.voicesettingssection.7603ae8c852e") }
      : { title: i18n("components.voicesettingssection.dd73594225ff"), desc: "" };
  }
  switch (st.state) {
    case "unsupported":
      return {
        title: i18n("components.voicesettingssection.99f2b52319a6"),
        desc: i18n("components.voicesettingssection.e54687f4ae5c"),
      };
    case "initializing":
      return { title: i18n("components.voicesettingssection.993d7857beb9"), desc: i18n("components.voicesettingssection.1aa0e6cae35c") };
    case "ready":
      return {
        title: i18n("components.voicesettingssection.8c286c301431"),
        desc: (st.engine ? i18n("components.voicesettingssection.8f463b50e0cb", { engine: String(st.engine) }) : i18n("components.voicesettingssection.bd3bac24c982")) + (st.note ? `（${st.note}）` : ""),
      };
    case "speaking":
      return { title: i18n("components.voicesettingssection.1ead396a0d02"), desc: st.engine ? i18n("components.voicesettingssection.8f463b50e0cb", { engine: String(st.engine) }) : i18n("components.voicesettingssection.892033f846ab") };
    case "error":
      return {
        title: i18n("components.voicesettingssection.6e5d0cde3be6"),
        desc: i18n("components.voicesettingssection.03e731b6fbf6", { value: String(st.reason ?? i18n("components.voicesettingssection.08ceb2822aa1")) }),
      };
    default:
      return { title: i18n("components.voicesettingssection.0c278a68af8a"), desc: i18n("components.voicesettingssection.82ee2ef744bf") };
  }
}


/* task-19/22：语音合成设置行注册。go 走 goOhRow（切基础档 + 行滚动高亮；引擎行标题是动态的 → 已在 JSX 里钉 data-set-id="row-voice-engine"） */
defineSearchRows([
  { id: "voice-engine", tab: "OneTHU Harness", section: "语音", get title() { return i18n("components.voicesettingssection.3e3b45ef84ac"); }, aliases: ["语音引擎", "重新检查", "试听"], get desc() { return i18n("components.voicesettingssection.20e403134d07"); } , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "语音", "引擎状态"], displayRoot: "设置", go: () => goOhRow("voice-engine", "basic") },
  { id: "voice-tone", tab: "OneTHU Harness", section: "语音", get title() { return i18n("components.voicesettingssection.6ab9d2bde92c"); }, aliases: ["嗓音", "普通话"], get desc() { return i18n("components.voicesettingssection.a26073d57821"); } , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "语音", "音色"], displayRoot: "设置", go: () => goOhRow("voice-tone", "basic") },
  { id: "voice-rate", tab: "OneTHU Harness", section: "语音", get title() { return i18n("components.voicesettingssection.cd97a36868f3"); }, aliases: ["速度"], get desc() { return i18n("components.voicesettingssection.bd80a69f212e"); } , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "语音", "语速"], displayRoot: "设置", go: () => goOhRow("voice-rate", "basic") },
  { id: "voice-pitch", tab: "OneTHU Harness", section: "语音", get title() { return i18n("components.voicesettingssection.8fb65b97b8dc"); }, aliases: ["音调"], get desc() { return i18n("components.voicesettingssection.f4feaf735d87"); } , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "语音", "音高"], displayRoot: "设置", go: () => goOhRow("voice-pitch", "basic") },
]);

export function VoiceSettingsSection(): ReactNode {
  const uiLocale = useUiLocale();

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
        setMsg(i18n("components.voicesettingssection.a930fa97ad36", { reason: String(reason) }));
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
    else setMsg(i18n("components.voicesettingssection.5ffbeb114a74", { value: String(lastTtsError() ?? i18n("components.voicesettingssection.f4b29bf393be")) }));
  };

  const copy = engineCopy(status, busy);

  return (
    <>
      {/* 「自动朗读 OH 的回复」开关已按用户要求**删除**（2026-10-11）：
          自动朗读只在对话面板/悬浮窗顶部的「朗读 开/关」按钮上管，设置里不再出现第二处开关。 */}
      {/* ② 引擎状态：长说明行按「正常设置行」排版（is-copy：文字列吃满宽、按钮与首行同基线） */}
      {/* task-22 检索直达：这行标题是动态的（配音面状态文案），注册表按「引擎状态」检索——显式钉 id，保证落点唯一 */}
      <div className="setting-row is-copy" data-set-id="row-voice-engine">
        <div>
          <div className="setting-title">{copy.title}</div>
          <div className="setting-desc">
            {copy.desc}
            {ready && voices.length > 0 ? (
              <span style={{ color: "var(--text-3)" }}>{i18nRich("components.voicesettingssection.06c47ff40845", { length: voices.length })}</span>
            ) : null}
          </div>
        </div>
        <Btn variant="ghost" disabled={busy} onClick={() => void refresh()}>{busy ? i18n("components.voicesettingssection.fb11aa6f2982") : i18n("components.voicesettingssection.c25fb86b1e96")}</Btn>
      </div>

      {/* ③ 音色 */}
      <div data-set-id="row-voice-tone" className="setting-row">
        <div>
          <div className="setting-title">{i18n("components.voicesettingssection.6ab9d2bde92c")}</div>
          <div className="setting-desc">
            {voices.length === 0
              ? i18n("components.voicesettingssection.853dd990730b")
              : i18n("components.voicesettingssection.87e2903f67f2")}
          </div>
        </div>
        <Select aria-label={i18n("components.voicesettingssection.6ab9d2bde92c")} disabled={voices.length === 0 || !usable} value={prefs.voiceName} onChange={(value) => setVoicePrefs({ voiceName: value })}><option value="">{i18n("components.voicesettingssection.9138d2ecd64e")}</option>{voices.map((v) => (
            <option key={v} value={v}>
              {prettyVoiceName(v)}
            </option>
          ))}</Select>
      </div>

      {/* ④ 语速 */}
      <div data-set-id="row-voice-rate" className="setting-row">
        <div>
          <div className="setting-title">{i18n("components.voicesettingssection.cd97a36868f3")}</div>
          <div className="setting-desc">{i18n("components.voicesettingssection.a1849a34d66f")}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-3)", minWidth: 44, textAlign: "right" }}>
            {shownRate.toFixed(2)}×
          </span>
          <input
            type="range"
            aria-label={i18n("components.voicesettingssection.cd97a36868f3")}
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
          <Btn variant="ghost" disabled={prefs.rate === 1} onClick={() => setVoicePrefs({ rate: 1 })}>{i18n("components.voicesettingssection.95ac0ce3b08b")}</Btn>
        </div>
      </div>

      {/* ⑤ 音高 */}
      <div data-set-id="row-voice-pitch" className="setting-row">
        <div>
          <div className="setting-title">{i18n("components.voicesettingssection.8fb65b97b8dc")}</div>
          <div className="setting-desc">{i18n("components.voicesettingssection.c6d7dc8d5c1d")}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-3)", minWidth: 44, textAlign: "right" }}>
            {shownPitch.toFixed(2)}
          </span>
          <input
            type="range"
            aria-label={i18n("components.voicesettingssection.8fb65b97b8dc")}
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
          <Btn variant="ghost" disabled={prefs.pitch === 1} onClick={() => setVoicePrefs({ pitch: 1 })}>{i18n("components.voicesettingssection.95ac0ce3b08b")}</Btn>
        </div>
      </div>

      {/* ⑥ 试听 / 停止 */}
      <div className="setting-row">
        <div>
          <div className="setting-title">{i18n("components.voicesettingssection.7f0a0fda741c")}</div>
          <div className="setting-desc">{i18n("components.voicesettingssection.36aaad1be5c9")}<span style={{ color: "var(--text-3)" }}>{i18n("components.voicesettingssection.cbe095bfb926")}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "none" }}>
          <Btn variant="outline" disabled={!usable} onClick={() => void preview()}>{speaking ? i18n("components.voicesettingssection.ca4d973c0b00") : i18n("components.voicesettingssection.7f0a0fda741c")}</Btn>
          <Btn variant="ghost" titleAttr={i18n("components.voicesettingssection.2a015c420014")} onClick={() => {
              void ttsStop();
              setSpeaking(false);
              resetVoicePrefs();
              setMsg(i18n("components.voicesettingssection.c4b08459fe2e"));
            }}>{i18n("components.voicesettingssection.3b6c48ce496b")}</Btn>
        </div>
      </div>

      {msg ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-3)", padding: "6px 16px" }}>{msg}</div>
      ) : null}
    </>
  );
}
