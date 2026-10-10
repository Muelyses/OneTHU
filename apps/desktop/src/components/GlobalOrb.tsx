/**
 * 全局悬浮球前端（需求 5）——桌面悬浮窗 / 安卓悬浮层共用的 UI 面。
 *
 * 形态（原生侧通过 overlaySetMode 驱动）：
 *   ball  → 一颗可拖动的雾状球（桌面可拖任意位置；安卓由原生吸附边框）
 *   bar   → 长按后伸展成的语音输入条（点点波纹 + 上方雾里浮着实时转写）
 *   panel → 单击后从底部滑出的雾状对话面：**雾中の裸文字条目**，不是应用内那套气泡 UI
 *
 * 设计口径（2026-10-10 用户拍板）：
 *   - 不要气泡、不要框、不要头像：只有雾，和雾里的文字条目（双方的话都能一眼分清）
 *   - 内容**完整渲染**（不截断），可上下滑动
 *   - 一切颜色用 --dsw-alias-* token；雾 = 半透明 + backdrop-filter + 径向羽化
 *
 * 红线：这里只走纯前端通道（askOh / ohRun），绝不主动把主窗口拉到前台。
 */
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  onOverlayEvent, overlayHide, overlayPushUi, overlaySetMode, setOverlayClosedByUser,
  type OverlayMode,
} from "../lib/overlay.js";
import { askOh } from "../im/oh.js";
import { AttachTray } from "./AttachTray.js";
import { formatSize, sendToOh, type AttachFile } from "../lib/attach.js";
import { AttachActionsSheet } from "./AttachActionsSheet.js";
import { speechAvailable, speechLevel, speechPoll, speechStart, speechStop } from "../lib/speech.js";

const HOLD_MS = 450;
const FINAL_GRACE_MS = 320;
const CANCEL_PX = 56; // 上划取消阈值（与 ChatDock 同语义）

interface Bubble { role: "user" | "oh"; text: string }

/** 雾：中心浓、四周化开——不用 border/圆角/矩形阴影，避免出现「一条雾」 */
const fogLayer: CSSProperties = {
  backgroundImage:
    "radial-gradient(58% 78% at 50% 52%, color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 62%, transparent) 0%,"
    + " color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 30%, transparent) 46%, transparent 80%)",
  backdropFilter: "blur(22px) saturate(1.3)",
  WebkitBackdropFilter: "blur(22px) saturate(1.3)",
  maskImage: "radial-gradient(74% 90% at 50% 52%, #000 36%, rgba(0,0,0,.6) 64%, transparent 90%)",
  WebkitMaskImage: "radial-gradient(74% 90% at 50% 52%, #000 36%, rgba(0,0,0,.6) 64%, transparent 90%)",
  color: "var(--dsw-alias-label-primary, #1c1f24)",
};

const textShadow = "0 1px 14px color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 55%, transparent)";

/** 雾只做**背景层**：绝对定位 + pointer-events:none，文字层永远不吃 mask
 *  （用户要求「渲染还是渲染完整的」——把 mask 加在含文字的容器上会把首尾行渐隐掉）。 */
const fogBack = (extra?: CSSProperties): CSSProperties => ({
  ...fogLayer,
  position: "absolute",
  inset: "-6% -3%",
  zIndex: 0,
  pointerEvents: "none",
  ...extra,
});

