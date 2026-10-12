/**
 * 白板画笔层（SVG 覆盖在画布上）。
 *
 * penOn=false：只渲染已有笔迹（pointer-events 全关，不碰组件交互）。
 * penOn=true：层接管指针，按下起笔、移动跟手、松手定稿；取消/滚动仍交给外层
 * （touch-action 只在落笔后置 none，静止按住不拦截页面滚动）。
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  PEN_COLORS,
  addStroke,
  penKeyOf,
  penSnapshot,
  strokesOf,
  subscribePen,
  type PenStroke,
} from "../state/boardPen.js";

export function BoardPenLayer({
  boardId,
  orientation,
  penOn,
  color,
}: {
  boardId: string;
  orientation: string;
  penOn: boolean;
  color: string;
}): ReactNode {
  const snap = useSyncExternalStore(subscribePen, penSnapshot, penSnapshot);
  const key = penKeyOf(boardId, orientation);
  const strokes = strokesOf(key);
  const hostRef = useRef<SVGSVGElement | null>(null);
  const [live, setLive] = useState<number[] | null>(null); // 正在画的那笔
  const liveRef = useRef<number[] | null>(null);
  liveRef.current = live;

  useEffect(() => {
    if (!penOn) return;
    const el = hostRef.current;
    if (!el) return;
    let drawing = false;
    const toPoints = (e: PointerEvent): { x: number; y: number } | null => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return {
        x: Math.min(1000, Math.max(0, ((e.clientX - r.left) / r.width) * 1000)),
        y: Math.min(1000, Math.max(0, ((e.clientY - r.top) / r.height) * 1000)),
      };
    };
    const down = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      const p = toPoints(e);
      if (!p) return;
      e.preventDefault();
      drawing = true;
      el.setPointerCapture(e.pointerId);
      setLive([p.x, p.y]);
    };
    const move = (e: PointerEvent): void => {
      if (!drawing) return;
      const p = toPoints(e);
      if (!p) return;
      const cur = liveRef.current ?? [];
      // 抽稀：与上一斗间距 <0.4% 的点丢弃（跟手且省体积）
      const n = cur.length;
      if (n >= 2) {
        const px = cur[n - 2];
        const py = cur[n - 1];
        if (px !== undefined && py !== undefined) {
          const dx = p.x - px;
          const dy = p.y - py;
          if (dx * dx + dy * dy < 16) return;
        }
      }
      setLive([...cur, p.x, p.y]);
    };
    const up = (): void => {
      if (!drawing) return;
      drawing = false;
      const pts = liveRef.current;
      setLive(null);
      if (pts && pts.length >= 4) {
        addStroke(key, { id: "s" + Date.now().toString(36), color, w: 2.5, pts });
      }
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [penOn, key, color]);

  const all: PenStroke[] = live ? [...strokes, { id: "__live", color, w: 2.5, pts: live }] : strokes;
  return (
    <svg
      ref={hostRef}
      className={"board-pen" + (penOn ? " is-on" : "")}
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {all.map((s) => (
        <polyline
          key={s.id}
          points={s.pts.reduce<string[]>((acc, v, i) => {
            if (i % 2 === 0) acc.push(String(v));
            else acc[acc.length - 1] += "," + v;
            return acc;
          }, []).join(" ")}
          fill="none"
          stroke={s.color}
          strokeWidth={s.w}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}
    </svg>
  );
}

/** 画笔小浮条：颜色三选 + 撤销 + 清空（penOn 时挂在画布右上） */
export function BoardPenToolbar({
  color,
  onColor,
  onUndo,
  onClear,
  canUndo,
}: {
  color: string;
  onColor: (c: string) => void;
  onUndo: () => void;
  onClear: () => void;
  canUndo: boolean;
}): ReactNode {
  return (
    <div className="board-pen-toolbar" role="toolbar" aria-label="画笔">
      {PEN_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={"board-pen-swatch" + (c === color ? " is-on" : "")}
          style={{ background: c }}
          aria-pressed={c === color}
          aria-label={"画笔颜色 " + c}
          onClick={() => onColor(c)}
        />
      ))}
      <button type="button" className="board-pen-act" onClick={onUndo} disabled={!canUndo}>
        撤销
      </button>
      <button type="button" className="board-pen-act" onClick={onClear}>
        清空
      </button>
    </div>
  );
}
