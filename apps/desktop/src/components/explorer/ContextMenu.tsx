/**
 * 标签页 / 工作区的右键就地菜单（浮层，贴着鼠标出现）。
 * 用法：右键时调用 openContextMenu(x, y, items)；由 ContextMenuHost 统一渲染（挂在 Layout）。
 * 点外部、Esc、滚动、窗口缩放时关闭。
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** 在该项前画一条分隔线 */
  sepBefore?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

let menu: MenuState | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((f) => f());
const subscribe = (f: () => void): (() => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
const snapshot = (): MenuState | null => menu;

export function openContextMenu(x: number, y: number, items: MenuItem[]): void {
  if (items.length === 0) return;
  menu = { x, y, items };
  emit();
}

export function closeContextMenu(): void {
  if (!menu) return;
  menu = null;
  emit();
}

export function ContextMenuHost(): ReactNode {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const ref = useRef<HTMLDivElement | null>(null);

  // 定位：超出视口时往回挪，别跑出窗口
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !state) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(state.x, window.innerWidth - r.width - 8);
    const y = Math.min(state.y, window.innerHeight - r.height - 8);
    el.style.left = Math.max(8, x) + "px";
    el.style.top = Math.max(8, y) + "px";
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onDown = (e: PointerEvent): void => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      closeContextMenu();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") closeContextMenu();
    };
    const onScroll = (): void => closeContextMenu();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [state]);

  if (!state) return null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="ex-ctxmenu"
      style={{ position: "fixed", left: state.x, top: state.y, zIndex: 9998 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((it, i) => (
        <div key={i}>
          {it.sepBefore ? <div className="ex-ctxmenu-sep" role="separator" /> : null}
          <button
            type="button"
            role="menuitem"
            className={"ex-ctxmenu-item" + (it.danger ? " is-danger" : "")}
            onClick={() => {
              closeContextMenu();
              it.onSelect();
            }}
          >
            {it.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
