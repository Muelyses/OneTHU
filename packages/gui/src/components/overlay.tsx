/* ════════════════════════════════════════════════════════════════════════════
 * OneGUI · 浮层族（Overlay）—— 全站唯一的弹层模型
 *
 * 两种落点，一套语言：
 *   ① 模态族 = 遮罩 .og-scrim + 面板 .og-panel：Modal / Sheet / Drawer / ActionSheet
 *      只差修饰符（--bottom / --left / --right / --sm…），head / body / foot 解剖完全共用；
 *   ② 锚定族 = 定位壳 .og-floating + 浮层面 .og-float：Menu / ContextMenu / Popover / Tooltip
 *      共用同一份落位算法：优先方向 → 放不下就翻转 → 四边夹紧 → 给出可用 maxHeight。
 *
 * 为什么 portal 到 document.body：祖先只要有一个 transform / filter / will-change
 * （壳层动画、卡片悬浮、虚拟滚动），position: fixed 就变成"相对那个祖先"，浮层会跟着滚、跟着缩。
 *
 * 退场不靠"open=false 就卸载"：节点由 useExitPhase 多留一段播 is-closing 动画（见 exit.ts）。
 * Esc 只关最上面那层（浮层栈）：模态里开着菜单时一次 Esc 退一层。
 * 唯一的例外是锚定几何：top / left / maxHeight 由锚点矩形算出后内联，
 * 并且这些节点必须标 data-og-dynamic="overlay" —— 除此之外没有任何内联样式。
 * ══════════════════════════════════════════════════════════════════════════ */
import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode, type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useAxes } from "../pipeline/react.js";
import { IconBtn } from "./button.js";
import { useExitPhase } from "./exit.js";
import { IconX } from "./icons.js";
import { cx, one, scopeProps, type OGSize, type OneBase } from "./kit.js";

/* ══ 退场时长 ═════════════════════════════════════════════════════════════
 * 相位机在 exit.ts（useExitPhase），时长在 CSS（--og-dur-*）：两边同一个刻度，
 * 这里按家族各钉一个值，改令牌要同步改（模态族 = --og-dur-3，锚定族 = --og-dur-2）。 */

/** 模态族（Modal / Sheet / Drawer / ActionSheet）退场：styles/overlay.css 用 --og-dur-3 */
const EXIT_MODAL_MS = 260;
/** 锚定族（Menu / ContextMenu / Popover）退场：styles/overlay.css 用 --og-dur-2 */
const EXIT_FLOAT_MS = 180;

/* ══ 类型 ═════════════════════════════════════════════════════════════════ */

export type OverlaySide = "top" | "bottom" | "left" | "right";

