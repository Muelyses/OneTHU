/**
 * 「给某块小组件绑内容」的请求总线。
 *
 * 三种发起方：桌面上点未绑定的小组件（原生把落点写成 widget-config:<id>）、收藏夹页的
 * 「上桌面」、原子长卡上的「桌」。它们分散在不同组件里，而绑定层只有一份（要显示实例清单、
 * 要选原子、要写配置），所以用一个极小的请求队列把它们汇到一处：写请求 → 绑定层弹出。
 */
import { useEffect, useState } from "react";
import type { AtomRef } from "./favorites.js";

export type BindRequest =
  /** 给这一块（appWidgetId）选内容 */
  | { to: "instance"; id: string }
  /** 把某个收藏夹放上桌面：先问放到哪一块 */
  | { to: "pick"; binding: { kind: "folder"; folderId: string } }
  /** 把某个原子放上桌面（详情 / 快捷方式）：先问放到哪一块 */
  | { to: "pick"; binding: { kind: "detail" | "shortcut"; atom: AtomRef } };

let pending: BindRequest | null = null;
const listeners = new Set<() => void>();

export function requestWidgetBind(req: BindRequest): void {
  pending = req;
  for (const fn of [...listeners]) fn();
}

export function clearWidgetBind(): void {
  pending = null;
  for (const fn of [...listeners]) fn();
}

export function currentWidgetBind(): BindRequest | null {
  return pending;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 绑定层的挂载点用它订阅待处理请求 */
export function useWidgetBindRequest(): BindRequest | null {
  const [req, setReq] = useState<BindRequest | null>(() => currentWidgetBind());
  useEffect(() => subscribe(() => setReq(currentWidgetBind())), []);
  return req;
}
