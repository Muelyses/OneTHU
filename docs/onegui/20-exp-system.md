# OneGUI exp · 中性工作台视觉体系

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


2026-10-17，从本地 dev3 `90eec5b2` 创建 `exp`。本轮以 ChatGPT / Codex 的中性工作台语言为方向，实际实现于 OneTHU 的原有界面结构。

## 设计边界

保留首页自由画布、程序坞、标签页、工作空间、OH、OneGO、设置抽屉、收藏落点、手机导航、路由和数据契约。视觉采用白与石墨灰、清晰字阶、柔和面差、可见描边、克制阴影和圆润输入区。主要动作使用黑白对；业务状态和用户强调色保留语义。

## 唯一来源

| 层 | 文件 | 职责 |
|---|---|---|
| Reference | `packages/gui/src/tokens/reference.css` | 唯一的颜色与投影字面值 |
| Semantic | `tokens/semantic.css` | 明暗面阶、内容、边界、动作、状态、产品角色 |
| Structure | `tokens/structure.css` | 间距、字阶、圆角、控件、密度、动效、安全区与层级 |
| Material | `skins/neutral.css`、`skins/glass.css` | 同一角色的材质；四档玻璃由 opacity 公式推导 |
| Components | `styles/` 与 `components/` | 按钮、输入、卡、列表、菜单、分段和浮层 |
| Host recipe | `recipes/onethu.css` | OneTHU 壳层、程序坞、OH 入口、设置、菜单与兼容别名 |

宿主导入 `gui.css` + `onethu.css`。原应用 `styles/onegui-bridge.css` 已删除，其兼容职责归入库；旧名只做别名，不持有新颜色。应用样式仍保留结构、定位、滚动和响应式行为。

## 核心角色

| 角色 | 使用范围 |
|---|---|
| `--og-action / --og-action-on` | 主要操作、发送、确认；用户主题不改写 |
| `--og-accent-*` | 用户强调色、链接、状态与部分选中标识 |
| `--og-content-1/2/3` | 主文、说明、弱文；亮暗面上均验证可读性 |
| `--og-line-1/2/3` | 分隔、输入边界、聚焦强边界 |
| `--og-canvas / --og-chrome` | 工作区与持久导航框架 |
| `--og-card-fill / --og-menu-fill` | 卡片与不透明浮层基色 |
| `--og-fill-surface / --og-fill-overlay` | 可选材质的最终合成面 |
| `--og-input-fill / --og-composer-fill` | 输入控件与 OH/用户消息写入面 |
| `--og-selection-fill / --og-selection-ink` | 中性导航和选中状态 |
| `--og-contrast-ink-light/dark` | 壁纸对比度引擎的修复墨色 |

密度档仍为 compact / comfortable / touch。手机控件主高度 44px，小控件及芯片 40px；桌面 compact 主高度 32px。主题、壁纸、存储与六轴入口保持原有通道。

## 本轮清理与修复

- 删除宿主内 309 条争夺外观的声明，集中管理壳层、标签、抽屉、程序坞、画布卡、OH 和旧控件。
- 所有 OneGUI CSS 的颜色字面值归 Reference；新增 R9 单源护栏，材质也不能绕过。
- 主要动作与主题强调色分离；切回默认外观会清除 accent、selected、inverse、ring 等派生值。
- scope 的同名映射现在继承，不再生成自引用 CSS 变量；修复导览等浮层的底色/文字失效。
- 输入本体不再重复绘制键盘焦点，外壳承担统一焦点；OH 胶囊在 focus-within 时显示外环。
- OH 用户消息改用中性写入面，回复区取消玻璃气泡；主题色不再铺满正文背景。
- 取景框使用 OneGUI 按钮/选择器和材质，设备边框不侵占 iframe 的真实视口；开发面板控件一并接入。
- 开发白板 250% 自动缩放探针改为显式 `?board-zoom-selftest=1`，正常预览不再修改视图。
- 构建时发现 global.css 的一条孤立注释结尾并补齐起始标记；CSS 结构检查扩展到整个 gui 包。

## 验证

运行 `pnpm guard:onegui`、桌面 typecheck/build、令牌/CSS/对比度护栏。新增 system-test 覆盖真实 StyleDirector 主题往返、scope 继承、动作与 accent 隔离，以及直接读取当前 CSS 的 28 组语义色对比度（含透明状态面的合成）。

浏览器截图与逐场景报告位于 `docs/onegui/exp/`。浏览器预览不等于真机和登录后校园服务验收；校园 API、原生语音与设备性能没有在本轮重新验证。

## 迁移余量

全量应用旧样式与裸控件迁移尚未归零。当前棘轮：旧样式 9959 行、外观内联 278 处、字面色 322 处、裸控件 257 处、旧 UI 类名 81 处。基线只向下收紧，本轮没有放宽任何存量限制。数据色、文档正文、第三方内容视口仍需逐页判断；不以新增宿主配方宣称所有旧页面已完成组件迁移。

`pnpm guard` 仍含上一代视觉断言及产品文案约束，其结果与当前 OneGUI 专项护栏分别记录。

## 第二轮 Workbench（2026-10-17，取代首轮页面构图）

用户反馈首轮整页变化不明显。当前实现已重做首页、服务目录、设置窗口与手机排版；`onethu.css` 现在是入口，`compatibility.css` 保留存量映射，`workbench.css` 管产品构图。

桌面 compact 主控件由 32 调为 36，comfortable 40，touch 44；字阶 display/title 为 36/24，卡片半径 24。首页页头进入文档流，自由画布在其后继续使用原坐标，旧用户数据不重排。新安装的默认三列布局与旧布局迁移有独立测试。

验收记录及最新截图见 [Workbench 验收](workbench/README.md)。本节及该记录优先于上文首轮尺度和迁移计数。