/** 锚点矩形：与 DOMRect 结构兼容（ContextMenu 用坐标自己合成一个零尺寸矩形） */
export interface RectLike {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** 锚点：元素、实测矩形，或 null（无锚点时落在视口左上角并夹紧，不会跑到屏外） */
export type OverlayAnchor = HTMLElement | RectLike | null | undefined;

export interface Placement {
  top: number;
  left: number;
  maxHeight: number;
  /** 实际用上的方向（可能被翻转），决定浮层从哪一角长出来 */
  side: OverlaySide;
}

/** 菜单项：一个动作，或一条分隔线（Menu / ContextMenu / ActionSheet 共用同一份模型） */
export interface MenuAction {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** 危险动作（删除 / 忽略）：走语义红 */
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

export type MenuItem = MenuAction | "separator";

/* ══ 落位几何 ═════════════════════════════════════════════════════════════ */

/** 离视口四边的最少留白（= --og-space-2）：CSS 侧同一个口径，不写第三个值 */
const EDGE_MARGIN = 8;
/** 浮层与锚点之间的缝（= --og-space-1） */
const ANCHOR_GAP = 4;
/** Tooltip 出现的延迟：悬浮不该立刻弹，会变成噪声 */
export const TOOLTIP_DELAY_MS = 320;

const OPPOSITE: Record<OverlaySide, OverlaySide> = { top: "bottom", bottom: "top", left: "right", right: "left" };
/** 无锚点时的落点：视口左上角（随后仍会被夹紧） */
const POINT_RECT: RectLike = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };

function rectOf(anchor: OverlayAnchor): RectLike {
  if (!anchor) return POINT_RECT;
  if (typeof Element !== "undefined" && anchor instanceof Element) return anchor.getBoundingClientRect();
  return anchor as RectLike;
}

/** 唯一允许的内联样式：浮层几何。带它的节点必须标 data-og-dynamic="overlay" */
function dynamicStyle(p: Placement | null): CSSProperties | undefined {
  return p ? { top: p.top, left: p.left, maxHeight: p.maxHeight } : undefined;
}

/** 落位：优先 side，放不下翻到对面，最后四边夹紧并给出可用的 maxHeight（内容超高就内部滚） */
function placeFixed(rect: RectLike, w: number, h: number, prefer: OverlaySide, align: "start" | "center"): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const room: Record<OverlaySide, number> = {
    top: rect.top - ANCHOR_GAP - EDGE_MARGIN,
    bottom: vh - rect.bottom - ANCHOR_GAP - EDGE_MARGIN,
    left: rect.left - ANCHOR_GAP - EDGE_MARGIN,
    right: vw - rect.right - ANCHOR_GAP - EDGE_MARGIN,
  };
  const vertical = prefer === "top" || prefer === "bottom";
  const need = vertical ? h : w;
  let side: OverlaySide = prefer;
  if (room[side] < need && room[OPPOSITE[side]] > room[side]) side = OPPOSITE[side];

  const maxHeight = vertical ? Math.max(Math.min(room[side], vh - EDGE_MARGIN * 2), 0) : vh - EDGE_MARGIN * 2;
  const height = Math.min(h, maxHeight);
  const width = Math.min(w, vw - EDGE_MARGIN * 2);
  let top: number;
  let left: number;
  if (side === "bottom") {
    top = rect.bottom + ANCHOR_GAP;
    left = align === "center" ? rect.left + rect.width / 2 - width / 2 : rect.left;
  } else if (side === "top") {
    top = rect.top - ANCHOR_GAP - height;
    left = align === "center" ? rect.left + rect.width / 2 - width / 2 : rect.left;
  } else if (side === "right") {
    top = rect.top + rect.height / 2 - height / 2;
    left = rect.right + ANCHOR_GAP;
  } else {
    top = rect.top + rect.height / 2 - height / 2;
    left = rect.left - ANCHOR_GAP - width;
  }
  top = Math.max(EDGE_MARGIN, Math.min(top, Math.max(EDGE_MARGIN, vh - height - EDGE_MARGIN)));
  left = Math.max(EDGE_MARGIN, Math.min(left, Math.max(EDGE_MARGIN, vw - width - EDGE_MARGIN)));
  return { top: Math.round(top), left: Math.round(left), maxHeight: Math.round(maxHeight), side };
}

interface FloatingOptions {
  open: boolean;
  anchor: OverlayAnchor;
  side: OverlaySide;
  align: "start" | "center";
  /** 内容尺寸会变的东西（items 等）：变了要重新落位 */
  dep?: unknown;
}

/** 锚定落位：量浮层自身尺寸 → 算坐标 → 跟随滚动/缩放重算；未落位前保持隐藏，不闪一帧 */
function useFloating(opts: FloatingOptions): { ref: RefObject<HTMLDivElement | null>; placement: Placement | null } {
  const { open, anchor, side, align, dep } = opts;
  const ref = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const compute = useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    /* 尺寸取布局盒（offsetWidth/Height），不取 getBoundingClientRect：入场动画的
       transform 会污染后者，同一手势开第二次时会量到动画填充帧的尺寸、落位偏一截。 */
    const next = placeFixed(rectOf(anchor), el.offsetWidth, el.offsetHeight, side, align);
    setPlacement((prev) =>
      prev && prev.top === next.top && prev.left === next.left && prev.maxHeight === next.maxHeight && prev.side === next.side ? prev : next,
    );
  }, [anchor, side, align]);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    compute();
  }, [open, compute, dep]);

  useEffect(() => {
    if (!open) return;
    const onMove = (): void => compute();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true); /* 捕获：内层滚动容器也要跟随 */
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, compute]);

  return { ref, placement };
}

