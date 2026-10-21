# i18n 接入后的账号、权限与诊断边界审查

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


日期：2026-10-20。范围：本轮工作树中的 TypeScript 运行时、云盘账号状态、组织同步与分享协议、网络诊断出口。没有访问学校 API、读取真实日志、修改真实账号或调用远端权限写入。原生文件权限、HTML 消毒及核心客户端诊断由其他审查任务负责，本文不代替其验收。

## 已复现并修复

### 云盘退出及切换账号的旧状态回填

原实现退出时没有清理目录缓存，`openDir` 又先查缓存再检查账号；退出后相同路径在 TTL 内仍能返回旧账号文件名。加载配置提前标记完成，未等待文件读取；更早的加载、连接、目录和资料库请求还可能在退出或新账号连接后回填旧数据。

本轮在 `apps/desktop/src/state/seafile.ts:25` 起增加配置载入 single-flight、凭据世代编号和持久化队列：

- 退出立即清空账号、资料库、目录缓存与忙状态；目录查询先判断当前账号。
- 延迟到达的旧账号、目录、资料库和文件预览结果不再发布。
- 连接先通过服务端账号校验，再以严格文件接口持久化；写入失败不会返回连接成功。
- 退出删除新旧配置路径；已有写入结束后仍执行排队的删除，后来的失败连接不会跳过这个删除。
- 文件读取失败可以重试；并发调用共享同一次完整载入。

`tools/seafile-account-lifecycle-test.mjs` 运行真实状态模块，仅替换原生调用、文件与 React 订阅适配，共 9 项通过。包含延迟响应、并发载入、写入与退出交错、后续连接失败、缓存切号和磁盘写入错误。夹具使用合成账号，不是跨账号真实服务验证。

### Cookie、认证 URL 与页面内容进入诊断日志

`transport.ts` 的原逐跳日志将新 Cookie 的 `name=value` 截断后落盘；`clients.ts` 的 `InfoClient.onDebugDump` 则会分块写入学校页面原文。这些内容可能包含会话凭据和个人信息，截断不等于脱敏。

本轮增加 `apps/desktop/src/lib/networkLog.ts`：

- 逐跳日志只保留合法 Cookie 名称；不记录 Cookie 值。
- 日志和可见错误中的 HTTP URL 去除用户名、密码、查询参数和片段，保留 origin/path 以定位路由。
- `clients.logLine` 统一遮蔽结构化认证字段、Bearer 值、页面标记和 `body` 等原文片段。
- 完整学校页面的调试钩子仅记录字符数，不再分块落盘。
- 云盘自动连接失败时不再记录未知 profile 页的 token 区域或内联脚本；仅遮蔽已知 40 位 hex 无法保护未来页面中的其他凭据。
- `diagnostics.redactDiagnostics` 复用该保护，继续保留原有邮箱、长数字处理；网络错误展示与超时提示也不携带认证 query。

`tools/network-log-privacy-test.mjs` 共 20 项通过，使用合成 Cookie、OAuth/CAS URL、JSON、页面正文和错误片段，并检查实际诊断出口接线。脱敏值只用于诊断，实际请求 URL、Cookie 与响应没有改变。

## 权限与协议复核

- `state/orgSync.ts:23` 的保护分支校验仍拒绝额外用户、群组、部署密钥授权；私有群组与元数据项目归属、成员角色仍由服务端读取。当前 i18n 改动没有把权限数字、分支名或协议字段变成译文。
- `state/orgSyncCore.ts:89` 起先审计独立授权路径；成员变化及资源降权采用服务端回读。已开始执行后的独立撤权会继续尝试，撤权错误会阻止后续新增授权，保留可重试的 pending。
- `state/orgSync.ts:75`、`:163` 的远端修订比较和乐观提交仍保留；冲突不会用陈旧本地文档覆盖远端。
- `state/sealedShare.ts:26`、`:43` 保留每份随机密钥及 AES-GCM 随机 IV；读取密钥需要服务端认可当前账号对密钥资料库的访问，客户端邮箱显示值不能替代授权。协议版本、`kind`、`/key.json`、算法及路径检查未被翻译。
- `tools/org-collaboration-test.mjs` 本轮 38 项通过。这是实际权限模型配合模拟网关的验收，不能称作 GitLab/云盘双账号联调。

## i18n 运行时与导航验收

本轮运行时与宿主验证独立于翻译质量：

| 验收 | 结果 | 覆盖 |
| --- | --- | --- |
| `tools/i18n-runtime-test.mjs` | 29 项 | 插值、字面转义、缺参、受限复数、Intl、回退、惰性数组、跨窗口通知 |
| `tools/i18n-runtime-browser-test.mjs` | 17 项，自然退出 | 实际 React/OneGUI 确认、提示、表单、Toast；切语言不重挂输入、不丢草稿；`document.lang` 与跨窗口 |
| `tools/i18n-settings-routing-test.mjs` | 12 项 | 显示译文变化、稳定 tab/section/row ID、搜索 getter 不被冻结 |
| `tools/settings-search-coverage-test.mjs` | 通过 | 63 个注册条目、196 个别名、10 个落点标记 |
| `tools/search-landing-test.mjs` | 通过 | 注册模型的 63 个路由家族检查；不等同浏览器点击验收 |
| `tools/i18n-security-boundaries-test.mjs` | 15 项 | 不同译文下口令字节、导入目标、原生错误识别不变；二次认证提示按调用解析 |
| `tools/mail-state-test.mjs` | 23 项 | 原邮箱状态验收及真实词典适配，保留缓存失败等原断言 |

