/**
 * 通知与小组件的应用侧接线（无 UI，挂一个空组件即可）。
 *
 * 三件事：
 *   ① 启动调度链（通知 + 小组件），后端类型由原生 `notify_backend` 回答；
 *   ② 应用回到前台时取走「用户点的是哪个落点」（小组件/通知点击都会写这里）并导航；
 *   ③ 登出/卸载时收摊，避免残留定时器。
 *
 * 之所以单独成组件而不是塞进 App 根：这些副作用只在「已登录」后才该跑，
 * 且需要在路由上下文里拿到 navigate（点击通知要跳页）。
 */
import { useEffect, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../state/context.js";
import {
  detectNotifyBackend,
  ensureNotifyRuntime,
  ensureWidgetRuntime,
  releaseNotifyRuntimes,
} from "../state/notifySources.js";
import { parseWidgetTarget } from "../state/widgetTarget.js";

export function NotifyBridge(): ReactNode {
  const { status, navigate } = useApp();

  /* ① 调度链（Android：通知 + 小组件；macOS：通知；其余桌面平台后端未接 → 跳过） */
  useEffect(() => {
    if (status !== "ready") return;
    let alive = true;
    void (async () => {
      const kind = await detectNotifyBackend();
      if (!alive || kind === "none") return;
      try {
        await ensureNotifyRuntime();
        await ensureWidgetRuntime();
      } catch (e) {
        console.warn("[notify] 启动失败", e);
      }
    })();
    return () => {
      alive = false;
      releaseNotifyRuntimes();
    };
  }, [status]);

  /* ② 回到前台取走落点：小组件/通知点击先写进原生，这里消费并导航。
        小组件的落点是「页面 + 参数」（如「某收藏夹」= folder?folderId=f1），
        故要先拆开再导航，否则会跳到没有上下文的收藏夹首页。 */
  useEffect(() => {
    if (status !== "ready") return;
    const take = async (): Promise<void> => {
      if (document.visibilityState !== "visible") return;
      try {
        const raw = await invoke<{ ok?: boolean; target?: string }>("notify_take_target");
        const target = raw?.target ?? "";
        const parsed = parseWidgetTarget(target);
        if (parsed) navigate(parsed.page as never, parsed.params as never);
      } catch {
        /* 无后端的平台返回 not-implemented：静默 */
      }
    };
    document.addEventListener("visibilitychange", take);
    void take();      // 冷启动路径：App 由点击拉起时立刻消费
    return () => document.removeEventListener("visibilitychange", take);
  }, [status, navigate]);

  return null;
}
