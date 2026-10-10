/**
 * 全局悬浮球前端（需求 5）——桌面悬浮窗 / 安卓悬浮层共用的 UI 面。
 *
 * 形态（原生侧通过 overlaySetMode 驱动）：
 *   ball  → 一颗可拖动的雾状球（桌面可拖任意位置；安卓由原生吸附边框）
 *   bar   → 长按后伸展成的语音输入条（点点波纹 + 雾状实时转写）
 *   panel → 单击后从底部滑出的雾状对话面板（约半屏消息 + 底部「点击输入，长按说话」）
 *
 * 红线：这里只走纯前端通道（askOh / ohRun），绝不主动把主窗口拉到前台。
 * 原生手势 → onOverlayEvent（tap/hold/release/drag/closed）。
 */
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  onOverlayEvent, overlayHide, overlaySetMode, setOverlayClosedByUser,
  type OverlayMode,
} from "../lib/overlay.js";
import { askOh } from "../im/oh.js";
import { overlayPushUi } from "../lib/overlay.js";
import { speechAvailable, speechPoll, speechStart, speechStop } from "../lib/speech.js";

const HOLD_MS = 450;
const FINAL_GRACE_MS = 320;
const FOG_BG = "color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 72%, transparent)";

interface Bubble { role: "user" | "oh"; text: string }