/* ══ 浮层栈与焦点契约 ═════════════════════════════════════════════════════ */

/* 栈里只有 id；Esc / 点外面只对最上面那层生效（否则一次 Esc 会把模态和它的菜单一起关掉）。 */
const layerStack: string[] = [];

function layerTop(id: string): boolean {
  return layerStack[layerStack.length - 1] === id;
}

function useLayer(id: string, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    layerStack.push(id);
    return () => {
      const i = layerStack.lastIndexOf(id);
      if (i >= 0) layerStack.splice(i, 1);
    };
  }, [id, open]);
}

/** Esc 关闭：捕获阶段 + 栈判定（同节点上的多个监听器 stopPropagation 拦不住，所以自己判栈） */
function useEscape(open: boolean, id: string, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || !layerTop(id)) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, id, onClose]);
}

/** 点外面即关（捕获阶段 pointerdown：触发器自己的 click 晚于它，由触发器负责切换开关） */
function useDismiss(open: boolean, id: string, ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!layerTop(id)) return;
      const el = ref.current;
      if (e.target instanceof Node && el && el.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, id, ref, onClose]);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/** 焦点契约：打开时把焦点送进浮层（autoFocus / 已有内部焦点的孩子优先），关闭时还给打开它的元素 */
function useLayerFocus(open: boolean, ref: RefObject<HTMLElement | null>, trap?: boolean): void {
  const owner = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const active = document.activeElement;
    owner.current = active instanceof HTMLElement ? active : null;
    if (!el.contains(active)) el.focus({ preventScroll: true });
    return () => {
      const back = owner.current;
      const node = ref.current;
      owner.current = null;
      if (!back || !back.isConnected) return;
      if (node && !node.contains(document.activeElement)) return; /* 焦点已被别处接管：不抢 */
      back.focus({ preventScroll: true });
    };
  }, [open, ref]);

  useEffect(() => {
    if (!open || !trap) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Tab") return;
      const el = ref.current;
      if (!el) return;
      const list = focusables(el);
      if (list.length === 0) {
        e.preventDefault();
        el.focus({ preventScroll: true });
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !el.contains(active))) {
        e.preventDefault();
        last.focus();
        return;
      }
      if (!e.shiftKey && (active === last || !el.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, ref, trap]);
}

/* 模态族打开时锁文档滚动：计数叠加，最外层关闭才解锁。走根节点上的类，不写内联样式。 */
let lockCount = 0;

function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    lockCount += 1;
    document.documentElement.classList.toggle("og-scroll-lock", true);
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) document.documentElement.classList.toggle("og-scroll-lock", false);
    };
  }, [active]);
}

/* ══ 类名：一律由 one() 生成 ══════════════════════════════════════════════ */

/** 浮层类名：定位壳（og-floating）+ 皮肤（og-float / og-tooltip）+ 状态 */
function floatingClass(p: {
  skin: "float" | "tooltip";
  side?: OverlaySide;
  placed: boolean;
  closing?: boolean;
  className?: string;
}): string {
  return cx(
    one("floating").state("placed", p.placed).toString(),
    one(p.skin).variant(p.side).state("closing", p.closing).toString(),
    p.className,
  );
}

/** 面板类名：共享外形 og-panel + 家族类（og-modal / og-sheet / og-drawer）+ 修饰符 + 状态 */
function panelClass(p: { name: string; variant?: string; size?: string; closing: boolean; className?: string }): string {
  return cx(
    "og-panel",
    one(p.name).variant(p.variant).size(p.size).state("closing", p.closing).toString(),
    p.className,
  );
}

