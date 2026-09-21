/**
 * 首次安装申请通知权限（R21 用户反馈）。
 *
 * 由来：寻迹页进入即主动请求定位权限，而通知权限从不主动询问——Android 13+
 * 未授权时提醒静默失效（用户只会觉得「提醒没响」）。系统权限本该在用户第一次
 * 真正需要它的时候问：装好应用、导览结束，就是那个时刻。
 *
 * 纪律：**一次性**。问过就写标记，被拒绝也不再反复弹（设置页仍如实展示状态，
 * 并提供跳系统设置的入口）；平台没有通知后端（如 Linux 桌面）时不写标记，
 * 换环境后仍有机会问。
 */
import { fetchNotifyBackend, fetchNotifyStatus } from "./notifyBridge.js";

const KEY = "onethu.notify.asked.v1";

export function notifyPermissionAsked(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === "1";
  } catch {
    return true; // 存不下就别反复弹
  }
}

function markAsked(): void {
  try {
    globalThis.localStorage?.setItem(KEY, "1");
  } catch {
    /* ignore */
  }
}

/** 一次性申请：返回本次是否拿到授权（已问过/无后端 → false，不抛错） */
export async function askNotifyPermissionOnce(): Promise<boolean> {
  if (notifyPermissionAsked()) return false;
  let backend = "none";
  try {
    backend = await fetchNotifyBackend();
  } catch {
    return false;
  }
  if (backend === "none") return false;
  markAsked();
  try {
    const st = await fetchNotifyStatus(true); // request=true → 触发系统授权弹窗
    return st.granted;
  } catch {
    return false;
  }
}
