/**
 * 全局「长按内容 → 拖入暂存箱 / 发给 OH」交互层。
 *
 * 任何元素只要带 `data-vault-catch`（JSON: VaultCatch）就能被拖：
 * - 鼠标与触屏：按住 400ms 拾取，先移动则交给排序/滚动；
 * - 触屏：长按 400ms 启动（避免和滚动/点击冲突），启动后 pointermove 阻止默认滚动。
 *
 * 拖动中在 body 上挂一个跟随指针的 ghost，并显示 [data-vault-drop] 目标；
 * 松手后确认收纳/交接结果再飞向目标；取消或重复收纳回到来源，不投递或保留高亮。
 */
import { GESTURE, claimGesture, releaseGesture } from "../../lib/gestureArena.js";
import { cacheRemoteFileToVault } from "../../lib/vaultRemote.js";
import { addToVault, type VaultCatch } from "../../state/vault.js";
import { ohAsk } from "../../plugins/ChatDock.js";
import { showToast } from "../../state/toast.js";
import { vaultItemPresentation, VAULT_ICON_PATHS } from "./vaultItemPresentation.js";
import { beginVaultCardMotion, disposeVaultCardMotions, playVaultTakeout, type VaultDragMotion, type VaultMotionDestination } from "./vaultDragMotion.js";

export interface VaultDragState {
  active: boolean;
  hover: boolean;
  title: string;
  target?: "vault" | "oh";
}

let dragState: VaultDragState = { active: false, hover: false, title: "" };
const dragListeners = new Set<() => void>();
const emitDrag = (): void => dragListeners.forEach((f) => f());

export function subscribeVaultDrag(f: () => void): () => void {
  dragListeners.add(f);
  return () => dragListeners.delete(f);
}

export function vaultDragSnapshot(): VaultDragState {
  return dragState;
}

function setDrag(next: Partial<VaultDragState>): void {
  dragState = { ...dragState, ...next };
  emitDrag();
}

const GHOST_CLASS = "vault-drag-ghost";
const HOVER_CLASS = "is-vault-drop-hover";
const BODY_CLASS = "is-vault-dragging";

let ghost: HTMLDivElement | null = null;
let ghostMotion: VaultDragMotion | null = null;
let dragFromManager = false;
let targetEl: HTMLElement | null = null;
/** 拾取后必须掐断浏览器原生 HTML5 拖拽：否则 pointercancel 会中断我们的投递。 */
const blockNativeDrag = (e: DragEvent): void => { e.preventDefault(); };
let pointerId = -1;
let sourcesInstalled = false;

function dropTargetRect(el: HTMLElement): DOMRect {
  return el.getBoundingClientRect();
}

function hitDrop(x: number, y: number): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>("[data-vault-drop], [data-oh-drop]")) {
    const r = dropTargetRect(el);
    if (r.width && r.height && x >= r.left-20 && x <= r.right+20 && y >= r.top-20 && y <= r.bottom+20) return el;
  }
  return null;
}

function paint(x: number, y: number): void {
  if (!ghost) return;
  ghostMotion?.move(x, y);
  const hit = hitDrop(x, y);
  if (hit !== targetEl) {
    targetEl?.classList.remove(HOVER_CLASS);
    targetEl = hit;
    targetEl?.classList.add(HOVER_CLASS);
    setDrag({ hover: Boolean(targetEl), target: targetEl?.hasAttribute("data-oh-drop") ? "oh" : targetEl ? "vault" : undefined });
  }
}

function onMove(e: PointerEvent): void {
  if (e.pointerId !== pointerId) return;
  /* 触屏：拖动开始后必须阻止页面滚动；鼠标无副作用。 */
  if (e.pointerType !== "mouse" && e.cancelable) e.preventDefault();
  paint(e.clientX, e.clientY);
}