/* ══ 模态族的壳：Modal / Sheet / Drawer / ActionSheet 共用同一份实现 ═══════ */

interface ShellProps {
  open: boolean;
  onClose: () => void;
  /** 家族类：modal / sheet / drawer */
  name: string;
  variant?: string;
  size?: string;
  scrimVariant?: string;
  title?: ReactNode;
  foot?: ReactNode;
  closeButton?: boolean;
  maskClose?: boolean;
  /** 无标题时给面板的无障碍名 */
  label: string;
  scope?: string;
  className?: string;
  bodyClassName?: string;
  /** 面板内第一件东西（Sheet 的抓手） */
  leading?: ReactNode;
  id?: string;
  testId?: string;
  children?: ReactNode;
}

function Shell(p: ShellProps): ReactNode {
  const { mounted, closing } = useExitPhase(p.open, EXIT_MODAL_MS);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const layerId = useId();
  const titleId = useId();
  /** 遮罩上按下的那一下必须也在遮罩上抬起才关（面板里拖选到外面不该关闭） */
  const maskDown = useRef(false);

  useLayer(layerId, p.open);
  useEscape(p.open, layerId, p.onClose);
  useLayerFocus(p.open, panelRef, true);
  useScrollLock(p.open);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      {...scopeProps(p.scope)}
      className={one("scrim").variant(p.scrimVariant).state("closing", closing).toString()}
      onMouseDown={(e) => {
        maskDown.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (!p.maskClose || e.target !== e.currentTarget || !maskDown.current) return;
        p.onClose();
      }}
    >
      <div
        ref={panelRef}
        id={p.id}
        className={panelClass({ name: p.name, variant: p.variant, size: p.size, closing, className: p.className })}
        role="dialog"
        aria-modal="true"
        aria-labelledby={p.title ? titleId : undefined}
        aria-label={p.title ? undefined : p.label}
        data-testid={p.testId}
        tabIndex={-1}
      >
        {p.leading}
        {p.title || p.closeButton !== false ? (
          <div className="og-panel-head">
            {p.title ? (
              <div className="og-panel-title" id={titleId}>
                {p.title}
              </div>
            ) : null}
            {p.closeButton !== false ? (
              <IconBtn className="og-panel-close" label="关闭" size="sm" icon={<IconX size="sm" />} onClick={p.onClose} />
            ) : null}
          </div>
        ) : null}
        <div className={cx("og-panel-body", p.bodyClassName)}>{p.children}</div>
        {p.foot ? <div className="og-panel-foot">{p.foot}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ── Modal ──────────────────────────────────────────────────────────────── */

export interface ModalProps extends OneBase {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  foot?: ReactNode;
  size?: OGSize;
  /** 点遮罩关闭（默认 true） */
  maskClose?: boolean;
  /** 右上角关闭按钮（默认 true） */
  closeButton?: boolean;
  children?: ReactNode;
}

/** 对话框：全站的唯一模态。portal 到 body，遮罩 + 面板，Esc / 遮罩 / 按钮三个出口都走退场相位 */
export function Modal({
  open, onClose, title, foot, size = "md", maskClose = true, closeButton = true, scope, className, children, ...rest
}: ModalProps): ReactNode {
  return (
    <Shell
      open={open}
      onClose={onClose}
      name="modal"
      size={size}
      title={title}
      foot={foot}
      closeButton={closeButton}
      maskClose={maskClose}
      label={rest["aria-label"] ?? "对话框"}
      scope={scope}
      className={className}
      id={rest.id}
      testId={rest["data-testid"]}
    >
      {children}
    </Shell>
  );
}

/* ── Sheet ──────────────────────────────────────────────────────────────── */

export interface SheetProps extends OneBase {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  foot?: ReactNode;
  size?: OGSize;
  maskClose?: boolean;
  closeButton?: boolean;
  children?: ReactNode;
}

/** 底部表：手机上是贴底通栏 + 抓手 + 安全区，桌面上退化成居中小面板（同一个 API） */
export function Sheet({
  open, onClose, title, foot, size = "md", maskClose = true, closeButton = true, scope, className, children, ...rest
}: SheetProps): ReactNode {
  const mobile = useAxes().platform === "mobile";
  return (
    <Shell
      open={open}
      onClose={onClose}
      name="sheet"
      variant={mobile ? "bottom" : "center"}
      size={mobile ? undefined : size}
      scrimVariant={mobile ? "sheet" : undefined}
      leading={mobile ? <span className="og-sheet-grip" aria-hidden="true" /> : null}
      title={title}
      foot={foot}
      closeButton={closeButton}
      maskClose={maskClose}
      label={rest["aria-label"] ?? "面板"}
      scope={scope}
      className={className}
      id={rest.id}
      testId={rest["data-testid"]}
    >
      {children}
    </Shell>
  );
}

/* ── Drawer ─────────────────────────────────────────────────────────────── */

export interface DrawerProps extends Omit<OneBase, "size"> {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  title?: ReactNode;
  foot?: ReactNode;
  maskClose?: boolean;
  closeButton?: boolean;
  children?: ReactNode;
}

/** 侧栏抽屉：只动 transform 滑入滑出，左右只差位移方向（同一份 CSS） */
export function Drawer({
  open, onClose, side = "right", title, foot, maskClose = true, closeButton = true, scope, className, children, ...rest
}: DrawerProps): ReactNode {
  return (
    <Shell
      open={open}
      onClose={onClose}
      name="drawer"
      variant={side}
      scrimVariant="drawer"
      title={title}
      foot={foot}
      closeButton={closeButton}
      maskClose={maskClose}
      label={rest["aria-label"] ?? "抽屉"}
      scope={scope}
      className={className}
      id={rest.id}
      testId={rest["data-testid"]}
    >
      {children}
    </Shell>
  );
}

/* ══ 菜单：列表本体（Menu / ContextMenu / ActionSheet 共用） ══════════════ */

function MenuItemList(p: {
  items: readonly MenuItem[];
  /** 选项 DOM id 前缀（键盘用它在列表里找落点） */
  listId: string;
  active: number | null;
  onHover: (i: number) => void;
  onPick: (i: number, item: MenuAction) => void;
  role?: string;
  label?: string;
}): ReactNode {
  return (
    <div
      className="og-menu-list"
      role={p.role ?? "presentation"}
      aria-label={p.label}
      onPointerLeave={() => p.onHover(-1)}
    >
      {p.items.map((item, i) =>
        item === "separator" ? (
          <div key={`sep-${i}`} className="og-menu-sep" role="separator" />
        ) : (
          <button
            key={item.id}
            id={`${p.listId}-${i}`}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={cx(
              "og-menu-item",
              item.danger ? "is-danger" : "",
              item.disabled ? "is-disabled" : "",
              p.active === i ? "is-active" : "",
            )}
            aria-disabled={item.disabled || undefined}
            onPointerEnter={() => {
              if (!item.disabled) p.onHover(i);
            }}
            onClick={() => {
              if (!item.disabled) p.onPick(i, item);
            }}
          >
            {item.icon ? (
              <span className="og-menu-icon" aria-hidden="true">
                {item.icon}
              </span>
            ) : null}
            <span className="og-menu-label">{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
}

/** 上下移动一格：跳过分隔线与禁用项，到头绕回 */
function step(items: readonly MenuItem[], from: number, dir: 1 | -1): number | null {
  const n = items.length;
  if (n === 0) return null;
  let i = from;
  for (let k = 0; k < n; k += 1) {
    i = (i + dir + n) % n;
    const it = items[i];
    if (it !== undefined && it !== "separator" && !it.disabled) return i;
  }
  return null;
}

interface MenuKeysOptions {
  open: boolean;
  items: readonly MenuItem[];
  active: number | null;
  setActive: (i: number) => void;
  onPick: (i: number, item: MenuAction) => void;
  listId: string;
  /** Tab 离开即关（菜单要；模态里的动作表不要） */
  closeOnTab: boolean;
  onClose: () => void;
  /** 有栈身份时只在最上层响应（动作表由壳负责，故可省） */
  layerId?: string;
}

/** 菜单键盘：↑↓ 移动（落点在选项上）、Home/End 到两端、Enter/Space 选中；Esc 由 useEscape 负责 */
function useMenuKeys(p: MenuKeysOptions): void {
  const { open, items, active, setActive, onPick, listId, closeOnTab, onClose, layerId } = p;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (layerId && !layerTop(layerId)) return;
      if (closeOnTab && e.key === "Tab") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
        const dir: 1 | -1 = e.key === "ArrowUp" ? -1 : 1;
        const from = active === null || active < 0 ? (dir === 1 ? -1 : 0) : active;
        const next = e.key === "Home" ? step(items, -1, 1) : e.key === "End" ? step(items, 0, -1) : step(items, from, dir);
        if (next === null) return;
        e.preventDefault();
        setActive(next);
        const el = document.getElementById(`${listId}-${next}`);
        if (el) {
          el.focus({ preventScroll: true });
          el.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        const idx = active === null || active < 0 ? step(items, -1, 1) : active;
        const it = idx === null ? undefined : items[idx];
        if (idx === null || it === undefined || it === "separator" || it.disabled) return;
        e.preventDefault();
        onPick(idx, it);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, items, active, setActive, onPick, listId, closeOnTab, onClose, layerId]);
}

interface AnchoredMenuProps {
  open: boolean;
  onClose: () => void;
  anchor: OverlayAnchor;
  items: readonly MenuItem[];
  title?: ReactNode;
  label: string;
  scope?: string;
  className?: string;
  id?: string;
  testId?: string;
}

/** 锚定菜单本体：Menu 给元素锚点，ContextMenu 给坐标合成的矩形 —— 落位与键盘只有这一份 */
function AnchoredMenu(p: AnchoredMenuProps): ReactNode {
  const { mounted, closing } = useExitPhase(p.open, EXIT_FLOAT_MS);
  const layerId = useId();
  const listId = useId();
  const [active, setActive] = useState<number | null>(null);
  /* 没给锚点时用"打开那一刻的焦点元素"（触发菜单的按钮通常就在那儿）；
     只在打开那一刻取一次快照 —— 之后的焦点变化不该让菜单自己挪位置。 */
  const [fallback, setFallback] = useState<RectLike | null>(null);
  const { ref, placement } = useFloating({
    open: p.open,
    anchor: p.anchor ?? fallback,
    side: "bottom",
    align: "start",
    dep: p.items.length,
  });
  const pick = useCallback(
    (_i: number, item: MenuAction): void => {
      item.onSelect?.();
      p.onClose();
    },
    [p.onClose],
  );

  useLayoutEffect(() => {
    if (!p.open || p.anchor) {
      setFallback(null);
      return;
    }
    const activeEl = document.activeElement;
    setFallback(activeEl instanceof Element && activeEl !== document.body && activeEl !== document.documentElement ? activeEl.getBoundingClientRect() : null);
  }, [p.open, p.anchor]);

  useLayer(layerId, p.open);
  useEscape(p.open, layerId, p.onClose);
  useDismiss(p.open, layerId, ref, p.onClose);
  useLayerFocus(p.open, ref);
  useMenuKeys({ open: p.open, items: p.items, active, setActive, onPick: pick, listId, closeOnTab: true, onClose: p.onClose, layerId });
  useEffect(() => {
    if (p.open) setActive(null);
  }, [p.open, p.items]);

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      id={p.id}
      {...scopeProps(p.scope)}
      className={cx(
        floatingClass({ skin: "float", side: placement?.side, placed: Boolean(placement), closing }),
        one("menu").toString(),
        p.className,
      )}
      role="menu"
      aria-label={p.label}
      tabIndex={-1}
      data-testid={p.testId}
      data-og-dynamic="overlay"
      style={dynamicStyle(placement)}
    >
      {p.title !== undefined && p.title !== null ? <div className="og-menu-title">{p.title}</div> : null}
      <MenuItemList items={p.items} listId={listId} active={active} onHover={setActive} onPick={pick} />
    </div>,
    document.body,
  );
}

export interface MenuProps extends Omit<OneBase, "size"> {
  open: boolean;
  onClose: () => void;
  /** 锚点：触发元素或它的实测矩形 */
  anchor?: OverlayAnchor;
  items: MenuItem[];
  /** 顶部标题行（长按菜单的"文件名"） */
  title?: ReactNode;
  /** 无障碍名；不给就用 title，再不给是"操作菜单" */
  label?: string;
}

/** 锚定菜单：贴着触发元素开，放不下自己翻转并夹进视口，点外面 / Esc / Tab 关闭 */
export function Menu({ open, onClose, anchor, items, title, label, scope, className, ...rest }: MenuProps): ReactNode {
  return (
    <AnchoredMenu
      open={open}
      onClose={onClose}
      anchor={anchor}
      items={items}
      title={title}
      label={label ?? (typeof title === "string" ? title : "操作菜单")}
      scope={scope}
      className={className}
      id={rest.id}
      testId={rest["data-testid"]}
    />
  );
}

export interface ContextMenuProps extends Omit<OneBase, "size"> {
  open: boolean;
  onClose: () => void;
  /** 视口坐标（右键 / 长按的落点） */
  x: number;
  y: number;
  items: MenuItem[];
  title?: ReactNode;
  label?: string;
}

/** 右键 / 长按菜单：与 Menu 同一个本体，只是锚点是一对坐标（零尺寸矩形） */
export function ContextMenu({ open, onClose, x, y, items, title, label, scope, className, ...rest }: ContextMenuProps): ReactNode {
  const anchor = useMemo<RectLike>(() => ({ top: y, left: x, right: x, bottom: y, width: 0, height: 0 }), [x, y]);
  return (
    <AnchoredMenu
      open={open}
      onClose={onClose}
      anchor={anchor}
      items={items}
      title={title}
      label={label ?? "操作菜单"}
      scope={scope}
      className={className}
      id={rest.id}
      testId={rest["data-testid"]}
    />
  );
}

/* ── ActionSheet ────────────────────────────────────────────────────────── */

export interface ActionSheetProps extends Omit<OneBase, "size"> {
  open: boolean;
  onClose: () => void;
  items: MenuItem[];
  title?: ReactNode;
  /** 底部"取消"行（手机上的动作表惯例；不给就不渲染） */
  cancelLabel?: string;
  maskClose?: boolean;
}

/** 动作表：手机上就是贴底的动作列表，桌面上收成居中面板（图片操作 / 附件操作那类流程） */
export function ActionSheet({
  open, onClose, items, title, cancelLabel, maskClose = true, scope, className, ...rest
}: ActionSheetProps): ReactNode {
  const mobile = useAxes().platform === "mobile";
  const listId = useId();
  const [active, setActive] = useState<number | null>(null);
  const pick = useCallback(
    (_i: number, item: MenuAction): void => {
      item.onSelect?.();
      onClose();
    },
    [onClose],
  );

  useMenuKeys({ open, items, active, setActive, onPick: pick, listId, closeOnTab: false, onClose });
  useEffect(() => {
    if (open) setActive(null);
  }, [open, items]);

  return (
    <Shell
      open={open}
      onClose={onClose}
      name="sheet"
      variant={mobile ? "bottom" : "center"}
      size={mobile ? undefined : "md"}
      scrimVariant={mobile ? "sheet" : undefined}
      leading={mobile ? <span className="og-sheet-grip" aria-hidden="true" /> : null}
      title={title}
      closeButton={!mobile}
      maskClose={maskClose}
      label={rest["aria-label"] ?? "操作"}
      scope={scope}
      className={className}
      bodyClassName="og-action-body"
      id={rest.id}
      testId={rest["data-testid"]}
    >
      <MenuItemList items={items} listId={listId} active={active} onHover={setActive} onPick={pick} role="menu" label={typeof title === "string" ? undefined : "操作"} />
      {cancelLabel ? (
        <>
          <div className="og-menu-sep" role="separator" />
          <button type="button" className="og-menu-item og-action-cancel" onClick={onClose}>
            <span className="og-menu-label">{cancelLabel}</span>
          </button>
        </>
      ) : null}
    </Shell>
  );
}

/* ── Tooltip ────────────────────────────────────────────────────────────── */

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: OverlaySide;
  /** 悬浮多久才显示（默认 TOOLTIP_DELAY_MS） */
  delay?: number;
  scope?: string;
  className?: string;
  id?: string;
}

/** 提示气泡：悬浮 / 聚焦后延迟出现，Esc、移开、失焦即消失；不吃指针，永不挡住它标注的东西 */
export function Tooltip({ content, children, side = "top", delay = TOOLTIP_DELAY_MS, scope, className, id }: TooltipProps): ReactNode {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<number | null>(null);
  const layerId = useId();
  const { ref, placement } = useFloating({ open, anchor: hostRef.current, side, align: "center" });

  const clear = useCallback((): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const show = useCallback((): void => {
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setOpen(true);
    }, delay);
  }, [delay]);
  const hide = useCallback((): void => {
    clear();
    setOpen(false);
  }, [clear]);

  useEffect(() => clear, [clear]);
  useLayer(layerId, open);
  useEscape(open, layerId, hide);

  return (
    <>
      <span
        ref={hostRef}
        {...scopeProps(scope)}
        className={cx("og-tooltip-anchor", className)}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => {
          if (e.key === "Escape") hide();
        }}
      >
        {children}
      </span>
      {open && content !== undefined && content !== null && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={ref}
              id={id}
              className={floatingClass({ skin: "tooltip", side: placement?.side, placed: Boolean(placement) })}
              role="tooltip"
              data-og-dynamic="overlay"
              style={dynamicStyle(placement)}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/* ── Popover ────────────────────────────────────────────────────────────── */

export interface PopoverProps extends Omit<OneBase, "size"> {
  open: boolean;
  onClose: () => void;
  anchor: OverlayAnchor;
  children?: ReactNode;
  side?: OverlaySide;
  align?: "start" | "center";
  label?: string;
}

/** 锚定浮层：内容自己管，壳提供浮层面 + 落位 + 点外面 / Esc 关闭 */
export function Popover({
  open, onClose, anchor, children, side = "bottom", align = "start", label, scope, className, ...rest
}: PopoverProps): ReactNode {
  const { mounted, closing } = useExitPhase(open, EXIT_FLOAT_MS);
  const layerId = useId();
  const { ref, placement } = useFloating({ open, anchor, side, align });

  useLayer(layerId, open);
  useEscape(open, layerId, onClose);
  useDismiss(open, layerId, ref, onClose);
  useLayerFocus(open, ref);

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      id={rest.id}
      {...scopeProps(scope)}
      className={cx(
        floatingClass({ skin: "float", side: placement?.side, placed: Boolean(placement), closing }),
        one("popover").toString(),
        className,
      )}
      role="dialog"
      aria-label={rest["aria-label"] ?? label ?? "浮层"}
      tabIndex={-1}
      data-testid={rest["data-testid"]}
      data-og-dynamic="overlay"
      style={dynamicStyle(placement)}
    >
      {children}
    </div>,
    document.body,
  );
}
