# 手机 UI / 拖放识别 / 动画 / NFC 调研（2026-10-18）

> 只读调研，基线 `ca2fadea`；Phase 1 暂存箱地基在调研期间提交（`35cef40f`）。用于计划文档 §7.5/§7.6 的手机基础层设计。

## 1. 现有交互骨架

- 手机判定唯一来源：`state/platform.ts:46-53`（短边 <600），`main.tsx:27-31` 同步 `html.is-phone`，`?phone=1` 可强制。
- 贴底抽屉：`PhoneSheet` + `useSheetDrag`（速度低通、0.6/0.94vh 两档吸附、档位记忆、安全区），TabDrawer/OneGo/OnePage 复用。
- 底部安全区/底栏：`explorer-ui.css:780-786`；固定层 z：底栏 80、sheet 1290/1300/1310、OH 面板 9992/雾 9993。
- 触感：`lib/haptics.ts`（5 档、老机型白名单）；长按可用 `haptic("longPress")`。
- 320/390 回归：`layout-browser-test.mjs`、`usability-browser-test.mjs`、`phone-audit.mjs`、`phone-regression.mjs`。

## 2. 拖拽现状：四套自写 Pointer，无统一层

| 面 | 阈值/机制 | 证据 |
|---|---|---|
| 白板卡片 | pointer capture、4px、500ms 长按菜单；手机 stack 模式只点选不拖 | `FreeBoard.tsx:82,652,666-680,738-744,888-890` |
| 标签条 | 6px/160ms 让位/600ms 并组；手机 300ms 武装、500ms 菜单、8px 判滚 | `TabStrip.tsx:244-248,388,800-930` |
| 标签抽屉 | 6px 阈值、transform 让位、跨组并组 | `TabDrawer.tsx:116,189-400` |
| 抽屉把手 | 速度低通、0.4px/ms 甩动、两档吸附 | `PhoneSheet.tsx:23-29,37-102` |
| 其它 | 作业轮播纵拖、组件尺寸轮播、白板画笔、图标取色、图片查看器、悬浮网窗口 | `HomeworkCarousel.tsx:236-288`、`WidgetSizes.tsx:277-365` 等 |

结论：**全仓没有 HTML5 DnD、没有通用「可拖元素→对象引用」层、没有边缘自动滚动**；长按阈值三套（300/450/500ms）并存。

## 3. 逐类可拖性（摘要）

- 可拖但需仲裁：白板卡片（桌面世界坐标、手机 stack 禁拖）、标签条/抽屉（已有长按武装）。
- 只差点一下属性：搜索结果、邮件、新闻、课程/作业/通知/文件、体育/图书馆/研讨间等（都有 `CollectStar` 原子）——本轮已在 `CollectStar` 统一接 `data-vault-catch`。
- 需新增对象类型/稳定 key：日程事件（无事件 atom）、设置行（routeId）、主题、壁纸、选课、插件、OnePage、邀请/名片。
- 完全无入口：桌面 OS 拖入（无 `onDragDropEvent`）、剪贴板文件、Android `ACTION_SEND` 分享面板、文件 hash/上传通道。
- 现成但零使用：`ContextMenu.tsx` 的全局 `data-ctx-atom` 兜基层；可复活为「长按→收进暂存箱」菜单。

## 4. 手势竞技场建议

优先级：系统返回/悬浮球 > 弹层/抽屉把手 > 已注册强语义拖（白板/标签/轮播）> 通用长按拖动 > 滚动/点击。

- 通用长按 380–420ms、容差 8–10px；武装时 `haptic("longPress")` + scale 1.04；武装后移动即拖拽并取消菜单定时器。
- 未武装时绝不吃滚动；武装后 document `touchmove` `passive:false` + preventDefault；不要全局改 `touch-action`。
- 拖拽期间给 `<html>` 加 `is-catch-dragging`，底栏 `pointer-events:none`（避免 OH 胶囊 450ms 长按/点击抢事件）；落点自身 `pointer-events:auto`。
- 边缘自动滚动：进入最近可滚祖先上下 60px 启动 rAF，4→14px/帧。
- 返回键：拖拽中压入 `openOverlayFrame("vault-drag", cancel)`，Android 返回先取消手势。
- 拖出系统边界：WebView 内不能跨应用拖拽；跨应用走分享面板/ACTION_SEND，不在首版承诺。

## 5. 暂存箱落点挂载建议

