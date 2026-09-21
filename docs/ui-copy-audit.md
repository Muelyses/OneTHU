# UI 文案与信息密度审计（2026-09-20）

> 由来：开发群反馈「非计算机专业同学试用后觉得太复杂/太极客」，其中很具体的一条是
> 设置页出现内部实现术语。前端大量由 AI 生成，AI 会忠实把后端字段渲染给用户看，
> 靠人记性守不住 —— 所以这件事交给工具守。

## 规则（tools/ui-copy-lint.mjs）

| 规则 | 内容 |
|---|---|
| R1 禁用词 | 内部存储键名（`onethu.*`）、`localStorage`、`token/Cookie`、`webvpn/wengine/XSRF/csrf`、`Rust/Tauri/WebView/JSON/IPC/SWR`、`漫游/会话桶/埋点/幂等/降级`、`缓存`、`变量/字段/参数/返回值/null/undefined/NaN` |
| R2 说明超长 | 单条说明 > 42 字 |
| 豁免 | 行内 `// ui-copy-lint-ok: 理由`；或 `tools/ui-copy-allow.json` 按文件+文案片段豁免（**只允许插件作者向字段**，用户可见文案一律不得豁免） |

跑法：`pnpm lint:ui-copy`（有违规退出码 1，可直接接 CI）。

## 首轮结果

- 扫描范围：`apps/desktop/src/pages`、`apps/desktop/src/components`
- 首轮命中 157 处 → 收紧规则（跳过模板插值 `${}` 与 JSX 表达式片段）后 **48 处真违规**
- 已改 **26 处**用户可见文案，例如：
  - `yyfw 漫游（demo 同款）` → `由信息门户提供`
  - `粘贴 Seafile API Token` → `粘贴云盘访问口令`
  - `收藏夹 JSON 已复制` / `导入失败：需要 onethu.favs.v1 导出格式` → `收藏夹已复制` / `内容格式不对，请粘贴本应用导出的内容`
  - `Rust 骨干与 JS 模块的安装、启停、权限与运行轨迹` → `插件的安装、启停、权限与运行记录`
  - 雨课堂/TUOJ 的 `Cookie`、`sessionid/csrftoken/uv_id` → `登录状态`
  - 若干超长说明精简到 42 字内
- 余 **14 处**显式豁免，全部是**插件作者向**字段（manifest.json / sidecar 二进制 / 环境变量 / 仓库安装约定），理由逐条写在 `tools/ui-copy-allow.json`

## 给 AI 生成前端的硬约束（复制进 Prompt）

```
只用既有 class 与设计令牌（packages/ui/src/tokens.css），不得新增颜色/圆角/字号。
不得在用户可见文案里出现：内部键名、store/缓存/token/Cookie/漫游/API/Rust/WebView 等实现术语。
每条设置说明 ≤1 句且 ≤42 字，超出请收进「?」。
每张卡片状态标签 ≤3 个；列表必须有空状态；异步加载必须有骨架屏。
按钮用动词（办理/查看），不用名词（服务/入口）。
```

## 后续（本次未做，按序推进）

1. 功能可见性模型（页面级 + 二级菜单级折叠，默认全展开，暴露给 OH 读写）
2. 设置页按用途重组 + 「重新导览」入口置顶
3. 首启导览（场景勾选 → 落到折叠 → 教一次收藏）
4. 首页/列表信息密度（概览 Chip 直达、日程留 2–3 条、卡片 ≤3 标签、空状态/骨架屏统一）
5. 在线服务：搜索置顶 + 可解释排序（收藏 → 最近 → 全部）
6. 「猜你喜欢」：今日页**可选添加**的卡片 + OH 可读统计（不默认、不自动写入收藏）


---

# 附：本轮 UX 改造已落地清单（2026-09-20）

## 已上线

