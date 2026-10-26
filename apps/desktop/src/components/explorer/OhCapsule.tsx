import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { Badge, Grow, Input } from "@onethu/gui";
/**
 * OH 胶囊条（dev-explorer 二轮定稿）：**白色长条**，横在底栏中央、两端快贴住标签页与 OneGO。
 *
 * OneGUI 收编（dev3 换血）：外壳自挂 `data-og-scope="oh.capsule"`（档位在 ohCapsuleScope.ts
 * 经 og.defineScope 登记，由 OneGUI 管线调度）；徽标走 OG Badge、收音容器走 OG Grow、
 * 展开态输入走 OG Input（className="ohx-input" 供手势守卫与 explorer-ui 契约规则识别）；
 * 白长条本体的白底/描边由 explorer-ui.css 的 .ex-bbar-center 契约规则出（OneGUI 令牌桥）
 * 本文件不再持有任何外观样式。
 *
 * 三种本体形态（用户 2026-10-12 口径「胶囊本身变成输入框/显示波纹的语音胶囊」）：
 *  - 常态：HarnessMark + 占位文字「搜索或问小OH」（看起来像输入框的**按钮**，不是输入框）+ 未读徽标；
 *  - 展开（is-open，由 ChatDock 的 open+mode 驱动）：换成真输入框——面板搜索态=检索词、
 *    对话态=消息草稿（Enter 直发），与上方生长窗构成一个连续交互体；
 *  - 收音（is-hold，长按 ≥450ms 跨过阈值）：本体切换为原位波纹（VoiceBar 复用，
 *    点位动画引擎在 ChatDock，60fps 直写 DOM）；雾状识别字幕仍由 ChatDock 悬在条上方。
 *
 * 手势（与旧岛同语义，全部发 ohControl 命令，零面板内部依赖）：
 *  - 短按 → requestOhPanel(prefs.capsuleTap)：按默认动作开窗（窗从胶囊顶边长出来）；
 *  - 按住跨 450ms → requestOhVoice()（第一条：开始收音，ChatDock 同时弹窗）；
 *    松手 → requestOhVoice()（第二条：按 voiceTarget 直发/预填）；
 *  - 按住上划 >110px → 松手发 requestOhPanel("oh")：ChatDock 视语音中的面板命令为取消；
 *  - 展开态点击输入框本体不触发手势（打字、选词不误关窗）。
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { HarnessMark } from "../HarnessMark.js";
import { useOnePageStar } from "../Collect.js";
import { atomRefOfTab, StarGlyph } from "./TabStrip.js";
import { getTab, useExplorerState } from "../../state/explorer.js";
import { resolveTabTitle } from "../../state/tabTitles.js";
import { requestOhPanel, requestOhVoice } from "../../plugins/ohControl.js";
import {
  VoiceBar, useDockBadge, useDockUi,
  subscribeDockInput, dockInputSnapshot, setDockInputValue, dockSubmitInput,
} from "../../plugins/ChatDock.js";
import { useExplorerPrefs } from "../../state/explorerPrefs.js";
import { prefersReducedMotion } from "../../lib/motion.js";
import { useIslandText, ISLAND_DEFAULT_TEXT } from "../../state/island.js";
import "./ohCapsuleScope.js"; // OH 专属档位登记进 OneGUI 管线（scope: oh.capsule，受 OneGUI 调度）

/** 长按阈值（与 ChatDock 的 VOICE_HOLD_MS 同值；跨过即开始收音） */
const HOLD_MS = 450;
/** 胶囊展开/收起的文字 FLIP：170ms 对齐胶囊放大峰值（实测 173ms 达最大宽度）。 */
const CAPSULE_FLIP_MS = 170;
const CAPSULE_OPEN_EASE = "cubic-bezier(0.23, 1, 0.32, 1)"; // ease-out：居中 → 左
const CAPSULE_CLOSE_EASE = "cubic-bezier(0.23, 1, 0.32, 1)"; // 收起同样用 ease-out：左 → 居中
/** 上划取消位移（与 ChatDock 的 CANCEL_PULL_PX 同口径） */
const CANCEL_PULL_PX = 110;
const placeholderText = (): string => i18n("components.explorer.ohcapsule.searchPlaceholder");

