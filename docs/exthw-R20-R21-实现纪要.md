# 外部作业源 · R20–R21 实现纪要

面向用户的概览见 [external-homework.md](./external-homework.md)。

本文是雨课堂（含 Tyche / TUOJ 相关批次）R20–R21 阶段的**实现纪要与实测记录**原始稿：
接口实测、加密字体与 LaTeX 处理、原生详情页与嵌入式 WebView 提交入口的设计与踩坑。
作者：xiao-dreamr（PR #32 / 前序 R20 批次）。

---

### 28.4 雨课堂提交接口实测（2026-09-19，只读探测 + pc.js 逆向）
- **题干加密字体有解**：`get_exercise_list` 响应的 **`data.font`** 就是该次作业的字体文件
  （实测 `https://fe-static-yuketang.yuketang.cn/fe_font/product/exam_font_<hash>.ttf`）——
  下载后以 `@font-face` 应用即可正确显示 `<span class="xuetangx-com-encrypted-font">` 里的"乱码"。
- **题目结构**：`problems[].content{ ProblemType, TypeText, Body, Options, AllowResults, score, data, Answer }`；
  `problems[].user{ my_answer{content, attachment}, remark, comment[]{content,index,name,avatar,attachment}, count }`
  —— 我的作答、**老师批改评语/批注**都能拿到。
- **提交接口（官方 pc.js `submitProblem` 原文）**：`POST /mooc-api/v1/lms/exercise/problem_apply/`
  body `{classroom_id, problem_id, answer}`，**逐题提交**。题型 → payload 映射：
  - `ProblemType` 1 / 6 → `answer: [s.toString()]`；2 / 3 → `answer: s`；
  - 4（多空填空）→ `answers: {num: answer}`；5（主观题）→ `answer: s`（JSON，AllowResults text/pic/file）；
  - 9 → 外链 OJ（`answer_problem_url`，不在本站提交）。
  - 组作业：`problem_group_apply` + `exercise_id`。
- **附件/图片上传**：候选 `/c27/online_courseware/service/upload/`、`/pc/upload_info/exercise_attachment/`
  （字段与响应需再确认一次）。
- 其他：`max_retry`（本题重交上限）、`is_allowed_late_submission`、`late_submission`。

### 28.5 R20-B/C 设计（仿网堂范式）
- **页面（原生）`YktAssignmentDetailPage`**：
  - 头部：作业名 / 截止 / 重交上限 / 我的得分与批改状态 / 说明；
  - 题目列表：题号 + 题型 + 分值 + 我的作答状态（未答 / 已交 / 已批 + 得分 + 老师评语）；
  - 每题卡片：**题干区用本地小 WebView**（内联 HTML + `data.font` 字体 + KaTeX 渲染 `$…$`，加密字体因此正确显示）
    + 作答区（按题型）+ 本题「提交」（逐题）+ 剩余重交次数。
- **作答区（R20-C）**：单选/多选/判断/填空 → 原生控件（选项来自 `Options`/`data`）；
  主观题 → Quill 富文本 + 图片/附件上传（走 upload 接口）→ 组装 `answer`。
- **与网堂的差异**：网堂是整份作业一次 `tjzy` 提交；雨课堂是**逐题** `problem_apply`；雨课堂题干有字体反爬。
- **红线**：试卷（type 6）永不提交；题型 9 只跳外链；仅 `is_allowed_late_submission`/未过截止/未超 `max_retry` 时开放提交；提交前二次确认并展示将提交的内容。
- **分步**：R20-B（只读：详情 + 题干渲染 + 我的作答/评语）零写风险，先做；R20-C（提交）需先确认 upload 字段，再做灰度。

### 28.6 R20-A 已知缺陷（霖 22:35 反馈，待修）
- 移动端内嵌桌面模式只显示页面**左 1/3**且**无法拖动/缩放**。
- 修法：WebView 加 `setInitialScale()`（按桌面 1200px 宽适配屏宽）+ 双指缩放
  （`setSupportZoom/builtInZoomControls(true)` + `setDisplayZoomControls(false)`）+ 允许水平滚动；
  并给「按屏宽缩放 / 实际大小」切换按钮。

### 28.7 R20-B/C 实施计划（自定义原生 UI 为主，WebView 降为备选）
**范围**：移动端（Android）优先——桌面端雨课堂网页版体验良好，桌面保持现状（外链）；同一页面桌面也可打开，仅入口默认移动端。

**阶段**
- **B1 数据层（core，0.5 天）**：`getExerciseDetail(leafTypeId, classroomId, uvId)` → 归一化
  `YkExerciseDetail{ name, description, deadline, maxRetry, lateAllowed, answerCount, fontUrl, problems[] }`；
  `YkProblem{ problemId, index, type, typeText, score, bodyHtml, options?, allowResults, maxRetry,
  myAnswer?{contentHtml,attachments[]}, myStatus: 未答/已交/已批, myScore?, remark?, comments[] }`；
  用真实响应快照（脱敏）做单测。
- **B2 详情页 UI（1 天）**：`YktAssignmentDetailPage`：头部信息条（作业名/截止/重交上限/得分与批改）+ 题目列表 +
  我的作答与老师评语；入口 = 移动端作业列表 雨课堂 条目 → 原生页。
- **B3 题干渲染（1 天）**：`<ProblemBody>` = 本地小 WebView：内联 HTML + `@font-face` 挂 `data.font`（下载后缓存到应用数据目录）
  + 轻量 `$…$` LaTeX 渲染；字体失效自动重取，渲染失败降级（去掉加密 span 兜底）。
- **C1 客观题作答与提交（1.5 天）**：题型 1/2/3/4/6 原生控件（选项来自 `Options`/`data`）+ 逐题 `problem_apply`
  + 二次确认 + 剩余重交次数 + 提交后刷新真实状态；mock 测试断言 payload 形状与题型映射。
- **C2 主观题（5）+ 附件（1.5 天）**：Quill 富文本 + 图片/附件上传（先确认 `/c27/online_courseware/service/upload/` 字段）
  → 组装 `answer`；展示上次作答与老师评语。
- **C3 打磨（0.5–1 天）**：重交/撤回语义、批改评语展示、桌面入口开关、错误文案。

**红线（写死在实现里）**：试卷（exam/type 6）永不提交；题型 9 只跳外链；仅未过截止、未超 `max_retry`、
`is_allowed_late_submission` 允许时渲染提交；提交前二次确认并展示将提交内容；提交后立即刷新真实状态（不乐观更新）。

**风险与对策**：字体 URL 时效 → 本地缓存 + 失效重取 + 降级；接口变更 → 失败保留原文案 + `log_debug` 诊断，不静默；
风控 → 逐题提交（与官方一致）、不并发轰炸、失败退避；不可逆 → 二次确认 + 显示剩余重交次数。

**验收**：每阶段 typecheck/build/三个测试全绿 + 手机人工确认；B 验收 = 手机上完整看题（加密文字正常）+ 看到我的作答与评语；
C 验收 = 用一道「不计入总分」的作业做灰度提交（霖确认后再放开）。

**备选**：某题型原生控件成本过高时，该题卡片退化为「内嵌 WebView 单题视图」（复用 B3 组件），其余仍原生。

### 28.8 R20-B2 实现纪要（2026-09-19）
B2 = 雨课堂作业**原生只读详情页**：移动端作业列表的雨课堂条目不再整页缩放看桌面版网页，
直达本页；桌面端保持 R20-A 外链现状（入口分流不变），但页面本身桌面也能正常打开。
**只读红线落地：全页无任何提交/作答输入入口**（提交属 C1/C2）；试卷（kind exam / type 20）
进本页同样只读；题型 9（外链 OJ）只渲染外链跳转，无作答/评语区。

- **数据补齐（core）**：`ExternalHomework` 增 `leafTypeId?/classroomId?`（仅 yuketang 的 fetch()
  设置，来自 activity.content.leaf_type_id 与 classroom_id——详情端点必需参数，深链 URL 里没有，
  必须随列表透出）；`Homework` 镜像为 `externalLeafTypeId?/externalClassroomId?`（对齐既有
  `externalUrl/externalProgress` 命名）。详情归一化增补：`YkExerciseDetail.lateDeadline?`
  （data.late_submission 毫秒 → 本地 "YYYY-MM-DD HH:MM"，缺失/0 不设）、`YkProblem.myAnswerAttachments?`
  （my_answer.attachment 非对象/空白名过滤，空数组不设）与 `externalUrl?`（题型 9 的
  content.data.answer_problem_url，仅 http(s)）。`createYuketangSource` 与详情类型透出到包入口
  （此前只在 `exthw/yuketang.ts`，state 层要自行注入凭据/fetch 就得能从 `@onethu/core` 导入）。
- **state 层薄包装（`state/exthw.ts`）**：`toHomework` 补两字段映射；新增
  `fetchYktExerciseDetail(leafTypeId, classroomId)` = 读 `getExtHwCreds().yuketang`（未登录 → 抛
  明确中文错误）+ `universalFetch` + `creds.days ?? 30` 建 `createYuketangSource` 后调
  `getExerciseDetail`（uvId 回落链：参数 → 凭据 → "2598"）。失败原样上抛，页面绝不静默吞。
- **纯判定/展示（`lib/yktDetail.ts`，零依赖可 Node 直测，约定同 `androidHost.ts`）**：
  `pickYktDetailEntry(androidHost, row)`（Android 宿主 + yuketang + 双参数齐备 → native，其余
  external）、`yktStatusChip`（已批改带分/已交未批/未作答）、`yktExerciseSummary`（total/answered/
  graded/scoreSum/整卷徽标；**无一题透分时 scoreSum 不设**，避免把未出分显示成 0）、
  `yktTypeText`（typeText 缺失按 ProblemType 兜底）、`yktIsExternalLinkProblem`（type===9）、
  `yktAttachmentsText`。宿主信号采集（isTauri + isAndroidNavigator 多信号，tauri.conf 伪装
  Windows UA 也不误判）收在 `lib/extHwBrowse.ts isAndroidHostEnv()`，纯判定与信号采集分离。