export const GlobalOrb = memo(function GlobalOrb({ initialMode = "ball" }: { initialMode?: OverlayMode }): ReactNode {
  const [mode, setMode] = useState<OverlayMode>(initialMode);
  const [voice, setVoice] = useState<"off" | "listening" | "sending">("off");
  const [voiceText, setVoiceText] = useState("");
  const [msgs, setMsgs] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [level, setLevel] = useState(0);
  const [typing, setTyping] = useState(false);
  const [sheetFiles, setSheetFiles] = useState<AttachFile[] | null>(null);
  const holdTimer = useRef<number | null>(null);
  const pollTimer = useRef<number | null>(null);
  const levelTimer = useRef<number | null>(null);
  const cancelRef = useRef(false);
  const pressY = useRef(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const scrollToEnd = (): void => {
    requestAnimationFrame(() => {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  /** 上划取消：按住期间向上拖过阈值即进入取消态（松手不发送） */
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      if (voice !== "listening") return;
      cancelRef.current = pressY.current - e.clientY > CANCEL_PX;
      setVoiceText(cancelRef.current ? "松开取消" : "");
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [voice]);

  // 原生手势 → UI 状态机
  useEffect(() => {
    let un: (() => void) | null = null;
    void (async () => {
      un = await onOverlayEvent((e) => {
        if (e.type === "tap") {
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

  const stopTimers = (): void => {
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    if (levelTimer.current) {
      window.clearInterval(levelTimer.current);
      levelTimer.current = null;
    }
  };

  const startVoice = useCallback(async (): Promise<void> => {
    if (!(await speechAvailable())) {
      // 荣耀/华为「仅前台麦克风」：别的应用在前台时取不到麦 → 诚实引导到键盘输入
      setVoiceText("此环境取不到麦克风（系统限制），点球打开面板用键盘输入");
      setMode("panel");
      void overlaySetMode("panel");
      return;
    }
    cancelRef.current = false;
    setVoice("listening");
    setVoiceText("在听，请讲…");
    try {
      await speechStart();
    } catch {
      setVoice("off");
      setVoiceText("");
      return;
    }
    stopTimers();
    pollTimer.current = window.setInterval(() => {
      void speechPoll().then((t) => {
        if (!cancelRef.current) setVoiceText(t || "在听，请讲…");
      });
    }, 180);
    levelTimer.current = window.setInterval(() => {
      void speechLevel().then(setLevel);
    }, 110);
  }, []);

  /** 需求 2：识别结果不进输入框，整句直接喂给 OH；上划取消则丢弃 */
  const finishVoice = useCallback(async (): Promise<void> => {
    const cancelled = cancelRef.current;
    cancelRef.current = false;
    stopTimers();
    setVoice("sending");
    speechStop();
    await new Promise((r) => window.setTimeout(r, FINAL_GRACE_MS));
    const final = (await speechPoll()).trim();
    setVoiceText("");
    setLevel(0);
    setVoice("off");
    if (cancelled) {
      setMsgs((m) => [...m, { role: "oh", text: "（已取消）" }]);
      return;
    }
    if (final) void send(final);
    setMode("panel");
    await overlaySetMode("panel");
  }, []);

  const send = useCallback(async (text: string): Promise<void> => {
    const t = text.trim();
    if (!t) return;
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setInput("");
    scrollToEnd();
    setTyping(true);
    try {
      const r = await askOh(t);
      const answer = String((r as { text?: string })?.text ?? "");
      setMsgs((m) => [...m, { role: "oh", text: answer || "（没有拿到回复）" }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "oh", text: `（出错了：${e instanceof Error ? e.message : String(e)}）` }]);
    } finally {
      setTyping(false);
      scrollToEnd();
    }
  }, []);

  // 状态推送：安卓系统悬浮层用原生 UI 渲染，必须由前端把内容推过去
  useEffect(() => {
    void overlayPushUi({
      messages: msgs,
      transcript: voiceText,
      level,
      listening: voice === "listening",
      busy: voice === "sending" || typing,
      mode,
      theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    });
  }, [msgs, voiceText, level, voice, typing, mode]);

  // 新消息滚到底（内容完整渲染，可滑动回看）
  useEffect(scrollToEnd, [msgs.length, typing]);

  if (mode === "hidden") return null;

  /* ── 球：雾状玻璃球，无硬边 ── */
  if (mode === "ball") {
    return (
      <div
        role="button"
        aria-label="OH 悬浮球：单击打开对话，长按说话"
        style={{
          ...fogLayer,
          maskImage: "none", WebkitMaskImage: "none",
          position: "fixed", right: 12, bottom: 128, width: 54, height: 54, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 15, letterSpacing: 0.4, userSelect: "none", touchAction: "none", zIndex: 9999,
          border: "none", textShadow,
        }}
        onPointerDown={(e) => {
          pressY.current = e.clientY;
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

  /* ── 语音条：点点波纹 + 上方雾里浮着转写（与本体同语言，但不是同一套 DOM） ── */
  if (mode === "bar") {
    const amplitude = Math.max(0.42, Math.min(1, level));
    return (
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 9999, pointerEvents: "none" }}>
        <div
          style={{
            position: "relative", margin: "0 auto 10px", width: "min(96vw, 640px)", padding: "26px 40px",
            border: "none", textAlign: "center",
            fontSize: 14, lineHeight: 1.5, textShadow,
            opacity: voiceText ? 1 : 0, transition: "opacity .2s ease",
          }}
        >
          <div aria-hidden style={fogBack()} />
          <span style={{ position: "relative", zIndex: 1 }}>{voiceText}</span>
        </div>
        <div
          style={{
            position: "relative",
            margin: "0 auto 18px", width: "min(78vw, 460px)", height: 54, borderRadius: 26,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            border: "none", opacity: voice === "listening" ? 1 : 0.7, transition: "opacity .25s ease",
          }}
        >
          <div aria-hidden style={fogBack({ inset: "-30% -6%", borderRadius: 26 })} />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            const phase = Math.sin((Date.now() / 220) + i * 0.7);
            const h = 6 + phase * 8 * amplitude + amplitude * 6;
            return (
              <i
                key={i}
                style={{
                  display: "block", width: 3, height: Math.max(4, h), borderRadius: 2,
                  background: "var(--dsw-alias-label-secondary, rgba(0,0,0,.5))",
                  opacity: 0.35 + 0.5 * amplitude,
                  animation: "none",
                }}
              />
            );
          })}
        </div>
      </div>
    );
  }

  /* ── 对话面：雾中の裸文字条目（无气泡、无框、可滑动、内容完整） ── */
  return (
    <div
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, top: "18vh", zIndex: 9999,
        display: "flex", flexDirection: "column", padding: "18px 22px 14px",
        border: "none",
      }}
    >
      <div aria-hidden style={fogBack({ inset: "-4% -6%" })} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12, letterSpacing: 1.6, opacity: 0.55 }}>OH</span>
        <button
          style={{
            fontSize: 12, padding: "4px 10px", borderRadius: 999, border: "none", cursor: "pointer",
            background: "color-mix(in srgb, var(--dsw-alias-bg-layer-2, #f2f2f4) 55%, transparent)",
            color: "inherit", opacity: 0.75,
          }}
          onClick={() => {
            setOverlayClosedByUser(true);
            setMode("hidden");
            void overlayHide();
          }}
        >
          本次关闭悬浮球
        </button>
      </div>

      <div ref={scroller} style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingRight: 2 }}>
        {msgs.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: m.role === "user" ? "84%" : "94%",
              textAlign: m.role === "user" ? "right" : "left",
              fontSize: 15, lineHeight: 1.62, whiteSpace: "pre-wrap", wordBreak: "break-word",
              opacity: m.role === "user" ? 0.62 : 1,
              fontStyle: m.role === "user" ? "normal" : "normal",
              letterSpacing: 0.2, textShadow,
            }}
          >
            {m.text}
          </div>
        ))}
        {typing ? (
          <div style={{ alignSelf: "flex-start", fontSize: 14, opacity: 0.5, letterSpacing: 2, textShadow }}>
            ···
          </div>
        ) : null}
      </div>

      {/* 需求 6：附件入口就在悬浮球打开后的这个位置（拍照 / 相册 / 上传，单张图片可先修一下再发） */}
      <div style={{ position: "relative", zIndex: 1, marginTop: 8 }}>
        <AttachTray
          onPicked={async (files: AttachFile[]) => {
            const summary = files.map((f) => `${f.name}（${formatSize(f.size)}）`).join("、");
            setMsgs((m) => [...m, { role: "user", text: `［附件］${summary}` }]);
            scrollToEnd();
            setSheetFiles(files); // 需求 7：拿到附件就先给动作选择（转存云盘 / 交作业 / 发讨论区）
          }}
        />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setTyping(false)}
          placeholder="点击输入，长按说话"
          style={{
            flex: 1, border: "none", outline: "none", background: "transparent",
            color: "inherit", fontSize: 15, padding: "8px 2px", textShadow,
            borderBottom: "1px solid color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0,0,0,.18)) 70%, transparent)",
          }}
        />
      </form>
      {sheetFiles ? (
        <AttachActionsSheet
          files={sheetFiles}
          onClose={() => setSheetFiles(null)}
          onDone={(d) => {
            const r = (d as { result?: { ok?: boolean; path?: string; error?: string } })?.result;
            setMsgs((m) => [...m, {
              role: "oh",
              text: r?.ok ? `已处理附件${r.path ? `：${r.path}` : ""}` : `附件动作未完成${r?.error ? `：${r.error}` : ""}`,
            }]);
            setSheetFiles(null);
            scrollToEnd();
          }}
        />
      ) : null}
    </div>
  );
});
