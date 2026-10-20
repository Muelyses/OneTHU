# 国际化业务边界复核

日期：2026-10-20。范围为本轮批量提取对协议判断、路由、持久化身份及静态文案缓存的影响；不代表英文翻译质量或全部页面已经验收。没有向学校接口发送请求。

## 已修复

| 位置 | 原风险与修复 |
| --- | --- |
| `pages/info/ThosPage.tsx:60`、待办合并过滤器 | 校方返回「任务已被…办理」「退回修改」「待我处理」是原始协议文本。恢复原文判断，只翻译显示结果，避免英文模式漏掉待处理任务。 |
| `pages/info/WasherTab.tsx:265`、`components/LiveTiles.tsx:91` | 缺名设备的「设备」原本参与 AtomRef key、深链 DOM target 和设备查找。分离稳定 deviceKey 与翻译 title，切语言后同一个收藏仍能匹配。 |
| `state/systemCal.ts:43`、`plugins/XiaodaPane.tsx:22`、`pages/xiaoda/XiaodaPage.tsx:38` | 原生日历名称与校方智能体名称保留原始身份值；不能将当前语言写进原生身份或校方消息元信息。 |
| `pages/zhjwxk/Courses.tsx` 的三处 `infoNewsQuery` | 恢复学校公告检索使用的「北京大学 北京外国语大学」「北京大学 研究生」，仅按钮可见文本翻译。 |
| `plugins/ChatDock.tsx:1484` | 429 操作按钮使用真实固定 section 锚点「模型MCP日志」，不会按翻译文本寻找 OH 配置位置。 |
| `components/FilePreview.tsx:165` | Windows 预览说明改为显示时调用函数，避免模块加载时固定语言。 |
| `components/ExtHwLoginModal.tsx:53` | SMS 通道 hint 改 getter，避免把延迟翻译函数的结果再次提前存成普通字符串；通道 ID 与禁用状态保留。 |

## 动态注册表检查

- `NAV` → `homeSpheres.sphereEntry/allSphereEntries` 保留原对象；没有提前复制其 label getter。
- `navigation.BY_ID` 存原对象引用；路由、category 和服务参数保持既有 ID。
- `PAGE_ATOMS/WIDGET_ATOMS` 展示 getter 在解析时访问；动态学校名称作为用户/服务器数据保留。
- `widgets.cardWidgetDefs/appWidgetDefs/allWidgetDefs` 在函数调用时派生；`FreeBoard` 的目录 memo 依赖 UI locale。
- `quickEntries()` 在调用时生成当前标签；持久化 OneShot 仅保存 ID。`HOME_TAB` 单例 title 为 getter，没有提前 spread 为普通字符串。

上述检查未发现新的顶层复制冻结。存档中的用户自定义名称和原始学校内容不改写。

## 验证

```sh
node tools/i18n-business-boundaries-test.mjs
pnpm --filter @onethu/desktop typecheck
```

两者自然退出 0。边界测试 **39 项**，从实际 TS/TSX 提取并执行真实判断/路由/标识表达式，提供刻意不同的两套翻译返回值，避免当前尚为空的英文条目回退中文而掩盖协议错误。覆盖原始 THOS 任务状态、去重、缺名/名称/位置/类型四类洗衣机身份、三条学校检索路由、OH 锚点、原生身份和已创建提示对象的语言切换。它不是实际账户端到端验收，也不评估翻译质量。

定向 `git diff --check` 通过；本机类型检查日志为 `/tmp/onethu-i18n-boundaries-typecheck.log`。

## 状态层显示文案补齐

在以上边界复核之后，按协调后的文件范围补齐 **95 条** 显示消息：

- `state-completion-seed.json`：75 条，暂存箱/组织口令显示原因、对象打开 toast、学校模型预检提示、场馆二次认证、内容接收反馈，以及校园数据指定的 prompt/错误提示。
- `small-display-completion-seed.json`：20 条，通知设置动作、小组件实例摘要/运行标题、工具与 OneFlow 执行错误、好友空留言、原生悬浮窗回落说明、附件读取失败。

两个文件位于 `docs/i18n/`，使用稳定键，保留中文事实源、插值表达式和位置；英文初值为空，交由根任务统一生成/翻译。没有把默认组织名、姓名、箱名、校方「登录成功」检测、日志、工具 ID、参数名或附件发给 OH 的系统说明改成展示翻译。动态提示用完整句与 `error/recipient/currentAccount/count/contents/reason/name/step` 具名参数。

补齐后的既有回归：

- `node tools/madmodel-auth-route-test.mjs`：31 项自然退出 0。仅给旧 fixture 补真实 i18n 导入，全部原断言保留；无校园请求或真实凭据。
- `ONETHU_TEST_OUT=/tmp/onethu-state-completion-short-share node tools/short-share-browser-test.mjs`：52 项自然退出 0，浏览器正常清理，运行时异常为空。沿用真实分享状态函数和假云盘，覆盖新旧口令、组织/名片、收发、重复、过期和撤销；输出参数新增后不覆盖历史证据。
- 首组 75 条后 desktop typecheck 自然退出 0；最后 20 条交由根任务统一执行最终类型检查和构建。