- **入口接线**：`shared.tsx HomeworkRow`（全部作业/课程详情/搜索）与 `HomeWidgets.tsx HomeworkRows`
  （今日页）点击外部作业时先过 `pickYktDetailEntry`：native → `navigate("learn-ykt-detail", {ykt,
  from})`，否则维持 R20-A `openExternalHomework`（桌面行为零变化）。`state/app.tsx` 增
  `Page "learn-ykt-detail"` 与 `LearnNav.ykt?: YktNav{ leafTypeId, classroomId, externalUrl?, title?,
  deadline?, courseName?, kind? }`——列表行已知信息仅作详情未回来时的头部兜底与「在网页中打开」
  备用入口（详情响应无整卷截止字段，截止恒用列表值；详情 name 到达后覆盖 title）。
- **页面（`pages/learn/YktAssignmentDetailPage.tsx` + `global.css` 追加 `.ykt-*`）**：移动端优先
  单列布局。PageHead（作业名 + 课程·截止 + 返回 + 「在网页中打开」= R20-A 通道备用入口）；
  loading = SkeletonRows；错误 = ErrorNote 保留 core 原始错误文案 + log_debug 留痕 + 重试 +
  网页出口提示。头部信息卡：截止倒计时徽标（timeLeft）、整卷批改徽标、考试 tag（exam）；
  作业信息键值：截止时间 / 补交截止（lateDeadline）/ 重交上限（0 → 「不可重交」，归一化保守口径）/
  是否允许迟交 / 作答进度 X/Y / 我的得分（已批合计，仅在有已批透分时显示）。题目卡：第 N 题 +
  题型 + 分值 + 单题批改徽标；题干/我的作答 = 基础 innerHTML 渲染（**TODO(B3)：xuetangx 加密字体
  @font-face + $…$ LaTeX**，本版加密 span 显示占位字形属已知形态；雨课堂 CDN 图片交 WebView
  原生加载，不走 learn 图片管道）；老师评语按纯文本 pre-wrap 渲染（实测为纯文本，不按 HTML 注入）；
  题型 9 只给「打开外链题目 ↗」（openExternal 系统浏览器——OJ 会话在浏览器不在应用 WebView）。
- **测试**：新增 `tools/ykt-detail-ui-test.mjs` 55 断言（入口分流 7、展示口径 19、整卷汇总 14、
  core 新字段 15：列表 leafTypeId/classroomId、lateDeadline 及缺失/0 回归、附件过滤、题型 9 外链
  与非 http(s) 拒收）。`toHomework` 两行映射与 `fetchYktExerciseDetail` 依赖 tauri/localStorage，
  Node 无法加载，由 typecheck + 真机烟测兜底。
- **验证**：`pnpm typecheck`（core / desktop / info-lib / ui 全绿）、`tools/exthw-status-test.mjs`
  169 通过 / 0 失败、`tools/ykt-exercise-detail-test.mjs` 79 通过 / 0 失败、
  `tools/ykt-detail-ui-test.mjs` 55 通过 / 0 失败。真机（雨狐侧 Android 构建/安装）验收项：
  雨课堂条目直达本页、倒计时与批改徽标、题目/作答/评语完整可读、加密字体占位已知、
  「在网页中打开」回 R20-A WebView、桌面点击雨课堂条目仍走系统浏览器。

### 28.9 R20-B2b 实现纪要（2026-09-20，霖真机反馈修正）
**真机反馈**：Android 上点雨课堂作业仍打开官方页 WebView（R20-A 备用通道），B2 原生详情页
没触发。审计结论两条：① B2 入口分流接漏点击点——只接了 `shared.tsx HomeworkRow` 与
`HomeWidgets.tsx HomeworkRows`，`SearchPage.tsx SearchHomeworkRow` 直接 `navigate` 站内详情
（外部源没有站内详情记录，属漏接）；② 入口判定的「Android 宿主」门槛本就多余——原生页
桌面同样可用，行数据缺 `externalLeafTypeId/externalClassroomId` 时回退 external 属正确
兜底，但宿主限制让 PC 永远进不了原生页。

- **纯判定改三态（`lib/yktDetail.ts`）**：新增 `pickHomeworkRoute(row)`（ykt-native /
  external-web / internal）——yuketang + leafTypeId/classroomId 齐备 → ykt-native，
  **不再看宿主，全平台默认原生（PC 同样直达）**；非雨课堂 / 参数缺失 → external-web；
  无 source → internal。`pickYktDetailEntry(row)` 改单参签名，成为 ykt-native 的两态
  投影（旧口径兼容）。判定条件唯一出处收敛到本函数。
- **唯一执行层（`lib/homeworkEntry.ts` 新文件）**：`openHomeworkRow(h, {navigate, from,
  courseName})` 把三态落成动作（learn-ykt-detail 导航 / `openExternalHomework` /
  learn-assignment-detail）；外部源行无 externalUrl 保持旧口径 no-op。ykt 导航参数拼装
  只此一处，点击点不再各写一份。
- **接线收敛**：三处点击点全部改走 `openHomeworkRow`——`shared.tsx HomeworkRow`
  （全部作业/课程详情/搜索外列表）、`HomeWidgets.tsx HomeworkRows`（今日页/收藏夹作业卡）、
  `SearchPage.tsx SearchHomeworkRow`（全局搜索，本次补接）。`extHwBrowse.isAndroidHostEnv`
  失去全部调用方，随之删除（Android 宿主判定仍活在 pickExtHwOpenChannel 内部）。
- **「浏览器打开」文案统一（`YktAssignmentDetailPage`）**：页头按钮与错误态提示由
  「在网页中打开」改「浏览器打开」；行为不变（桌面 = 系统浏览器打开官方页，移动 = R20-A
  桌面模式 WebView 通道，分流在 `openExternalHomework`）。
- **测试**：`ykt-detail-ui-test.mjs` [1] 改三态全平台口径（9 断言）；新增 [5] 入口接线
  静态审计 14 断言（三点击点必须走 `openHomeworkRow`、不得自拼判定/直连详情页，
  homeworkEntry 三态动作齐全，「浏览器打开」文案回归）——漏接回归网。全文件 69 通过 /
  0 失败。
- **验证**：`pnpm typecheck`（core / desktop / info-lib / ui 全绿）、
  `tools/exthw-status-test.mjs` 169 通过 / 0 失败、`tools/ykt-exercise-detail-test.mjs`
  79 通过 / 0 失败、`tools/ykt-detail-ui-test.mjs` 69 通过 / 0 失败。真机验收项：
  Android 在全部作业/今日页点雨课堂条目直达本页（参数缺失的行仍回退网页打开）；桌面
  （PC）点同条目同样进本页；页头「浏览器打开」桌面开系统浏览器、移动回 R20-A WebView。

### 28.10 R20-B3 实现纪要（2026-09-20：题干渲染——加密字体 / LaTeX / 图片代理）

**目标**：B2 详情页的题干 / 我的作答从「innerHTML 占位」升级为完整渲染管线：
`xuetangx-com-encrypted-font` 加密字体（`data.font` 下载缓存 + `@font-face`）、`$…$` 与
`$$…$$` LaTeX、图片带会话代理；**永不白屏**，每一环失败只降级该环。

**形态选型：本地内联沙箱文档（iframe `srcdoc` + `sandbox="allow-scripts"`），两端一套代码。**
对比过「移动复用应用内 WebView 能力」的方案：应用内 WebView（R20-A 通道）是**整页级**
能力，塞单题内容要为移动端单独造一座 JS 桥（加载 HTML、双向 postMessage、高度回传、
生命周期管理），而桌面端 iframe 本就可用——等于维护两套宿主胶水。srcdoc iframe 则在
桌面（WebView2 / WKWebView / WebKitGTK）与移动（Android System WebView）上对
`srcdoc + sandbox + postMessage + document.fonts` 的支持完全同源，**零平台分叉**；且
opaque origin（不给 `allow-same-origin`）天然隔离外部平台 HTML——碰不到应用存储 /
Cookie / DOM，比同源 innerHTML 少一整层注入面。成本最低且两端一致，选它。

**分层**（判定收敛纯逻辑，IO 薄壳，组件只做胶水）：
- `lib/yktBody.ts`（纯逻辑，Node 直引可测）：LaTeX `$…$`/`$$…$$` 定界扫描（价格
  `$5 与 $6` 不误判、`\$` 转义、未配对/失败逐段保原文）、`stripEncryptedFontClass`
  兜底、`sanitizeForInlineDoc`（script/容器标签/on*/`javascript:` 去活性，与沙箱双保险）、
  `hardenYktImgs`、字体缓存判定纯函数（`fontMimeFromBase64` magic / `isFontCacheFresh`
  TTL+url 对档+时钟回拨 / `fontDownloadAllowed` 退避 / `yktFontCacheKey` 兼容 Rust
  `safe_name` 白名单）、`buildYktProblemDoc` 拼装。
- `lib/yktAssets.ts`（IO 薄壳）：字体「进程内去重 → 磁盘缓存（复用 Rust
  `state_read`/`state_write`，appData/state/，**7 天 TTL**，失败 **10min 退避**且退避期
  不打网络）→ `fetch_binary` 下载（带雨课堂 Referer；magic 校验防 404 页/HTML 垃圾入
  缓存）」；图片代理 `fetchYktImageAsDataUrl`（仅 yuketang/xuetangx 自有域附加会话
  Cookie，不向第三方图床外泄凭据）。