| 项 | 位置 | 说明 |
|---|---|---|
| 首启导览 | `components/OnboardingTour.tsx`、`state/onboarding.ts` | 首屏二选一（自行选择 / 按场景预设）→ 侧栏功能（2 列方块，带图标与内容说明）→ 各页二级页签（chip 排列）→ 收藏夹引导（一键创建「示例收藏夹」并放入 网络学堂 / 选课 / 空教室 三项原子）。选课不参与询问；可跳过、可重放 |
| 场景预设 | `state/onboarding.ts:PRESETS` | 完整 / 极简 / 预约狂人 / 信息大师；与手动路径写同一批既有存储（`favs.foldSidebar`、`saveTabLayout`、`homeCards`） |
| 设置页二级页签 | `pages/Settings.tsx` | 页签：账号 / 通知与提醒 / 外观与布局 / 数据与同步 / 下载与存储 / 插件 / 关于；形态与信息页一致（`SegmentedOverflow` + `role="tab"`）；「管理栏目」接入既有 `TabManageModal`，写入 `tabLayout("settings")` |
| 设置页操作区 | 同上 | 「导览」与「管理栏目」并列；导览不再占用页签 |
| 在线服务默认视图 | `pages/info/ThosPage.tsx` | 有常用项时默认进「常用服务」；首次预置 亲友来访人员报备、缓考申请 |
| 在线服务排序 | 同上 | 收藏 → 最近使用（`thos-recent:<userId>`，20 条上限）→ 学校原序；同一档内稳定排序 |
| 在线服务搜索 | 同上 | 搜索框移至页签之上 |
| 在线服务常用标记 | 同上 + `components/Icons.tsx:IconPin` | 图钉 = 在常用（既有 `thos-favorites`）；与"收藏进收藏夹"的星号语义分离 |
| 网络学堂同步说明 | `pages/Learn.tsx` | 指明雨课堂与 OJ 的作业同步在「设置 → 数据与同步」配置 |
| 文案纪律 | `tools/ui-copy-lint.mjs`、`tools/ui-copy-allow.json` | `pnpm lint:ui-copy`；新增「机构简称」规则（网堂等） |

## 已修复缺陷

| 缺陷 | 根因 |
|---|---|
| 二级课表「1-4 被读成 4-1」（实验室课错位、与主课表重复） | CR 课表格子 id 为 `a{session}_{day}`，我们误把 `anchor[0]` 当星期；抽出 `core/zhjwxk/anchor.ts:parseCellAnchor` 对齐 info app 口径，并加 14 条断言 |
| 深色主题大量黑字 | 引用了不存在的令牌（`--text` / `--bg-elev` / `--bg-hover` 等 14 个），硬编码兜底值恒生效；全量审计后改为真实令牌 |
| THUbook / 学堂正文深色黑字 | 源站行内颜色压过主题令牌 → `lib/htmlTheme.ts:stripInlineColors` |
| 导览「跳过/完成」白屏 | `useState` 落在 `if (!open) return null` 之后，hooks 顺序违规；已提到早退之前 |
| 设置页页签切换后仍显示其它分组 | `hidden` 属性被 CSS display 规则压过；且分节不在同一父节点 → 改为行内 `style.display` + 逐分节在各自父节点内收拢 |
| 在线服务跳收藏夹落到空夹 | 跳转未带 `folderId`，而 `FolderPage` 以 `navParams.folderId` 为渲染根 |
| 内嵌官方页每次要求二次登录（三端） | 桌面：独立子窗口 + `set_cookie`（**必须带 Domain**）+ UA 同主窗口（wengine 按 UA 指纹管会话）；Android：全屏 Dialog + 原生 CookieManager 种票 + 关闭后回灌 jar |

## 待办（未实现）

1. **新增 `thos-service` 原子类型**：THOS 服务列表加载时写入原子缓存；解析器提供标题/部门与打开动作。
   完成后可同时满足：① 服务行星号（统一收藏，可入收藏夹）与图钉并列；② OH 一句话打开对应服务页。
2. **体育馆改为应用内打开并共享登录态**：复用在线服务方案（桌面独立子窗口 / 手机全屏 Dialog），
   需在 `venue_sso_set` 链上补齐体育馆域的会话票收集。
