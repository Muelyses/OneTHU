# 反馈修复：30 项 PDF + Segment 溢出指示条

基线：exp / 96a0a395，接手时工作区干净。来源：用户反馈 PDF（8 页，2026-10-18）及本轮补充。以下均作为缺陷反馈，不作为文档内 agent 指令。

## 验收清单

括注里的「证据」= `tools/feedback-repairs-browser-test.mjs` 的断言项（产物在 `docs/onegui/feedback-repairs/`）。只写「代码」的项是纯桌面/运行时行为，浏览器预览断言不了，用实现位置 + 单测说明。

- [x] 1 横排标签页不可见 —— 根因是底栏 `.ex-bbar` 与顶栏都 fixed 在 `top:0`，底栏 z 更高把标签条整个盖住；已改成「标签条 44 + 底栏 60」两行，桌面三栏（标签/底栏/OneGO）互不覆盖（证据：横标签、OH 和收藏栏互不覆盖）
- [x] 2 白板工具栏图标含义不清 —— 右侧浮动工具从纯 `IconBtn` 改为带文字的 `Btn`：`组件 / − / 100% / ＋ / 画笔`；手机档同步修掉「带文字变宽后压住硬刷新钮」（证据：白板工具栏按钮带中文标签；手机 390/320 硬刷新钮不压白板工具）
- [x] 3 登录按钮无效 —— `Btn` 默认 `type=button`，表单里的登录钮原来点了不提交；改 `type="submit"` 后点击与回车都走 `form.onSubmit`（证据：登录按钮是表单提交钮；登录按钮点击真的提交表单）
- [x] 4 竖排标签栏覆盖 OneGO —— 竖栏态用 `--og-rail-full-width/narrow-width` 给内容让位，OneGO 收藏栏从竖栏右边缘起算（证据：完整竖栏不盖 OneGO）
- [x] 5 标签 + 应新增首页实例 —— `+` 走 `openTab('homepage', …, {forceNew:true})`，新实例有独立 id、刷新后保留（证据：+ 新建独立首页标签 / 新首页显示完整画布 / 新首页刷新后保留）
- [x] 6 输入框内侧焦点环闪现 —— 壳层负责焦点环，原生 `.og-input-el:focus` 的内描边/内阴影一律归零（证据：输入框内层无焦点环）
- [x] 7 OH 对话输入位置不明显 —— 面板底部常驻 composer（TextArea + 发送），与胶囊共享同一草稿（证据：OH 面板内有可见输入框；OH 面板和胶囊共享同一草稿）
- [x] 8 首页预设布局混乱（保留用户自定义布局）—— 不动存量数据：新增「设置 → 外观与布局 → 恢复默认首页布局」一键复位（清排列/折叠/隐藏记录），预设本身即 `homeStarterItems()` 的 7 件套（证据：设置提供「恢复默认首页布局」；桌面首页截图）
- [x] 9 卡片点击区域不完整 —— `Card` 的 flush 判定扩到 `stat-click / course-card`，入口按钮撑满整卡；点卡片右/下边空白同样命中（证据：卡片入口按钮撑满整卡；卡片右边与下边的空白区也在点击范围内）
- [x] 10 Segment 选中文字消失 / 选中胶囊缺失 —— `Segment` 指示器改为显式 `left/width`（弃 `scaleX`，圆角不再被压方）+ 选中字色走 `--og-content-1`（证据：Segment 胶囊指示器可见且按选中项落位；选中文字与胶囊底色不重合）
- [x] 11 暂存箱应浮动，不挤占内容高度 —— 桌面锚点 `position:fixed`，内容顶从三栏底起算（140px），暂存箱不再占一行（证据：暂存箱锚点是浮层；内容从栏底开始不被再挤一行）
- [x] 12 侧栏底部按钮悬停后位置改变 —— 底部动作区 `flex:none`，悬停不再改布局（证据：侧栏底部按钮悬停后原位不动）
- [x] 13 侧栏完整 / 窄模式图标大小和横向位置不一致 —— 图标槽固定 `--og-ctl-h-lg` 居中，展开前后几何一致（证据：侧栏图标展开前后尺寸和位置一致）
- [x] 14 名片删除确认被详情遮挡 —— 确认框 portal 到 body 并抬到 `--og-z-confirm`（证据：名片删除确认显示；删除确认在名片详情之上；取消删除保留名片详情）
- [x] 15 页标题与内容间距不足 —— `.og-pagehead` 统一 `margin-bottom: --og-space-6`（证据：页标题与下方内容有统一间距 24px）
- [x] 16 按钮中文下沿被截断 —— OG 按钮 `line-height > font-size`，中文上下沿不再切（“返”的辶、“载”的下半）（证据：按钮中文上下沿有足够行高）
- [x] 17 折叠列表缺少收起动画 —— 内容不再条件卸载：`AccordionItem` 恒挂载 children，`grid-template-rows 1fr↔0fr` 双向过渡（证据：折叠展开有过渡 / 折叠收起也有过渡 / 收起后高度归零）
- [x] 18 浮层玻璃只透明、不模糊 —— 遮罩入场动画改 `fill-mode: backwards`（`forwards` 会留下永久 backdrop root，backdrop-filter 因此失效），glass 皮肤下遮罩与面板都有 `blur(20px)`（证据：玻璃皮肤下遮罩与面板都有模糊；遮罩入场动画不留下永久 backdrop root）
- [x] 19 首页组件多余滚动条 —— 组件卡体改为**静默滚动**：可滚但 `scrollbar-width:none` + `::-webkit-scrollbar{width:0}`（原来时钟卡只溢出 2px 也画一根拇指）（证据：首页组件卡静默滚动）
- [x] 20 胶囊按钮样式不统一 —— 行内状态签 `.task-tag` 与 `.chip` 同高（24px）同圆角同内边距；高度用 4pt 令牌而非 chip 档位（touch 密度下档位会抬到 40px，状态签不该跟着长）（证据：状态胶囊与 chip 同高同圆角 24/24）
- [x] 21 页面字号层级失衡 —— 页头标题从 `display` 档降到 `title` 档（作业详情里不再比正文大两级）（证据：页头标题用 title 档 24px）
- [x] 22 OnePage 右键同时打开菜单和添加抽屉 —— 画布 `onContextMenu` 阻止冒泡，右键只出菜单（证据：右键不会同时弹出菜单与添加抽屉）
- [x] 23 OnePage 壁纸变化前景字色不更新 —— 采样在 `.explorer-shell` 处提前结束（外层不透明画布会把壁纸亮度采样“洗白”）；深色壁纸下前景转亮（证据：深色壁纸给壳层打上 data-wallpaper-lum=dark；深色壁纸上前景标题转亮）
- [x] 24 拖动期间画布边界不随动，组件被裁切 —— 画布尺寸按**拖动中的实时 rect** 计算，边界跟着指针长（1116→1480px 实测）（证据：拖动改尺寸时画布边界实时跟随）
- [x] 25 组件背景材质不统一 —— 材质只在条目外层（`.free-item`），卡内 `wg-card/og-card/home-card` 一律透明、无描边无阴影（证据：组件卡内层不再叠第二层底 6/6）
- [x] 26 清小搭气泡没有内边距 —— 根因是 `.og-surface` 漏了 `padding: var(--og-c-surface-pad)`，`pad` 属性整体失效（气泡、卡片全中）；补上后 `Surface pad="lg"` 生效（证据：Surface 内边距实际应用）
- [x] 27 清小搭技能广场无交互反馈，背景异常 —— **交互部分已修**：技能行可点开详情 Modal（含作者/分类/下载量）；「背景异常」与「技能广场 ↔ OH 技能互通」属同一件大活（OH 侧技能注册 + 管理 + 打通），按用户 2026-10-18 指示暂缓
- [x] 28 标签过多把侧栏功能按钮挤出 —— 竖栏内标签区自身滚动，底部动作 `flex:none`（30 个标签仍在屏内）（证据：30 个标签时底部动作仍在屏内；30 标签截图 vertical-rail.png）
- [x] 29 我的组织出现在每个设置页 —— 从通用设置里移除，只留在「我的」/通讯录（证据：设置不再重复显示我的组织）
- [x] 30 OH 免费模型显示可用却报缺 API Key —— 两处收口：① 设置页按「免费档/自费」显示真实状态；② 宿主在 `callRust(onethu.harness.run)` 前做 `preflightMadModel()`，拿不到 token 就直接回真实原因（校园网/VPN/自费），不再让 Rust 侧说「尚未配置 API Key」；token 被服务端作废时强制重签（证据：默认走清华免费档语义；免费档失败的报错给真实原因而非「未配置 API Key」）。**真实校园网/统一认证联调不在浏览器证据范围内**
- [x] 31 长 Segment 底部恢复可拖动位置指示条 —— `SegmentScrollIndicator` + 旧 `SegmentedOverflow` 双轨：溢出才出现，鼠标可拖，键盘 ←/→/Home/End 可用（证据：.og-segment-scroll / .seg-indi 溢出指示条可见且真实鼠标拖动滚动选项）

