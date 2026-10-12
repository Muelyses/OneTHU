/**
 * 当前页的「顶栏 chrome」（G1）：页面声明的返回目标 + 页面级操作菜单。
 *
 * 为什么是一份 module 级小 store 而不是 props/Context 值：
 *   顶栏（`Layout` 里 `.mobile-topbar`）与页面（`{children}`）是兄弟，页面级操作却由页面
 *   自己声明（`PageHead` 是唯一声明点，页内返回键的 `to`/`label` 也从它的 back 槽上取）。
 *   用「订阅 + 实时读」两段式，避开两个坑：
 *   · 快照（`pageChromeSnapshot`）只在「有没有返回键 / 有没有菜单」变化时换引用，
 *     `useSyncExternalStore` 不会因为每次渲染传新数组而打转；
 *   · 菜单项（含 onSelect 闭包）每次渲染都写进 live，点「···」时读的是**最新一次渲染**
 *     的闭包，不会点到上一帧的旧状态。
 */
import type { BackTarget } from "./app.js";
import type { CtxItem } from "../components/ContextMenu.js";

/** 页面级操作项：与长按菜单同一份结构（点「···」时直接喂给 ContextMenu.open） */
export type PageMenuItem = CtxItem;

interface Chrome {
  back: BackTarget | null;
  menu: PageMenuItem[];
}

interface ChromeSnapshot {
  hasBack: boolean;
  hasMenu: boolean;
  /** 菜单内容的签名（键 + 文案）。**内容**变化也要通知，否则顶栏会停在上一次"空菜单"的渲染上。 */
  menuSig: string;
}

/** 菜单签名：只认键与文案，不含 onSelect 闭包（每次渲染都会换引用）。 */
function sigOf(menu: readonly { key: string; label: string }[]): string {
  return menu.map((i) => i.key + ":" + i.label).join("|");
}

const EMPTY: Chrome = { back: null, menu: [] };
let live: Chrome = EMPTY;
let snapshot: ChromeSnapshot = { hasBack: false, hasMenu: false, menuSig: "" };
const listeners = new Set<() => void>();
/** 当前 chrome 的声明方（每个 PageHead 一个稳定 token）。 */
const DEFAULT_TOKEN: object = {};
let owner: object = DEFAULT_TOKEN;
/* 让 snapshot 初值带上签名，类型才完整（下面每次同步都会重算）。 */
snapshot = { hasBack: false, hasMenu: false, menuSig: "" };

/**
 * PageHead 每次渲染都同步一次；只有可见性（有无返回键/菜单）变化才通知顶栏重渲染。
 *
 * `token` 是该 PageHead 的稳定标识：**只有当前声明方的卸载才允许清空**（见 clearPageChrome）。
 */
export function syncPageChrome(next: Chrome, token: object = DEFAULT_TOKEN): void {
  owner = token;
  live = next;
  const hasBack = !!next.back;
  const hasMenu = next.menu.length > 0;
  const menuSig = sigOf(next.menu);
  /* 可见性**与内容**任一变化都通知：只比可见性时，"被清空又写回"会停在空渲染上
     （霖 2026-10-11：收起添加组件抽屉后顶栏「···」消失）。 */
  if (hasBack === snapshot.hasBack && hasMenu === snapshot.hasMenu && menuSig === snapshot.menuSig) return;
  snapshot = { hasBack, hasMenu, menuSig };
  for (const fn of listeners) fn();
}

/**
 * 页面卸载时清空：否则上一页的菜单会残留到下一页（返回键也会变成假可返回）。
 *
 * **但只清自己的**：页切换期间会有两代 PageHead 同时存在（旧页尚未卸载、新页已挂载），
 * 旧页的清理若照清不误，就会把新页刚写进去的 chrome 抹掉——而新页不会因此重渲染，
 * 于是顶栏一直读到空菜单：表现是「收起添加组件抽屉后，顶栏右上角的「···」消失」
 * （霖 2026-10-11 现场；实测关闭抽屉瞬间 live.menu 被清空，滚动重渲染也回不来）。
 */
export function clearPageChrome(token: object = DEFAULT_TOKEN): void {
  if (token !== owner) return;
  owner = DEFAULT_TOKEN;
  syncPageChrome(EMPTY, token);
}

export function subscribePageChrome(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function pageChromeSnapshot(): ChromeSnapshot {
  return snapshot;
}

/** 顶栏「···」被点开时读实时 chrome（菜单项与返回目标都要最新一次渲染的） */
export function readPageChrome(): Chrome {
  return live;
}
