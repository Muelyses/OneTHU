/**
 * R20-A：外部作业「桌面模式」内嵌浏览（移动端救急）前端分流。
 *
 * 背景：雨课堂等外部作业的官方网页版未做移动适配，移动端此前点击详情链接
 * 直接丢给系统浏览器（页面小字、来回切换）。本模块把「外部作业条目的链接
 * 点击」改道：
 *  - Android 宿主（isTauri + isAndroidNavigator 多信号判定，见 ./androidHost.ts）
 *    → invoke `open_web_modal`：Kotlin 全屏 Dialog WebView 以桌面模式打开
 *    （桌面 UA + useWideViewPort/概览模式 + 可缩放 + 第三方 Cookie），
 *    底部固定「在系统浏览器打开」（ACTION_VIEW 兜底）与「关闭」；
 *  - 桌面端 / 浏览器预览 → 保持现状 openExternal（系统浏览器）。
 *
 * 只读浏览：不注入脚本、不回读 Cookie、零数据链路改动；与 R18 雨课堂登录
 * 通道（openYktWebLogin）各自独立 WebView，互不影响。
 * 非 http(s) 一律拒绝（不开 WebView 也不交系统浏览器）。
 *
 * 通道判定抽成纯函数 pickExtHwOpenChannel（./androidHost.ts，零依赖可单测）；
 * 本文件只做真实打开动作，包装层遇到 open_web_modal 失败（桌面 stub / 通道
 * 异常）时降级回系统浏览器，绝不把链接吞掉。
 */
import { invoke } from "@tauri-apps/api/core";
import { pickExtHwOpenChannel } from "./androidHost.js";
import { isTauri } from "./transport.js";
import { openExternal } from "../pages/info/openExternal.js";

/** 外部作业（雨课堂等）详情链接点击的统一入口。 */
export async function openExternalHomework(rawUrl: string): Promise<void> {
  const nav = typeof navigator === "undefined" ? null : navigator;
  const channel = pickExtHwOpenChannel(nav, rawUrl, isTauri);
  if (channel === "reject") {
    // 非 http(s)：拒绝并留痕（不允许 WebView / 系统浏览器加载任意 scheme）
    void invoke("log_debug", { line: `R20-A 拒绝打开非 http(s) 外部作业链接: ${String(rawUrl).slice(0, 200)}` }).catch(
      () => undefined,
    );
    return;
  }
  if (channel === "webview") {
    try {
      // Android：应用内全屏 WebView 桌面模式（用户关闭才 resolve）
      await invoke("open_web_modal", { url: rawUrl });
      return;
    } catch (e) {
      // 通道异常（桌面 stub 被误调 / 插件出错）：降级系统浏览器，不吞链接
      void invoke("log_debug", { line: `R20-A open_web_modal 失败，降级系统浏览器: ${String(e).slice(0, 200)}` }).catch(
        () => undefined,
      );
    }
  }
  void openExternal(rawUrl);
}
