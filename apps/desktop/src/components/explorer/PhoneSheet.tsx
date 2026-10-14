/**
 * 手机底部抽屉的拖动把手 + 惯性吸附（seeking 两档：0.6vh / 0.94vh）。
 *
 * 自写 pointer 事件（Chromium 96 兼容，不依赖 overscroll 新 API）：
 *  - 按住把手竖直拖，面板高度跟手（往上 = 变高）；
 *  - 松手按**速度**与**就近**吸附到两档：上甩 → 全屏，下甩 → 半屏；
 *  - 档位存 state/phoneSheets.ts（palette 写法），下次打开沿用上次的档位。
 *
 * 使用方：TabDrawer / OneGoSheet / OnePageSurface（OnePage）的手机分支共用一份；
 * 档位值读取走 state/phoneSheets.ts 的 `useSheetSnap(id)`。
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { haptic } from "../../lib/haptics.js";
import { setSheetSnap, type PhoneSheetSnap } from "../../state/phoneSheets.js";

/** 松手判定阈值（px/ms）：越过即算甩动 */
const FLING_VY = 0.4;
/** 拖动允许的拉伸余量（相对高点档） */
const STRETCH = 0.03;

export interface SheetGripProps {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}

export interface SheetDrag {
  /** 跟手里的即时高度（px）；null = 未在拖（高度交给 CSS 档位类） */
  dragH: number | null;
  /** 本次手势正在拖把手 */
  dragging: boolean;
  /** 摊在把手元素上的 pointer 处理器 */
  gripProps: SheetGripProps;
}

export function useSheetDrag(
  sheetRef: { current: HTMLElement | null },
  opts: { id: string; lowRatio?: number; highRatio?: number },
): SheetDrag {
  const low = opts.lowRatio ?? 0.6;
  const high = opts.highRatio ?? 0.94;
  const [dragH, setDragH] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const st = useRef<{ y0: number; h0: number; lastY: number; lastT: number; vy: number } | null>(null);

  const down = (e: ReactPointerEvent<HTMLElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    st.current = { y0: e.clientY, h0: sheet.getBoundingClientRect().height, lastY: e.clientY, lastT: performance.now(), vy: 0 };
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 捕获失败也能拖：松手/cancel 仍会到 currentTarget */
    }
  };

  const move = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = st.current;
    if (!d) return;
    const now = performance.now();
    const dt = now - d.lastT;
    if (dt > 0) {
      const inst = (e.clientY - d.lastY) / dt;
      d.vy = d.vy * 0.6 + inst * 0.4; // 低通：甩动判定不被抖动带偏
    }
    d.lastY = e.clientY;
    d.lastT = now;
    const vh = window.innerHeight;
    const lo = Math.round(vh * (low * 0.85)); // 允许拉得比半屏矮一点（预感要收起）
    const hi = Math.round(vh * Math.min(high + STRETCH, 0.985));
    const next = Math.max(lo, Math.min(hi, d.h0 - (e.clientY - d.y0)));
    setDragH(Math.round(next));
  };

  const finish = (): void => {
    const d = st.current;
    st.current = null;
    setDragging(false);
    setDragH(null);
    if (!d) return;
    const vh = window.innerHeight;
    const lowPx = vh * low;
    const highPx = vh * high;
    const finalH = d.h0 - (d.lastY - d.y0);
    let snap: PhoneSheetSnap;
    if (d.vy < -FLING_VY) snap = "full";
    else if (d.vy > FLING_VY) snap = "half";
    else snap = finalH - lowPx > highPx - finalH ? "full" : "half";
    setSheetSnap(opts.id, snap);
    haptic("tick");
  };

  const gripProps: SheetGripProps = {
    onPointerDown: down,
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: finish,
  };
  return { dragH, dragging, gripProps };
}

/** 44px 触目标的把手：横条 + 中间小把手 pill，摊 useSheetDrag 的 gripProps。 */
export function PhoneSheetGrip({
  label,
  gripProps,
}: {
  label: string;
  gripProps: SheetGripProps;
}): ReactNode {
  return (
    <div className="ex-sheet-grip" role="separator" aria-label={label} tabIndex={0} {...gripProps}>
      <i className="ex-sheet-grip-pill" aria-hidden="true" />
    </div>
  );
}