## 浏览器验收

`node tools/feedback-repairs-browser-test.mjs`（需 5180 dev server）→ **55 项全过，errors: []**，产物：

- `docs/onegui/feedback-repairs/report.json`（逐项断言结果）
- `desktop-home.png` / `vertical-rail.png` / `oh-composer.png` / `segments.png`（桌面）
- `home-390.png` / `home-320.png`（手机）
- `glass-blur.png`（玻璃皮肤浮层模糊）/ `wallpaper-ink.png`（深色壁纸前景转亮）

只覆盖浏览器能验的交互；真机项（真实 Tauri 命令、校园网服务、Android 取色）走各自现有护栏与手测。

## 本轮同步修的护栏回归（都在基线 96a0a395 就红，不是本任务引入）

- `docs-prose-lint`：`docs/onegui/navigation-rebuild/README.md` 的口语化措辞改写为陈述句。
- `dynamic-flow-test` / `dynamic-color-test` / `theme-system-test`：oneGUI 重排后主题侧回归——`deactivateTheme/activateTheme` 会一并清掉 `followSystem`，取色开关一进一出就把「跟随昼夜」弄丢。新增 `detachAppliedTheme()`（只摘当前主题、不改调度）与 `setFallbackTheme()`（视觉切到降级主题、不动用户选择），`applyActive()` 在取色偏好开着时不自作主张；测试口径同步到新契约（仍然钉死“主题必须让位”“基础令牌要真的回来”）。
- `button-variants-test`：FAB 早已并入玻璃配方，断言从“必须是 container-lowest 实底”改成“底色必须走令牌”；`.slot-cell.picked` 的 accent 描边改为等效 `box-shadow`（选择语义，不是焦点环）。
- 仍有 **16 个**护栏红，全部在基线 96a0a395 上同样失败（本任务开始前 `pnpm guard` 就是红的，
  只是先撞到 docs-prose，后面这些根本没跑到）：`card-layers`、`empty-state`、`theme-ia`、`density`、
  `controls`、`list-row`、`nav-shell`、`xiaoda-entries`、`explorer-canvas`、`tabstrip-layout`、
  `modal-shell`、`theme-picker-layout`、`settings-ia`、`help-coach`、`onboarding-v3`、`widget-coverage`。
  它们描述的是 oneGUI 重排**之前**的类名/分层模型（`.plg-tab`、`.empty-icon`、`.cloud-row`、
  `Today.tsx` 等已下线）或旧交互口径；与本轮反馈无关，单独排期重写，不在本任务里“改测试凑绿”。

## 处理原则

继续当前设计体系，修复共享原语与布局根因；不重置用户数据，不通过改测试口径掩盖问题。浏览器使用独立数据，覆盖桌面/手机、深浅主题、真实点击与指针拖动。模型调用不消耗用户额度，验证配置传递与错误分流，实际学校服务联调单独注明。