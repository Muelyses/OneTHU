/**
 * OH 胶囊条（dev-explorer）：搜索与 OH 的**二合一触发器**（用户 2026-10-12 拍板）。
 *
 * 手势（与旧灵动岛同一套语义，手柄搬到这里）：
 *  - 短按（<450ms）→ requestOhPanel(prefs.capsuleTap)：按默认动作打开搜索模式或 OH 对话；
 *  - 按住跨过 450ms → requestOhVoice()：开始收音（ChatDock 的原位胶囊现出波纹/雾/字幕）；
 *    此时**仍在按住**＝对着说话（push-to-talk 的"按"）；
 *  - 松手 → 再发一条 requestOhVoice()：ChatDock 收到第二条 voice 命令＝收尾直发；
 *  - 按住期间向上拉 >110px → 松手发 requestOhPanel("oh")：ChatDock 视语音中的面板命令
 *    为「取消」（唯一能穿过 ohControl 契约的取消通道）。
 *
 * 纯触发器：不渲染面板、不持有任何 ChatDock 状态；未读徽标只读（useDockBadge）。
 * 摆位归宿主（底栏中央 / 桌面顶栏），这里只给形状与手势反馈。
 */
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { HarnessMark } from "../HarnessMark.js";
import { requestOhPanel, requestOhVoice } from "../../plugins/ohControl.js";
import { useDockBadge } from "../../plugins/ChatDock.js";
import { useExplorerPrefs } from "../../state/explorerPrefs.js";

/** 长按阈值（与 ChatDock 的 VOICE_HOLD_MS 同值；跨过即开始收音） */
const HOLD_MS = 450;
/** 上划取消位移（与 ChatDock 的 CANCEL_PULL_PX 同口径） */
const CANCEL_PULL_PX = 110;

export function OhCapsule(): React.ReactNode {
  const prefs = useExplorerPrefs();
  const badge = useDockBadge();
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
      requestOhVoice(); // 开始收音（ChatDock 的原位胶囊接管显示）
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
      // 未到阈值＝单击：按默认动作打开（search / oh）
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

  /** 指针捕获被 WebView 丢弃（来电/系统手势等）：pointerup 不会再到达。
   *  只在手势仍进行中才收场（正常松手后的释放事件直接忽略），语音绝不悬死。 */
  const onLostCapture = (): void => {
    if (holdTimer.current == null && !held && startY.current == null) return;
    const wasHeld = held;
    reset();
    if (wasHeld) requestOhPanel("oh"); // 已在收音：按取消收场
    /* 未到阈值就丢捕获的短按：丢弃（宁缺勿滥，不凭空开面板） */
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      requestOhPanel(prefs.capsuleTap);
    }
  };

  return (
    <button
      className={"ohx-capsule" + (pressing ? " is-press" : "") + (held ? " is-hold" : "")}
      aria-label="搜索与 OH（点击搜索，长按说话）"
      title="点击搜索 / OH（可设默认）；长按说话"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostCapture}
      onKeyDown={onKeyDown}
    >
      <HarnessMark size={15} />
      {badge > 0 && !held ? <span className="ohx-capsule-badge">{badge > 9 ? "9+" : badge}</span> : null}
    </button>
  );
}