- `lib/yktKatex.ts`：KaTeX **懒加载**胶水——`katex.mjs`（≈265KB min）与内联 CSS
  （≈368KB）都走动态 import，Vite 分包，**无公式的作业一个字节不进主包**；
  `throwOnError: true` 让单公式失败由 `safeRender` 兜回原文、同文档其余公式照常；
  `trust: false` 不展开 `\href/\url`（公式不成为第二个链接通道）。
- `components/exthw/ProblemBody.tsx`：srcdoc iframe 宿主——高度自适应
  （文档脚本 load/ResizeObserver/延时三保险上报，`YKT_FRAME_MIN_H/MAX_H` 钳制）、
  图片直挂失败→代理重试一次→占位框+文件名、字体挂载后 iframe 内 `document.fonts`
  校验失败→`force` 重取一次（防打转）、文档内链接拦截走系统浏览器外开、
  postMessage 全程 `ev.source` 核对。

**KaTeX 离线自包含（vendor）**：`src/vendor/katex/` 内置 katex@0.16.22 官方
`dist/katex.mjs` + `types/katex.d.ts`（改名 `katex.d.mts`）+ MIT LICENSE；`katexInlineCss.ts`
为生成产物——`katex.min.css` 全部 20 个 `@font-face` 改写为**仅 woff2 的
`data:font/woff2;base64`**（四类目标 WebView 全支持 woff2，woff/ttf 段丢弃），随文档
字符串进 srcdoc（iframe 是 opaque origin 加载不了包内相对资源），且**只进真渲染出
`class="katex` 产物的文档**（`extraCss` 门禁，无公式文档零开销）。不用运行时 CDN：
内网/离线直接失效，且向第三方域发公式内容有泄露疑虑。

**降级链（写死在实现里，验收口径「永不白屏」）**：① katex 加载失败/单公式解析失败 →
`$…$` 原样保留；② 字体 404/超时/退避中/非字体 magic → 剥加密 class 普通字体显示原文
（宁错字不丢字）；③ 字体挂上但 iframe 内校验失败 → force 重取一次，仍败维持剥 class
形态；④ 图片直挂失败 → 代理重试一次 → 占位框+文件名。Cookie 通道：`getYktCookie()`
（state 层内存传递，不落日志）。

**接入面**：`YktAssignmentDetailPage` 四处正文全走 `ProblemBody`——题干（普通题 +
题型 9 题干）/ 我的作答 `myAnswer.contentHtml` / 作业说明 `description`；`fontUrl` 用
整卷 `YkExerciseDetail.fontUrl`。**红线不变**：全页只读，无任何提交 UI（测试审计
`onSubmit/提交答案/submitAnswer` 零命中），题型 9 仍只给外链跳转。

**测试**：新增 `tools/ykt-body-test.mjs`（125 断言，Node 直引 + 真实 vendor katex 烟测）：
[1] LaTeX 定界/转义/逐段降级 [2] 加密字体判定与剥 class [3] 字体缓存判定（magic/TTL/
对档/时钟回拨/退避/键形态）[4] sanitize 与 Cookie 域判定（防第三方外泄）[5] 拼装降级
与 extraCss 门禁 [6] KaTeX 集成烟测（含「只有价格 $ 不注入 CSS」）[7] 接线静态审计
（四处 ProblemBody、无 allow-same-origin、`ev.source` 核对、强刷仅一次）。回归：
`pnpm typecheck` 全绿（core/desktop/info-lib/ui）；`tools/exthw-status-test.mjs` 276 通过 /
0 失败；`tools/ykt-exercise-detail-test.mjs` 79 通过 / 0 失败；
`tools/ykt-detail-ui-test.mjs` 69 通过 / 0 失败；`pnpm --filter desktop build` 通过
（katex 双 chunk 确认懒加载，主包无增量）。

**真机验收项（待霖）**：① 含加密字体的作业——题干真字正常显示（非占位字形）；
② 含公式的作业——`$…$` 出正式数学排版；③ 断网/字体 404 场景——题干仍出文字（普通
字体），不白屏；④ 大图/防盗链图——占位框显示文件名或代理加载成功；⑤ PC 与 Android
同一页面观感一致。

#### 28.10.1 R20-B3 修复纪要（2026-09-20 霖 PC 实测反馈：加密字体仍乱码）

**现象**：PC 端题干里 `xuetangx-com-encrypted-font` 加密段仍是中文乱码原字符；LaTeX
渲染正常 → srcdoc iframe / postMessage / 高度自适应链路皆通，问题聚焦字体环。

**排查结论（五向全查）**：
1. **Tauri CSP——排除**。`tauri.conf.json` `app.security.csp = null`（不注入 CSP），
   仓库内也无 meta CSP；srcdoc iframe 未被拦 `data:` 字体。
2. **下载链路——无法真连复核（环境里 YKT_COOKIE 已过期：basic-info 返回 code=50000、
   get_exercise_list 返回 401000「Session not exists」，未尝试任何登录）**；静态复核：
   `detail.fontUrl`（`data.font`）host 落在 `shouldAttachYktCookies` 白名单内，
   `fetch_binary` 带 Cookie + Referer `https://pro.yuketang.cn/` + UA，magic 校验
   （wOF2/OTTO/0x00010000）口径正确；且乱码形态与「拿到字体」并存（见根因），可判
   下载链路不是本根因。
3. **data: URL mime——排除**。`fontMimeFromBase64` 按 magic 判 `font/ttf|otf|woff|woff2`，
   与 vendor katexInlineCss 同口径。
4. **就绪判定——有洞（已补）**。原 `fontCheck` 只查 `document.fonts.load` 成功与否；
   而「@font-face 载入成功」与「span 的 font-family 规则生效」是两件事，前者在规则被
   丢弃时照样成功 → 误报 `ykt:font-ok`，组件不触发强刷，静默保持乱码。
5. **font-family 匹配——根因**。见下。

**根因（引擎级实测复现）**：`YKT_DOC_CSS` 里加密 span 规则写的是
`font-family:"YktEncrypted",inherit`。**CSS 全局关键字（inherit/initial/unset/…）不能
作为 font-family 列表的一项**——不是"回退到父级字体"，而是整条声明在解析期即被引擎
按非法值**静默丢弃**。后果链：span 计算样式永远是正文字体栈 → 加密码点按普通字体显示
（= 乱码）；无人引用 `YktEncrypted` → `@font-face` 保持 `unloaded`（白下载白缓存）；
`document.fonts.load` 照样成功 → fontCheck 误报 OK → 无任何降级/重试信号。该错误
跨平台同构（Blink/WebKit 同规），PC 与 Android 会一起中招。实测：Windows Edge
（=WebView2 同 Blink 内核）headless 渲染 B3 产物，`sandbox="allow-scripts"` srcdoc
iframe 内 span 计算样式为正文栈、`@font-face` `unloaded`、样式表里该规则不存在
（`ruleSurvived:false`）——与霖的 PC 现象逐项吻合。

**修复**（`apps/desktop/src/lib/yktBody.ts` + `yktAssets.ts`）：
1. 新增 `YKT_DOC_FONT_STACK` 常量（`-apple-system,'PingFang SC','Microsoft YaHei',
   'Noto Sans CJK SC',system-ui,sans-serif`），body 与加密 span 回退栈共用同一常量；
   span 规则改为 `font-family:"YktEncrypted",<YKT_DOC_FONT_STACK>`——合法列表、加载
   失败/未覆盖字符的观感≈普通正文（宁错字不丢字的本意这才真正落地）。
2. `fontCheck` 就绪判定升级为**双确认**：`document.fonts.load` 载入成功后，再取首个
   非空加密 span 的 `getComputedStyle(...).fontFamily` 核对确实含 `YktEncrypted`，
   任一不满足 → `ykt:font-fail` → 组件既有 force 重取一次路径接管（防同类静默失效）。
3. `loadYktFont` 失败结果不再驻留进程内记忆（`mem.delete`）——否则下载失败一次后该
   URL 永远命中失败的 Promise，10min 退避窗口形同虚设、重启前再无重试机会。

**回归验证**：Windows Edge headless 复测修复后产物——span 计算样式
`YktEncrypted, -apple-system, 'PingFang SC', …`（规则存活）、`@font-face` 达 `loaded`、
`document.fonts.load('16px "YktEncrypted"')` resolve `loaded`；还原旧规则对照组依旧
`ruleSurvived:false` + `unloaded`（根因可复现、修复生效双向成立）。`tools/ykt-body-test.mjs`
新增 10 断言（span 规则合法性回归网 / 字体栈同源 / 就绪判定双确认 / 失败不驻留记忆），
135 通过 / 0 失败；`pnpm typecheck` 全绿；exthw-status 276 / ykt-exercise-detail 79 /
ykt-detail-ui 69 均 0 失败。

#### 28.10.2 R20-B3 修复纪要（2026-09-20 霖 PC 实测反馈：老师评语渲染两次）

**现象**：原生详情页老师评语区同一内容出现两处——一处是我们的结构化「老师评语：…」
（`user.remark` 渲染），另一处是「盛洁：…」（批注人名 + 完全相同的内容）。

**排查与定位（2026-09-20）**：环境里 YKT_COOKIE 已失效（v3 basic-info code=50000、
get_exercise_list 401000「Session not exists」，见 28.10.1），无法拉新快照复核；按既有
实测字段表（28.4）+ R16 21.1 判别器 + 霖所见形状三方定位：雨课堂已批改题
（status 4）会把同一段评语**同时写进 `user.remark`（总评）与 `user.comment[]`（批注，
带批注人 name/avatar）**，我们两条结构化渲染路径（remark 逐字 / comment[] 逐条带名）
各渲染一次 → 双显。「my_answer.content 内嵌批注块」假设可排除——批注人名前缀
「盛洁：」恰是我们 comments 渲染里 `c.name` 的拼接产物，myAnswerHtml 渲染链路
（yktBody）不含该形态，且我的作答正文与评语区在页面上是两个独立区块。

