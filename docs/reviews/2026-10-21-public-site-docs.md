# 0.11 官网、文档与导览更新验收

> 本记录描述源码和隔离浏览器验收，不把学校双账号联调或真实手机性能视为已完成。

## 交付范围

- README 提供中文与英文独立文件、互相切换入口，使用原版上下 Logo。
- 官网为概览、下载、插件、开发者、交流五类页面各提供中英文版；主题、壁纸和布局保持可自定义，不将默认主题作为固定产品外观。
- 手机竖屏、横屏与桌面素材来自真实 React/OneGUI 视图和隔离模拟数据。公开截图不连接真实校园账户，素材清单保留 SHA-256。
- 首页使用本地打包的 Three.js 设备模型和滚动驱动视角；减少动态、无 JavaScript、WebGL 不可用时提供静态回退，不劫持滚轮。
- 插件市场保留目录加载、分类、搜索和网络失败入口；远端描述使用纯文本显示。社区公开 QQ 群入口保留。
- 开发者页集中构建、插件、Harness、技能运行边界、API、OneGUI、贡献者。贡献者按可追溯 Git 历史生成，已确认别名合并；公开产物不含作者邮箱。
- 累计新增代码严格超过 10,000 行标记为主要贡献者，排除合并重复、生成/依赖/词典/夹具和非代码文件。当前主要贡献者为 smartThise、xiao-dreamr；署名共同作者保留，行数不代表贡献质量。
- 现行指南包含中英文版，API 从类型与门面生成，两种语言均列出 36 个命名空间和 255 个方法入口。详细历史工程记录保持原文并标注历史性质，由全量目录统一访问。
- 文档同步按原文件位置解析相对链接，正确处理根 README 更名、跨语言路径与仓库外链接。发布所有 Markdown，裁掉未引用的测试转储、临时素材与提取目录；源仓历史证据保留。

## 导览修复

三模式首课均介绍搜索、OneTHU Harness 与插件，说明精简模式的实际边界。按钮可打开真实搜索、OH 与插件/模式设置，并可返回导览。

暂存箱演示改为真实作业长按、提起、拖入高亮目标、松手收纳、打开箱子核对结果的录制。只额外显示指针，不替代实际拖动管线。文字列明已接入的组件、标签页、工作区、作业、文件、搜索、日程、名片、邮件、云盘、GitLab 与设置类来源，不声称任意屏幕内容均能收纳。

录制改为复用经过外窗校准的 CDP compositor 采集，修复旧录制的右侧/底部留白。单手机舞台采用竖屏构图；在 1280 和 390 视口中主体投影约占舞台宽度 80%、高度 89%，完整保留模型边界。暂停、后台、离屏和减少动态效果会暂停媒体及帧调度。

## 验证

- `pnpm test:onboarding`：课程、目标导航、模式策略与实践返回通过。
- `tools/onboarding-browser-test.mjs`：桌面/手机全模式及扩展课程真实跳转，66 项断言通过并正常清理浏览器。
- `tools/onboarding-real-screens-test.mjs`：31 张导览图、54 种选择/模型组合，1141 项断言通过。
- `tools/onboarding-basics-vault-browser-test.mjs`：三模式搜索/OH/设置跳转、实际视频播放、暂停、主体占比与减少动态通过，浏览器正常清理。
- `tools/public-site-browser-test.mjs`：1440、390、320、844 视口，语言/键盘/模式、贡献者、插件分类/搜索、外部文本不作为 HTML 执行、无 JS/无 WebGL/减少动态回退通过。
- `tools/public-docs-browser-test.mjs`：桌面/手机同页语言切换、完整英文 API、贡献者和动画素材通过。
- 官网静态契约：10 个双语页面、本地资源、原版上下 Logo、主要贡献者阈值与无邮箱输出通过。
- 中英文 MkDocs `--strict` 构建均无 WARNING；全量文档文案检查通过。修复了历史文档裸写 `<style>` 吞掉后续正文的问题，并核对全站页面、资源和片段链接。
- `pnpm i18n:check`：7516 个词条，错误 0；Android 回退模板 62 份匹配。
- 应用 TypeScript 检查和前端生产构建通过；现有主包体积提示仍存在，不作为本轮已解决事项。

复现与更新工具：`tools/docs-api-surface.mjs`、`tools/docs-catalog.mjs`、`tools/contributors-report.py`、`tools/capture-public-preview.mjs`、`tools/record-vault-onboarding.mjs`。官网仓维护页面生成、素材同步、静态契约与中英文构建脚本。

## English review summary

The site and current guides have explicit Chinese/English content. Preserve the app’s original stacked logo and keep themes, wallpapers and layouts customizable. Public previews are captured from the real UI using fictional fixtures. The developer page includes every attributed contributor, a documented source-line threshold and no author emails. Historical technical records remain clearly labeled in their original language.

Browser acceptance covers desktop, portrait, narrow and landscape viewports, actual guide destinations, staging playback, keyboard use, language links, plugin search, and motion/JavaScript/WebGL fallbacks. It does not claim live two-account collaboration or physical-device performance acceptance.
