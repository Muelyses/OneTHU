# HTML 预览安全修复验收

本轮修复四处把外部内容放入应用 DOM 的入口：自定义白板组件、网络学堂富文本、DOCX 预览、THUBook 正文。原有正则过滤或仅去除颜色无法处理浏览器实际解析的事件属性和编码协议。

## 修复前的真实反例

隔离 Chromium 页面运行原生产转换函数，再写入 `innerHTML`：

- 自定义组件的未加引号 `onerror` 会执行。
- 网络学堂富文本的 `onerror` 会执行。
- DOCX 链接中 `java&#x09;script:` 会在真实点击后执行。

反例只设置本页无害标记，不读取账号、凭据或用户内容。记录见 [before.json](html-safety-2026-10-20/before.json)。

## 实现

四个入口统一调用 `sanitizeDisplayHtml`。它使用精确锁定的 DOMPurify 3.4.17 和 HTML profile，移除事件、危险协议、嵌套文档、表单及应用专用 `data-*` 标记。原有课程与手册去色逻辑继续生效。解析器不可用或抛错时输出转义文字，不回退成原始 HTML。

版本来自实施时官方 npm registry；上游文档为 [DOMPurify](https://github.com/cure53/DOMPurify)。正常文本、强调、表格、安全链接和图片继续保留。图片仍遵循原预览网络行为，本次未加入远程图片代理。

## 验收

`node tools/html-safety-browser-test.mjs` 在 Chromium 和 Playwright WebKit 自然退出 0，共 221 项断言。测试从源文件提取实际转换函数及富文本 `__html` 表达式，浏览器加载生产共用清洗模块，覆盖编码协议、事件、SVG、iframe、表单、元数据、正常内容及清洗失败退化。

记录见 [report.json](html-safety-2026-10-20/report.json)。全部外网请求被阻止，无学校 API、邮件或原生能力调用。

这组结果证明实际转换与浏览器 DOM 边界，不冒充完整应用操作、原生 WebView 或恶意文件解析器全量审计。应用级语言切换与草稿保持另行验收。

## 场馆代理内联脚本

原生 `venue_proxy` 曾把 SSO 字符串直接插入 JavaScript 双引号。现先用 `serde_json` 序列化，再转义 `<` 和 Unicode 行分隔符，防止引号逃逸或 HTML 的 `</script>` 提前结束脚本。

`node tools/venue-token-script-browser-test.mjs` 提取并编译实际 Rust 插值块，在 Chromium 和 WebKit 解析生成的 HTML。8 组模拟字符串、35 项断言自然退出 0：均只产生原定的一个脚本，token 和 headers 的存储内容完整往返，没有额外代码执行。记录见 [venue-script.json](html-safety-2026-10-20/venue-script.json)。这项测试不读取真实 SSO，不调用场馆服务，也不代替原生主应用构建。
