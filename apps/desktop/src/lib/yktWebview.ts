/**
 * R18 24.2：雨课堂「官方网页登录」通道（应用内 WebView）前端桥。
 *
 * 背景：雨课堂官方登录页发短信前必须先过 TencentCaptcha / hCaptcha（交互式，纯接口不可行，
 * 见 R17 23.2）。本模块把「打开官方登录页 → 用户在其中完成扫码或手机号+图形验证码+短信 →
 * 读回 Cookie」封装成两个动作：
 *   - openYuketangWebLogin()：打开应用内原生 WebView 窗口（桌面 Tauri 窗口 / Android Dialog WebView）；
 *   - readYuketangWebCookies()：读取 `pro.yuketang.cn` 的 Cookie（含 HttpOnly），
 *     经 core 的 yuketangCookieFromHeader 补齐清华固定字段后返回可直接保存的凭据串。
 *
 * 取 Cookie 由用户点「我已登录，读取会话」触发（避免与页面跳转竞态）。
 * 读不到时抛错，调用方在 UI 里明确回退「高级：手动粘贴 Cookie」——绝不卡住。
 */
import { invoke } from "@tauri-apps/api/core";
import { yuketangCookieFromHeader } from "@onethu/core";
import { isTauri } from "./transport.js";

/** 读取失败时的统一回退提示（桌面端读不到 / Android 未取到会话均适用） */
export const YKT_WEB_FALLBACK_HINT =
  "读取失败。请在电脑浏览器登录 pro.yuketang.cn 后，用下方「高级：手动粘贴 Cookie」粘贴会话（浏览器 F12 → Application → Cookies）。";

/** 打开雨课堂官方登录窗口（已打开则聚焦）。非 Tauri 环境（浏览器预览）直接给出明确提示。 */
export async function openYuketangWebLogin(): Promise<void> {
  if (!isTauri) throw new Error("官方网页登录需在 OneTHU App 内使用（浏览器预览不可用）。");
  await invoke<string>("open_ykt_window");
}

/**
 * 读取官方登录窗口里的会话 Cookie 并补齐清华固定字段。
 * 未取到会话（空 / 无 sessionid）时抛错——调用方展示 {@link YKT_WEB_FALLBACK_HINT}。
 */
export async function readYuketangWebCookies(): Promise<string> {
  if (!isTauri) throw new Error("官方网页登录需在 OneTHU App 内使用（浏览器预览不可用）。");
  const raw = await invoke<string>("read_ykt_cookies");
  if (!raw || !/sessionid=/i.test(raw)) {
    throw new Error("尚未检测到雨课堂登录会话（请先在窗口内完成扫码或短信登录）。");
  }
  return yuketangCookieFromHeader(raw);
}

/** 关闭官方登录窗口（窗口不存在时静默忽略）。 */
export async function closeYuketangWebLogin(): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke("close_ykt_window");
  } catch {
    /* 窗口已由用户关闭 */
  }
}
