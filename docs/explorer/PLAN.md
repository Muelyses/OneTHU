# OneTHU · dev-explorer：从校园服务导航到个人校园工作空间

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


> 2026-10-12 立项。上一进程笔记：`docs/ball/PLAN.md`（Ball 分支，task-1→22 已收口于 cf8dd13 + bdae9c1）。
> 本分支 = 交互架构革命：底栏三入口（标签页 | OH | OneGO）+ 顶栏标签条 + 侧边栏整体退役（**桌面手机同一套**）。

## 0. 用户拍板（原文要点，红线条目加粗）

1. **左上角恒在首页按钮（点击回首页）；右上角恒在设置按钮**——点开是「个人设置 / 插件 / OneTHU Harness」三段合一浮层，**它们不是任何标签页，高于任何标签页**。
2. **OnePage 暂按普通收藏夹格式组织**，可以有子收藏夹（OnePage 平级；在一个 OnePage 里放另一个 OnePage 的入口）→ 直接落在 favs 体系，FolderPage 即 OnePage 视图（已验证嵌套可用，零修改）。
3. **OH 胶囊条 = 搜索 + OH 二合一**：点击/长按语音；「点击默认打开」「长按语音发送到」可设置默认值（搜索 or OH），弹出小窗内可随时切换；**搜索保留最近 10 条跳转记录**；小窗样子不变（能拖动、有气泡）；搜不到时小窗内一键丝滑切换到 OH 对话。
4. **悬浮球展开面板同样获得**：默认设置、切换、普通搜索、搜索跳转记录。
5. **电脑端完全删除侧边栏**，与手机同一套交互（"我们要革命"）。
6. 标签页语义 = 0.10 旧版一级子页面（信息/网络学堂）的实例化；**可深链到具体栏目（信息-新闻），但 tab 主题不变，栏内可切换（信息-成绩）**。
7. OnePage 还没完全做好——**直接移植当前页面组织模式**（首页 = TodayPage 卡片系统原样 + 新增层）。

## 1. 架构（已落码）

### 状态机
- `state/explorer.ts`：标签页/工作区/设置浮层唯一真源（模块级 store + localStorage `onethu.explorer.v2`）。
  - 首页 tab（id="home"）单例恒在不可关；`openTab`（入口级导航，同页可多开；`dedupe` 供工作区恢复）；`navigateInTab`（tab 内导航，工作上下文保留）；`explorerNavigate`（**全库 navigate() 的新实现**：settings/plugins→浮层；活动 tab 是首页→开新 tab；否则 tab 内导航）。
  - 工作区 = tab 快照数组（`saveWorkspace/openWorkspace/deleteWorkspace/renameWorkspace`）。
  - 设置浮层 store 即旧 Entry 状态机（`openSettings("settings"|"plugins"|"oh")`）；`Layout.tsx` 薄重导出 `goEntry/useEntry/entrySnapshot/subscribeEntry` 保持全库调用点零改动。
  - hash 由 explorer 统一写：自身写入对账消费；外部深链 = 开新标签页。
  - `recordUse` 落账「最近使用」（旧 navigate 行为找回，动态 import 防模块环）。
- `state/explorerPrefs.ts`：胶囊默认动作（capsuleTap/voiceTarget）+ 最近 10 条搜索跳转记录（跨入口共享）。
- `plugins/ohControl.ts`：OH 命令总线（requestOhPanel/requestOhVoice/onOhCommand）——胶囊、悬浮球、首页搜索条都发命令，ChatDock 订阅执行。

### 渲染
- `components/explorer/TabHost.tsx`：所有标签页常驻挂载、display 切换（keep-alive）；页 tab **首次聚焦才挂载**（防启动恢复的抓取风暴），挂过终身保留；页内导航 key=page 重挂保转场。
- `components/explorer/renderPage.tsx`：App.tsx 原页面开关原样抽出（含 PluginTabHost）。
- `components/explorer/SettingsOverlay.tsx`：设置浮层（手机全屏/桌面右侧推入），内嵌 SettingsPage/PluginsPage。
- `components/explorer/HomeTab.tsx`（explorer-home 交付）：搜索条（唤起二合一窗）+ 继续上次恢复条 + 功能目录卡（NAV_REGISTRY 五组全量）+ TodayPage 原样。
- `components/explorer/{TabStrip,TabDrawer,OneGoSheet,BottomBar}.tsx`（explorer-ui 交付）：顶栏标签条、标签抽屉、OneGO 抽屉（OnePage=收藏夹 + 工作区两段）、底栏三入口。
- `components/{Layout,App}.tsx`：重写。侧栏/抽屉/五格底栏退役；Shell = TopBar（Logo+TabStrip+搜索+齿轮）+ TabHost + BottomBar + CommandPalette + SettingsOverlay。

### OH 链路（explorer-oh 交付中）
- OhCapsule（底栏中央，短按=按 prefs 开搜索/OH，长按=语音）；ChatDock 加搜索模式（searchAll + 最近记录 + 零命中转 OH）；GlobalOrb 同能力；ExplorerPrefsSection 设置分节。

## 2. 语义速查（新）
| 操作 | 行为 |
|---|---|
| 侧栏点击（已删） | — |
| 首页目录/快捷卡片/OneGO/搜索命中 | `openTab`：恒开新标签页（today→聚焦首页；settings/plugins→浮层） |
| 页内链接（列表→详情等） | 当前标签页内导航，tab 主题不变 |
| 底栏「标签页」 | TabDrawer：管理/排序/关闭/工作区 |
| 底栏 OneGO | OneGoSheet：OnePage（收藏夹）+ 工作区 |
| 底栏 OH / 悬浮球 | 二合一窗（搜索⇄OH 可切，prefs 决定默认） |
| 顶栏 Logo / 齿轮 | 回首页 / 设置浮层 |

## 3. 已知取舍（v1）
- 工作区恢复按 page+folderId/courseId 判同实例（params 深链恢复取近似）。
- 同页多开的各实例独立抓取（无共享缓存层）。
- 标签页休眠不冻结后台 effects（v1 靠懒挂载控制规模；冻结器后置）。
- 浮层关闭动画沿用 TabManageModal 手法；标签条拖拽排序后置（↑↓ 先顶）。

## 4. 验收清单（收口用）
- [ ] tsc 零错 + `pnpm -C apps/desktop build` 过
- [ ] 护栏：settings-search-coverage / search-landing / oh-routes-sync / plugin-action-style 全绿
- [ ] 手动：登录→首页；目录开三个作业 tab→各自独立；tab 内进详情→切走再回上下文保留；存工作区→关 tab→一键恢复；搜「音色」直达设置浮层行；搜不到→丝滑转 OH；重启→标签页恢复
