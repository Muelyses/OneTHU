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
  // 无记住凭据也可走链：账密传空时，id 表单页会在浏览窗口内要求手动输入一次
  const remembered = await loadRemembered();
  await invoke("thos_open_portal", {
    url: routeThosUrl(url),
    username: remembered?.username ?? "",
    password: remembered?.password ?? "",
    dark: currentThemeIsDark(),
  });
}
