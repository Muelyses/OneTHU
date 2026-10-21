# exp 分支交接报告（2026-10-19 收尾）

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


> 面向下一个接手的智能体。仓库 `/Volumes/PortableSSD/Projects/thuapp/OneTHU`，分支 **exp**，
> 远端 `github` = `smartThise/OneTHU`。dev server 常驻 `http://127.0.0.1:5180`。

## 当前状态

本会话把「实用模式（第三模式）」「课表页快捷收纳 + 拖动」「简洁壳隐藏云同步/寻迹」
「通讯录直接粘贴收名片 / 组织名片并进名片夹」「硬刷新钮自动避让 + 可拖动」
「pnpm guard 过期断言全量收口」都做完并提交；浏览器回归已跑到 5 个套件全绿。

## 本会话提交

| commit | 内容 |
| --- | --- |
| `91e67e1a` | 实用模式（含设置三选一/导览三课/独立存档）+ 课表 OneShot 收起/拖动/动效 + 作业详情课程行 + 简洁壳隐藏云同步与寻迹 + 手机课表底栏净空 + 硬刷新钮自动避让/拖动 |
| `b78d52f2` | 通讯录直接收名片 + guard 过期断言收口（16 个 guard 脚本，`pnpm guard` 转绿），并修设置分节映射真 bug |
| `a64f22e4` | 名片夹组织名片 + 收名片入口收成一颗按钮（工具条消肿） |
| `3cabc79b` | 组织卡并进同一个名片夹牌堆（用户口径「应该和其他名片夹在一起」） |
| `8876c229` | 暂存箱回归跟上统一收发/新锚点口径（42 条绿） |

**注意**：`b78d52f2` 之前已推过 `exp`；`a64f22e4`/`3cabc79b`/`8876c229` 若尚未推，先 `git push github exp`。

## 已完成并可验收的点

### 1. 实用模式（practical）
- `state/experienceMode.ts`：三模式 `full | simple | practical`，`isSimpleLike()`（极简/实用共用简洁壳）。
- OneShot：第五格固定 `MORE_FEATURES_SLOT="more"`；左四格可配置（`state/quickAccess.ts`，独立存档 `onethu.oneshot.practical.v1`）；「更多功能」面板按功能目录分组，点「+」放进入口 → 面板收起、底栏入口亮编号 → 点位放置。
- 设置「使用模式」三选一；导览换成模式向导（`onethu.onboarded.flow4`，兼容 flow3/phone 旧标记；`resetActiveOnboarding()` 清 flow4）。

### 2. 课表页（is-schedule-page）
- OneShot 默认收成一枚「快捷」小按钮，浮在「日程设置」上方；`grid-template-rows 0fr/1fr` 过渡动效；按住可上下拖动并记住位置（`onethu.quickbar.schedule-offset.v1`）。
- 手机档课表内容加底栏净空（`packages/gui/src/recipes/schedule.css`），最后一节课不被底栏盖住。
- 作业详情补「课程 / 截止」两行（learn 作业 courseId→courses 映射）。

### 3. 简洁壳收口
- 日程设置只留「刷新」（云同步/系统日历按钮与文案一并藏）；新建日程不再默认写云日历；课程详情无「寻迹」；`compactPageAllowed()` 把 `trace` 也挡掉，搜索/OH 历史/实用面板共用同一白名单；atoms 日程副标题去掉「·云同步」。

### 4. 通讯录
- 名片夹工具条只留一颗「接收名片」→ 面板三选（粘贴口令 / 识别二维码 / 从暂存箱收）。
- 自己的组织名片并进**同一个 `.contact-deck` 牌堆**（我的名片 → 组织 → 好友）；共用 `OrgCardDetailModal`（放进暂存箱/复制加入方式/管理组织/删除）。

### 5. 硬刷新悬浮按钮
- JS 自动找位（右下起步，避开 OneShot/日程设置/白板工具栏/暂存箱/回到顶层/底栏；往上让、挤了往左挪），窗口/标签变化重算。
- 按住可拖动、按设备记忆（`onethu.ui.refreshFab.v1`）；「回到顶层」跟随叠在上面。

### 6. guard
- `pnpm guard` 全绿（含 typecheck）。16 个脚本里过期的 OneGUI 收编断言已改为当前事实（`.og-*`、OneGUI 弹层/开关/进度、新导览 flow4、新首页锚点等）；已退役组件（`.plg-*`、`.bottom-nav`、sidebar、Today.tsx、V3 导览）的断言删除并注明替代物。

## 测试状态

```bash
pnpm guard                                              # ✅ 全绿
node tools/experience-browser-test.mjs                  # ✅ 实用模式全链路
node tools/schedule-timeline-browser-test.mjs           # ✅ 18
node tools/short-share-browser-test.mjs                 # ✅ 49
node tools/vault-browser-test.mjs                       # ✅ 42
node tools/namecard-browser-test.mjs                    # ✅ 14
node tools/org-browser-test.mjs                         # ✅ 11
node tools/mobile-vault-browser-test.mjs                # ✅ 14
node tools/feedback-repairs-browser-test.mjs            # ✅（含手机硬刷新钮不压白板工具）
```

待复跑（本会话未扫）：`tools/feedback-round2-browser-test.mjs`、`tools/short-code-test.mjs`、
`tools/platform-test.mjs`、`tools/board-*`、`tools/viewer-*` 等。

## 接手必读的坑

1. **OneShot 课表态结构**：`.oneshot.is-schedule > (.oneshot-slots-wrap > .oneshot-slots) + .oneshot-schedule-toggle`；拖动 handle 是外层 `.oneshot-schedule-drag` span，**click 必须绑在 span 上**（pointer capture 会把 click 目标改成 span，绑 Btn 上点不动）。
2. **模式数据隔离**：实用模式只写 `onethu.oneshot.practical.v1`；课表快捷位置键名 `onethu.quickbar.schedule-offset.v1`（**别带 `oneshot` 字样**，experience 测试的存档快照比对会误判）。
3. **收名片**：统一入口 `useVaultReceive().paste()/scan()` → `contentExchange.receivePastedCode`（名片/组织/名片串/暂存箱都认）；「接收」语义现在是**总是开新暂存箱**，不覆盖当前箱。
4. **短码/云分享**：`vaultShare.shareCodeForBox` 复用未失效短码；`decodeShareAsync` 对短码走 `cloudExchange.resolveExchangeCode`；测试 mock 适配器必须真写假云盘：`write_temp_file → seafile_upload → seafile_share(expireDays>0)`（0 天会立即过期）。
5. **假云盘测试**：`tools/lib/fake-cloud.mjs`，`installFakeCloud(page,{token})` 要在 `goto` 前；页面内模块调用按 `performance.getEntriesByType('resource')` 找 URL（HMR 带 `?t=`），并 `setResourceTimingBufferSize(10000)`。
6. **红区**：OJ 作业题严禁直接改；切模式不得删/覆盖完整模式数据。用户对 UI 观感零容忍——改完先自己截图实测（本会话截图在 `docs/onegui/experience-mode/`）。

## 建议下一步

1. `git push github exp`。
2. 复跑未扫的浏览器回归，确认无回归后把 docs 截图/报告一并提交。
3. 用户验收观感：课表「快捷」拖动位置与动效、手机课表底栏净空、通讯录牌堆顺序、接收名片面板文案。
4. 可扩展：组织口令接收也接到「我的组织」页签；首页空态加入「接收名片」。