export function OhCapsule(): React.ReactNode {
  const uiLocale = useUiLocale();

  const prefs = useExplorerPrefs();
  const badge = useDockBadge();
  const ui = useDockUi();
  const draft = useSyncExternalStore(subscribeDockInput, dockInputSnapshot, dockInputSnapshot);
  const voiceOn = ui.voice !== "off";
  const isOpen = ui.open && !voiceOn;
  /* 捞回很早的设定：胶囊显示当前紧急任务（临近课程/提醒窗口内 DDL）。
     无任务时回落静态占位。黑色显眼（--text-1），是内容不是灰暗示。 */
  const islandText = useIslandText();
  const smartText = islandText && islandText !== ISLAND_DEFAULT_TEXT ? islandText : null;
  const idleText = smartText ?? placeholderText();
  /* 展开态占位文字必须跟随当前面板模式（搜索 / OH / 清小搭），不能一律用搜索词。 */
  const openPlaceholder =
    ui.mode === "search" ? placeholderText()
      : ui.mode === "xiaoda" ? i18n("components.explorer.ohcapsule.c9ec33563d39")
        : i18n("components.explorer.ohcapsule.afa493184dbe");
  /* 常态/展开态共用同一段占位文字：点击时用 FLIP 从「居中」平滑滑到「左对齐」，
     而不是先卸载占位再让输入框凭空出现。 */
  const phRef = useRef<HTMLSpanElement | null>(null);
  const markWrapRef = useRef<HTMLSpanElement | null>(null);
  const lastRects = useRef<{ ph: DOMRect; mark: DOMRect; open: boolean } | null>(null);
  const animSeq = useRef(0);
  const [pressing, setPressing] = useState(false);
  const [rebounding, setRebounding] = useState(false);
  const reboundTimer = useRef<number | null>(null);
  const bounce = (): void => {
    if (reboundTimer.current != null) window.clearTimeout(reboundTimer.current);
    setRebounding(true);
    reboundTimer.current = window.setTimeout(() => setRebounding(false), 360);
  };
  useEffect(() => () => {
    if (reboundTimer.current != null) window.clearTimeout(reboundTimer.current);
    if (holdTimer.current != null) window.clearTimeout(holdTimer.current);
  }, []);
  /* 展开/收起时为占位文字与 (OH) 标尺补一段平移（FLIP）：起点/终点矩形只有运行时才知道，
     所以用 WAAPI 而不是 CSS transition（后者无法跨 position: static → absolute 变化）。
     170ms：胶囊弹性放大在 ~170ms 达到最大宽度（实测 731px / 173ms），文字正好同时抵达左端；
     再长就会和「缩回」阶段一起结束，看起来拖沓。 */
  useLayoutEffect(() => {
    const ph = phRef.current;
    const mark = markWrapRef.current;
    if (!ph || !mark || voiceOn) {
      lastRects.current = null;
      return;
    }
    const capsule = ph.closest(".ohx-capsule") as HTMLElement | null;
    /* 先取消上一段动画再测量：否则 getBoundingClientRect() 量到的是动画中的
       视觉位置（X/Y 都带偏移），下一次 FLIP 就会把「动画起点」当成布局位置，
       出现「文字先跳到搜索栏上方、再滑回来」的跳变。取消后元素立即回到
       当前状态的 CSS 目标位置，这次测量才是稳定的目标矩形。 */
    for (const anim of [...ph.getAnimations(), ...mark.getAnimations()]) anim.cancel();
    if (isOpen && capsule) {
      // 展开态：占位脱离 flex 流，压在 (OH) 标尺右侧；左边缘按标尺实测算，避免硬编码宽度
      const c = capsule.getBoundingClientRect();
      const m = mark.getBoundingClientRect();
      // 与胶囊 gap 同源（CSS gap 8px），不写死视觉间距
      const gap = Number.parseFloat(getComputedStyle(capsule).columnGap) || 8;
      ph.style.left = `${m.right - c.left + gap}px`;
    }
    const nowPh = ph.getBoundingClientRect();
    const nowMark = mark.getBoundingClientRect();
    const prev = lastRects.current;
    if (prev && prev.open !== isOpen && !prefersReducedMotion()) {
      // 只补横向位移：纵向由 CSS（static 居中线 / absolute top:50% -50%）固定，
      // 用户要的是「居中 ⇄ 左对齐」，不该有上下漂移。
      const base = isOpen ? "translateY(-50%)" : "none";
      const dx = prev.ph.left - nowPh.left;
      /* 展开（居中→左）用 ease-out：起步快、落位慢；收起（左→中）用 ease-in：
         先慢后快，像被"吸"回中间。170ms 与胶囊放大峰值对齐。 */
      const easing = isOpen ? CAPSULE_OPEN_EASE : CAPSULE_CLOSE_EASE;
      const seq = ++animSeq.current;
      // 文字在 overflow:hidden 的胶囊里横移：显式提升合成层，避免逐帧重绘导致掉帧
      ph.style.willChange = "transform";
      mark.style.willChange = "transform";
      const phAnim = ph.animate(
        [{ transform: isOpen ? `translate(${dx}px, -50%)` : `translate(${dx}px, 0)`, opacity: 0.65 }, { transform: base, opacity: 1 }],
        { duration: CAPSULE_FLIP_MS, easing, fill: "both" },
      );
      const mdx = prev.mark.left - nowMark.left;
      const markAnim = mark.animate(
        [{ transform: `translateX(${mdx}px)` }, { transform: "none" }],
        { duration: CAPSULE_FLIP_MS, easing, fill: "both" },
      );
      void Promise.allSettled([phAnim.finished, markAnim.finished]).then(() => {
        if (animSeq.current !== seq) return; // 已被下一段动画接管
        ph.style.willChange = "";
        mark.style.willChange = "";
      });
    }
    lastRects.current = { ph: nowPh, mark: nowMark, open: isOpen };
  }, [isOpen, voiceOn, draft]);
  const [held, setHeld] = useState(false); // 已跨过阈值（收音中，手还按着）
  const holdTimer = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const pulled = useRef(false);

  const reset = (): void => {
    if (holdTimer.current != null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    startY.current = null;
    pulled.current = false;
    setHeld(false);
    setPressing(false);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // 展开态：点在输入框上＝打字/选词，不是手势（否则一点就误关窗）
    if (isOpen && (e.target as HTMLElement).closest(".ohx-input")) return;
    startY.current = e.clientY;
    pulled.current = false;
    setRebounding(false);
    setPressing(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 无捕获也能用（收尾走 pointercancel/失焦兜底） */
    }
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      setHeld(true);
      requestOhVoice(); // 开始收音（ChatDock 同时弹窗；胶囊切波纹由 useDockUi 驱动）
    }, HOLD_MS);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const y0 = startY.current;
    if (y0 == null) return;
    if (y0 - e.clientY > CANCEL_PULL_PX) pulled.current = true; // 上划＝取消候选
  };

  const onPointerUp = (): void => {
    const wasHeld = held;
    const wasPulled = pulled.current;
    const hadTimer = holdTimer.current != null;
    reset();
    if (hadTimer) {
      bounce();
      // 未到阈值＝单击：按默认动作开窗；已开着且就在目标模式时 ChatDock 会收起（再点一下=收）
      requestOhPanel(prefs.capsuleTap);
      return;
    }
    if (wasHeld) {
      if (wasPulled) requestOhPanel("oh"); // 上划：穿过契约的取消通道
      else requestOhVoice(); // 松手直发（目标由 prefs.voiceTarget 决定）
    }
  };

  const onPointerCancel = (): void => {
    const wasHeld = held;
    reset();
    if (wasHeld) requestOhPanel("oh"); // 系统手势抢占：按取消收场
  };

  /** 指针捕获被 WebView 丢弃（来电/系统手势等）：只在手势仍进行中才收场，语音绝不悬死 */
  const onLostCapture = (): void => {
    if (holdTimer.current == null && !held && startY.current == null) return;
    const wasHeld = held;
    reset();
    if (wasHeld) requestOhPanel("oh");
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (e.target instanceof HTMLInputElement) return; // 输入框自己的键盘事件不归手势
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (e.repeat) return;
      bounce();
      requestOhPanel(prefs.capsuleTap);
    }
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      /* 对话态（OH / 清小搭）：胶囊里回车＝直发草稿；搜索态回车不抢跳（命中即时在窗里，留给用户挑） */
      if (ui.mode !== "search") dockSubmitInput();
    } else if (e.key === "Escape") {
      e.preventDefault();
      requestOhPanel(ui.mode); // 已开且同模式 → ChatDock 收窗（缩回胶囊）
    }
  };

  return (
    <button
      data-og-scope="oh.capsule"
      data-oh-drop
      data-tx="keep"
      className={
        "ohx-capsule" +
        (pressing ? " is-press" : "") +
        (rebounding ? " is-rebound" : "") +
        (held || voiceOn ? " is-hold is-voice" : "") +
        (isOpen ? " is-open" : "")
      }
      aria-label={voiceOn ? (ui.hint || i18n("components.explorer.ohcapsule.81f0f45f7ad2")) : isOpen ? i18n("components.explorer.ohcapsule.3e11141c195b") : i18n("components.explorer.ohcapsule.d134f5438ae2")}
      title={isOpen ? undefined : i18n("components.explorer.ohcapsule.245c82d696b4")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostCapture}
      onKeyDown={onKeyDown}
    >
      {!voiceOn && !isOpen ? <span className="ohx-slot" aria-hidden="true" /> : null}
      <span ref={markWrapRef} className="ohx-mark-wrap"><HarnessMark size={15} /></span>
      {voiceOn ? (
        /* 收音中：本体就是波纹条（点位动画引擎在 ChatDock，全局 .dock-wave-dot 直写）；
           容器用 OG Grow（flex:1 + min-width:0，OG 表件出布局），行为类名保留给契约 */
        <Grow className="ohx-capsule-voice">
          <VoiceBar hint={ui.hint} />
        </Grow>
      ) : isOpen ? (
        /* 展开态：真输入框——搜索态=检索词、对话态=消息草稿，与上方窗一个连续交互体。
           className="ohx-input" 挂回 OG Input 的壳上：Explorer-ui 契约的 .ohx-input 规则
           （去壳框/满宽）重新生效，同时 pointerDown 的 closest(".ohx-input") 守卫恢复可判 */
        <Input className="ohx-input" autoFocus value={draft} onChange={(value) => setDockInputValue(value)} onKeyDown={onInputKeyDown} aria-label={ui.mode === "xiaoda" ? i18n("components.explorer.ohcapsule.4d403cab80e6") : i18n("components.explorer.ohcapsule.3e11141c195b")} />
      ) : null}
      {!voiceOn ? (
        <span
          ref={phRef}
          className={"ohx-capsule-ph" + (isOpen ? " is-open" : "") + (isOpen && draft.trim() ? " is-typing" : "")}
          aria-hidden={isOpen || undefined}
        >
          {isOpen ? openPlaceholder : idleText}
        </span>
      ) : null}
      {badge > 0 && !voiceOn ? <Badge count={badge} tone="accent" className="ohx-capsule-badge" /> : null}
      {!voiceOn && !isOpen ? <CapsuleStar /> : null}
    </button>
  );
}

