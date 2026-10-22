# 手机白板添加确认的触摸响应修复

日期：2026-10-22。目标版本：0.11.2。范围为首页白板和 OnePage 共用的组件添加抽屉。

## 复现与原因

在 390×844 的隔离 Chromium 触摸页面中，通过 CDP 的真实触摸输入点按确认按钮。手指从 44px 按钮中心下移 18px，终点仍在按钮内部，浏览器却发出 `pointercancel`，随后没有 `pointerup` 或兼容 `click`，组件数量保持不变。相同场景的 0、8、13px 位移能够添加。

确认按钮继承了抽屉内容区的 `touch-action: pan-y`。浏览器将按钮上的轻微纵向位移解释为滚动，并取消应用接收的指针事件。原有 `pointerup` 提交补偿因此同样无法执行。

另一个延迟来源位于关闭流程：进入退场前立即清空 `expanded`，使整个组件预览目录重新挂载；200ms 退场结束后才卸载抽屉。原流程的一次确认在该阶段产生 10–12 轮目录 DOM 变化，与白板新增组件的渲染同时发生。

本次未复现确认按钮被 OneShot 或底部导航覆盖。按钮五个采样点均命中按钮本身，仍保留此检查作为回归约束。

## 修复

- 确认按钮独立使用 `touch-action: none`；目录纵向滚动、尺寸预览拖动及抽屉手柄保持原有手势区域。
- 触摸确认在抬手时提交，接受按钮内 24px 以内的轻微漂移。移出按钮、显著移动后返回、系统取消及来自其他区域的滑动均保留取消语义。
- 按具体手势消费兼容 click，取代 400ms 的全局时间闸门；下一次主动点按可立即执行。鼠标与键盘沿用 click 路径。
- 详情预览完整保留到退场结束，随后统一清理；退场中的抽屉停止接收指针操作。

修改文件为 `apps/desktop/src/components/BoardAddDrawer.tsx`、`packages/gui/src/recipes/workbench.css`。本次沿用现有中英文文案。

## 验证

新增 `tools/board-add-touch-browser-test.mjs`，49 项通过。真实触摸输入覆盖 360×780、390×844、844×390，包含模拟安全区；390px 场景另施加 4 倍 CPU 降速。检查包括：

- 一次 18px 漂移触摸立即添加，兼容 click 保持单次提交。
- 移出后返回、系统取消、按钮外抬手均保持取消；后续一次点按正常执行。
- 尺寸预览拖到确认区不会添加；尺寸动画期间确认会保存所选尺寸。
- 目录保留原生触摸滚动，末尾组件与确认按钮可达，释放手势不会点击底层导航。
- 首页和自建 OnePage 均向当前白板保存组件；桌面鼠标与 Enter 操作通过。
- 关闭阶段没有再次挂载目录。

复跑命令：

```sh
node --import /Volumes/OneTHUBuild/artifacts/mobile-round3-register.mjs tools/board-add-touch-browser-test.mjs
pnpm --filter @onethu/desktop typecheck
node tools/css-parse-test.mjs
git diff --check
```

TypeScript 检查及 82 个 CSS 文件结构检查通过。结果位于 `/tmp/onethu-board-add-touch/report.json`；竖屏与横屏截图 `confirm-360.png`、`confirm-844.png` 已人工查看。

测试使用真实 React 页面及白板持久化流程，账户和内容均为隔离的虚构数据，外部网络请求被阻断。本次验收在浏览器触摸环境完成，尚未安装到反馈用户的 Android 实机。
