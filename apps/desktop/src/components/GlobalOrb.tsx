/**
 * 全局悬浮球前端（需求 5）——桌面悬浮窗 / 安卓悬浮层共用的 UI 面。
 *
 * 形态（原生侧通过 overlaySetMode 驱动；桌面只有前两个，安卓另有侧边条等）：
 *   ball  → 实底 + 1px 细边 + 轻投影的球：单击开面板、按住拖动（桌面）
 *   panel → 单击后铺开的悬浮小窗：**整块圆角毛玻璃 + 裸文字条目**，不是应用内那套气泡 UI
 *   （bar 语音条：桌面已按用户口径下线，仅安卓原生侧保留；桌面说话走输入框 + 系统听写）
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
import { logLine } from "../lib/clients.js";
import { readVoicePrefs, setVoicePrefs, useVoicePrefs } from "../state/voicePrefs.js";
import { speakReply } from "../lib/tts.js";

/** 面板窗比视觉块四周多出的留白（与 overlay_win.rs 的 PANEL_SHADOW_PAD 同值）：
 *  那圈留白专门给面板的柔和外阴影，视觉块仍严格落在 14px 边距上。 */
const PANEL_PAD = 14;
/** 顶部把手夹取范围（屏高比例；Rust 侧还会再夹一次，前端只为拖动跟手不越界） */
const PANEL_MIN_RATIO = 0.3;
const PANEL_MAX_RATIO = 0.8;

/** 按下滑动多少 px 才算「拖动」（|dx|+|dy| 曼哈顿距离）——小于它一律当「点一下」。
 *  2026-10-11 实测问题：原值 6px 在手握鼠标时太容易触发（微抖就开拖），拖动一开就清掉长按
 *  定时器 → 长按 450ms 永远进不了语音。12px 是「鼠标微抖不会误触、有意拖动一推就走」的折中；
 *  与 lib/overlayDesktop.ts 的 DRAG_PX 必须保持一致。 */
const DRAG_PX = 12;

/** 悬浮窗内的取证日志（Rust 侧 [OVERLAY] + 这里 [orb]，用户跑一轮就能定位红线条/长按问题） */
function logOrb(line: string): void {
  void logLine(`[orb] ${line}`).catch(() => undefined);
}

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

/** 正文投影：对齐安卓 OverlayViews.shadow()（半径 6、dy 1、α0.25 一档；深色加重） */
const textShadow = `0 1px 6px rgba(0,0,0,${isDarkUi() ? 0.5 : 0.18})`;

/** 背板（用户口径 2026-10-11 两端统一）：**整块可见的圆角毛玻璃**，不要顶部渐隐、不要径向化开。
 *  做法 = 半透明同色块 + backdrop-filter 模糊 + 1px 细边 + 轻投影，四角边界清晰。
 *  注：透明悬浮窗里 backdrop-filter 只采样本窗口内容（macOS 合成器采样不到别家 App），
 *  所以视觉上是「半透明纸」而非「磨砂玻璃」——平台限制，但整块可见、边界清晰这两条成立。 */
/** 背板不透明度：安卓落地值 0.90（浅）/ 0.80（深），桌面取同量级
 *  （用户 2026-10-11：「底板再厚重一点，这个有点透」；原桌面 0.74/0.74 偏透）。 */
const GLASS_ALPHA_LIGHT = 0.9;
const GLASS_ALPHA_DARK = 0.8;

/** 当前是否深色（本仓主题挂 <html data-theme|data-scheme>；取不到就按浅色） */
function isDarkUi(): boolean {
  try {
    const d = document.documentElement.dataset;
    return d.theme === "dark" || d.scheme === "dark";
  } catch {
    return false;
  }
}

const glassBlock = (extra?: CSSProperties): CSSProperties => {
  const dark = isDarkUi();
  const alpha = Math.round((dark ? GLASS_ALPHA_DARK : GLASS_ALPHA_LIGHT) * 100);
  return {
    position: "absolute",
    inset: 0,
    zIndex: 0,
    pointerEvents: "none",
    background: `color-mix(in srgb, var(--dsw-alias-bg-layer-1, ${dark ? "#151517" : "#fff"}) ${alpha}%, transparent)`,
    backdropFilter: "blur(22px) saturate(1.25)",
    WebkitBackdropFilter: "blur(22px) saturate(1.25)",
    border: "1px solid color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0,0,0,.14)) 70%, transparent)",
    // 上沿高光（安卓 withAlpha(white,158/56) 同量级）——整块玻璃的「厚度」感就靠它
    boxShadow: dark ? "inset 0 1px 0 rgba(255,255,255,.10)" : "inset 0 1px 0 rgba(255,255,255,.55)",
    ...extra,
  };
};