3. **今日页加入「最近使用 / 猜你喜欢」**：基于本地使用计数（`onethu.usage.counts.v1`），
   作为可选添加的卡片（默认关闭），并把统计暴露为 OH 可读的内部信息；不默认、不自动写入收藏。
4. **两处深色白底**：雨课堂 LaTeX 区域、培养方案右侧完成情况。已排查
   `yktBody.ts` / `yktKatex.ts` / `katexInlineCss.ts` / `ProblemBody.tsx` / `zhjwxk/Courses.tsx`，
   未发现硬编码白色（后者已用主题令牌），需要具体页面与入口才能定位生效规则。

## 追加（2026-09-20 深夜批）：场馆 · 今日推荐 · 雨课堂深色

| 项 | 处理 |
|---|---|
| 体育官方预约页 | 改为**应用内共享登录态**（桌面独立窗口 / Android 全屏 WebView），按钮文案「在应用内打开官方预约页」+「改用系统浏览器」兜底；预约动作仍由用户在官方页面完成 |
| 今日页 | 新增「最近使用」「猜你喜欢」两张卡（卡体为空则整卡不渲染）：只读本机点击记录，**绝不自动改收藏夹**；说明文字「和你在用的地方同类 / 多数人天天用 / 顺手看看」≤42 字 |
| 雨课堂公式区 | 内联文档补深色档（opaque origin 继承不到主题变量，原只有浅色档）——深色主题下不再白底黑字 |
| 在线服务 | 星号（统一收藏原子）与图钉（在常用）语义分离并并列；不出现内部键名 |

## 追加（2026-09-20 夜·二批）：常用预置 · 导览能力补齐 · 首页行样式

| 项 | 处理 |
|---|---|
| 在线服务「常用服务」预置 | 修根因：预置按严格子串匹配「亲友来访」，学校侧正式名（如「亲友入校报备」）匹配不到，且**只要有一项命中就写"已预置"标记** → 少的那项永远补不上。改为复用口语容错分档（≥20 取最像一条）+ **逐关键词记账** + 版本号（老标记视为未记账，按新规则补一次）；预置动作留一行日志（谁被铆上、谁待补） |
| 导览新增「今日页留哪些卡」 | 默认全留 = 现在这份全面版首页；取消的卡收进「添加卡片」，其余卡位与顺序保持不动（不整体重排） |
| 导览场景 chip | 与卡片勾选统一为同一份判定（此前 chip 走 applyScenarios、卡片走另一套，"点了等于没点"）；落盘按**当前朝向**写，横竖屏各一份布局都能对上 |
| 今日页「最近使用 / 猜你喜欢」 | 行样式与「最近通知」同款（细色条 + 标题/说明 + 右箭头），去掉那排 accent 底色的方图标块——那也是用户说的"原子选择条很怪" |

### 追加：导览选卡把首页选空了（2026-09-20 夜·三批）

用户实录：「导览里只留了最近使用和猜你喜欢，点开今日是空的」。日志 `[TODAY] 朝向=portrait
主栏=[] 侧栏=[] 收起=36` 定位到根因：卡片 chip 默认**全部已选**，用户想"选中"那两张时
实际把它们点掉了（其余也已被逐个取消）→ 落盘成"一张不留"。

三处修法：
1. 落盘兜底：`applyTodayCards` 收到空集时至少保留「今日概览」，并写一行 `[ONBOARD]` 日志；
2. 界面明示：卡片步骤标题旁显示「已留 N 张」，0 张时红字警告"今日页会没有任何卡片"；
3. 一键自救：首页真的一张卡都没有时，空白提示里直接给「恢复默认布局」按钮（不必去翻编辑/添加卡片）；
4. 两张推荐卡改为**空态说明**（不再整卡消失）：只留这两张卡的用户不会对着空白发愣；
   并修掉「猜你喜欢」起步项里的假 key（`thos` 注册表里不存在 → 整条推荐被静默丢掉）。

---

# 附：2026-09-21 批次（R21）——四条用户反馈的根因与修法

## ① PDF 手机预览回归（「0.9.0 当时可以」）

