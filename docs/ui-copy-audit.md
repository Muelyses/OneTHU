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