/** 顶栏胶囊（与安卓 OverlayViews.capsule 同值：浅 #FFFFFF α0.86 / 深 #000000 α0.45 + 1px 细边） */
function capsuleStyle(active: boolean): CSSProperties {
  const dark = isDarkUi();
  return {
    fontSize: 12,
    lineHeight: "18px",
    padding: "4px 10px",
    borderRadius: 999,
    cursor: "pointer",
    whiteSpace: "nowrap",
    color: "inherit",
    border: `1px solid ${dark ? "rgba(255,255,255,.20)" : "rgba(0,0,0,.12)"}`,
    background: dark
      ? `rgba(0,0,0,${active ? 0.45 : 0.3})`
      : `rgba(255,255,255,${active ? 0.86 : 0.66})`,
    opacity: active ? 0.95 : 0.75,
  };
}

export const GlobalOrb = memo(function GlobalOrb({ initialMode = "ball" }: { initialMode?: OverlayMode }): ReactNode {
  const [mode, setMode] = useState<OverlayMode>(initialMode);
  const [msgs, setMsgs] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [sheetFiles, setSheetFiles] = useState<AttachFile[] | null>(null);
  /** 过场状态：drop（球滴落）→ bloom（面板铺开）/ collapse（收拢）→ bounce（球弹回） */
  const [anim, setAnim] = useState<"none" | "drop" | "bloom" | "collapse" | "bounce">("none");
  /** 球心相对本窗左上角（逻辑 px），由原生 geometry 事件回传：决定「从球的方位滴落/收拢」 */
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const animTimer = useRef<number | null>(null);
  const modeRef = useRef<OverlayMode>(initialMode);
  /** 顶部把手拖动（改面板高度） */
  const handleDrag = useRef<{ id: number; y0: number; h0: number } | null>(null);
  const lastPanelH = useRef(0);
  const [handleDown, setHandleDown] = useState(false);
  const prefs = useVoicePrefs();

  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const scrollToEnd = (): void => {
    requestAnimationFrame(() => {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

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
      transcript: "",
      level: 0,
      listening: false,
      busy: typing,
      mode,
      theme: isDarkUi() ? "dark" : "light",
    });
  }, [msgs, typing, mode]);

  // 新消息滚到底（内容完整渲染，可滑动回看）
  useEffect(scrollToEnd, [msgs.length, typing]);

  if (mode === "hidden") return null;

  /* ── 球：实底 + 1px 细边 + 轻投影（安卓 A② 口径）──
   *  几何铁律（2026-10-11 修「半个球 / 阴影不对」）：
   *    ① 外框吃满窗口（inset:0），手势挂在外框 → 球外那圈留白也吃点击，没有死区；
   *    ② 球**只在内层**画（BALL_VISUAL），四周留 BALL_PAD 给投影；
   *    ③ 投影半径压到 6px：留白 8px > 偏移 2px + 可见尾巴，绝不会被窗口边界裁出硬线；
   *    ④ 不再用 right/bottom 定位（那是整屏窗口的写法，球窗里必然被推出窗外 = 半个球）。 */
  /* ── 球：实底 + 1px 细边 + 轻投影（安卓 A② 口径）──
   *  几何铁律（2026-10-11 修「半个球 / 阴影不对」）：
   *    ① 外框吃满窗口（inset:0），手势挂外框 → 球外留白也吃点击，没有死区；
   *    ② 球**只在内层**画（BALL_VISUAL），四周留 BALL_PAD 给投影；
   *    ③ 投影半径压到 6px：留白 8px > 偏移 2px + 可见尾巴，不会被窗口边界裁出硬线；
   *    ④ 不用 right/bottom 定位（那是整屏窗口的写法，球窗里必然被推出窗外 = 半个球）。
   *  桌面球只做两件事：**单击开面板**、**按住拖动**。
   *  长按语音已按用户口径整体下线（2026-10-11「把电脑悬浮球长按语音关了」）——
   *  桌面要说话就用面板里的输入框 + 系统听写。 */
  if (mode === "ball") {
    return (
      <>
        <style>{ORB_KEYFRAMES}</style>
        {/* 手势在外框上（= 整个窗口）；`data-oh-ball` 是 overlayDesktop 手势桥的闸门：
            只有从这里按下的按压才可能触发拖窗，拖把手/划消息/点输入框都不会误触。 */}
        <div
          role="button"
          data-oh-ball="1"
          aria-label="OH 悬浮球：单击打开对话，按住可拖动"
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            display: "flex", alignItems: "center", justifyContent: "center",
            userSelect: "none", touchAction: "none", cursor: "pointer",
          }}
          onPointerDown={(e) => {
            pressStart.current = { x: e.clientX, y: e.clientY };
            draggedRef.current = false;
          }}
          onPointerMove={(e) => {
            const st = pressStart.current;
            if (!st || draggedRef.current) return;
            if (Math.abs(e.clientX - st.x) + Math.abs(e.clientY - st.y) > DRAG_PX) {
              draggedRef.current = true;
              logOrb(`位移 > ${DRAG_PX}px → 判定拖动（松手不再开面板）`);
            }
          }}
          onPointerUp={() => {
            const wasDrag = draggedRef.current;
            draggedRef.current = false;
            pressStart.current = null;
            if (!wasDrag) openPanel(); // 球滴落 → 面板铺开
          }}
        >
          <div
            aria-hidden
            style={{
              width: BALL_VISUAL, height: BALL_VISUAL, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--dsw-alias-bg-layer-1, #fff)",
              color: "var(--dsw-alias-label-primary, #1c1f24)",
              border: "1px solid color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0,0,0,.12)) 80%, transparent)",
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

  /* ── 对话面：悬浮小窗（安卓 A①：左右/底部各留 14、高 44%~80%、圆角 24）里的整块毛玻璃 ──
   *  窗口尺寸由原生给（`overlay_win.rs`：视觉块 14 边距 + 四周 PANEL_SHADOW_PAD 阴影留白），
   *  这里负责：inset 14 的视觉块 + 24px 圆角 + overflow:hidden + 柔和外阴影。 */
  return (
    <>
      <style>{ORB_KEYFRAMES}</style>
      <div
        style={{
          position: "fixed", inset: PANEL_PAD, zIndex: 9999,
          display: "flex", flexDirection: "column", padding: "8px 16px 12px",
          borderRadius: PANEL_RADIUS, overflow: "hidden",
          border: "1px solid color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0,0,0,.14)) 70%, transparent)",
          color: "var(--dsw-alias-label-primary, #1c1f24)",
          // 柔和外阴影（用户口径）：窗口特意留了 PANEL_PAD，阴影尾巴落在留白里不会被裁
          boxShadow: "0 4px 12px rgba(0,0,0,.18)",
          // 「从球所在的方位滴落铺开 / 收拢回去」：origin = 球心相对**视觉块**的坐标
          transformOrigin: origin
            ? `${origin.x - PANEL_PAD}px ${origin.y - PANEL_PAD}px`
            : "50% 100%",
          animation:
            anim === "bloom"
              ? `ohOrbBloom ${BLOOM_MS}ms cubic-bezier(.22,.9,.24,1)`
              : anim === "collapse"
                ? `ohOrbCollapse ${COLLAPSE_MS}ms cubic-bezier(.5,0,.75,0) forwards`
                : undefined,
          pointerEvents: anim === "collapse" ? "none" : "auto",
        }}
      >
        <div aria-hidden style={glassBlock({ border: "none" })} />
        {/* 顶部把手（用户口径 2026-10-11：内外悬浮窗最上面都要有个 handle，上下拖可拉长拉短）：
            36×5 圆角条、按下提亮；竖直拖动 → overlay_set_panel_height（Rust 侧夹 30%~80% 屏高并落盘）。
            把手自己的按压被 stopPropagation + 手势桥闸门挡住，不会误触发拖窗。 */}
        <div
          role="separator"
          aria-label="上下拖动调整悬浮窗高度"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDrag.current = {
              id: e.pointerId,
              y0: e.clientY,
              h0: Math.max(120, (typeof window !== "undefined" ? window.innerHeight : 0) - PANEL_PAD * 2),
            };
            lastPanelH.current = handleDrag.current.h0;
            try {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } catch {
              /* 旧内核无指针捕获：拖快了会跟丢，已尽力 */
            }
            setHandleDown(true);
          }}
          onPointerMove={(e) => {
            const d = handleDrag.current;
            if (!d || d.id !== e.pointerId) return;
            const avail = typeof window !== "undefined" ? window.screen.availHeight || window.innerHeight : 800;
            // 向上拖 = 变长（位移取负）；夹在屏高 30%~80%（与 Rust 同值，前端只为跟手）
            const next = Math.max(
              avail * PANEL_MIN_RATIO,
              Math.min(avail * PANEL_MAX_RATIO, d.h0 - (e.clientY - d.y0)),
            );
            if (Math.abs(next - lastPanelH.current) < 2) return;
            lastPanelH.current = next;
            void (async () => {
              try {
                const { invoke } = await import("@tauri-apps/api/core");
                await invoke("overlay_set_panel_height", { h: next });
              } catch {
                /* 非 Tauri/未注册：忽略 */
              }
            })();
          }}
          onPointerUp={() => {
            handleDrag.current = null;
            setHandleDown(false);
          }}
          onPointerCancel={() => {
            handleDrag.current = null;
            setHandleDown(false);
          }}
          style={{
            position: "relative", zIndex: 3, margin: "0 auto 6px", width: 36, height: 5,
            borderRadius: 999, cursor: "ns-resize", touchAction: "none",
            background: handleDown
              ? "var(--dsw-alias-label-secondary, rgba(0,0,0,.45))"
              : "color-mix(in srgb, var(--dsw-alias-label-secondary, rgba(0,0,0,.4)) 42%, transparent)",
            transition: "background .15s ease",
          }}
        />
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
                style={capsuleStyle(a.active)}
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
          placeholder="点击输入（可直接用系统听写说话）"
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