设置分类改为声明式 `data-settings-tab` / `data-settings-section`，搜索定位优先稳定 `row.id`；不再根据翻译后的 DOM 文本生成导航 ID。两个旧组织设置搜索入口转到实际通讯录组织页面。Confirm/Form/Toast 使用消息描述符在显示时解析，插件或用户传入的原文保持原样。

## 保留的边界

1. `clients.obfuscateSecret` 的 XOR 仍然只是混淆，不是密码学加密或操作系统钥匙串。不能将本轮缓存隔离和文件权限改进描述为所有凭据已加密。
2. 文件系统删除失败会由严格接口拒绝；进程内退出仍清空状态，但上层有兼容性 catch，不应承诺任意磁盘错误下凭据物理擦除成功。
3. 账号切换拒绝旧响应回填，不等于撤回已下载文件或远程取消所有已发出的请求。
4. 日志脱敏不是任意文本的数据防泄漏分类器。结构化认证与已知正文应在源头不记录；日志中的课程名称等诊断信息也不应默认视作可公开数据。原生日志、核心 HttpClient 原文输出需结合对应任务报告。
5. 公开 URL 的 path 仍用于定位请求，某些服务可能把敏感值放在 path 中；本轮没有承诺删除任意 URL 路径中的业务标识。
6. 本轮没有真实账号、真实双账号权限、远端故障或系统钥匙串验收；翻译词典内容仍需专门翻译模型及语言质量审查。

## 生产依赖复核

本轮初始 `pnpm audit --prod` 为 2 high、1 moderate、1 low。修复后为 0 high、1 moderate、1 low；没有增加忽略规则，不能称依赖告警全部清零。

- **SheetJS：已升级。** 文件预览确实会读取用户 XLSX，不能使用“仅导出不受影响”的例外。固定为官方 CDN `xlsx-0.20.3.tgz`，lock 保留 SHA512 完整性。官方明确 npm `xlsx` 停留旧版本，应从其 CDN 安装；原型污染修复起点为 0.19.3，ReDoS 修复起点为 0.20.2。[官方安装说明](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)、[原型污染公告](https://cdn.sheetjs.com/advisories/CVE-2023-30533)、[ReDoS 公告](https://cdn.sheetjs.com/advisories/CVE-2024-22363)。
- **Quill：保留低等级依赖告警。** 官方及 registry 最新稳定版仍为 2.0.3。漏洞发生于 formula/video blot 的 HTML 导出。隔离浏览器在默认配置下实际复现恶意属性进入导出字符串；本应用两个编辑器的明确格式白名单均不含这两种 blot，实际插入与粘贴探针均无法保留这些 embed；通用显示消毒也会删除导出中的事件属性。这是已验证的应用触发面限制，不是声明上游库已修复。未来放开 formula/video 或新增直接导出渲染必须重新检查。[官方发行](https://github.com/slab/quill/releases)、[研究者原始披露](https://fluidattacks.com/advisories/diomedes)。
- **sprintf-js：保留中等级依赖告警。** 当前依赖链为 Mammoth → argparse → sprintf-js 1.0.3；registry 最新 sprintf-js 1.1.3 仍在影响范围，Mammoth 最新 1.13.0 仍依赖旧 argparse，盲升级不能解决。安装源码中 argparse 只由 Mammoth 命令行入口引用；以实际浏览器条件打包转换入口、Quill 与共用消毒器的模块图不含 argparse/sprintf-js，实际 DOCX 转换正常。本应用没有调用 Mammoth CLI，但依赖图仍含受影响代码，不删除它来隐藏审计结果。[上游问题](https://github.com/alexei/sprintf.js/issues/237)、[Mammoth 官方依赖](https://github.com/mwilliamson/mammoth.js/blob/master/package.json)。

`tools/dependency-preview-security-test.mjs` 的 13 项检查自然退出 0，浏览器阻断所有外部请求，使用合成 XLSX/DOCX 和本地恶意属性标记。没有拿真实用户文件做漏洞测试。该脚本不等于 SheetJS 全套上游 CVE 回归，也不能证明所有恶意 Office 文件都不会造成资源消耗。

## 复现命令

在仓库根目录运行：

```sh
node tools/seafile-account-lifecycle-test.mjs
node --import ./tools/ts-resolve-register.mjs tools/network-log-privacy-test.mjs
node tools/dependency-preview-security-test.mjs
pnpm audit --prod
node --import ./tools/ts-resolve-register.mjs tools/org-collaboration-test.mjs
node --import ./tools/ts-resolve-register.mjs tools/i18n-runtime-test.mjs
node --import ./tools/ts-resolve-register.mjs tools/i18n-settings-routing-test.mjs
node tools/i18n-security-boundaries-test.mjs
node tools/mail-state-test.mjs
node tools/settings-search-coverage-test.mjs
node tools/search-landing-test.mjs
pnpm --filter @onethu/desktop typecheck
```

浏览器运行时验收需先启动本地开发服务，再按 `tools/i18n-runtime-browser-test.mjs` 的环境配置执行；它使用隔离浏览器上下文与合成内容，不需要真实账号。
