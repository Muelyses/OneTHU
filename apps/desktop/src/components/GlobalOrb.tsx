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
import { HarnessMark } from "./HarnessMark.js";
import { formatSize, sendToOh, type AttachFile } from "../lib/attach.js";
import { AttachActionsSheet } from "./AttachActionsSheet.js";
import { speechAvailable, speechLevel, speechPoll, speechStart, speechStop } from "../lib/speech.js";
import { readVoicePrefs, setVoicePrefs, useVoicePrefs } from "../state/voicePrefs.js";
import { speakReply } from "../lib/tts.js";

const HOLD_MS = 450;
const FINAL_GRACE_MS = 320;
const CANCEL_PX = 56; // 上划取消阈值（与 ChatDock 同语义）

/* ── 悬浮球几何（**只在这里定尺寸**：窗口尺寸由原生按同样口径给） ──
 *   窗口 = 球 + 两侧各 BALL_PAD；投影画在球之外的留白里，所以永远不会被窗口边界裁掉
 *   （2026-10-11 用户实录：「半个球」「球形状阴影不对」= 球按整屏定位 + 投影被 64px 窗裁断）。 */
const BALL_VISUAL = 58; // 与 overlay_win.rs 的 BALL_VISUAL 一致
const BALL_PAD = 8; //     与 overlay_win.rs 的 BALL_PAD 一致（安卓 BALL_WIN_DP = BALL_DP + 16 同口径）
const PANEL_RADIUS = 24; // 悬浮小窗圆角（安卓 PANEL_RADIUS_DP = 24）

/* ── 过场时长：与安卓同源（Drop 150 + Bloom 280 ≈ 430ms / Collapse 260 / BallIn 200） ── */
const DROP_MS = 150;
const BLOOM_MS = 280;
const COLLAPSE_MS = 260;
const BALL_IN_MS = 200;

/** 关键帧集中一处（组件自带 <style>，不往 global.css 塞东西——那是别人的写域） */
const ORB_KEYFRAMES = `
@keyframes ohOrbDrop{0%{transform:scale(1,1)}45%{transform:scale(.88,1.14) translateY(3px)}100%{transform:scale(.86,1.16) translateY(4px);opacity:.82}}
@keyframes ohOrbBounce{0%{transform:scale(.82);opacity:.55}55%{transform:scale(1.06);opacity:1}100%{transform:scale(1)}}
@keyframes ohOrbBloom{0%{opacity:0;transform:scale(.94) translateY(14px);border-radius:50%}60%{opacity:1}100%{opacity:1;transform:none;border-radius:${PANEL_RADIUS}px}}
@keyframes ohOrbCollapse{0%{opacity:1;transform:none;border-radius:${PANEL_RADIUS}px}100%{opacity:0;transform:scale(.94) translateY(14px);border-radius:50%}}
@keyframes ohOrbBarIn{0%{opacity:0;transform:scaleX(.18)}100%{opacity:1;transform:scaleX(1)}}
`;

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
/** 面板雾（用户口径 2026-10-11）：**从底部铺满、向上渐变变淡**，不是一片径向团。
 *  纵向 linear-gradient 做填充，mask 让 backdrop 模糊也一起随高度化掉。 */
