# 完整模式：清小搭 in OneTHU 导览

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


用户要求直接完成完整模式专属介绍。将清小搭作为主线第六课，紧随组织；极简两课与实用三课不变。

- 说明对话与历史、选择专用智能体、导入并检查兼容轻量技能后启用给 OH。
- 明确 Python、Node、外部服务等不受当前轻量环境支持，可保存给电脑 Agent。
- 「打开清小搭」走真实一级功能页，继续导览回到本课。
- 复用现有自动播放的三维手机与 CSS 降级，屏幕使用真实清小搭对话/技能页面截图；只注入隔离示例数据，不重画界面。
- 中英文文案、翻译种子及翻译交接批次同步更新。

## 验收

- `pnpm test:onboarding`：21 项内容/模式边界、21 项返回栈行为及 flow4 静态护栏通过。
- `tools/onboarding-browser-test.mjs`：1280 桌面与 390 触屏完整导览的真实落点、返回、模式切换等 62 项通过。
- `tools/onboarding-xiaoda-browser-test.mjs`：新增章节 48 项通过，0 页面异常，浏览器自然清理完成。覆盖桌面中文、390 手机中英文、320×568 英文减少动态；自动展示对话/技能真实屏幕，按钮滚动可达，打开智能体/技能分栏后可返回原课，再进入完成页。截图已人工查看。
- `tools/onboarding-real-screens-test.mjs`：1056 项截图/模型检查通过，51 个组合、23 张图片，包含新增清小搭两阶段纹理、图片缓存与模型资源释放。
- 类型检查与生产构建通过。翻译交接批次重新生成，`pnpm i18n:check` 为 7503/7503、errors 0。

截图源与 SHA-256：`apps/desktop/src/assets/tour/real-ui/manifest-xiaoda.json`。采集命令：`node tools/capture-tour-xiaoda.mjs`。

新增章节的验收报告、截图、生产构建日志位于 `/Volumes/OneTHUBuild/artifacts/onboarding-xiaoda/`。学校请求与原生技能列表使用隔离数据夹具，页面组件和样式为实际应用；未访问他人账号，不代表 Android 真机帧率或学校服务可用性验收。本轮仅前端导览，无新安装包。