- **不要**塞进 `.ex-bbar` 三槽（胶囊已占中槽，320 会挤）。
- 独立 fixed 层；常驻态右下小徽标，拖拽时展开为底部胶囊/环形落点；锚点与 FAB/OnePage 抽屉同族（`bottom: calc(var(--explorer-bar-h) + safe-area + gap + 8px)`）。
- 层级：底栏 80 之上、sheet 1290 之下；OH 面板/设置浮层打开时隐藏或 `pointer-events:none`。
- 距离 <120px 高亮、<64px 吸附；吸附 `haptic("tick/click")`，取消 `haptic("reject")`。

## 6. 动效基础

- 令牌：`styles/motion.css`（MD3 时长/曲线 + compat `--dur-1..4`、`--ease-*`、`--rise-*`、`--stagger`）；`docs/动效设计规范.md`。
- 状态机：`useExitPhase`、`useExitHold`、`useSheetDrag`、`useNavIndicator`；keyframes `m-pop/m-spring-in/m-sheet-up/down/m-expand-in/m-breathe` 等。
- reduced-motion：CSS 全量降级 + JS `prefersReducedMotion()`；触感白名单。
- **已知问题**：`tools/motion-test.mjs` 当前红（四档时长接 MD3 var 后测试只匹配字面 ms；后续还有 CardTab 等护栏漂移）。做新动画前必须修该护栏，否则新动画没有把关。
- 性能纪律：只动 transform/opacity；ghost 不要克隆子树/不要毛玻璃；长列表 >80–100 项需虚拟化（当前全仓无虚拟化）。

## 7. NFC 可行性

- 现状：**零代码/零权限**；`grep nfc` 全仓 0 命中。Android 插件 `minSdk=24`（HCE/ReaderMode 需 19+，满足）。
- 插件架构已铺好：Kotlin `@Command` + 主 crate `run_mobile_plugin` + `#[cfg(desktop)]` 降级模板；Plugin 支持 `onNewIntent/onResume/onPause`。
- 平台事实：Android Beam（P2P）自 Android 10 弃用、14 移除；两机「碰一碰」只能 **HCE 一机模拟 NDEF + 另一机 ReaderMode**，或 NFC 贴纸/二维码兜底。
- 实现清单：
  1. 插件清单加 `NFC` 权限 + `uses-feature required=false`。
  2. Reader：`enableReaderMode`（A/B/F/V），`onResume` 开/`onPause` 关；读 NDEF 回 JS。
  3. HCE：`HostApduService` + `apduservice.xml`（NDEF AID `D2760000850101`），回 NDEF 长度+内容+`9000`。
  4. JS `lib/nfc.ts` 探测 Android；失败/无 NFC/关闭 → 二维码/口令/剪贴板降级；桌面只显示「手机端可用」。
  5. 安全：NDEF 只接受 `ONV1.` 口令并校验 checksum，拒绝任意 URL 自动打开；口令长时不要整箱 NDEF，只传短 token/口令。
- 风险：HCE 后台限制、两机握手 1–3s 超时、无硬件、读屏可达性。

## 8. 已知 P0 问题（做手机 UI 大改前先处理）

1. `tools/motion-test.mjs` 红（护栏失效）。
2. 手机长按/滚动手势冲突（三套阈值）；需竞技场。
3. Android 根返回命令 `plugin:onethu-mobile|mobile_exit` 不存在，真机退不出应用（`navStack.ts:149-165`）。
4. 横竖屏判定不一致：`is-phone`（短边<600） vs `useExpanded`（宽≥840），844×390 会选桌面形态。
5. 无边缘自动滚动/无跨应用拖拽，需要明确降级。
6. 文件 hash/上传在主线程会卡 UI；需 worker/分片。
7. 读屏/键盘用户：每个可拖元素必须有「收进暂存箱」菜单替代路径。

## 9. 下一步（Phase 2+ 决策）

1. 先修 motion 护栏与手机返回命令；统一 `is-phone/useExpanded`。
2. 做 `lib/catch/`：`types` + `extract`（data-vault-catch/data-ctx-atom/data-set-id/data-item-id/选区/文件）+ `gesture`（400ms/8px 竞技场、边缘滚动、取消回弹）+ `registry`。
3. 逐步接 6 个高价值面：首页卡片、OH 搜索结果、邮件、网络学堂行、设置行、文件；菜单兜底同步上线。
4. 暂存箱 dock/sheet（复用 `useSheetDrag`）与名片/NFC 动效放到 P2/P3。
