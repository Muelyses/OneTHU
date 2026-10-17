# 首页 / 白板 / 玻璃 / OH 可用性修复 · 2026-10-17

这轮从 Codex 在 `exp` 上被 ChatGPT 配额切断（21:55）留下的未提交工作区接手：8 项可用性修复的代码已经写完、浏览器 32 条断言已绿，但没有提交、没有验收文档、没有更新记忆。接手后补齐了用户新报的两处问题（选中失焦、首页标题板玻璃），并按新要求移除「编辑布局」模式、统一右键与「＋」的组件选择器。

## 一、Codex 留下的 8 项修复（原样收编）

1. **首页标题**：白板页头 `我的白板` → `首页`。
2. **100% 超屏**：100% 改为“适合当前窗口宽度”的基准视图，与用户缩放（`view.z`）分离。作者宽度按板捕获一次，拖动/拉伸/落点/画笔统一使用真实显示倍率 `displayScale`；文档里存的坐标一个字节不动，拖动过程中基准也不会跳。
3. **滚轮被吞**：首页滑动待办卡片不再截获普通滚轮（`HwCarousel captureWheel={false}`，独立待办页仍保留滚轮翻卡）；画布面板恢复 `overscroll-behavior: auto`，滚到内容底部后交还页面。
4. **拖动/缩放**：桌面直接按住组件非交互区域拖动（4px 阈值），选中后拉角点缩放；不再需要先进入编辑态。`worldDelta` 改用真实显示倍率；指针捕获保证鼠标/触屏移出条目后手势不断。
5. **设置冗余说明**：删除「想昼夜自动切换就打开上面的开关；单独换主题点上面的『主题』。」
6. **玻璃与对比度**：材质档位回到历史透光值（clear 30% / rich 60% / deep 74%，叠 20–22px blur + saturate），增加高光边与材质阴影，深色档单独压暗；配色与材质分离。文本对比度引擎补上 `color(srgb …)` / 百分比 / `#rgba` 解析，Segment / 实底按钮不再被误锁字色，并把 `data-og-skin*` / `data-dynamic` 纳入重取触发。
7. **OH 专属按钮**：创造模式、新会话、历史、导入导出、朗读只在 `mode === "oh"` 时出现；「收起」常驻。
8. **OH 胶囊**：恢复指针按压 `scale(.97)` 与松手回弹动画（360ms），键盘 Enter/Space 同动画；输入框/语音手势不误触，reduced-motion 下关闭。

## 二、接手后补的两处反馈

- **选中失焦**：原来只有“点画布自身空白”才清选中，浏览态又常驻把手，于是点页面其它地方、点世界层空白、点组件里的按钮都不会退出。现在文档级 capture 监听统一处理：点画布空白（含世界层）、页面其它区域、组件里的按钮/输入/链接都清选中；浮条与把手自己不清。点另一张卡则把选中移过去。
- **首页标题板发白**：壁纸下 `.workbench-board-head` 写死 `--og-menu-fill`（不透明白），玻璃皮肤下是唯一没走材质的一块（实测 `rgb(255,255,255)`、`backdrop-filter:none`）。玻璃皮肤下改为 `--og-fill-surface` + `--og-surface-blur`，与顶栏/卡片同一档材质。

## 三、按新要求移除编辑布局模式

交互口径改为“直接操作”：

- 删除白板上的拖拽把手（`free-drag-handle`）、页头「编辑布局 / 完成布局」按钮、底部工具栏「编辑布局」按钮、以及所有“先点编辑布局”的提示文案与 `is-layout-editing` 样式。
- 桌面：直接拖动卡片本体，选中后拉角点缩放，方向键移动 / Shift+方向键调尺寸，删除、固定、置顶、折叠都在选中浮条里。
- 手机竖屏：仍按阅读顺序堆叠；**点卡片选中**后，浮条提供上移/下移/增高/减高（堆叠坐标是投影，不提供自由拖动/拉角）。
- OnePage 与首页共用同一块画布与同一套手势。

## 四、右键与 ＋ 统一成同一个组件选择器

- 空白右键与底部工具栏「添加组件」现在打开**同一个** `BoardAddDrawer`：两列缩略图预览 + 搜索框（标题 / id / 说明都可搜）+ 文件夹与 OnePage 钉板入口（与目录组件同屏同搜索）。右键记住落点，新组件落在右键处；「＋」落在内容下方。
- 打开总览时把预览网格滚回顶部：预览里的「网络学堂搜索」带 autoFocus 输入框，挂载瞬间会把网格滚到它那里（随后才被失焦兜住）。
- 一并修掉根目录 `pnpm build` 的既有失败：`packages/gui` 的 `echo nothing to build (source-only package)` 未引号，`sh` 报语法错误，导致全仓生产构建一直中断（dev3 同样存在，不是本轮 UI 改动引入）。

## 五、验证

