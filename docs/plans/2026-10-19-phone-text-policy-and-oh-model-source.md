# 手机文字/排布统一策略 + 设置收口 + OH 模型源（2026-10-19 深夜）

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


一批用户反馈（原话）：
- 「手机版很多文字省略号回来了，不能统一解决一下吗」；
- 「很多文字在左边挤成一堆，右边单独放一个组件」；
- 「设置里面应该把模式选择默认收起来，不要一直一大块挡着人」；
- 「一个电脑，一个手机，这两个按钮排布你不觉得看起来就很乱吗」；
- 「设置里的 segment 太不直观」（指 账号/通知与提醒/外观与布局/数据与下载… 那排栏目）；
- 429 原文气泡要删掉，改成「一键续签 / 设置自己的 API」；
- 「胶囊自带接管所有这个地方的文字输入，删了 OH 自己的输入框」；
- 设置里也要能一键续签，极简/实用可选 MadModel 或自己的 API；
- 完整模式不在这里简化配置：「删了。在高级设置里调」。

## 手机文字/排布统一策略

新增 `packages/gui/src/styles/phone.css`（`gui.css` 最后 import，保证压过组件默认）：

- `.og-row`：允许换行；`.og-row-main` 至少占行宽 55%，右件放不下整块换到下一行；
  标题/副题两行封顶，不再单行省略；右件右对齐。
- `.og-settings-row`：主列 55% 起，值/控件可换行，右对齐。
- `.og-pagehead-main` 手机整行，操作换行到下一行；标题行 `.og-inline:has(h1/h2/标题)` 改为纵向 grid。
- `.og-kv`：手机上「标签 → 值」上下排、左对齐（组织概况/名片信息不再把值挤到右边缘）。

旧版样式在 `apps/desktop/src/styles/global.css` 末尾追加手机统一段：
- 覆盖历史手机档里 `.row { flex-wrap: nowrap !important }` 的单行钉死；
- `.row-title/.row-sub` 等 20 余个旧文本类改为两行截断/换行；
- 卡片头、区块头、设置行等「左标题 + 右操作」一律 wrap。

回归：`tools/phone-layout-browser-test.mjs`（390/320 × 通讯录/云盘/暂存箱/组织；
无横向溢出、内容文字无单行省略、键值对单列、成员行文字 ≥ 半行宽、名片按钮等宽）。

## 设置页收口

- 「使用模式」：默认收起成一行摘要（当前模式 + 切换按钮），选完自动收起。
- 设置栏目（账号/通知与提醒/桌面小组件/外观与布局/数据与下载/…）：手机改成下拉选择，
  桌面仍是左侧栏目列表——不再横向滚动猜还有多少栏。
- 名片面板 8 个动作：等宽网格（桌面各一排 4 列、手机 2 列），标签允许换行不省略。

## OH：429 动作卡 + 删除面板输入框

- 对话落定若是 429/额度类错误：不显示原始报错气泡，插一张动作卡
  「免费额度被限流了（429）· 一键续签 / 设置自己的 API」。
  续签 = `ensureMadModelToken(true)`；设置 API = 打开 OH 页面并定位到「模型 / MCP / 日志」高级配置。
- 删除面板内第二个输入框：文本输入唯一入口是底栏胶囊 `ohx-input`；面板底部只剩附件入口。

## 小 OH · 模型源卡片（设置通用）

`components/OhModelSourceCard.tsx`，完整模式设置与极简/实用模式设置共用：
- 只出现在**极简/实用模式**的设置里（完整模式设置不显示这个条，用户 2026-10-19 最终拍板）；
- 显示当前模型源与模型名；学校 MadModel 免费档：一键续签 + 有效期；
- 两档间可直接切换（自己的 API 的地址/Key/模型在下方「小 OH · 自己的 API」填写）；
- **完整模式设置里完全不出现这个条**：续签、模型源、Key 全部在 OH → 高级配置里调
  （OH 高级配置新增「免费额度（MadModel）」行，带「一键续签」；429 动作卡的
  「设置自己的 API」也直接跳 `goOhRow("模型 / MCP / 日志", "advanced")`）；
- 自动续签本来就跑着：`startMadModelPump()` 在插件 loader 加载时启动，每 10 分钟巡检、
  到期前约 1 小时自动续（`RENEW_BEFORE_EXP_MS`），设置页只补手动兜底按钮。

## 测试

- `phone-layout-browser-test.mjs` 22 条、`namecard` 23 条、`experience`、`mobile-vault` 14 条、
  `feedback` 55 项、`feedback-round2`、`contacts` 52 条全绿；`pnpm guard` 全绿
  （新增 `tools/phone-oh-policy-test.mjs` 静态守卫）。
- 截图：`identity-actions-desktop/phone.png`、`mode-control-collapsed/expanded-*.png`、
  `settings-phone-nav.png`、`phone-org-kv-stacked.png`、`phone-cloud-head-stacked.png`、
  `oh-model-source-full/simple/practical.png`。

## 手机白板：自由摆放（仅完整模式）

用户：「手机上也要允许白板拖动和改变大小，而不是现在这个样子只能上下调整（仅限完整模式）」。

- 手机竖屏默认仍是**阅读顺序**（单列堆叠，保留原有阅读体验）；
- 完整模式白板头部新增「自由摆放 / 阅读顺序」切换（`onethu.board.phoneCanvas.v1` 持久化）：
  切到自由摆放 = 回到真画布（世界坐标 + 缩放），条目可直接拖动、选中后拉四角/边把手缩放；
  自动把缩放调到 200%，并提示「拖动卡片，点选后拉角点调大小」；
- 仅完整模式出现：极简/实用模式根本不渲染白板，不会出现该开关；
- CSS：`.freeboard-wrap.phone-canvas .free-item { touch-action: none }`，
  避免垂直拖拽被页面滚动抢走；阅读顺序仍保留 `pan-y` 可正常滚动。
- 回归 `tools/phone-board-browser-test.mjs` 14 条：默认阅读顺序、切自由摆放、拖动改位置、
  拉把手改尺寸、切回阅读顺序、简单/实用模式无可见白板。
  截图：`phone-board-stack.png` / `phone-board-free.png`。
