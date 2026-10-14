/* OneGUI · 浮层族：Modal / Sheet / Drawer / Menu / ContextMenu / ActionSheet / Tooltip / Popover
 *
 * 共同点（必须一致，页面不许再自己写弹层）：
 *   · 一律 portal 到 body；遮罩点按可关（maskClose）；Escape 可关；打开锁滚动、焦点进面板；
 *   · 入场 og-pop-in/og-sheet-up，退场 og-pop-out/og-sheet-down（相位由 useExitPhase 管）；
 *   · 面一律 Surface overlay（皮肤换玻璃时自动跟着走）。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IconBtn } from "./button.js";
import { Icon } from "./chip.js";
import { cx, one, scopeProps, type OGSize } from "./kit.js";
import { Surface } from "./surface.js";
import { anchorRect, clampToViewport, Portal, useDismiss, useExitPhase, useFocusTrap, useScrollLock, type Rect } from "./exit.js";
import { useAxes } from "../pipeline/react.js";

/* ── 关闭按钮（浮层里统一的 ×） ─────────────────────────────────────── */
function CloseButton({ onClose }: { onClose: () => void }): ReactNode {
  return (
    <IconBtn label="关闭" variant="ghost" size="sm" onClick={onClose} icon={<Icon><path d="M6 6l12 12M18 6L6 18" /></Icon>} />
  );
}

/* ── Modal / Sheet ──────────────────────────────────────────────────── */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  foot?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** 点遮罩是否关闭（默认 true） */
  maskClose?: boolean;
  /** 强制形态（默认：手机底部抽屉、桌面居中弹窗） */
  form?: "modal" | "sheet";
  scope?: string;
  className?: string;
  children?: ReactNode;
}

export function Modal({ open, onClose, title, foot, size = "md", maskClose = true, form, scope, className, children }: ModalProps): ReactNode {
  const { mounted, closing } = useExitPhase(open);
  const ref = useRef<HTMLDivElement | null>(null);
  const platform = useAxes().platform;
  const asSheet = (form ?? (platform === "mobile" ? "sheet" : "modal")) === "sheet";

  useScrollLock(mounted);
  useFocusTrap(open, ref);
  useDismiss(open, onClose, ref, { clickOutside: maskClose });

  if (!mounted) return null;
  const panelCls = cx(
    asSheet
      ? one("sheet").state("closing", closing).toString()
      : one("modal").size(size).state("closing", closing).toString(),
    className,
  );

  return (
    <Portal>
      <div className="og-scrim" />
      <Surface
        level={0}
        overlay
        radius={asSheet ? "2xl" : "xl"}
        pad="none"
        className={panelCls}
        role="dialog"
        aria-modal="true"
      >
        {asSheet ? <div className="og-sheet-handle" /> : null}
        <div ref={ref} tabIndex={-1} className="og-modal-inner">
          {(title || !asSheet) ? (
            <div className="og-modal-head">
              <div className="og-modal-title">{title}</div>
              <CloseButton onClose={onClose} />
            </div>
          ) : null}
          <div className="og-modal-body">{children}</div>
          {foot ? <div className="og-modal-foot">{foot}</div> : null}
        </div>
      </Surface>
    </Portal>
  );
}

/* ── Drawer ─────────────────────────────────────────────────────────── */

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  title?: ReactNode;
  header?: ReactNode;
  foot?: ReactNode;
  scope?: string;
  className?: string;
  children?: ReactNode;
}

export function Drawer({ open, onClose, side = "right", title, header, foot, scope, className, children }: DrawerProps): ReactNode {
  const { mounted, closing } = useExitPhase(open);
  const ref = useRef<HTMLDivElement | null>(null);
  useScrollLock(mounted);
  useFocusTrap(open, ref);
  useDismiss(open, onClose, ref, { clickOutside: true });
  if (!mounted) return null;
  return (
    <Portal>
      <div className="og-scrim" />
      <Surface
        level={0}
        overlay
        radius="none"
        pad="none"
        role="dialog"
        aria-modal="true"
        className={cx(one("drawer").variant(side).state("closing", closing).toString(), "og-drawer", `og-drawer--${side}`, className)}
        {...scopeProps(scope)}
      >
        <div ref={ref} tabIndex={-1} className="og-drawer-inner">
          {header ?? (
            <div className="og-modal-head">
              <div className="og-modal-title">{title}</div>
              <CloseButton onClose={onClose} />
            </div>
          )}
          <div className="og-modal-body">{children}</div>
          {foot ? <div className="og-modal-foot">{foot}</div> : null}
        </div>
      </Surface>
    </Portal>
  );
}

/* ── Menu / ContextMenu / ActionSheet ───────────────────────────────── */

export type MenuItem = { id: string; label: ReactNode; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect?: () => void } | "separator";

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  /** 锚点：元素或矩形（右键菜单给坐标构造的矩形） */
  anchor?: HTMLElement | Rect | null;
  items: MenuItem[];
  /** 形态：anchored（锚定菜单）/ sheet（手机底部动作单） */
  form?: "anchored" | "sheet" | "float";
  /** float 形态时的坐标 */
  point?: { x: number; y: number };
  scope?: string;
  className?: string;
}

