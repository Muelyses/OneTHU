/**
 * 通知的原生桥（通用层）：把 Tauri 命令收在一处，供设置页与插件 facade 共用。
 *
 * 分层的理由：`pluginNotify.ts` 是**插件语义**（id 前缀、归属、回收），本文件只做
 * 「调哪个命令、参数长什么样」。两者分开后，设置页不必为了查一次权限状态而引入
 * 插件 id 约定，插件侧也不必知道设置页存在。
 */
import { invoke } from "@tauri-apps/api/core";

export interface NativeNotifyStatus {
  ok: boolean;
  /** 平台后端：android / macos / windows / none */
  backend: string;
  granted: boolean;
  exact: boolean;
  reason?: string;
}

/** 查询后端类型（前端据此决定是否启动调度链） */
export async function fetchNotifyBackend(): Promise<string> {
  try {
    return await invoke<string>("notify_backend");
  } catch {
    return "none";
  }
}

/** 查权限/后端状态；`request=true` 时才发起授权请求（用户主动行为） */
export async function fetchNotifyStatus(request = false): Promise<NativeNotifyStatus> {
  const backend = await fetchNotifyBackend();
  if (backend === "none") {
    return { ok: false, backend, granted: false, exact: false, reason: "not-supported" };
  }
  try {
    const raw = (await invoke<Record<string, unknown>>("notify_permission", { request })) as {
      ok?: boolean; granted?: boolean; exact?: boolean; reason?: string;
    };
    return {
      ok: raw?.ok === true,
      backend,
      granted: raw?.granted === true,
      exact: raw?.exact !== false,
      reason: typeof raw?.reason === "string" ? raw.reason : undefined,
    };
  } catch (e) {
    return { ok: false, backend, granted: false, exact: false, reason: String(e).slice(0, 120) };
  }
}

/** 打开系统通知设置：`what` = channels（渠道，可带 channel）/ exact-alarm / app */
export async function openNotifySettings(what: "channels" | "exact-alarm" | "app", channel?: string): Promise<boolean> {
  try {
    const raw = (await invoke<Record<string, unknown>>("notify_open_settings", {
      what,
      channel: channel ?? "",
    })) as { ok?: boolean };
    return raw?.ok === true;
  } catch {
    return false;
  }
}

/** 立即发一条测试通知 */
export async function sendTestNotification(): Promise<boolean> {
  try {
    const raw = (await invoke<Record<string, unknown>>("notify_test")) as { ok?: boolean };
    return raw?.ok === true;
  } catch {
    return false;
  }
}
