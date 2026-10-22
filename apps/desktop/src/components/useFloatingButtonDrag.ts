import { useRef, useState, type MouseEvent, type PointerEvent } from "react";

type FloatingButtonDragOptions<Position> = {
  position: Position;
  move: (start: Position, dx: number, dy: number, button: HTMLElement) => Position;
  onChange: (position: Position) => void;
  onCommit: (position: Position) => void;
  onPress?: () => void;
  onRelease?: () => void;
};
type Press<Position> = {
  x: number;
  y: number;
  start: Position;
  moved: boolean;
};

/** Shares HardRefreshButton's click slop and down/move/up behavior.
 * Do not add WebView isPrimary/buttons/capture-loss cancellation gates here. */
export function useFloatingButtonDrag<Position>(options: FloatingButtonDragOptions<Position>) {
  const latest = useRef(options);
  latest.current = options;
  const press = useRef<Press<Position> | null>(null);
  const position = useRef(options.position);
  if (!press.current) position.current = options.position;
  const pressedRef = useRef(false);
  const skipClick = useRef(false);
  const [dragging, setDragging] = useState(false);

  const onPointerMove = (event: PointerEvent<HTMLElement>): void => {
    const active = press.current;
    if (!active) return;
    const dx = event.clientX - active.x, dy = event.clientY - active.y;
    if (!active.moved) {
      if (Math.hypot(dx, dy) < (event.pointerType === "touch" ? 12 : 10)) return;
      active.moved = true;
    }
    position.current = latest.current.move(active.start, dx, dy, event.currentTarget);
    latest.current.onChange(position.current);
  };
  const onPointerDown = (event: PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    // A browser may omit the compatibility click after dragging. It must not
    // leave a stale skip flag that consumes the user's next real press.
    skipClick.current = false;
    position.current = latest.current.position;
    press.current = { x: event.clientX, y: event.clientY, start: position.current, moved: false };
    pressedRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    latest.current.onPress?.();
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>): void => {
    const active = press.current;
    if (!active) return;
    press.current = null;
    pressedRef.current = false;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (active.moved) {
      skipClick.current = true;
      latest.current.onCommit(position.current);
    }
    latest.current.onRelease?.();
  };
  const consumeClick = (event: MouseEvent<HTMLElement>): boolean => {
    if (event.detail === 0 || !skipClick.current) return false;
    skipClick.current = false;
    event.preventDefault();
    return true;
  };
  return { dragging, pressedRef, consumeClick, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}