function endDrag(commit: boolean, x: number, y: number, cat: VaultCatch | null): void {
  const target = commit ? hitDrop(x, y) : null;
  const isOH = target?.hasAttribute("data-oh-drop") === true;
  // The scan widens the hit area; successful content lands in the actual box.
  const destinationEl = target && !isOH ? document.querySelector<HTMLElement>(".vault-box-button[data-vault-drop]") ?? target : target;
  const destination = destinationEl?.getBoundingClientRect();
  const motion = ghostMotion, fromManager = dragFromManager;
  ghost = null; ghostMotion = null; dragFromManager = false;
  window.removeEventListener("pointermove", onMove, true);
  window.removeEventListener("pointerup", onUp, true);
  window.removeEventListener("pointercancel", onCancel, true);
  window.removeEventListener("blur", cancelActiveDrag);
  document.removeEventListener("visibilitychange", cancelHiddenDrag);
  document.removeEventListener("dragstart", blockNativeDrag, true);
  document.body.classList.remove(BODY_CLASS);
  targetEl?.classList.remove(HOVER_CLASS);
  targetEl = null;
  pointerId = -1;
  pendingCat = null;
  releaseGesture("vault-drag");
  setDrag({ active: false, hover: false, title: "", target: undefined });
  let outcome: "store" | "oh" | "return" = "return";
  try {
    if (!commit || !cat) return;
    if (!target) {
      showToast("没放进暂存箱：拖到「暂存箱」目标上再松手");
      return;
    }
    if (isOH) {
      ohAsk(`请帮我处理这个来自 OneTHU 的内容：${cat.title}\n${JSON.stringify({type:cat.type,atom:cat.atom,board:cat.board,text:cat.text,summary:cat.sub,payload:cat.payload})}`);
      outcome = "oh";
      window.dispatchEvent(new CustomEvent("onethu:vault-handoff", { detail: { target: "oh", fromManager } }));
      return;
    }
    const r = addToVault(cat);
    if (r.ok) {
      outcome = "store";
      if (cat.remote && r.item) {
        showToast(`已收进暂存箱：${cat.title}（正在缓存到云盘…）`);
        void cacheRemoteFileToVault(r.item.id, cat.remote, cat.title);
      } else {
        showToast(`已收进暂存箱：${cat.title}`);
      }
    }
    else if (r.reason === "duplicate") showToast(`暂存箱里已经有「${cat.title}」了`);
    else showToast("暂存箱暂时不可用：稍后再试");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "内容交接失败，请重试");
  } finally {
    motion?.finish(outcome, destination, destinationEl ?? undefined);
  }
}

function onUp(e: PointerEvent): void {
  if (e.pointerId !== pointerId) return;
  endDrag(true, e.clientX, e.clientY, pendingCat);
}

function onCancel(e: PointerEvent): void {
  if (e.pointerId !== pointerId) return;
  cancelActiveDrag();
}

let pendingCat: VaultCatch | null = null;
function cancelActiveDrag(): void {
  if (dragState.active) endDrag(false, 0, 0, null);
}
function cancelHiddenDrag(): void {
  if (document.visibilityState === "hidden") cancelActiveDrag();
}

/** 从一次 pointer 位置启动拖动（供内部/测试调用；任意元素走 data-vault-catch 自动接线）。 */
export function beginVaultDrag(cat: VaultCatch, x: number, y: number, id = -1, source?: HTMLElement): boolean {
  if (dragState.active || !claimGesture("vault-drag")) return false;
  pointerId = id;
  pendingCat = cat;
  dragFromManager = !!source?.closest(".vault-manager");
  ghost = createGhost(cat, source?.closest(".vault-workspace") ? "vault" : "page");
  ghostMotion = beginVaultCardMotion(ghost, source ?? null, x, y);
  document.body.classList.add(BODY_CLASS);
  setDrag({ active: true, hover: false, title: cat.title, target: undefined });
  paint(x, y);
  window.addEventListener("pointermove", onMove, { capture: true });
  window.addEventListener("pointerup", onUp, { capture: true });
  window.addEventListener("pointercancel", onCancel, { capture: true });
  // The source may hand off capture while the pointer is still down (WebKit).
  // Window move/up keep tracking it; only explicit cancellation ends delivery.
  window.addEventListener("blur", cancelActiveDrag);
  document.addEventListener("visibilitychange", cancelHiddenDrag);
  document.addEventListener("dragstart", blockNativeDrag, true);
  return true;
}