**方案（去重收敛在展示层，core 数据不动）**：core 继续忠实透出 `remark` / `comments`
两字段（R20-C 提交链路与未来导出仍要原始数据）；`apps/desktop/src/lib/yktDetail.ts`
新增纯函数 `dedupeYktRemarks(p)`，`YktAssignmentDetailPage` ProblemCard 评语区改为
渲染去重后口径。同文判定键 = 去所有空白 + 冒号全半角折叠；`remark` 与某条具名批注
同文（含「名：内容」嵌名形态）→ **保留批注行、总评不再单独渲染**（批注含批注人 =
渲染信息更全的规整口径，霖看到的「盛洁」得以保留且只出现一次）；无名批注与 remark
同文 → 两形态渲染等价，保留 remark、丢批注。不同文的评语一律原样保留（总评 +
逐条批注并存的合法形态不受影响）；remark 缺位时批注之间自身去重（首条优先）；
返回值不含空数组/空串 → 字段缺省 = 不渲染该层，两层皆空才隐藏整个评语区。
`my_answer.content` 的 HTML 批注渲染链路（yktBody）完全不动——无结构化评语的题，
题内批注照常显示（不丢任何老师批语的红线）。

**测试**：`tools/ykt-detail-ui-test.mjs` 新增 [6] 组 14 断言（霖实测同文形态 / 空白与
冒号全半角折叠 / 嵌名形态 / 无名批注等价形态 / 不同文全保留 / 批注间去重 / 空值形态）
+ 2 条静态审计（详情页必须走 dedupeYktRemarks、不得再直渲染原始 remark / comments），
85 通过 / 0 失败；`pnpm typecheck` 全绿；exthw-status 276 / ykt-exercise-detail 79 /
ykt-body 135 均 0 失败。

**真机验收项（待霖）**：雨课堂已批改作业详情页评语区应只出现一次「盛洁：…」；总评与
批注不同文的作业两段都在；无结构化评语的旧作业题内批注照常。

#### 28.10.3 R20-B3 纪要（2026-09-20 霖需求：已批改作业在入口显示分数，像考试一样）

**需求**：雨课堂已批改作业（`kind: homework`，区别于考试 type 20）此前入口行只显
「已批改」，分数要进详情页才能看到；要求像考试（R9「已提交 · 60/100」）一样在列表
入口直接显示。

**数据面侦查**：作业与试卷数据面天然不同构——考试出分走独立端点 `/v/exam/cover`
（R9 专用），而作业的批改分数**就在既有状态查询响应里**：`fetchYktStatus` 用的
`get_exercise_list/{leafTypeId}/`（与详情同端点，R16 21.1 已建 mock）里
`problems[].user.my_score`（单题得分，status 4 = 已批改、-1 为未批占位）与题面
`content.score`（卷面单题满分）同响应可得 → **零额外请求**，直接在状态路径聚合。

**方案**：
1. `packages/core/src/exthw/yuketang.ts` `fetchYktStatus`：score = 已批改题
   （status 4 且非 -1 占位，**真实 0 分照算**）的 `my_score` 合计；totalScore = 题面
   `content.score` 合计；求和经 `roundScore`（round 到百分位）去浮点尾差。**仅整卷
   已批改（graded，R16 21.1 判别器）时透出**——对齐考试「已出分才给分」口径，未批改
   不显示；无一题有有效分 → 不设 score（缺数据不谎报 0 分）；题面分值全缺失 → 只给
   score 不给 totalScore（入口显示裸分数）。状态与分数同一响应，缓存 / 聚合链路
   （fetch → ExternalHomework.score/totalScore → toHomework 既有透传）自动生效。
2. `apps/desktop/src/lib/yktDetail.ts` 新增纯函数 `homeworkEntryScoreText(h)`：已提交
   且带分 → `"X/Y"`（有满分）/ `"X"`；未提交 / 无分 → `""` 不显示。「何时有分」由
   core 决定（作业仅整卷已批改、试卷仅已出分），UI 只管显示——`shared.tsx`
   HomeworkRow 的考试分数内联表达式改走该函数（行为零变化），考试与已批改作业自此
   共用同一函数同一显示位（「已批改 · 30/40」，chip title 同步「成绩：30/40」）。
   PC / 移动共用 HomeworkRow，一套 UI 自动生效（今日页 HomeWidgets 行本就不显示
   考试分数，口径一致不加）。

**测试**：`tools/exthw-status-test.mjs` mock 扩展（leaf 102/103/104 补题面分值 +
新增零分 / 缺分 / 无满分三个边界作业），新增 12 断言：合计映射（30+0 含真实 0 分）、
卷面满分合计、未批改 / 混合批改不透分、真实 0 分照透（0/20）、无一题有效分不设
score、题面分值缺失只给 score、请求次数不变（分数随状态同响应零额外请求），
288 通过 / 0 失败；`tools/ykt-detail-ui-test.mjs` [6] 组新增 11 断言（考试口径回归
60/100、作业 30/40、裸分、真实 0 分、半分尾零、未提交 / 未批改不显示 9 条 + 接线
静态审计 2 条：HomeworkRow 必须走 homeworkEntryScoreText、旧内联拼接不得回潮），
96 通过 / 0 失败；`pnpm typecheck` 全绿；ykt-exercise-detail 79 / ykt-body 135
均 0 失败。

**真机验收项（待霖）**：全部作业 / 课程详情 / 搜索的已批改雨课堂作业行显示
「已批改 · 30/40」（无满分作业显示裸分数）；已交未批 / 未交不显示分数；考试行
「已提交 · 60/100」不受影响。

### 28.11 R20-C1 雨课堂 web 提交器全量侦查纪要（2026-09-21）

**侦查方法（不重新下载、零触发）**：复用前序会话留在 `.ykt-recon/` 的学生端 bundle 缓存
（`web/1.2.310` 三主包 + 978 个 code-split chunk，共 84MB，gitignored）。定位链：
`aiworkspace.4d1bd7dc.js` 路由表 → 学生端 `lms-graph/:classroom_id/exercise|quiz/:leaf_id`
组件 → 桌面路由组件（module 77392，落在 `chunks/69600.c171a5d7.js`）只渲染一个
`<iframe src="/v2/web/iframe-exercise/{classroomId}/{leafId}?noLeftMenu=1&…">` →
真正提交 UI 在 **rainweb（pc.js / web 1.2.310）** 的 `/iframe-exercise` 组件里（module 内联于
`pc.43fa16c6.js`，端点注册表在 `chunks/61467.e136e527.js`）。**结论 0：官方学生作业页 =
`/ai-workspace/lms-graph/{cid}/exercise/{leaf_id}` 外壳 + `/v2/web/iframe-exercise/{cid}/{leaf_id}`
内核 iframe**，两端 postMessage 交换补交状态；移动端老路由是
`/cloud/exercise/cover/{cid}/{leaf_id}/{sku_id}`（另一套）。本轮只读逆向，未对任何写端点发请求。

**表 A：题型 × 答案形态 × 提交 payload × 端点 × 行为**（题型号取 pc.js `xz` 枚举，权威：
`all:0 single:1 multi:2 vote:3 blanks:4 subjective:5 judge:6 other:7 anonymousVote:8 oj:9 material:10`）

| 题型 | ProblemType | 答案形态（前端 `_answer`） | `answer` 字段形状 | 端点 | 行为 / 限制 |
|---|---|---|---|---|---|
| 单选 | 1 | 字符串选项号（如 `"B"` / `"1"`） | `answer: [s.toString()]` | `problem_apply` | 逐题提交；非空即可交 |
| 判断 | 6 | 字符串（`"true"`/`"false"` 或选项号） | `answer: [s.toString()]` | `problem_apply` | 与单选同形（pc.js 正则 `/^1\|6$/` 合流） |
| 多选 | 2 | 字符串数组（选项号集合） | `answer: s`（数组） | `problem_apply` | 数组非空即可交 |
| 投票 | 3 | 字符串数组；`PollingCount` 上限，超出 `shift()` | `answer: s`（数组） | `problem_apply` | 同多选；匿名投票 8 未见独立提交路径 |
| 填空 | 4 | 按 `<span class="blank-item">` 切分题干，逐空 `{num, answer}` | `answers: { "<num>": "<answer>", … }` | `problem_apply` | 至少一空非空；空号从 1 起 |
| 主观 | 5 | `{ content:"<HTML>", time:"0", oSubject:{attachments:{filelist:[…]}}, pics?:[…] }` | `answer: JSON 深拷贝(s)` | `problem_apply` | 富文本 UEditor（toolbar：加粗/斜体/下划线/插图/公式/代码/前景色/背景色/有序无序列表，`maximumWords: 20000`）；正文、附件、图片三者任一非空即可交；`oSubject.isuploading` 为真时禁交 |
| 外链 OJ | 9 | `{ code:"", language:"" }`（仅本地态） | **不发 `problem_apply`** | `window.open(answer_problem_url)` + OJ 站 `/mooc-api/v1/lms/oj/submission` | 红线：雨课堂站内不提交，只跳外链；「开始作答/重新作答」按钮 |
| 材料题 | 10 | 材料壳 + 子题逐个走各自题型 | 同子题题型 | `problem_apply`（子题） | 有「逐题作答 / 整体作答」两模式、`SubmitAllQuestions` 为子题级，不是整卷提交 |
| 组作业 | — | 组答案 `groupAnswer`（同主观形态） | `answer: groupAnswer` + `exercise_id` | `problem_group_apply` | 先 `is_last_version` 判定 `shouldSubmitDirectly` / 是否有新提交，再弹 `GroupSubmitConfirm` 二次确认 |

**表 B：提交器端点地图（pc.js 逆向 + 注册表 `chunks/61467` 交叉核对）**