export const GlobalOrb = memo(function GlobalOrb({ initialMode = "ball" }: { initialMode?: OverlayMode }): ReactNode {
  const [mode, setMode] = useState<OverlayMode>(initialMode);
  const [voice, setVoice] = useState<"off" | "listening" | "sending">("off");
  const [voiceText, setVoiceText] = useState("");
  const [msgs, setMsgs] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const holdTimer = useRef<number | null>(null);
  const pollTimer = useRef<number | null>(null);

  // 原生手势 → UI 状态机
  useEffect(() => {
    let un: (() => void) | null = null;
    void (async () => {
      un = await onOverlayEvent((e) => {
        if (e.type === "tap") {
          // 修 stale closure：按函数式更新取「当下」的 mode（旧写法捕获首渲染值，恒发 panel）
          setMode((m) => {
            const next: OverlayMode = m === "panel" ? "ball" : "panel";
            void overlaySetMode(next);
            return next;
          });
        } else if (e.type === "hold") {
          setMode("bar");
          void overlaySetMode("bar");
          void startVoice();
        } else if (e.type === "release" && voice === "listening") {
          void finishVoice();
        } else if (e.type === "submit") {
          // 原生面板键入的文本直接进 OH（与语音同一条通道：ohAsk → 发送）
          setMode((m) => {
            const next: OverlayMode = "panel";
            void overlaySetMode(next);
            return next;
          });
          void send(e.text ?? "");
        } else if (e.type === "closed") {
          setOverlayClosedByUser(true);
          setMode("hidden");
          void overlayHide();
        }
      });
    })();
    return () => un?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startVoice = useCallback(async (): Promise<void> => {
    if (!(await speechAvailable())) {
      // 荣耀/华为「仅前台麦克风」：别的应用在前台时取不到麦 → 诚实地引导到键盘输入，而不是静默失败
      setVoiceText("此环境取不到麦克风（系统限制），点球打开面板用键盘输入");
      setMode("panel");
      void overlaySetMode("panel");
      return;
    }
    setVoice("listening");
    setVoiceText("");
    try {
      await speechStart();
    } catch {
      setVoice("off");
      return;
    }
    if (pollTimer.current) window.clearInterval(pollTimer.current);
    pollTimer.current = window.setInterval(() => {
      void speechPoll().then(setVoiceText);
    }, 180);
  }, []);

  /** 需求 2：识别结果不进输入框，整句直接喂给 OH */
  const finishVoice = useCallback(async (): Promise<void> => {
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    setVoice("sending");
    speechStop();
    await new Promise((r) => window.setTimeout(r, FINAL_GRACE_MS));
    const final = (await speechPoll()).trim();
    if (final) {
      setMsgs((m) => [...m, { role: "user", text: final }]);
      void send(final);
    }
    setVoiceText("");
    setVoice("off");
    setMode("panel");
    await overlaySetMode("panel");
  }, []);

  // 状态推送：原生壳（安卓系统悬浮层）用原生 UI 渲染，必须由前端把内容推过去
  useEffect(() => {
    void overlayPushUi({
      messages: msgs,
      transcript: voiceText,
      level: 0,
      listening: voice === "listening",
      busy: voice === "sending",
      mode,
      theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    });
  }, [msgs, voiceText, voice, mode]);

  const send = useCallback(async (text: string): Promise<void> => {
    const t = text.trim();
    if (!t) return;
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setInput("");
    try {
      const r = await askOh(t);
      setMsgs((m) => [...m, { role: "oh", text: String((r as { text?: string })?.text ?? "") }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "oh", text: `（出错了：${e instanceof Error ? e.message : String(e)}）` }]);
    }
  }, []);

  const fog: CSSProperties = {
    background: FOG_BG,
    backdropFilter: "blur(18px) saturate(1.4)",
    WebkitBackdropFilter: "blur(18px) saturate(1.4)",
    border: "1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.08))",
    boxShadow: "0 10px 40px rgba(0,0,0,.20)",
    color: "var(--dsw-alias-label-primary, #1c1f24)",
  };

  if (mode === "hidden") return null;

  if (mode === "ball") {
    return (
      <div
        role="button"
        aria-label="OH 悬浮球：单击打开对话，长按说话"
        style={{
          ...fog, position: "fixed", right: 10, bottom: 120, width: 52, height: 52,
          borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 15, userSelect: "none", touchAction: "none", zIndex: 9999,
        }}
        onPointerDown={() => {
          holdTimer.current = window.setTimeout(() => {
            holdTimer.current = null;
            setMode("bar");
            void overlaySetMode("bar");
            void startVoice();
          }, HOLD_MS);
        }}
        onPointerUp={() => {
          if (holdTimer.current) {
            window.clearTimeout(holdTimer.current);
            holdTimer.current = null;
            setMode("panel");
            void overlaySetMode("panel");
          }
        }}
      >
        OH
      </div>
    );
  }

  return (
    <div style={{ ...fog, position: "fixed", left: 0, right: 0, bottom: 0, borderRadius: "20px 20px 0 0", zIndex: 9999, padding: "10px 14px 16px" }}>
      {mode === "bar" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 46 }}>
          {/* 需求 1：随音量跳动的点点波纹（ball-tts/ball-ui 提供 rms 后驱动 amplitude） */}
          <div className="orb-wave" aria-hidden>
            {Object.keys([0, 1, 2, 3, 4]).map((i) => (
              <span key={i} className="orb-wave-dot" style={{ animationDelay: `${Number(i) * 0.12}s` }} />
            ))}
          </div>
          <div style={{ flex: 1, fontSize: 14, opacity: voiceText ? 1 : 0.55, transition: "opacity .25s" }}>
            {voiceText || (voice === "listening" ? "在听，请讲…" : "长按说话")}
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>OH</span>
            <button className="btn" style={{ fontSize: 12 }} onClick={() => {
              setOverlayClosedByUser(true);
              setMode("hidden");
              void overlayHide();
            }}>
              本次关闭悬浮球
            </button>
          </div>
          <div style={{ height: "42vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4 }}>
            {msgs.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "82%", padding: "8px 12px", borderRadius: 14, fontSize: 14, lineHeight: 1.5,
                background: m.role === "user"
                  ? "var(--dsw-alias-brand-primary, #111)"
                  : "color-mix(in srgb, var(--dsw-alias-bg-layer-2, #f4f4f6) 88%, transparent)",
                color: m.role === "user" ? "var(--dsw-alias-bg-base, #fff)" : "inherit",
              }}>
                {m.text}
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            style={{ display: "flex", gap: 8, marginTop: 10 }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="点击输入，长按说话"
              style={{ flex: 1, padding: "10px 14px", borderRadius: 999, border: "1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12))", background: "transparent", color: "inherit", fontSize: 14 }}
            />
            <button className="btn" type="submit">发送</button>
          </form>
        </>
      )}
    </div>
  );
});