function createGhost(cat: VaultCatch, origin: "vault" | "page"): HTMLDivElement {
  const presentation = vaultItemPresentation(cat), card = document.createElement("div"), inner = document.createElement("div");
  card.className = GHOST_CLASS; card.dataset.vaultTitle = cat.title; card.dataset.vaultOrigin = origin; card.setAttribute("aria-hidden", "true");
  inner.className = "vault-drag-card";
  const icon = document.createElement("span"), svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  icon.className = "vault-drag-ghost-icon";
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  path.setAttribute("d", VAULT_ICON_PATHS[presentation.icon] ?? VAULT_ICON_PATHS.inbox!); svg.append(path); icon.append(svg);
  const content = document.createElement("div"); content.className = "vault-drag-ghost-content";
  const badge = document.createElement("span");
  badge.className = "vault-drag-ghost-type";
  badge.textContent = [presentation.label, presentation.badge].filter(Boolean).join(" · ");
  const title = document.createElement("span");
  title.className = "vault-drag-ghost-title";
  title.textContent = cat.title;
  const detail = document.createElement("span"); detail.className = "vault-drag-ghost-detail"; detail.textContent = presentation.detail;
  content.append(badge, title); if (presentation.detail) content.append(detail);
  inner.append(icon, content); card.append(inner);
  return card;
}

/** Opening a stored item picks up a visual copy and keeps the original in its box. */
export function animateVaultTakeout(item: VaultCatch, origin: VaultMotionDestination): void {
  playVaultTakeout(createGhost(item, "vault"), origin);
}