| 用途 | 端点 | 方法 | payload / 说明 |
|---|---|---|---|
| 作业详情（提交器与原生详情页同源） | `/mooc-api/v1/lms/exercise/get_exercise_list/{leaf_type_id}/` | GET | `classroom_id` / `term=latest` / `uv_id`，头 `XTBZ: ykt` |
| **逐题正式提交** | `/mooc-api/v1/lms/exercise/problem_apply/` | POST | `{classroom_id:int, problem_id, answer}`（题型映射见表 A） |
| 组作业提交 | `/mooc-api/v1/lms/exercise/problem_group_apply/` | POST | `{classroom_id, problem_id, exercise_id, answer}` |
| 组作业版本/新提交判定 | `/mooc-api/v1/lms/exercise/is_last_version/` | GET | 回 `{is_last, user}` → `shouldSubmitDirectly = is_last && !is_submitted` |
| 试卷整卷提交 | `/quiz/entire_quiz_submit` | POST | `{quiz_id, classroom_id, user_id, results:[{problem_id?, result, time(秒)}]}`；errcode 0 成功 |
| 试卷逐题缓存（**服务端草稿**） | `/quiz/cache_each_result` | POST | `{results:[{problemID, result, time}], classroom_id, quiz_id}`；errcode 0 成功 |
| 试卷断网重传 | `/quiz/retry_quiz_submit` | POST | `{quiz_id, data:[{problem_id, result, submit_time}], classroom_id}`；3.5s 退避最多 84 次 |
| 试卷元信息 / 状态 / 结果 | `/quiz/shapes`、`/quiz/user_quiz_status`、`/quiz/quiz_info`、`/quiz/start_quiz`、`/quiz/refresh_left_time`、`/quiz/quiz_result`、`/quiz/personal_result` | GET/POST | 见注册表 `studentQuiz` 组 |
| **作业附件上传（OSS STS）** | `/pc/upload_info/exercise_attachment/` | GET | query `exercise_id` + `problem_id`（二者都有才带）；回 `data.upload{credentials{AccessKeyId,AccessKeySecret,SecurityToken,BucketName,UploadDir}, cdn_host, region}` → ali-oss `multipartUpload`（partSize 512KB，并发 3），对象名 `UploadDir/Date.now()+文件名`，回 `file_url` |
| 通用七牛上传（试卷/PPT 等） | `/generate_qiniu_token`（`API.pc.tool.POST_QINIU_TOKEN`） | POST | `{bucket_name:"cms-attachment", expired_time:3600}` → token 存 `sessionStorage.QINIUtoken` → `POST https://upload.qiniup.com` |
| 作业详情统计 / 提交历史 | `/c27/online_courseware/exercise/statistic/{exercise_id}/{sku_id}/…`（`result_history`、`team_result_history`、`problems`、`problem_list`、`open_exercise_problem_info`、`groups`） | GET | 提交历史、逐题统计、组信息 |
| 申诉 | `/mooc-api/v1/lms/exercise/appeal/`、`/appeal/history/` | POST/GET | 批改后申诉 |
| 重置 | `/mooc-api/v1/lms/exercise/reset_exercise/{exercise_id}/{sku_id}/{user_id}/`、`batch_reset_exercise` | POST | 教师侧重做 |
| 知识点练习（非本作业） | `/mooc-api/v1/lms/exercise/learning_plan/problem_submit/`、`problem_batch_submit/` | POST | learning_plan 专用，勿混用 |

**提交粒度与草稿**
- **作业（exercise）：逐题提交**（`problem_apply`），没有「整卷一次交」端点；`SubmitAllQuestions`
  是材料题子题级。每次提交成功后把响应 `data` 合并进 `problem.user`、`_refresh=true`，并重新拉
  详情刷新真实状态（**无乐观更新**）。
- **试卷（quiz）：整卷提交** `entire_quiz_submit`，且有**服务端逐题草稿** `cache_each_result`。
- **作业草稿只在 localStorage**：`writeDraft` 把整份 problem（含 `_answer`）写进
  `localStorage[<routePath 去斜杠换横线>-<userId>]`，`refreshSubmitStatus` 每次变更即写；
  无任何服务端 save/draft 端点。键含 `userId`，换设备/换浏览器不互通。
  `max_retry>1 || max_retry==-1` 时进详情会 `localStorage.removeItem` 清草稿。
- 组作业有独立 `GroupEditAnswer` 编辑态与 `submitConfirmData` 二次确认；非组作业点「提交」直接发。

**提交 API 细节 / 防重复**
- 成功判定：`problem_apply` 响应 `r.success === true`；`data` 含 `is_correct`、`exercise_is_show_answer`、
  更新后的 `user`（含 `my_answer`、`submit_time`、`count`、`my_count`）。失败走 `.catch`，弹 `e.msg || "网络异常"`。
- 防重复：客户端 `defaultProblemStatus.isloading` 置位期间按钮 `loading` + `disabled`；提交前
  `submitStatus`（= 答案非空 ∧ 可交）为假时按钮禁用；组作业额外 `is_last_version` 版本门。
  未观察到独立的服务端幂等键；重复提交靠 `left_times`（重交次数）与官方二次确认约束。
- 试卷错误码：`errcode 0` 成功；`500002`（+`status_code` 802/803）→ 收卷异常弹窗；
  `500003` → 自动判失败；`500006` → 人工判失败；其余按 3.5s 重试、最多 84 次。

**max_retry / 允许迟交 / 截止时间在 web 端如何呈现与拦截**
- 每题的 `left_times = user.count - user.my_count`（`count>0`）；`count<=0`（缺失/0）→ `999`（不限次）。
- `isBeforeDeadLine = !score_deadline || (score_deadline - now > 0)`；一旦过了 `score_deadline`，
  `left_times` 被强制置 0（**截止时间硬拦截，优先于次数**）。
- 提交按钮：`disabled = !submitStatus || !problem.left_times || isloading`；文案
  「提交(不限次)」/「提交(剩余 N 次)」；`left_times===0` 时换成 `已提交`/`已截止` 灰按钮（不可点）。
- 允许迟交（`is_allowed_late_submission` + `late_submission{dict}`）：**不直接改提交按钮**，而是由
  aiworkspace 外壳的 `LateSubmissionStatusBar` 显示「请在 {score_deadline} 前完成补交」或
  「补交已截止，补交扣分：{deduct_score}，作业最终得分：{final_score}」；即补交窗口仍以
  `score_deadline` 为准，`late_submission.deduct_score` 决定扣分。⚠️ 与 docs 28.1/28.4 把
  `late_submission` 当毫秒时间戳不同：**实测它是含 `deduct_score` 的对象**，core 现有
  `lateDeadline = toNum(data.late_submission)` 对其取不到值（不设），待修/待真机复核。
- 题型 9（外链 OJ）：未过截止时按钮为「开始作答 / 重新作答」，过截止显示灰「已截止」。

**提交后的状态回执与「已提交」判定**
- 单题「已提交」= `!!problem.user.submit_time`（`is_submitted` computed）。
- 已批改判定仍用 R16 21.1：`user.status===4` 且 `my_score` 非 -1 占位；已交未批 `status===3`。
- 整卷完成度：`exerciseList.problems` 里 `user.submit_time` 计数等于题数 → 触发
  `checkUserApplyStateAfterLeafFinished`（学习行为完成上报）。
- `submission_status` 字段存在于响应，但提交器未用它做「已提交」判定（用 `submit_time`）。

**附件上传通道（作业）**
- 端点 `GET /pc/upload_info/exercise_attachment/?exercise_id=&problem_id=` 取 OSS STS 临时凭据
  （`data.upload.credentials`），`region:"oss-cn-beijing"`，走 ali-oss 分片上传，落 `cdn_host` 域。
- 数量/大小：**可上传 1 个附件**；默认 ≤100MB（`0x6400000`），`video_1g` 作业放宽到 1GB（`0x40000000`）。
- 类型白名单（exercise，新版组件）：`.pdf .doc .docx .wps .pages .xls .xlsx .et .csv .numbers
  .ppt .pptx .dps .key .txt .rtf .jpg .jpeg .png .bmp .tif .gif .rar .zip .7z .tar .mp3 .wav .mp4 .wmv .mov`；
  **音频（mp3/wav）以附件形式交**，无独立录音题通道；代码题走 OJ 外链。
- 附件记录形状（挂进 `_answer.oSubject.attachments.filelist[]`）：`{fileID, fileName/name, fileSize/size,
  fileType, fileUrl, …}`；`file_url` 取分片上传 `requestUrls[0]` 去 query。
- 试卷附件走七牛 `/generate_qiniu_token`（`bucket_name:"cms-attachment"`，token 缓存 `sessionStorage`），
  与作业 OSS STS 是两条通道，勿混。

**与原生详情页数据模型的差距（R20-C2 前待补）**
- core `YkProblem` 目前未透出 `user.count` / `user.my_count`（重交次数）、`user.submit_time`（单题已交）、
  `submission_status`；R20-C1 资格判定已补 `remainingRetries`（count-my_count，count>0 才给），
  其余留待原生作答 UI 阶段按需补。
- `late_submission` 对象语义（deduct_score）与 core 现有 `lateDeadline` 口径不一致（见上）。

**⚠️ 待霖扫码重登后补测（本轮 Cookie 已失效 401000，写端点一律未触发）**
- 用一道「不计入总分」的作业实测 `problem_apply` 成功响应字段与 `left_times` 递减；
- 复核 `late_submission` 真实形状（对象 vs 时间戳）与 `score_deadline` 是否为补交截止；
- 复核作业附件 OSS STS 返回字段（`cdn_host`/`UploadDir`）与 1 附件限制；
- 组作业 `problem_group_apply` + `is_last_version` 二次确认链路。

#### 28.11.1 R20-C1 嵌入式 WebView 提交入口实现纪要（2026-09-21）

