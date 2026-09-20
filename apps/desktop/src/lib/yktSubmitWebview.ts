/**
 * R20-C1：雨课堂官方作答页「应用内 WebView」通道执行层（写操作入口的拉起动作）。
 *
 * 本阶段原生 UI 只做一件事：把用户送进**雨课堂官方作答页**——提交仍由官方页自身
 * 逻辑完成（官方页内的二次确认 / 截止与次数拦截原样保留，不替代、不绕过）。
 *
 * 通道（桌面端与移动端分别用现有能力）：
 *  - 桌面 Tauri：Rust `open_ykt_submit_window` 新建独立 WebView 窗口，加载前用 wry
 *    `set_cookie` 注入当前会话 Cookie，关闭窗口 emit `ykt-submit-closed`；
 *  - Android：同一命令转 onethu-mobile 插件 Kotlin `openWebModal`（全屏 Dialog WebView，
 *    桌面模式 UA），Cookie 走 `CookieManager.setCookie` 注入，关闭才 resolve；
 *  - 浏览器预览（非 Tauri）：明确报错，不静默吞。
 *
 * 安全口径：Cookie 只作 invoke 参数在内存中传递，**绝不打印 / 不落盘 / 不进 log_debug**；
 * 非 http(s) 一律拒绝（Rust / Kotlin 双侧再校验）。
 *
 * 关闭/返回后才 resolve —— 调用方据此重新拉取真实状态（禁止乐观更新）。
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./transport.js";

/** 打开应用内雨课堂官方作答页；用户关闭/返回后才 resolve。失败抛错（调用方展示）。 */
export async function openYktSubmitWebview(rawUrl: string, cookie: string): Promise<void> {
  if (!isTauri) throw new Error("应用内作答需在 OneTHU App 内使用（浏览器预览不可用）。");
  if (!/^https?:\/\//i.test(rawUrl)) throw new Error("官方作答页地址非法（仅允许 http(s)）。");

  // 先挂关闭事件（窗口可能在 invoke 返回后很快关闭）：关闭即 resolve。
  let unlisten: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => {
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen("ykt-submit-closed", () => resolve()))
      .then((un) => {
        unlisten = un;
      })
      .catch(() => resolve()); // 事件系统不可用：不悬挂（invoke 成功即视为已打开）
  });
  try {
    // cookie 仅在本次 invoke 参数中传递，不打印；关闭（按钮/返回键）才 resolve/emit。
    await invoke("open_ykt_submit_window", { url: rawUrl, cookie });
    await closed;
  } finally {
    unlisten?.();
  }
}