**根因不是 pdf.js 写错，而是它根本没跑过**：`FilePreview` 用裸 UA 正则判安卓
（`/android/i.test(navigator.userAgent)`），但主窗口 UA 被 tauri.conf.json 伪装成
Windows Chrome/79（webvpn 票绑定）→ 真机恒 false → 9-13 的 pdf.js 分支从未在真机
执行，一直渲染安卓上空白的 `<embed>`。这正是 `androidHost.ts` R18c 修过的同族坑。

修法（`FilePreview.tsx` + `lib/androidHost.ts:choosePdfRenderMode`）：
- 安卓判定走多信号（UA + userAgentData + platform）；
- `navigator.pdfViewerEnabled` 为真（内核自带渲染器）→ 回到 `<embed>`（观感最好）；
  否则走 pdf.js canvas 自绘，**modern → legacy 两级构建兜底**（老内核缺
  `Promise.withResolvers` 等 API 时 legacy 有垫片）；
- 失败必留痕（`[FILE-PREVIEW]`，logcat 可抓）+「换内嵌渲染」「系统应用打开」双出口。

护栏：`tools/pdf-render-mode-test.mjs`（分档断言 + **全 src 扫描禁止再出现裸 UA 判安卓**）。

## ②③ 安卓小组件：刷新延迟 + 深色跟随

**延迟根因**：「JS 算、原生画」架构里快照文本是推送时刻算死的（"还有 9 小时"），
`updatePeriodMillis` 30 分钟重画的还是同一句旧话。**深色根因**：布局/卡片底硬编码浅色。

修法（`widgetSnapshot.ts` 契约扩展 + `OnethuWidget.kt` 重画重算 + `WidgetTicker`）：
- 快照行新增机器时间字段 `at/until/rel/loc` + 快照级 `counts/titleAt`；
- 原生每次重画按**当前时钟**重算：倒计时文案、正在上课（加粗+次行重排）、
  过期行剔除（从顶重新装填）、脚注计数、标题日期；
- 触发 = 30 分钟兜底自续 tick + 最近 at/until 翻转点的 AlarmManager 精准闹钟
  （`setExactAndAllowWhileIdle`，未授权降级 `setAndAllowWhileIdle`；重启由既有
  BOOT receiver 覆盖——`refreshAll` 现在会自动重排 tick）；
- 深色：布局色抽 `values(-night)/widget_colors.xml`、卡底 `drawable-night/onethu_widget_bg`，
  启动器重 inflate 自动跟随系统；行内 Span 色渲染时按 uiMode 选盘。

语义锚 = `state/widgetNativeRender.ts`（两端同步的纯函数参考），
护栏 = `tools/widget-native-render-test.mjs`。

## ④ Windows 用户端出现 127.0.0.1:5180

CI 的 `tauri build` 产物资产内嵌、永不出现 5180；出现即说明拿到的是 **dev/手动 cargo
构建**（与 0.7.2 安卓事故同族：判据只能是构建方式，`strings` 找端点串两种构建都命中）。
修法：`lib.rs` setup 首部 dev 守卫——`tauri::is_dev()` 且 dev server 连不上时弹原生
对话框说明「这是开发版构建，请安装正式版」后退出，不再让用户对着浏览器错误页猜。

## ⑤ 在线服务/体育点击 webview 无反应

逐环节静态排查：Rust 移动端链路错误已冒出（265cc35）、Kotlin openWebModal 无静默
拒绝路径、`openThosInApp`/`openVenueInApp` 失败必 toast/回落浏览器。本轮归一：
`ThosPage.openOfficial` 原是第三份内联复份链（失败只 setError，横幅不显眼时等于
没反应），已委托 `openThosInApp`，打开链全应用只剩一份。
**遗留**：若仍复现，唯一可能是指令悬挂（设备相关）。下次 adb 时一次定位：
点一下 → `adb logcat -d | grep -E "THOS-UI|THOS-SEED|VENUE-PORTAL"`——
有 [THOS-UI] 无 [THOS-SEED] = JS→Rust 断；有 [THOS-SEED] 无窗口 = 插件侧问题。
