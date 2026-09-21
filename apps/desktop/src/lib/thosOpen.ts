/**
 * 打开校内在线服务官方页（模块级入口）。
 *
 * 从 ThosPage 抽出来是为了让**原子（收藏/OH）**也能打开服务页——收藏里的一项若只能靠
 * 组件内的回调打开，就无法在收藏夹、桌面小组件或 OH 里命中。三端行为：
 *   - 桌面（macOS / Windows）：独立子窗口 + 种入会话票（Rust thos_open_portal 内部完成）
 *   - Android：全屏 Dialog WebView + 原生 CookieManager 种票，关闭后回灌 jar
 *   - 浏览器预览：退回系统新标签页
 */
export async function openThosInApp(url: string): Promise<void> {
  if (!url) return;
  const [{ routeThosUrl }, { invoke }, { isTauri }, { loadRemembered }, { currentThemeIsDark }] =
    await Promise.all([
      import("@onethu/info-lib"),
      import("@tauri-apps/api/core"),
      import("./transport.js"),
      import("./clients.js"),
      import("../state/theme.js"),
    ]);
  if (!isTauri) {
    window.open(routeThosUrl(url), "_blank");
    return;
  }
  const target = routeThosUrl(url);
  try {
    // 无记住凭据也可走链：账密传空时，id 表单页会在浏览窗口内要求手动输入一次。
    // R21：挪进 try——它一旦 reject，整条链在 invoke 之前就死了，外面什么都不会发生。
    const remembered = await loadRemembered();
    await invoke("thos_open_portal", {
      url: target,
      username: remembered?.username ?? "",
      password: remembered?.password ?? "",
      dark: currentThemeIsDark(),
    });
  } catch (err) {
    // 绝不静默：此前这里直接 await，异常一路冒到 void 调用处被吞掉 → 用户看到"点了没反应"
    // （实录 2026-09-20：在线服务点服务、体育点预约都不弹窗也不开浏览器）。
    const [{ logLine }, { showToast }, { openExternal }] = await Promise.all([
      import("./clients.js"),
      import("../state/toast.js"),
      import("../pages/info/openExternal.js"),
    ]);
    const reason = err instanceof Error ? err.message : String(err);
    void logLine(`[THOS-PORTAL] 应用内打开失败（${reason}）→ 回落系统浏览器`);
    // R21：原因直接进 toast——安卓日志此前只有 logcat，用户读不到，失败原因等于黑箱
    showToast(`应用内打开失败：${reason.slice(0, 60)}（改用浏览器）`);
    await openExternal(target);
  }
}
