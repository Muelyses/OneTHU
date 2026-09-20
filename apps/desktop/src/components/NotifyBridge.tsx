/**
 * 通知与小组件的应用侧接线（无 UI，挂一个空组件即可）。
 *
 * 三件事：
 *   ① 启动通知运行时（数据变化 → 重算计划 → 对齐原生排程），仅 Android 有后端；
 *   ② 应用回到前台时取走「用户点的是哪个落点」（小组件/通知点击都会写这里）并导航；
 *   ③ 卸载时停掉运行时，避免热重载/登出后残留定时器。
 *
 * 之所以单独成组件而不是塞进 App 根：这些副作用只在「已登录」后才该跑，
 * 且需要在路由上下文里拿到 navigate（点击通知要跳页）。
 */
import { useEffect, useRef, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../state/context.js";
import { startNotifyRuntime, startWidgetRuntime, type NotifyRuntimeHandle, type WidgetRuntimeHandle } from "../state/notifySources.js";

export function NotifyBridge(): ReactNode {
  const { status, navigate } = useApp();
  const runtimeRef = useRef<NotifyRuntimeHandle | null>(null);
  const widgetRef = useRef<WidgetRuntimeHandle | null>(null);

  /* ① 通知运行时（Android 才有后端；桌面端 macOS/Windows 接入后这里扩成三端判定） */
  useEffect(() => {
    if (status !== "ready") return;
    let alive = true;
    let started: NotifyRuntimeHandle | null = null;
    let widget: WidgetRuntimeHandle | null = null;
    void (async () => {
      try {
        const android = await invoke<boolean>("os_is_android");
        if (!alive || !android) return;
        started = startNotifyRuntime({
          invoke: (cmd, args) => invoke(cmd, args ?? {}),
          backendAvailable: true,
          onError: (m) => console.warn("[notify]", m),
        });
        runtimeRef.current = started;
        // 小组件与通知共用同一批触发时机，但推送独立（没有总开关，也不受静默时段影响）
        widget = startWidgetRuntime({
          invoke: (cmd, args) => invoke(cmd, args ?? {}),
          backendAvailable: true,
          onError: (m) => console.warn("[widget]", m),
        });
        widgetRef.current = widget;
      } catch {
        /* 探活失败：不启动（非致命，用户下次进设置页仍可手动应用） */
      }
    })();
    return () => {
      alive = false;
      started?.stop();
      widget?.stop();
      runtimeRef.current = null;
      widgetRef.current = null;
    };
  }, [status]);

  /* ② 回到前台取走落点：小组件/通知点击先写进原生，这里消费并导航 */
  useEffect(() => {
    if (status !== "ready") return;
    const take = async (): Promise<void> => {
      if (document.visibilityState !== "visible") return;
      try {
        const raw = await invoke<{ ok?: boolean; target?: string }>("notify_take_target");
        const target = raw?.target ?? "";
        if (target) navigate(target as never, {} as never);
      } catch {
        /* 桌面端 not-implemented：静默 */
      }
    };
    document.addEventListener("visibilitychange", take);
    void take();      // 冷启动路径：App 由点击拉起时立刻消费
    return () => document.removeEventListener("visibilitychange", take);
  }, [status, navigate]);

  return null;
}
