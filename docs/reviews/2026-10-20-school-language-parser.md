# 学校英文页面解析、展示身份和诊断隐私

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


本轮保持学校返回的数据、请求字段和远端语言偏好不变。界面使用学校提供的 `englishName`；解析器兼容中文和英文展示标签；提交结果必须有明确成功证据。

## 材料边界

用户提供的第一份材料是网络学堂英文课程首页，包含官方语言切换入口。第二份是 Info 英文门户，**不是选课系统英文内页**。没有复制附件中的个人课程、姓名、CSRF、票据或 HTML 到仓库。

没有提供真实英文选课表格或英文作业详情内页。因此，本轮只能证明匿名结构下的英文别名、会话识别和失败保护，不能宣称官方英文全站已经验证。未使用登录态调用业务接口、修改账号语言、提交作业、选课或退课。

2026-10-20 的匿名网页复核中，[网络学堂课程入口](https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/)返回未登录/登录失效；网页读取工具未能获取 Info 与选课入口。这只说明该读取方式没有取得内页，不表示学校服务不可用，也不替代真实登录态验收。

## 改动

- 网络学堂提交作业只接受机器字段 `result: "success"`；英文拒绝、未知 JSON、空对象、数组和非 JSON 均不再误报成功。提交正文及 multipart 字段保持原样。
- 作业详情兼容中文和英文提交内容标签，并保留 `textarea[name=zynr]` 的无语言依赖路径。
- 选课表格按中英文表头映射，识别英文会话失效、业务拒绝和分页。选课回读必须匹配课号与归一化课序；显式拒绝不再被旧课程记录覆盖。
- 退课只有在识别出结果表、完整解析数据行、且目标课号和课序确实消失时才确认。未知页面或改变了身份控件的表格不会被当成空列表。志愿调整也需回读目标值。
- 学堂、HTTP 和选课行解析诊断只保留固定状态、响应类型、长度与计数，删除作业正文、原始 HTML/JSON、脚本、姓名及完整 URL 查询串。业务调用者仍收到原始响应和解析数据。
- 中文使用原课程名；英文及其他非中文语言优先学校英文名，缺失时回落原名。搜索保持双语；不修改缓存对象。
- 作业、通知、文件共享行新增 `identityCourseName`，由调用方传原课程名；展示名仍可切换。暂存箱按完整 Atom 键去重，这避免切语言后同一内容被重复存入。收藏自身已按身份段规范化，不受此重复问题影响。

## 验证

以下检查均自然退出为 0：

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| `school-language-parser-test.mjs` | 48 项 | 匿名离线 HTML、注入 HTTP；真实客户端提交/回读路径 |
| `school-language-browser-test.mjs` | 32 项 | Chromium、WebKit 实际 `DOMParser`，包含嵌套教师表格；禁止远端网络 |
| `school-diagnostics-privacy-test.mjs` | 30 项 | 合成敏感标记验证诊断不含正文、查询参数及标识；返回数据未被清空 |
| `learn-language-display-test.mjs` | 50 项 | 实际共享行 JSX、Atom 输出和点击函数；三种语言下身份/路由一致 |
| `i18n-gui-completion-test.mjs` | 24 项 | 实际 IM 适配器方法及插件更新处理函数，依赖隔离 |
| `learn-session-recover-test.mjs`、`learn-submit-body-test.mjs` | 通过 | 既有会话恢复、单飞、multipart 字节与字段回归 |
| `pnpm --filter @onethu/core test` | 5 组通过 | WebVPN、场馆、公共空间及选课既有 smoke |
| desktop / core `typecheck` | 通过 | 最终补漏及身份分离代码 |

浏览器证据和源码 SHA 位于 [browser-report.json](school-language-2026-10-20/browser-report.json)。最终集成另重跑了 Chromium/WebKit、三模式、两尺寸的真实 App 检查，两引擎各 77 项且正常退出；见 [App i18n 验收](2026-10-20-i18n-app-acceptance.md)。

## 界面文案补漏

显式 JSX 文本和静态展示属性扫描未发现剩余直接中文；继续审查表达式后补了 ICS 导出、文字预览默认标题、OH 搜索占位，以及微信/飞书适配器标签、二维码状态、本地错误回落。19 条双语消息在 `docs/i18n/gui-completion-seed.json`，由总词典统一合并。

插件反馈色改为 `failed` 布尔状态，不再通过中文失败句判断；更新失败也会释放忙碌状态以允许重试。协议值、设置身份、外部消息正文、日志和学校状态比较保持原样。扫描范围与处理记录见 [ui-residual-review.json](school-language-2026-10-20/ui-residual-review.json)。这不是英语翻译完成度报告；没有英文译文的键仍按运行时规则回落中文。