**范围**：第一阶段只做「把用户送进雨课堂官方作答页」——原生 UI 不逐题作答（留 R20-C2）。
资格判定为纯函数；打开前应用内二次确认；打开后官方页的确认/拦截**原样保留**；关闭/返回
后立即重拉真实状态（禁止乐观更新）。

- **core（`packages/core/src/exthw/yuketang.ts`）**：`YkProblem.remainingRetries?` =
  `user.count - user.my_count`，仅 `count>0` 时给（`count<=0`/缺失 = 不限/未知，不设；
  与 web `left_times` 同口径），供「未超 max_retry」资格判定。
- **纯函数（`apps/desktop/src/lib/yktDetail.ts`）**：`yktSubmitEligibility(input)` +
  `parseYktLocalTime`。红线：试卷（kind=exam / 活动 type 20 / 旧 `/subject` 别名 6）与
  **全题型 9**（外链 OJ）永不出口；时间窗：未过截止放行，已过截止须允许补交且未过补交
  截止（「允许迟交」是补交分支的门，不否定按时提交）；未超 max_retry：所有题都有次数
  信息且全部 ≤0 才算超（`undefined` 不拦），题目全无次数信息时用整卷 `maxRetry=0` +
  全已提交兜底。返回 `{eligible, reason?, remainingRetries?}`。
- **执行层（`apps/desktop/src/lib/yktSubmitWebview.ts`）**：`openYktSubmitWebview(url, cookie)`
  —— invoke `open_ykt_submit_window`；桌面端以 `ykt-submit-closed` 事件等窗口关闭，移动端
  命令本身关闭才 resolve；浏览器预览明确报错。Cookie 只作 invoke 参数内存传递，不打印 /
  不落盘；非 http(s) 拒绝。
- **详情页（`apps/desktop/src/pages/learn/YktAssignmentDetailPage.tsx`）**：页头「作答 / 提交」
  主按钮**仅在 `eligibility.eligible && externalUrl` 时渲染**；点击 → `confirmOk` 二次确认
  （说明将打开官方作答页、官方逻辑原样保留）→ 应用内 WebView 打开 R16b 学生端直链并注入
  `getYktCookie()` → `finally` 里 `setTick(+1)` 重拉详情。失败保留原文案 + `log_debug`
  （**不含 Cookie**）。
- **原生通道**：
  - Rust（`apps/desktop/src-tauri/src/lib.rs`）：新增 `open_ykt_submit_window` 并注册。
    桌面端先建在 `pro.yuketang.cn` 源根，逐条 wry `set_cookie`（`Domain=.yuketang.cn` /
    `Path=/`）后 `navigate` 到官方作答页，窗口关闭 emit `ykt-submit-closed`；移动端转
    `openWebModal`（带 cookie）后 emit 同事件。
  - Kotlin（`apps/desktop/src-tauri/plugins/onethu-mobile/android/.../OnethuMobilePlugin.kt`）：
    `OpenWebModalArgs` 增可选 `cookie`；`openWebModal` 在 `loadUrl` 前逐条
    `CookieManager.setCookie` 并 `flush`（空串 = 不注入，R20-A 只读浏览行为不变）；
    **绝不打印 Cookie 值**。
- **测试**：`tools/ykt-exercise-detail-test.mjs` 补 7 断言（remainingRetries 口径）→ **86**；
  `tools/ykt-detail-ui-test.mjs` 补 [7] 节 40 断言（红线 / 时间窗 / 次数 / 时间解析 / 详情页
  接线静态审计）→ **136**；`tools/exthw-status-test.mjs` **288**、`tools/ykt-body-test.mjs`
  **135** 零改动全绿；`pnpm typecheck`（core / desktop / info-lib / ui）全绿。
- **红线落实**：入口只打开官方页，不注入脚本、不替代/不绕过官方确认与拦截；试卷 / 全外链题
  无入口；关闭后重拉真实状态（无乐观更新）；Cookie 不打印/不落盘。
- **待霖真机验收项**：① PC 与 Android 各开一份**未过截止**作业，详情页出现「作答 / 提交」，
  点击二次确认后在应用内 WebView 打开官方作答页（应已登录态，不需重新扫码）；② 在其中
  完成一题提交并关闭窗口，详情页应自动刷新出「已交未批」/真实状态；③ 试卷详情页无该入口；
  ④ 过截止且不允许补交的作业无该入口；⑤ 重交次数用完的作业无该入口（真机数据复核）。

## 二十九、R21-A：Tyche 登录失效静默自动重登（2026-09-20 霖反馈）

### 29.1 问题与验证码侦查（真连实测，2026-09-20）
- 现象（霖）：Tyche 会话失效后不会自动重登，必须手动输一次密码，很麻烦。
- 现状：Tyche 本就支持账密登录（`tycheLogin`：`GET user/GetToken?username=…` 取挑战 token →
  `password = sha1(sha1(明文口令)+token)` → `POST user/Login` 取回
  JSESSIONID/username/uid Cookie），但设置页登录成功后**只存 Cookie**，密码用完即弃；
  会话失效（实测特征 `{"status":"login"}`，HTTP 200）后没有任何自动恢复，与 R19 27.1 之前
  的 TUOJ 同病。
- **验证码侦查结论（tools/ 真连探针，2026-09-20 实测）**：
  - `GET user/GetToken?username=root` → `{status:"success", vcode:false, token:<40 位>}` ——
    **常规账号登录没有验证码挡路**（`vcode=false`，走完整静默自动重登，无需降级）；
  - `Login.html` 的 `#vcode-field` 默认 `.hide()`，仅 GetToken 返回 `vcode:true` 才 `.show()`——
    即**只有「考场锁定」账号**才需要验证码（与 2026-09-18 逆向结论一致）；
  - `GetToken?username=<不存在用户>` → `{status:"error", returnFailString:"oops"}`（错误经
    `TYCHE_FAIL` 映射中文）。
  - **降级口径（仅考场锁定账号，实测未遇）**：`vcode:true` 时 `tycheLogin` 直接报
    「需要验证码（考场锁定），无法免人工登录」，自动重登必然失败——该场景退化为
    「已记住密码时重登只需补一次验证码」的人工路径：作业页条幅 / 设置页源卡片展示
    「已尝试自动重新登录，仍失败：…需要验证码…」，用户手点「重新登录」进表单补一次即可
    （表单有密码回填 + 记住密码，只差验证码这一步；如后续真有此账号，再考虑加内嵌
    验证码输入框）。普通账号（绝大多数）不受影响。
- 顺带实测：环境里那份 `TYCHE_COOKIE` 已过期（GroupList 返回 `status:"login"`）——正是
  本需求要自动恢复的真实场景。

### 29.2 方案（对齐 R19 27.1 的 TUOJ 会话失效自动重漫游模式）
1. **记住用户名+密码**：设置页 Tyche 登录表单加「记住密码（会话失效后自动重新登录）」
   勾选（默认不勾）。勾选并登录成功后 `username+password` 随 `ExtHwCreds.tyche` 存进既有
   AES-GCM 信封 `onethu.exthw.v1`（**与现有凭据机制同路**：信封整体加密，明文不落盘、
   不打印、不进日志、不进 commit；诚实口径与 README 一致——本机混淆，非强安全）。
   不勾选则不存密码并覆盖清掉旧存档；「退出」清除整个 tyche 凭据（含密码）。
2. **会话失效检测**：`status:"login"`（接口未登录特征，实测唯一稳定标志）/
   HTTP 401/403（外层 Basic 网关拒绝）/ 非 JSON 响应（跳登录页 HTML）三种表现统一归为
   新错误类型 `TycheSessionError`（`isTycheSessionError` 判定），其余错误（网络断、5xx、
   字段异常）不触发重登。注意 `task/Status` 的内层 catch 此前会把一切错误吞成「保守未提交」，
   会话错误必须冒泡，否则自动重登永远不触发。
3. **静默自动重登一次 + 自动重拉**：`refreshExternalHomework` 新增 `reloginTyche` 钩子
   （desktop 注入）——tyche 源被 `TycheSessionError` 拒绝时调用；返回 true（desktop 用
   记住的账密走 `tycheLogin` 重登并覆盖保存凭据）→ core 重新组装该源**重拉一次**；
   单次 refresh 每源至多重登一次（防循环）。
4. **频控与去重**（与 TUOJ 重漫游共用一套机制、独立计数）：同源两次自动重登间隔
   ≥10 分钟、每进程每源 ≤3 次（**含失败尝试**）；同源并发失效共享 in-flight Promise
   （只发起一次重登，后来者共享结果，不重复计数、不受频控拦截）；
   `resetTycheSessionRetryState()` 供离线测试清零。
5. **显式退出抑制**：用户点「退出」→ `EXTHW_TYCHE_LOGOUT_KEY`（`onethu.exthw.tycheLogout.v1`）
   抑制标记，之后**绝不**自动重登（手动登录成功即解除）；未记住密码也自然不重登
   （前置不满足 → 不算「已尝试」，错误文案**不带**前缀）。
6. **失败文案与诊断**：发起过（或共享过）自动重登而该源最终仍失败的，`errors.tyche`
   加前缀 **「已尝试自动重新登录，仍失败：」**（后接原失效原因）；作业页失败条幅把
   tyche 并入渲染（原 `ExtHwTuojErrorNote` 更名 `ExtHwSourceErrorNote`），设置页源卡片
   同步展示（既有 `exthw-note is-error` 通道）；desktop 全程 `log_debug`（logLine）留
   诊断（跳过原因 / 重登成败 / 失败原因，**绝不打印凭据**）。

### 29.3 R21-A 实现记录（2026-09-20）
- **core（`packages/core/src/exthw/tyche.ts`）**：`TycheSessionError` + `isTycheSessionError`；
  `getJson` 的 401/403、非 JSON、`status:"login"` 三分支改抛会话错误；
  `createTycheSource.fetch` 的 task/Status 内层 catch 与单课程组 catch 对会话错误冒泡、
  其余照旧吞掉。