本轮报告 `/tmp/onethu-state-completion-short-share/report.json`；日志 `/tmp/onethu-state-completion-madmodel.log`、`/tmp/onethu-state-completion-short-share.log`。这些结果不等于英文词典已经填满，也不等于真实云盘账号联调通过。

## 最后一次非 JSX 人工筛查

另补 **43 条** 明确的显示消息至 `docs/i18n/final-completion-seed.json`，已由根任务合并字典。范围包括 PPTX 不支持占位、语音读屏回落、插件安装/权限反馈、分享范围摘要、壁纸库限额、更新提示、接收失败、文件缓存反馈、铃铛时间、选课草稿差分确认与覆盖说明、记忆隐私拦截原因。没有自动翻译学校原文、分类/路由 ID、学校检索词、用户名称、默认持久名称、日志及发给 OH 的附件系统说明。

同时修复了四种独立于翻译内容的行为：

- 插件安装/市场消息改为 `{text, tone}`；成功或失败不再通过中文前缀判断。12 个实际消息分支保留明确语义，译文或服务器错误中的措辞不会改变状态色。
- 新建与历史迁移的系统板仍将 `首页` 作为原始存储名称。显示语言不能改写板身份。
- PPTX 三类不支持占位的 `label` 改 getter，已加载模型可随语言切换；记忆黑名单也只延迟求值描述，匹配正则保持原样。
- 雨课堂题干 iframe 的固定反馈文本在生成文档时翻译，经 JSON 序列化并转义 `<`、U+2028、U+2029 后传入脚本，最终只赋给 `textContent`。原始题干和文件名不翻译。`ProblemBody.rebuild` 补语言依赖，已打开题干能更新反馈语言。

本轮最终定向验证均自然退出 0：

| 命令 | 结果 |
| --- | --- |
| `node tools/i18n-final-display-test.mjs` | 33 项：真实 iframe 程序、中英恶意译文、惰性描述、12 条状态分支、系统板身份及文档重建依赖 |
| `node tools/pptx-render-test.mjs` | 43 项，保留原有几何/内容/占位断言 |
| `node --import ./tools/ts-resolve-register.mjs tools/ykt-body-test.mjs` | 161 项，原有正文处理/字体/颜色断言全部保留 |
| `node --import ./tools/ts-resolve-register.mjs tools/plugin-widget-test.mjs` | 33 项，用户/插件声明内容与槽位语义保留 |
| `node tools/i18n-business-boundaries-test.mjs` | 39 项，既有协议/身份/延迟求值回归 |

日志为 `/tmp/onethu-i18n-final-display.log`、`/tmp/onethu-final-{pptx,ykt,plugin-widget,business}.log`。最终类型检查/构建由根任务统一执行。原生小组件的快照与 Kotlin 重画语言契约交由另一位 agent 成套处理，没有在这里仅翻译 TS 初始文本而留下原生周期重画恢复中文的断层。

## 集成前独立复核

对纯 `t()` 回调删除 locale 依赖本身没有发现行为问题：`t()` 在调用时读取当前语言，稳定回调仍能使用新语言；不应因此重新执行请求、提交或清空编辑状态。真正生成并缓存显示结果的 memo 仍需要订阅语言。

本次发现并修正两处遗漏：

- `state/data.ts` 的 `useXkWorkbench.semesterOptions` 增加语言订阅和 memo 依赖；之前只依赖 `semester`，已加载工作台的“当前学期”标签会冻结。秋/春/夏改为三个完整显示模板，选择值仍是原始 `YYYY-YYYY-number`，不改变服务参数。
- `pages/info/reportParts.tsx` 的 `useReportStats.groups` 增加语言订阅和 memo 依赖；缺学期名称的本地显示回落能更新，学校提供的学期原文不改。数值计算不因翻译重取数据。

`docs/i18n/display-memo-completion-seed.json` 新增 3 条显示模板；`node tools/i18n-display-memo-test.mjs` **10 项**自然退出 0。测试执行实际 memo 构造与依赖缓存，覆盖中英切换、9 个学期值跨年不变、原成绩对象与均分/学分保留。日志 `/tmp/onethu-i18n-display-memo.log`。

复核同时确认组织表单入口仍有先求值的标题/字段字符串，不能仅凭通用 FormModal 支持描述符就称所有业务表单已支持打开状态下换语言；已交给负责表单入口的 agent 处理。中央交付报告明确区分工程接入与英文翻译、浏览器模拟与实体设备、隔离服务与真实账号、下载校验与发行签名，本次未发现这些边界被夸大为生产联调完成。