export function Menu({ open, onClose, anchor, items, form = "anchored", point, scope, className }: MenuProps): ReactNode {
  const { mounted, closing } = useExitPhase(open, 150);
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [activeIdx, setActiveIdx] = useState(-1);

  const place = useCallback(() => {
    const rect = point ? { top: point.y, left: point.x, width: 0, height: 0 } : anchorRect(anchor);
    if (!rect) return;
    setPos(clampToViewport(ref.current, rect, point ? "bottom-start" : "bottom-start"));
  }, [anchor, point]);

  useEffect(() => {
    if (!mounted) return;
    place();
    const onResize = (): void => place();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [mounted, place]);

  useDismiss(open, onClose, ref, { clickOutside: true });
  useFocusTrap(open, ref);

  const selectable = items.filter((it) => it !== "separator" && !it.disabled);

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setActiveIdx((i) => {
        const next = (i + dir + selectable.length) % Math.max(1, selectable.length);
        return next;
      });
    }
    if (e.key === "Enter" && activeIdx >= 0) {
      const item = selectable[activeIdx];
      if (item && item !== "separator") {
        item.onSelect?.();
        onClose();
      }
    }
  };

  if (!mounted) return null;

  const list = (
    <div ref={ref} tabIndex={-1} onKeyDown={onKey} className={cx("og-menu-list", className)}>
      {items.map((item, i) => item === "separator"
        ? <div key={`sep-${i}`} className="og-menu-sep" />
        : (
          <button
            key={item.id}
            type="button"
            className={cx(one("menu-item").state("danger", item.danger).state("active", selectable[activeIdx] === item).toString(), "og-menu-item")}
            disabled={item.disabled}
            onMouseEnter={() => setActiveIdx(selectable.indexOf(item))}
            onClick={() => { item.onSelect?.(); onClose(); }}
          >
            {item.icon ? <span className="og-menu-item-icon" aria-hidden="true">{item.icon}</span> : null}
            <span className="og-menu-item-label">{item.label}</span>
          </button>
        ))}
    </div>
  );

  if (form === "sheet") {
    return (
      <Portal>
        <div className="og-scrim" />
        <Surface
          overlay
          pad="none"
          radius="2xl"
          className={cx(one("sheet").state("closing", closing).toString(), "og-sheet")}
          {...scopeProps(scope)}
        >
          <div className="og-sheet-handle" />
          <div className="og-modal-body">{list}</div>
        </Surface>
      </Portal>
    );
  }

  return (
    <Portal>
      <Surface
        overlay
        pad="none"
        radius="lg"
        pos={pos}
        className={cx(one("menu").state("closing", closing).toString(), "og-menu", className)}
        {...scopeProps(scope)}
      >
        {list}
      </Surface>
    </Portal>
  );
}

export interface ContextMenuProps {
  /** 右键位置；null 表示关闭 */
  point: { x: number; y: number } | null;
  onClose: () => void;
  items: MenuItem[];
}

export function ContextMenu({ point, onClose, items }: ContextMenuProps): ReactNode {
  return <Menu open={Boolean(point)} onClose={onClose} items={items} form="anchored" point={point ?? undefined} />;
}

export interface ActionSheetProps extends Omit<MenuProps, "form"> {
  title?: ReactNode;
}

export function ActionSheet({ title, ...rest }: ActionSheetProps): ReactNode {
  const platform = useAxes().platform;
  return (
    <Menu
      {...rest}
      form={platform === "mobile" ? "sheet" : "float"}
      anchor={rest.anchor}
    />
  );
}

/* ── Tooltip ────────────────────────────────────────────────────────── */

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delayMs?: number;
}

export function Tooltip({ content, children, side = "top", delayMs = 400 }: TooltipProps): ReactNode {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    const el = tipRef.current;
    if (!rect || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const map: Record<string, { top: number; left: number }> = {
      top: { top: rect.top - h - 6, left: rect.left + rect.width / 2 - w / 2 },
      bottom: { top: rect.bottom + 6, left: rect.left + rect.width / 2 - w / 2 },
      left: { top: rect.top + rect.height / 2 - h / 2, left: rect.left - w - 6 },
      right: { top: rect.top + rect.height / 2 - h / 2, left: rect.right + 6 },
    };
    const p = map[side] ?? map.top!;
    setPos({ top: Math.max(4, Math.min(p.top, window.innerHeight - h - 4)), left: Math.max(4, Math.min(p.left, window.innerWidth - w - 4)) });
  }, [open, side]);

  const show = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delayMs);
  };
  const hide = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span ref={wrapRef} className="og-tooltip-host" onMouseEnter={show} onMouseLeave={hide} onFocusCapture={show} onBlurCapture={hide} onKeyDown={(e) => { if (e.key === "Escape") hide(); }}>
      {children}
      {open ? (
        <Portal>
          <div ref={tipRef} role="tooltip" className="og-tooltip" data-og-dynamic="overlay" style={{ top: pos?.top ?? 0, left: pos?.left ?? 0 }}>
            {content}
          </div>
        </Portal>
      ) : null}
    </span>
  );
}

/* ── Popover ────────────────────────────────────────────────────────── */

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor?: HTMLElement | Rect | null;
  scope?: string;
  className?: string;
  children: ReactNode;
}

export function Popover({ open, onClose, anchor, scope, className, children }: PopoverProps): ReactNode {
  const { mounted, closing } = useExitPhase(open);
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useDismiss(open, onClose, ref, { clickOutside: true });
  useEffect(() => {
    if (!mounted) return;
    const rect = anchorRect(anchor);
    if (rect) setPos(clampToViewport(ref.current, rect, "bottom-start"));
  }, [mounted, anchor]);
  if (!mounted) return null;
  return (
    <Portal>
      <Surface
        overlay
        pad="md"
        radius="lg"
        pos={pos}
        className={cx(one("popover").state("closing", closing).toString(), "og-popover", className)}
        {...scopeProps(scope)}
      >
        <div ref={ref}>{children}</div>
      </Surface>
    </Portal>
  );
}