- **core（`packages/core/src/exthw/index.ts`）**：R19 27.1 的 TUOJ 重漫游编排泛化为
  「会话失效自动重登」——状态表扩为 `{tuoj, tuojClassic, tyche}`（独立计数），常量改
  `SESSION_RETRY_MIN_INTERVAL_MS`/`SESSION_RETRY_MAX_PER_PROCESS`（10min/3，TUOJ_* 与
  TYCHE_* 为兼容别名同值），in-flight 表同步扩容；`reloginTyche?: () => Promise<boolean>`
  钩子、结果新增 `reloginTyche: boolean`；失败前缀常量更名
  `SESSION_RELOGIN_FAILED_PREFIX`（文案不变）。`rerouteTuoj` 语义、TUOJ 路径行为与
  R19 完全一致（既有 27.1 断言全部原样通过）。
- **core（`packages/core/src/exthw/types.ts`）**：`ExtHwCreds.tyche` 增加
  `password?: string`（勾选「记住密码」才写入；随信封 AES-GCM 落盘）。
- **core（`packages/core/src/index.ts`）**：透出 `TycheSessionError` / `isTycheSessionError`。
- **desktop（`apps/desktop/src/state/exthw.ts`）**：
  - `EXTHW_TYCHE_LOGOUT_KEY` 显式退出抑制键 + `loadTycheReloginFlag()`（首次解密时回灌）
    + `markTycheLoggedOut()`（`removeExtHwCreds("tyche")` 自动调用）+
    `clearTycheLogoutSuppress()`（手动登录成功调用）+ `isTycheReloginSuppressed()` /
    `isTychePasswordRemembered()`（设置页提示用）；
  - `maybeAutoTycheRelogin()`：抑制 / 未记住密码 → false（log_debug 说明）；否则用存档
    账密 `extHwLogin.tyche` 重登 → `saveExtHwCreds`（新 Cookie **连同记住的账密**覆盖保存，
    下次失效仍可再登）→ true；失败静默 false。频控与去重交给 core，不二次计数；
  - `refreshExtHw` 注入 `reloginTyche: () => maybeAutoTycheRelogin()`；
  - 诊断走 `logLine`（`log_debug`）：跳过原因 / 重登成功 / 失败原因（截 200 字符），
    **不含任何凭据**。
- **desktop（`apps/desktop/src/pages/Settings.tsx`）**：Tyche 表单加「记住密码」勾选 +
  说明文案（密文存本机 / 不进日志 / 退出即清）；`credsWith` 支持 `tychePwd`（勾选才存，
  未勾选覆盖清旧存档）；`onTycheLogin` 成功后按勾选存档密码、解除退出抑制、提示文案
  区分「已记住密码，会话失效将自动重登」；「退出」同步清表单态；已登录且已记住密码时
  源卡片展示「已记住密码：会话失效将自动重新登录（静默进行，失败才会提示）」。
- **desktop（`apps/desktop/src/pages/learn/AssignmentsPage.tsx`）**：失败条幅渲染列表
  扩入 `tyche`（组件更名 `ExtHwSourceErrorNote`），文案即 core 前缀文案；「去设置重新
  登录」入口复用（落到 Tyche 卡片手动登录）。
- **验证**：`pnpm --filter @onethu/core typecheck` ✓、`pnpm --filter @onethu/desktop
  typecheck` ✓、`tools/exthw-status-test.mjs` **224 通过 / 0 失败**（169 → 224，新增
  R21-A 十三组断言：⑩类型判定三失效归一 / ⑪login→静默重登→重拉成功且新 Cookie 生效 /
  ⑫重登失败防循环+文案前缀 / ⑬普通网络错误不重登 / ⑭未注入钩子行为同旧版 /
  ⑮并发失效 in-flight 去重只登一次两轮均重拉成功 / ⑯同源 ≥10min 频控 + 每进程 3 次上限
  + 超限文案无前缀 + 与 TUOJ 独立计数 / ⑰task/Status 内层会话错误冒泡触发重登 /
  ⑱状态接口普通错误仍保守吞掉 / ⑲⑳tycheLogin 挑战 token + sha1 双哈希链路 /
  ㉑vcode=true 拒绝登录且不发 POST / ㉒returnFailString 中文映射）、
  `tools/ykt-exercise-detail-test.mjs` 79 通过 / 0 失败、`tools/ykt-detail-ui-test.mjs`
  69 通过 / 0 失败。
- **真机/真连验收项（待霖）**：设置页勾选「记住密码」登录 Tyche → 手动使 Cookie 失效
  （或等待过期）→ 刷新作业，观察条幅不出现、Tyche 条目恢复（log_debug 有「自动重登成功」）；
  输错密码登录后失效 → 条幅出现「已尝试自动重新登录，仍失败：…」；点「退出」后失效 →
  不再自动重登（log_debug「用户曾显式退出登录，跳过自动重登」）。

### 29.4 备注
- 频控数值与 TUOJ 对齐（≥10min / ≤3 次每进程）而非照搬 24h：会话失效是「常态会发生的
  事」，太苛刻会烧掉自动恢复资格（R19 27.1 同款结论）。
- 密码安全口径（诚实声明，与 README 58 行一致）：AES-GCM 信封**只是本地混淆**——密钥与
  密文同在本机 localStorage，能读存储的人仍可解出明文；它防的是「凭据以肉眼可读形式被
  顺手看到 / 随备份导出」。明文不落盘、不打印、不进日志、不进 commit；真要强保密需系统级
  凭据库（未实现，见 README）。
- `tycheLogin` 的挑战/哈希链路（GetToken → sha1(sha1(pwd)+token) → Login）未改动；
  自动重登与手动登录走同一函数，行为一致。

## 三十、R21-B：雨课堂会话失效保活 / 健康检查 / Cookie 导出导入（2026-09-20 霖反馈）

### 30.1 问题与端点侦查（真连 + 前端 bundle 全量挖掘，2026-09-20）
- 现象（霖）：雨课堂（pro.yuketang.cn）会话约 24h 失效，失效后作业页报错，必须重新登录；
  多设备（宿舍台式机 / 笔记本）每台都要各自扫码，很麻烦。
- **失效特征（真连实测，2026-09-20）**：环境里 2026-09-19 生成的 `YKT_COOKIE` 已死——
  - `GET /v2/api/web/courses/list` → **HTTP 401** + `{"errcode":401000,"errmsg":"Session not exists"}`；
  - `GET /api/v3/user/basic-info` → **HTTP 200** + `{"code":50000,"msg":"UNAUTHENTICATED","data":""}`；
  - `GET /v2/api/web/profile/info` → HTTP 401 / 401000。
  （v2 系与 v3 系失效表现不同：一个甩 401，一个 200 包错误码——归一时都要认。）
- **侦查问题**：有没有会话续期 / 刷新 / 心跳端点可以做静默保活？
- **侦查方法**：public 前端 bundle 全量端点挖掘（登录壳 `/web` 起的三份 JS：login-spa.js
  459KB、pc.43fa16c6.js 5.4MB、aiworkspace.4d1bd7dc.js 1.3MB，合计挖出 ~1800 个端点字面量），
  聚焦 `login/refresh/renew/keepalive/heartbeat/token/session` 关键词；对可疑端点不做任何
  触发（只读侦查，避免风控）。
- **侦查结论：没有会话续期端点。**
  - 登录 SPA 的端点注册表就是六个：`pc_web_login:"/pc/web_login"`、
    `pc_web_logout:"/pc/web_logout"`、`pc_web_login_ewm:"/api/v3/user/login/app-web-pre-info"`、
    `pc_web_login_confirm:"/api/v3/user/login/app-web-login"`、
    `send_sms_login_code:"/pc/login/send_sms_login_code/"`、
    `verify_pwd_login:"/pc/login/verify_pwd_login/"`——没有 refresh/renew 家族；
  - pc.js 的 738 个端点里唯一带 "heartbeat" 的是 `/video-log/heartbeat/`——那是**课堂视频
    播放心跳**，与会话无关；`/passport/login` 是 public-activities 的无关 API；
  - aiworkspace.js 的 934 个端点里 token 系全部属于考试 / AI 文档服务，与会话续期无关；
  - 即 sessionid 由服务端 Django 会话管理，**客户端没有任何「续命」手段**；
  - 附带观察：登录壳匿名访问未见任何 Set-Cookie 下发；`app-web-pre-info`（二维码 token，
    JWT、exp≈300s）可匿名调用——扫码登录链路与 R18 24.1 实现一致，无新信息。
- **结论 → 方案路线（对齐需求第 3 步）**：没有续期端点，就退而求其次——
  ① 6h 周期**保活心跳**（最轻的已授权请求试探服务端；「是否滑动续期」属实验验证项）；
  ② **会话健康检查**与失效原因归一（早发现、准确报因，不误判网络故障）；
  ③ 失效后**一键重登**（扫码弹窗直达——短信通道有图形验证码挡路，无法静默自动重登，
  与 R21-A Tyche 的静默路径本质不同）；
  ④ **Cookie 导出/导入**缓解多设备 pain（一台登录，其余导入即用，免挨个扫码）。
  ⚠️ 侦查期间环境里唯一的 cookie 已死，「心跳能否推迟过期」的**活体实验做不了**——
  实验协议见 30.5，结论待回填；本轮先落地工程设施。

### 30.2 方案
1. **失效归一 `YktSessionError`（对齐 R21-A Tyche / R19 TUOJ 口径）**：四特征统一归一——
   HTTP 401/403（网关拒绝）、`errcode=401000`（v2 系死会话）、`code=50000 UNAUTHENTICATED`
   （v3 系死会话）、非 JSON（跳登录壳 HTML）；`isYktSessionError` 判定。**网络断 / 5xx /
   字段异常不误判**——网络故障报「会话已失效」会误导用户白重登一次。文案保持关键子串
   「会话已失效」「401000」（作业详情链路既有 UI 断言依赖）。
