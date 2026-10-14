import { Input } from "@onethu/gui";
/**
 * OH 胶囊条（dev-explorer 二轮定稿）：**白色长条**，横在底栏中央、两端快贴住标签页与 OneGO。
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
import { useRef, useState, useSyncExternalStore, type ReactNode, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
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
import { useIslandText, ISLAND_DEFAULT_TEXT } from "../../state/island.js";

/** 长按阈值（与 ChatDock 的 VOICE_HOLD_MS 同值；跨过即开始收音） */
const HOLD_MS = 450;
/** 上划取消位移（与 ChatDock 的 CANCEL_PULL_PX 同口径） */
const CANCEL_PULL_PX = 110;
const PLACEHOLDER = "搜索或问小OH";

export function OhCapsule(): React.ReactNode {
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
  const idleText = smartText ?? PLACEHOLDER;
  const [pressing, setPressing] = useState(false);
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
      requestOhPanel(prefs.capsuleTap);
    }
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (ui.mode === "oh") dockSubmitInput(); // 对话态：胶囊里回车＝直发草稿
      // 搜索态：命中即时在上方窗里，回车不抢跳（留给用户挑）
    } else if (e.key === "Escape") {
      e.preventDefault();
      requestOhPanel(ui.mode); // 已开且同模式 → ChatDock 收窗（缩回胶囊）
    }
  };

  return (
    <button
      className={
        "ohx-capsule" +
        (pressing ? " is-press" : "") +
        (held || voiceOn ? " is-hold is-voice" : "") +
        (isOpen ? " is-open" : "")
      }
      aria-label={voiceOn ? (ui.hint || "松开直发，上划取消") : isOpen ? "搜索或问小OH" : "搜索与 OH（点击打开，长按说话）"}
      title={isOpen ? undefined : "点击打开搜索 / OH；长按说话"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostCapture}
      onKeyDown={onKeyDown}
    >
      {!voiceOn && !isOpen ? <span className="ohx-slot" aria-hidden="true" /> : null}
      <HarnessMark size={15} />
      {voiceOn ? (
        /* 收音中：本体就是波纹条（点位动画引擎在 ChatDock，全局 .dock-wave-dot 直写） */
        <span className="ohx-capsule-voice">
          <VoiceBar hint={ui.hint} />
        </span>
      ) : isOpen ? (
        /* 展开态：真输入框——搜索态=检索词、对话态=消息草稿，与上方窗一个连续交互体 */
        <Input autoFocus value={draft} onChange={(value) => setDockInputValue(value)} onKeyDown={onInputKeyDown} placeholder={PLACEHOLDER} aria-label="搜索或问小OH" />
      ) : (
        <span className="ohx-capsule-ph">{idleText}</span>
      )}
      {badge > 0 && !voiceOn ? <span className="ohx-capsule-badge">{badge > 9 ? "9+" : badge}</span> : null}
      {!voiceOn && !isOpen ? <CapsuleStar /> : null}
    </button>
  );
}

/** 胶囊里常驻的一星（像浏览器地址栏的星）：跟随当前激活标签；搜索展开时隐藏。状态机同 OnePage 一星 */
function CapsuleStar(): ReactNode {
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
      aria-label={lit ? "取消星标" : "收藏为 OnePage"}
      aria-pressed={lit}
      title={lit ? "取消星标：删除该 OnePage" : "一星：把当前页面收藏成 OnePage"}
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
