/**
 * Tauri 桥认领（**必须最先执行**，见 main.tsx 的第一条 import）。
 *
 * 背景：Tauri 只把 `__TAURI_INTERNALS__` 注入**主 frame**。竖屏取景框用的是同源 iframe
 * （唯一能拿到真机视口尺寸的办法——桌面窗口高度受屏幕上限 700 左右，做不出 852），
 * 于是 iframe 里的应用会把自己当成"浏览器预览"：
 *   · 读不到应用数据目录里的会话快照（WKWebView 会驱逐 localStorage，会话主要靠
 *     `${appData}/state/session` 文件镜像，走 IPC 的 state_read）；
 *   · 网络退回 window.fetch，被校园网 CORS 拦。
 * 结果就是用户看到的「取景框里没有我的登录态」。
 *
 * 这里从父窗口**认领**同一份桥：同源可读写，且整页是同一个 WKWebView，
 * IPC 通道本来就只有一条，父子共用没有语义问题（回调用的是父窗口的注册表）。
 * 跨源 iframe 读父窗口会抛，直接吞掉保持 false —— 浏览器里的普通预览不受影响。
 */
function adoptParentTauriBridge(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const parent = window.parent as unknown as { __TAURI_INTERNALS__?: unknown } | null;
    if (!parent || parent === (window as unknown as unknown)) return false;
    if ("__TAURI_INTERNALS__" in window) return true; // 主 frame：本来就有
    const host = parent.__TAURI_INTERNALS__;
    if (!host) return false;
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = host;
    return true;
  } catch {
    return false; // 跨源：读父窗口抛 SecurityError
  }
}

/** 认领结果（dev 探针与取景框状态行用） */
export const adoptedParentTauriBridge = adoptParentTauriBridge();