/** 安装全局拖拽源识别（Layout 挂一次；返回清理）。 */
export function installVaultDragSources(): () => void {
  if (sourcesInstalled) return () => undefined;
  sourcesInstalled = true;
  let pending: { cat: VaultCatch; el: HTMLElement; x: number; y: number; pointerId: number; timer: number | null; armed: boolean } | null = null;
  let clickGuard: { el: HTMLElement; pointerId: number; swallow: (event: MouseEvent) => void; timer?: number } | null = null;

  const clear = (): void => {
    if (pending?.timer != null) window.clearTimeout(pending.timer);
    pending = null;
  };
  const clearClickGuard = (): void => {
    if (!clickGuard) return;
    window.removeEventListener("click", clickGuard.swallow, true);
    window.clearTimeout(clickGuard.timer);
    clickGuard = null;
  };
  const cancelSession = (): void => {
    clear(); cancelActiveDrag();
    // Blur/hidden can be followed by this very press's up/click when focus
    // returns. Keep its guard; a new pointerdown always clears it first.
  };
  const cancelHidden = (): void => {
    if (document.visibilityState === "hidden") cancelSession();
  };
  const arm = (): void => {
    if (!pending || pending.armed) return;
    if (!pending.el.isConnected || !beginVaultDrag(pending.cat, pending.x, pending.y, pending.pointerId, pending.el)) { clear(); return; }
    pending.armed = true;
    /* 拖动已经开始：吞掉这次元素自己的 click（否则松手会触发原按钮动作）。 */
    const el = pending.el;
    clearClickGuard();
    const swallow = (event: MouseEvent): void => {
      // Keyboard activation is a separate action, never the drag's compatibility click.
      if (event.detail === 0) return;
      if (event instanceof PointerEvent && event.pointerId > 0 && event.pointerId !== clickGuard?.pointerId) return;
      event.stopPropagation(); event.preventDefault(); clearClickGuard();
    };
    clickGuard = { el, pointerId: pending.pointerId, swallow };
    // A successful handoff can unmount the source before the compatibility click.
    // Capture globally so that same press cannot click through to the OH capsule.
    window.addEventListener("click", swallow, true);
  };

  const onDown = (e: PointerEvent): void => {
    if (e.isPrimary === false) {
      // A second finger belongs to scrolling/zooming, not a second pick-up.
      if (e.pointerType !== "mouse") { clear(); cancelActiveDrag(); }
      return;
    }
    lastPointerType = e.pointerType || "mouse";
    if (e.button !== undefined && e.button !== 0) return;
    // Recover a press whose release occurred outside the WebView.
    if (dragState.active) cancelActiveDrag();
    // A new physical press must never inherit a cancelled drag's click guard.
    clearClickGuard();
    clear();
    const target = e.target as Element | null;
    let el = target?.closest<HTMLElement>("[data-vault-catch]") ?? null;
    let cat: VaultCatch | null = null;
    if (el) {
      const raw = el.getAttribute("data-vault-catch");
      if (raw) {
        try { cat = JSON.parse(raw) as VaultCatch; } catch { cat = null; }
      }
    }
    /* 兜底：设置行没有逐条挂 data-vault-catch（SettingsRow 不转发属性），
       但 markSettingsRows 已打 data-set-id；长按即可收进暂存箱，标题用于以后反查。 */
    if (!cat) {
      const row = target?.closest<HTMLElement>('[data-set-id^="row-"]') ?? null;
      if (row) {
        const title = (row.querySelector<HTMLElement>(".og-settings-row-title,.setting-title")?.textContent ?? "").trim();
        if (title) {
          el = row;
          cat = { type: "payload", title, sub: "设置项", payload: { settingTitle: title }, source: "设置" };
        }
      }
    }
    /* 兜底：旧协议 data-ctx-atom（全局长按菜单的前身）。 */
    if (!cat) {
      const atomEl = target?.closest<HTMLElement>("[data-ctx-atom]") ?? null;
      const raw = atomEl?.getAttribute("data-ctx-atom");
      if (atomEl && raw) {
        try {
          const a = JSON.parse(raw) as { kind?: string; key?: string; title?: string };
          if (a?.kind && a?.key) {
            el = atomEl;
            cat = { type: "atom", title: a.title || a.kind, atom: { kind: a.kind, key: a.key }, source: "页面元素" };
          }
        } catch { /* ignore */ }
      }
    }
    if (!el || !cat?.title || target?.closest("input, textarea, select, [contenteditable=true], .free-toolbar, .free-handle, .free-drag-handle")) return;
    pending = { cat, el, x: e.clientX, y: e.clientY, pointerId: e.pointerId, timer: null, armed: false };
    pending.timer = window.setTimeout(arm, GESTURE.longPressMs);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!pending || e.pointerId !== pending.pointerId) return;
    if (pending.armed) return;
    const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
    /* 触摸端手指会抖：8px 太紧，长按还没到就被当滚动取消（手机上「长按没反应」的主因之一）。
       触摸放宽到 14px；鼠标仍是 8px。真正滑动 scrolling 仍会超过它。 */
    const slop = e.pointerType === "touch" ? 14 : GESTURE.longPressSlop;
    if (dist > slop) clear();
  };
  /** 安卓 WebView 长按会弹原生「复制/全选」菜单并取消指针：在可拖元素上直接吞掉 contextmenu。
      桌面右键菜单不在这里管（只有 touch 指针的 contextmenu 才吞）。 */
  let lastPointerType = "mouse";
  const onContextMenu = (e: MouseEvent): void => {
    if (lastPointerType !== "touch") return;
    const el = e.target as Element | null;
    if (clickGuard || pending?.el.contains(el) || el?.closest("[data-vault-catch]")) {
      e.preventDefault(); e.stopPropagation();
    }
  };
  const onRelease = (e: PointerEvent): void => {
    if (pending?.pointerId === e.pointerId) clear();
    if (clickGuard?.pointerId !== e.pointerId) return;
    // Losing capture can precede the same press's eventual up/click. An automatic
    // lostpointercapture after pointerup must not remove its compatibility guard.
    if (e.type === "lostpointercapture") return;
    if (e.type !== "pointerup") clearClickGuard();
    else {
      // Keep the guard through the compatibility click dispatched after pointerup.
      const guard = clickGuard;
      guard.timer = window.setTimeout(() => { if (clickGuard === guard) clearClickGuard(); }, 80);
    }
  };
  const lockTouch = (e: TouchEvent): void => {if (dragState.active && e.cancelable) e.preventDefault();};
  const escape = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    clear(); cancelActiveDrag();
    // Retain only this press's click guard until release or the next pointerdown.
  };
  document.addEventListener("touchmove",lockTouch,{passive:false});
  document.addEventListener("contextmenu",onContextMenu,{capture:true});
  window.addEventListener("keydown",escape);
  window.addEventListener("blur", cancelSession);
  document.addEventListener("visibilitychange", cancelHidden);
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", onRelease, true);
  document.addEventListener("pointercancel", onRelease, true);
  document.addEventListener("lostpointercapture", onRelease, true);
  return () => {
    cancelSession(); clearClickGuard(); disposeVaultCardMotions();
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onRelease, true);
    document.removeEventListener("pointercancel", onRelease, true);
    document.removeEventListener("lostpointercapture", onRelease, true);
    document.removeEventListener("touchmove",lockTouch);
    document.removeEventListener("contextmenu",onContextMenu,{capture:true} as never);
    window.removeEventListener("keydown",escape);
    window.removeEventListener("blur", cancelSession);
    document.removeEventListener("visibilitychange", cancelHidden);
    sourcesInstalled = false;
  };
}

/** 给任意元素生成 data 属性值（组件里展开用）。 */
export function vaultCatchAttr(cat: VaultCatch): string {
  return JSON.stringify(cat);
}