const fogSheet = (extra?: CSSProperties): CSSProperties => ({
  position: "absolute",
  inset: 0,
  zIndex: 0,
  pointerEvents: "none",
  backgroundImage:
    "linear-gradient(to top,"
    + " color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 88%, transparent) 0%,"
    + " color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 70%, transparent) 38%,"
    + " color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 40%, transparent) 68%,"
    + " color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 14%, transparent) 88%,"
    + " transparent 100%)",
  backdropFilter: "blur(20px) saturate(1.25)",
  WebkitBackdropFilter: "blur(20px) saturate(1.25)",
  maskImage: "linear-gradient(to top, #000 0%, #000 58%, rgba(0,0,0,.55) 82%, transparent 100%)",
  WebkitMaskImage: "linear-gradient(to top, #000 0%, #000 58%, rgba(0,0,0,.55) 82%, transparent 100%)",
  ...extra,
});

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
  /** 过场状态：drop（球滴落）→ bloom（面板铺开）/ collapse（收拢）→ bounce（球弹回）/ bar（条展开） */
  const [anim, setAnim] = useState<"none" | "drop" | "bloom" | "collapse" | "bounce" | "bar">("none");
  /** 球心相对本窗左上角（逻辑 px），由原生 geometry 事件回传：决定「从球的方位滴落/收拢」 */
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const animTimer = useRef<number | null>(null);
  const modeRef = useRef<OverlayMode>(initialMode);
  const prefs = useVoicePrefs();
  const holdTimer = useRef<number | null>(null);
  /** 事件 effect 依赖是 []（不该频繁重挂），所以 voice 必须用 ref 镜像——
   *  否则 release 分支读到的永远是挂载那一刻的 "off"，松手永远收不了尾（桌面浮层实测踩到）。 */
  const voiceRef = useRef<"off" | "listening" | "sending">("off");
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
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

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  /** 过场定时器统一收口（连点/中途切形态不会叠动画） */
  const later = useCallback((ms: number, fn: () => void): void => {
    if (animTimer.current) window.clearTimeout(animTimer.current);
    animTimer.current = window.setTimeout(() => {
      animTimer.current = null;
      fn();
    }, ms);
  }, []);

  /** 开：球先「滴落」150ms，再让原生把窗切到面板，随即「铺开」280ms */
  const openPanel = useCallback((): void => {
    if (modeRef.current === "panel") return;
    setAnim("drop");
    later(DROP_MS, () => {
      setMode("panel");
      void overlaySetMode("panel");
      setAnim("bloom");
      later(BLOOM_MS, () => setAnim("none"));
    });
  }, [later]);

  /** 关：面板「反向收拢」260ms → 原生缩回球窗 → 球「弹回」200ms */
  const collapseToBall = useCallback((): void => {
    if (modeRef.current === "ball") return;
    setAnim("collapse");
    later(COLLAPSE_MS, () => {
      setMode("ball");
      void overlaySetMode("ball");
      setAnim("bounce");
      later(BALL_IN_MS, () => setAnim("none"));
    });
  }, [later]);

  /** 「回到 OneTHU」：唯一把主窗口带前台的路径，且必须由用户点这一下触发 */
  const backToApp = useCallback((): void => {
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("overlay_back_to_main");
      } catch {
        /* 安卓/浏览器：这条走原生侧自己的实现；失败不弹错 */
      }
    })();
  }, []);

  // 原生手势 → UI 状态机
  useEffect(() => {
    let un: (() => void) | null = null;
    void (async () => {
      un = await onOverlayEvent((e) => {
        if (e.type === "tap") {
          // 球 ↔ 面板：带过场（滴落铺开 / 收拢弹回），别直接硬切
          if (modeRef.current === "panel") collapseToBall();
          else openPanel();
        } else if ((e.type as string) === "geometry") {
          // 原生每次落位后回传：球心相对本窗左上角的逻辑坐标，给过场当 transform-origin
          const g = e as unknown as { x?: unknown; y?: unknown };
          if (typeof g.x === "number" && typeof g.y === "number") setOrigin({ x: g.x, y: g.y });
        } else if (e.type === "hold") {
          setAnim("bar");
          setMode("bar");
          void overlaySetMode("bar");
          void startVoice();
        } else if (e.type === "release" && voiceRef.current === "listening") {
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
      setAnim("bloom");
      later(BLOOM_MS, () => setAnim("none"));
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
    setAnim("bloom");
    later(BLOOM_MS, () => setAnim("none"));
  }, [later]);

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
      // 需求 4：默认静音；顶栏「自动朗读」开了才念（偏好存 state/voicePrefs）
      if (answer && readVoicePrefs().autoSpeak) void speakReply(answer);
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

  /* ── 球：实底 + 1px 细边 + 轻投影（安卓 A② 口径）──
   *  几何铁律（2026-10-11 修「半个球 / 阴影不对」）：
   *    ① 外框吃满窗口（inset:0），手势挂在外框 → 球外那圈留白也吃点击，没有死区；
   *    ② 球**只在内层**画（BALL_VISUAL），四周留 BALL_PAD 给投影；
   *    ③ 投影半径压到 6px：留白 8px > 偏移 2px + 可见尾巴，绝不会被窗口边界裁出硬线；
   *    ④ 不再用 right/bottom 定位（那是整屏窗口的写法，球窗里必然被推出窗外 = 半个球）。 */
  if (mode === "ball") {
    return (
      <>
        <style>{ORB_KEYFRAMES}</style>
        <div
          role="button"
          aria-label="OH 悬浮球：单击打开对话，长按说话"
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            display: "flex", alignItems: "center", justifyContent: "center",
            userSelect: "none", touchAction: "none", cursor: "pointer",
          }}
          onPointerDown={(e) => {
            pressY.current = e.clientY;
            pressStart.current = { x: e.clientX, y: e.clientY };
            draggedRef.current = false;
            holdTimer.current = window.setTimeout(() => {
              holdTimer.current = null;
              if (draggedRef.current) return; // 已经在拖窗口：不进语音
              setAnim("bar");
              setMode("bar");
              void overlaySetMode("bar");
              void startVoice();
            }, HOLD_MS);
          }}
          onPointerMove={(e) => {
            const st = pressStart.current;
            if (!st) return;
            if (Math.abs(e.clientX - st.x) + Math.abs(e.clientY - st.y) > 6) {
              draggedRef.current = true;
              if (holdTimer.current) {
                window.clearTimeout(holdTimer.current);
                holdTimer.current = null;
              }
            }
          }}
          onPointerUp={() => {
            const wasDrag = draggedRef.current;
            draggedRef.current = false;
            pressStart.current = null;
            if (holdTimer.current) {
              window.clearTimeout(holdTimer.current);
              holdTimer.current = null;
              if (!wasDrag) openPanel(); // 球滴落 → 面板铺开
            }
          }}
        >
          <div
            aria-hidden
            style={{
              width: BALL_VISUAL, height: BALL_VISUAL, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--dsw-alias-bg-layer-1, #fff)",
              color: "var(--dsw-alias-label-primary, #1c1f24)",
              border: "1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12))",
              boxShadow: "0 2px 6px rgba(0,0,0,.20)",
              animation:
                anim === "drop"
                  ? `ohOrbDrop ${DROP_MS}ms cubic-bezier(.4,0,.6,1) forwards`
                  : anim === "bounce"
                    ? `ohOrbBounce ${BALL_IN_MS}ms cubic-bezier(.34,1.4,.5,1)`
                    : undefined,
            }}
          >
            <HarnessMark size={17} />
          </div>
        </div>
      </>
    );
  }

  /* ── 语音条：点点波纹 + 上方雾里浮着转写（与本体同语言，但不是同一套 DOM） ── */
  if (mode === "bar") {
    const amplitude = Math.max(0.42, Math.min(1, level));
    // 安卓 D①：**球原地横向展开**——球在窗内左半就从左侧摊开，右半就从右侧摊开
    const halfW = (typeof window !== "undefined" ? window.innerWidth : 0) / 2;
    const barOrigin: string = (origin?.x ?? 0) < halfW ? "left center" : "right center";
    return (
      <>
      <style>{ORB_KEYFRAMES}</style>
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
            transformOrigin: barOrigin,
            animation: `ohOrbBarIn ${BLOOM_MS}ms cubic-bezier(.22,.9,.24,1)`,
            // 条窗是全宽的，药丸四周有足够留白 → 投影不会被窗口边界裁（球那次教训）
            boxShadow: "0 3px 10px rgba(0,0,0,.12)",
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
      </>
    );
  }

  /* ── 对话面：悬浮小窗（安卓 A①：左右/底部各留 14、高 44%、圆角 24）里的雾中の裸文字条目 ──
   *  窗口尺寸由原生给（`overlay_win.rs` 的 PANEL_RATIO/PANEL_MARGIN），这里只负责「填满窗口」：
   *  inset:0 + 24px 圆角 + overflow:hidden（雾与滚动条都裁在圆角内）。 */
  return (
    <>
      <style>{ORB_KEYFRAMES}</style>
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 9999,
          display: "flex", flexDirection: "column", padding: "12px 16px 12px",
          borderRadius: PANEL_RADIUS, overflow: "hidden",
          border: "1px solid color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0,0,0,.14)) 70%, transparent)",
          color: "var(--dsw-alias-label-primary, #1c1f24)",
          // 「从球所在的方位滴落铺开 / 收拢回去」：origin = 球心相对本窗左上角（原生 geometry 事件给）
          transformOrigin: origin ? `${origin.x}px ${origin.y}px` : "50% 100%",
          animation:
            anim === "bloom"
              ? `ohOrbBloom ${BLOOM_MS}ms cubic-bezier(.22,.9,.24,1)`
              : anim === "collapse"
                ? `ohOrbCollapse ${COLLAPSE_MS}ms cubic-bezier(.5,0,.75,0) forwards`
                : undefined,
          pointerEvents: anim === "collapse" ? "none" : "auto",
        }}
      >
        <div aria-hidden style={fogSheet()} />
        {/* 顶栏**只留三个动作**（用户口径 2026-10-11）：回到 OneTHU / 自动朗读 / 收起
            ——「本次关闭悬浮球」已删（收进本体，浮层不再自带注销开关）。 */}
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
          <span style={{ display: "flex", alignItems: "center", opacity: 0.5 }}>
            <HarnessMark size={12} />
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {[
              { key: "back", label: "回到 OneTHU", active: true, onClick: backToApp },
              {
                key: "read",
                label: prefs.autoSpeak ? "自动朗读 · 开" : "自动朗读",
                active: prefs.autoSpeak,
                onClick: () => setVoicePrefs({ autoSpeak: !prefs.autoSpeak }),
              },
              { key: "collapse", label: "收起", active: true, onClick: collapseToBall },
            ].map((a) => (
              <button
                key={a.key}
                onClick={a.onClick}
                style={{
                  fontSize: 12, lineHeight: "18px", padding: "4px 10px", borderRadius: 999, cursor: "pointer",
                  whiteSpace: "nowrap", color: "inherit",
                  border: a.active
                    ? "1px solid color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0,0,0,.12)) 80%, transparent)"
                    : "1px solid transparent",
                  background: a.active
                    ? "color-mix(in srgb, var(--dsw-alias-bg-layer-2, #f2f2f4) 82%, transparent)"
                    : "color-mix(in srgb, var(--dsw-alias-bg-layer-2, #f2f2f4) 45%, transparent)",
                  opacity: a.active ? 0.92 : 0.7,
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
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
    </>
  );
});