2. **健康检查 `checkSession()`**：`GET /api/v3/user/basic-info`——全部已授权端点里最轻的
   （无列表遍历、无 XTBZ 头要求）。返回 `{alive: true|false|null, reason?, userName?, checkedAt}`：
   `alive=null` 仅网络异常（**未知 ≠ 失效**，不谎报）；`userName` 宽松取归属人姓名
   （取不到不设，纯展示）。
3. **保活心跳（desktop 编排）**：应用启动 15s 后首查（避开启动刷新高峰），此后每 6h 一次
   `checkSession`；结果进 `ExtHwSnapshot.yktSession` 供设置页展示；全程 `log_debug`
   诊断（**绝不打印 Cookie**）。
4. **Cookie 轮换回写（兜底）**：侦查未见服务端在常规 GET 上轮换 sessionid 的证据，但一旦
   轮换而我们还持旧值，就会「莫名失效」。故传输层每响应检查 Set-Cookie 透传头
   （`x-onethu-set-cookie` / `-hops` 通道，R18 已有），**白名单字段**
   （sessionid/csrftoken/uv_id/university_id/platform_id/platform_type/xtbz/django_language）
   有变化 → 合并进会话串 → `onCookieRefresh` 钩子交 desktop 用既有 AES-GCM 信封存回
   （非白名单字段如统计位绝不并入；浏览器原生 fetch 读不到这些头 → 预览态零行为变化）。
5. **一键重登**：失效条幅（作业页）与设置页失效提示直接拉起雨课堂扫码登录弹窗
   （`ExtHwLoginModal` 默认二维码通道）。不做静默自动重登：短信登录被图形验证码挡住
   （R17 23.2 侦查结论），扫码必须人——诚实路径是「把重登的入口铺到失败现场」。
6. **Cookie 导出/导入（多设备迁移缓解）**：导出 = 把当前会话串写成 JSON 文件
   （`kind:"onethu.yuketang.session"`、`version:1`、`sensitive:true` + 警示文案——文件
   脱离 UI 也在标注自己敏感）；导入 = 选文件 → 强校验（JSON 合法 / kind / version /
   含有效 sessionid）→ 并入凭据（uvId/phone 缺省保留原值）→ 立即刷新。导出走 Tauri
   `save_text_file`（WKWebView 无 a[download]），导入走系统文件对话框 +
   `read_file_text`（R10 插件导入同款通道）。

### 30.3 R21-B 实现记录（2026-09-20）
- **core（`packages/core/src/exthw/yuketang.ts`）**：
  - `YktSessionError` + `isYktSessionError`；`getJson` 四分支归一（401/403、非 JSON、
    `code===50000`）；`fetch()` 课程列表与 `fetchExerciseDetail` 的 `errcode===401000`
    分支归一（其余 errcode 维持原通用报错）；
  - `YktSessionHealth` + 源方法 `checkSession()`（basic-info；失效 reason：
    `http401/http403/errcode=401000/unauthenticated/non-json`，网络异常 `alive:null`）；
  - Cookie 轮换：会话串改可变（`curCookie`），传输层包装 `yktFetch` 每响应捕获
    Set-Cookie（私有 `yktCaptureSetCookies`——**故意不复用 login.captureCookies**：
    yuketang.ts 必须保持零相对导入，离线 Node 单测靠原生 type-stripping 静态导入本模块，
    `.js`→`.ts` 重写钩子注册在静态图解析之后救不了它；两处实现需同步维护，已注释互指）
    + `mergeYktCookiePairs` 白名单合并 + 可选第 4 参 `hooks.onCookieRefresh`
    （既有 3 参调用方零改动）；
  - 导出/导入纯函数：`buildYktCookieExportJson` / `parseYktCookieExportJson` /
    `YKT_COOKIE_EXPORT_KIND`（校验拒绝均带中文原因）。
- **core（`packages/core/src/exthw/index.ts`、`src/index.ts`）**：透出 `YktSessionError`、
  `isYktSessionError`、`YktSessionHealth`、`YuketangSourceHooks`、`YktCookieExport`、
  `mergeYktCookiePairs`、`buildYktCookieExportJson`、`parseYktCookieExportJson`、
  `YKT_COOKIE_EXPORT_KIND`。
- **desktop（`apps/desktop/src/state/exthw.ts`）**：`YKT_HEARTBEAT_INTERVAL_MS`（6h）；
  `YktSessionState` + 快照新字段 `yktSession`；`runYktSessionCheck()`（幂等、永不抛出、
  未配置返回 null；结果写快照 + log_debug）；`startYktHeartbeat()`（幂等；15s 后首查 +
  6h 周期；`useExternalHomework` 挂载即启动）；`saveYktCookieRefresh()`（轮换 Cookie 合并
  存回，保留 uvId/phone）。
- **desktop（`apps/desktop/src/pages/Settings.tsx`）**：雨课堂卡片（已登录态）新增——
  会话健康行（未检查 / 有效含归属人+时间 / 已失效含原因 / 未知）+「检查会话」「导出
  Cookie」「导入 Cookie」三按钮 + 失效红色提示块内「一键重登（扫码）」（拉起二维码面板）；
  导出/导入在浏览器预览明确报错（无 Tauri 通道）。
- **desktop（`apps/desktop/src/pages/learn/AssignmentsPage.tsx`）**：失败条幅渲染列表扩入
  `yuketang`；yuketang 失败时加「雨课堂扫码重登」主按钮，直达 `ExtHwLoginModal`（默认
  二维码通道），省一趟设置页；「去设置重新登录」保留。
- **工具（`tools/ykt-session-smoke.mjs`）**：真连冒烟 + 实验载体——打印会话串**字段名**
  （值不打印）、跑一次 `checkSession`、存活时顺带跑课程列表并报告原生 set-cookie 观察；
  输出可直接粘进 docs 的结论行。凭据走 `YKT_COOKIE`/`YKT_UV` 环境变量，全程不落盘。

### 30.4 验证（2026-09-20）
- `pnpm --filter @onethu/core typecheck` ✓、`pnpm --filter @onethu/desktop typecheck` ✓。
- `tools/exthw-status-test.mjs` **276 通过 / 0 失败**（224 → 276，新增 R21-B 七组断言：
  ①失效归一矩阵——401/403/errcode=401000（列表+详情）/code=50000/非 JSON →
  `YktSessionError` 且文案含关键子串，普通 Error / TUOJ 会话错误不误判；
  ②checkSession 有效路径——alive+归属人+单请求+无 XTBZ 头；③网络断 → alive=null 不谎报；
  ④Cookie 轮换捕获——白名单合并恰回调一次、非白名单不并入、后续请求立即用新值、
  无 Set-Cookie 零回调；⑤`mergeYktCookiePairs` 纯函数；⑥导出/导入往返 + 五类拒绝；
  ⑦编排层对 yuketang 失效不加自动重登前缀、不误触发 Tyche 重登）。
- `tools/ykt-exercise-detail-test.mjs` **79 通过 / 0 失败**（会话失效文案契约未破坏）、
  `tools/ykt-detail-ui-test.mjs` **69 通过 / 0 失败**。
- **真连验证（2026-09-20T05:12:56Z，`tools/ykt-session-smoke.mjs`）**：对已死 Cookie，
  `checkSession` 准确判定 `alive=false, reason=unauthenticated`——失效检测链路
  （认证头组装 → basic-info → v3 系 code=50000 归一）端到端成立，与 30.1 侦查特征一致。

### 30.5 备注：保活有效性实验协议（**待霖回填**）与工程注记
- **实验协议**（侦查期唯一 cookie 已死，活体实验无法进行）：
  1. 任意设备登录雨课堂，取到新鲜 Cookie（或直接用应用内登录）；
  2. 每 6h 运行一次 `node tools/ykt-session-smoke.mjs`（或日常使用应用，其内置 6h 心跳），
     记录每次的 `docs 结论行`（ISO 时间 + alive）；
  3. **判读**：若存活时长显著超过 ~24h 基线（霖观察的失效周期）→ 服务端存在「活动滑动
     续期」，6h 心跳即有效保活；若仍 ~24h 失效 → 会话是绝对 TTL，心跳只能保证
     「失效后 ≤6h 内被发现」，届时可考虑把周期降到 1h 或在作业页刷新前先查一次；
  4. 顺带记录每次响应的 set-cookie 观察（脚本已内置）——若发现常规 GET 也轮换
     sessionid，则白名单回写（30.2-4）从兜底转正为必需路径。
- **心跳周期取 6h**：霖观察失效周期 ~24h，6h 足够密（4 次机会/天）；basic-info 极轻，
  每天每设备 4 个请求的量级对服务端无感。
- **为什么不做静默自动重登**：短信通道被图形验证码挡死（R17 23.2），扫码必须人——
  与 Tyche（账密 + 无验证码）本质不同。诚实做法是把「扫码重登」入口铺到所有失败现场
  （作业页条幅 / 设置页失效提示），而不是假装能自动。
- **导出文件安全口径（诚实声明）**：导出的 JSON 即完整登录凭据，拿到它 = 拿到账号会话；
  文件内 `sensitive:true` + warn 文案、UI 提示「勿放同步盘/群聊/仓库，导入后删除」都只是
  减灾，不是防线；请勿把导出文件当成安全存储。
- Cookie 轮换回写是**无证据的防御性设计**（侦查未见轮换行为）：若服务端从不轮换，该路径
  永远不触发（测试覆盖其纯逻辑）；若轮换，凭据不再「莫名失效」。成本极低，值得。
- 「会话已失效」「401000」子串是 UI 断言契约（`tools/ykt-exercise-detail-test.mjs`），
  改文案需同步改断言。
