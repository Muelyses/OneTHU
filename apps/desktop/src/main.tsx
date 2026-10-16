import { StrictMode } from "react";
import { logLine } from "./lib/clients.js";
import { isPhoneViewport, platformOf } from "./state/platform.js";
// 渲染层崩溃捕获：白屏=未被记录的 JS 异常（webview 控制台/系统日志都拿不到），
// 全局 error/unhandledrejection 直接落盘 /tmp/onethu-debug.log。
function hookRenderError(kind: string, detail: string): void {
  void logLine(`RENDER-ERR ${kind} ${detail}`).catch(() => undefined);
}
window.addEventListener("error", (e) => {
  if (e.message || e.error) hookRenderError("window", `${e.message} @${e.filename}:${e.lineno} stack=${e.error?.stack?.slice(0, 900) ?? ""}`);
});
// [dev 逐行探针] 模块求值完成（若蜂窝下此行不出现=模块加载期悬挂）
void logLine("PROBE js-modules-evaluated").catch(() => undefined);
window.addEventListener("unhandledrejection", (e) => {
  hookRenderError("rejection", `${String((e.reason as Error)?.message ?? e.reason).slice(0, 300)} stack=${(e.reason as Error)?.stack?.slice(0, 900) ?? ""}`);
});
// 开发者构建（ONETHU_DEV=1）：把 console.* 也灌进 Rust 日志链，真机导出的日志才有现场。
// 正式版 __ONETHU_DEV__ 折叠为 false → 整块（含动态 import）被静态删除。
if (__ONETHU_DEV__) {
  void import("./lib/devlog.js").then((m) => m.installDevLogBridge());
}
// 真机密度标记：触屏 + 短边窄 → html.is-phone（CSS 密度层挂此类，不依赖媒体查询细节）。
// 判定在 state/platform.ts 的 isPhoneViewport()（唯一来源，横竖都算手机；dev 可 ?phone=1 强制预览）。
function markPhone(): void {
  document.documentElement.classList.toggle("is-phone", isPhoneViewport());
}
markPhone();
window.addEventListener("resize", markPhone);
// 列表/网格入场 stagger（手机密度层才挂）
installScrollReveal();
// 全字符对比度：文本在背景栈（壁纸+纱+玻璃层）实测亮度上自动选黑/白字
installTextContrast();
// 按钮涟漪（§3.5 B1）：全局单监听，认类名不认调用点；触摸/笔出涟漪，鼠标只走状态层（§2.8.3）
installRipple();

import { createRoot } from "react-dom/client";
import { activateInstalledPlugins, seedBuiltinHarness } from "./plugins/loader.js";
import "@onethu/ui/tokens.css";
import { installAuthWatchdog, installKeepalive } from "./lib/reload.js";

// 风格管线（六轴）挂载：皮肤/明暗/密度/动效/强调色/平台一处解析、一处落盘。
// 平台判定复用 state/platform.ts 的唯一断点（禁止组件各自 matchMedia）。
// 密度随平台走：桌面 compact（与旧版刻度对齐——2026-10-14「卡片/按钮太大」）、手机 touch。
installOneGUI({
  platform: () => (isPhoneViewport() ? "mobile" : platformOf(window.innerWidth) === "expanded" ? "desktop" : "mobile"),
  densityByPlatform: { desktop: "compact", mobile: "touch" },
});
// 旧通道（主题明暗 / 玻璃档位）→ OneGUI 轴；用户现有选择立刻在 OneGUI 上生效
installOneGUIBridge();
installAuthWatchdog();
installKeepalive();   // 10 分钟会话保活探针：死会话在用户点击前就透明重建
// 系统日历自动跟随：订阅云/本日程与课表变更（未开启时零开销）
import { initSystemCalAutoSync } from "./state/systemCal.js";
initSystemCalAutoSync();
// 玻璃程度档位：读档落到 <html data-glass>（默认档不落属性）
import { initGlassLevel } from "./lib/glassLevel.js";
initGlassLevel();
import "@onethu/ui/base.css";
import "./styles/global.css";
import "./styles/glass-levels.css";
// 动效层（local/anim-delight）：令牌 + keyframes + 全局微交互。必须在 global.css 之后，
// 否则同选择器的 transition/animation 会被 global.css 覆盖。
import "./styles/motion.css";
// OneGUI（唯一 UI 体系）：正式样式表 + 风格管线。放在旧样式之后 —— 组件与令牌优先。
// 旧样式表在换血期间仍在，逐页迁移完成后整批删除（见 docs/onegui/00-plan.md §5）。
import "@onethu/gui/gui.css";
import { installOneGUI } from "@onethu/gui";
// 过渡桥（TEMP）：旧令牌名 → OneGUI 语义令牌 + 旧明暗/玻璃通道 → OneGUI 轴。
// 目的：未迁页面也立刻长成 OneGUI 的样子；迁完一页删一页，最后连这份桥一起删。
import "./styles/onegui-bridge.css";
import { installOneGUIBridge } from "./lib/oneguiBridge.js";
import { installScrollReveal } from "./lib/motion.js";
import { installTextContrast } from "./lib/textContrast.js";
import { installRipple } from "./components/Ripple.js";
import { initDynamicColor, watchDynamicColor } from "./lib/dynamicColor.js";
import { App } from "./App.js";
import { ConfirmHost } from "./lib/confirm.js";
import { FormModalHost } from "./lib/formModal.js";
import { RootErrorBoundary } from "./components/RootErrorBoundary.js";
import { TextPeekHost } from "./components/TextPeek.js";
import { ImageViewerHost } from "./components/ImageViewer.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* R24：根级错误边界——任何渲染期崩溃都变成可读卡片，不再整窗白屏 */}
    <RootErrorBoundary>
      <App />
      <ConfirmHost />
      <FormModalHost />
      {/* 手机端双击看全文：被省略号截断的文本双击后弹浮层（可选中） */}
      <TextPeekHost />
      {/* 手机端长按看图：全屏查看 + 双指缩放 + 保存到相册，单击任意处退出 */}
      <ImageViewerHost />
    </RootErrorBoundary>
  </StrictMode>,
);
// 动态取色（§3.4）：上次开着就重开；取色不可用会自动降级到「清华紫」主题。
// 放在 CSS 导入之后：注入的 <style> 需要插在令牌样式之后（且自身特异性更高，顺序无关紧要）。
initDynamicColor();
watchDynamicColor();

// 恢复已装插件（异步，失败只落日志）
void (async () => {
  await seedBuiltinHarness();
  await activateInstalledPlugins();
})().catch(() => undefined);

declare const __APP_VERSION__: string;

/* glass probe 1791917225 */

/* glass force-reload 1791917328 */

/* glass r2 1791917664 */

/* glass r3 1791917757 */

/* glass r4 1791918078 */

/* glass r5 1791918118 */

/* gold glass r-g 1791943734 */

/* retune probe 1791944030 */

/* pin probe 1791944124 */

/* tc probe 1791944629 */