/** 胶囊里常驻的一星（像浏览器地址栏的星）：跟随当前激活标签；搜索展开时隐藏。状态机同 OnePage 一星 */
function CapsuleStar(): ReactNode {
  const uiLocale = useUiLocale();

  const { activeId } = useExplorerState();
  const tab = getTab(activeId);
  const isPage = !!tab && tab.kind === "page";
  const ref = isPage && tab ? atomRefOfTab(tab) : null;
  const title = isPage && tab ? resolveTabTitle(tab.page, tab.params) : { label: "", full: "" };
  const { lit, toggle } = useOnePageStar(ref, title.label, title.full);
  if (!ref) return null;
  const stop = (e: { stopPropagation: () => void; preventDefault: () => void }): void => {
    e.stopPropagation();
    e.preventDefault();
  };
  return (
    <span
      role="button"
      tabIndex={0}
      className={"ohx-star" + (lit ? " is-lit" : "")}
      aria-label={lit ? i18n("components.explorer.ohcapsule.825750d712cc") : i18n("components.explorer.ohcapsule.009a73342eab")}
      aria-pressed={lit}
      title={lit ? i18n("components.explorer.ohcapsule.cb013b74bfc3") : i18n("components.explorer.ohcapsule.82ae0981093e")}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        stop(e);
        void toggle();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          stop(e);
          void toggle();
        }
      }}
    >
      <StarGlyph />
    </span>
  );
}