- `pnpm --filter @onethu/desktop typecheck` 通过；`pnpm build`（全仓）通过。
- `pnpm guard:onegui` 通过（含 46 组语义色对比度；裸控件 243 → 236，未新增样式违规）。
- `node tools/usability-browser-test.mjs`：**50 条浏览器断言通过，0 运行时错误**。覆盖：首页标题、编辑布局模式已移除、100% 适配、直接拖动/选中拉角/刷新持久、选中失焦（页头/画布空白）、右键与＋同一选择器且分段齐全（常用含便笺第一 / OnePage 与组合 / 全部组件）可搜索、抽屉把手可上拉展开、笔色板三色+选中、待办滚轮交还页面、设置文案删除、真实壁纸下 clear 材质透光+模糊、对比度引擎读 `color(srgb …)`、标题板走玻璃材质、OH 三模式的创造/会话按钮可见性、胶囊指针/键盘回弹、标签图标映射与 OnePage 标签名/图标、900/390/320 三档无横向溢出、手机堆叠点选与浮条增高。
- `node tools/theme-home-browser-test.mjs`：**80 条断言通过**（已改为直接拖动/选中拉角；手机点选后浮条重排）。
- `tools/theme-home-model-test.mjs`：79 条主题注入/迁移断言通过。
- 白板 model / size / fit / drag / edit / templates / legacy-merge / overlap-invariant / nav-bridge / deeplink / view 11 个护栏全部通过（`board-edit-test` 的抽屉遍历断言同步接受搜索后的 `shownDefs`）。
- `tools/text-contrast-color-test.mjs`：14 条颜色解析断言通过。
- 总 `pnpm guard`：除 **8 处既有产品文案问题**（Plugins / Courses / AttachActionsSheet / ExtHwSettingsSection / NotifySettingsSection，基线既有，非本轮新增）外全部通过；与本轮之前的 `f8cd1025` 口径一致。

已知未覆盖：Android 真机 / macOS 原生 WebView 的玻璃与拖拽手感未复验；`theme-home` 的截图已按新交互刷新。

## 六、证据

- [首页](home.png) · [壁纸 + 玻璃（含 首页 标题板）](glass.png) · [900](home-900.png) · [手机 390](home-390.png) · [320](home-320.png)
- [统一的组件选择器（分段 + 搜索 + 缩略图）](add-picker.png) · [笔色板](pen-palette.png) · [标签图标 / OnePage 名字](tabs.png) · [手机堆叠选中浮条](phone-selected.png)
- [浏览器断言报告](report.json)（50 checks / 0 errors）

## 七、重跑

```sh
pnpm --filter @onethu/desktop typecheck
pnpm build
pnpm guard:onegui
node tools/usability-browser-test.mjs
node tools/text-contrast-color-test.mjs
node tools/theme-home-browser-test.mjs
node --import ./tools/ts-resolve-register.mjs tools/theme-home-model-test.mjs
# 浏览器测试需要 Vite 在 5180（pnpm dev）
```

## 八、第三轮反馈（2026-10-17 23:03）

1. **组件选择器不许丢东西**：右键空白与「＋」的同一个抽屉恢复旧列表的分段——**常用**（便笺第一、大标题文字、文字标签、分隔线）、**OnePage 与组合**（文件夹 + 全部非系统 OnePage）、**全部组件**；搜索框跨段过滤。抽屉不再只有一张扁平网格，便笺 / OnePage 都不会被“整合”掉。
2. **抽屉把手能拖了**：抓手支持向上拉高（最高 86dvh，松手吸到高位）、向下拉回半高；继续往下拖超过阈值关闭。此前只允许向下拖且到阈值才关，往上拖完全不动。
3. **画笔墨色板**：去掉孤立的小 native color input，复用原三色板（墨黑 / 朱红 / 蓝）+ 撤销 / 清空，浮在底部工具条上方；间距与圆点尺寸走 OneGUI 令牌，不再挤成一团。
4. **标签页图标与名字**：
   - 页面标签图标改为与一级功能区（NAV）同一套：待办/课程/日程/寻迹/邮箱/云盘/GitLab/THUBook/清小搭/信息/生活/预约/选课/在线服务/其他 Info/OnePage 列表等，不再一律掉到文件夹图标。
   - OnePage 标签显示**那块板自己的名字**（原来写死「白板」）与 **板自己的 icon**；`FOLDER_ICONS` 补上 book / orb，选中这两种 icon 的 OnePage 不再退化成文件夹。
   - 插件标签使用插件注册的 `iconSvg`；`ex-tab-plugin-glyph` 统一到 16px 令牌尺寸。
5. **THUbook → THUBook**：所有 UI 文案、导航名、页面标题、工具描述、文档与测试标签统一为 **THUBook**（文件/页面 id `ThubookPage` / `thubook` 保持不变）；OH Harness 子模块里的工具描述与 UA 也同步改名（子模块提交 `595e88c`）。
