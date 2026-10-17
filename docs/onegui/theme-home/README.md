# 主题、材质与可编辑首页 · 2026-10-17

本轮在 `exp` 完成用户反馈的六组修改。

- Segment 选中按钮自身同时绘制底色与字色，旧滑块只负责装饰，避免量测/切换期间黑底黑字。两套 Segment 共用动作色对，主题与动态取色不会拆开这组对比色。
- 主题定义直接送入 OneGUI，注入面阶、三级文字、边框、字体、圆角与强调色；部分主题自动补齐面阶并校正文字对比度。切换主题、昼夜调度、动态取色和返回默认都走同一入口，完整清除前一套覆盖。默认显示名为 **石墨**，保留历史 ivory ID 以兼容存储。
- 玻璃独立于配色，应用在导航栏、独立卡面、浮层与工具条；输入、动作按钮、Segment、便笺保留实底。移除了按 card 类名和 inline background 通杀透明的旧规则，白板内部不再反复叠加模糊。支持减少透明度的系统偏好。
- 首页七组件：时钟、大标题问候语、一级功能区、今日待办、今日课程、最新新闻、校园卡余额。待办页和今日待办复用同一滑动卡片及过滤排序逻辑，保留提醒、忽略、收藏和详情入口。
- 浏览时组件响应自身操作；**编辑布局**后使用顶部把手移动、四角/右边/下边调整尺寸。方向键移动、Shift + 方向键调尺寸；手机提供上下重排及高度操作；固定组件保留位置锁定。修复了缺失的把手定位、右上/左下角只改一个方向和浏览手势误拖卡片。
- 编辑、添加、缩放、画笔位于窗口底部的固定工具条，经 body portal 高于内容、低于弹层。手机添加抽屉及确认按钮高于底部导航。

## 既有数据

`homeLayoutVersion: 2` 仅迁移一次：把原来的固定首页内容补成组件，为旧卡片让出顶部区域，保留内容、属性、相对摆位、折叠与固定信息。后续删除时钟等组件后刷新不会复活。用户 OnePage 不被首页迁移影响。全新首页直接采用七组件；已有用户可从「模板 → 默认首页」主动替换当前板布局。模板替换会移除当前板组件，请先保留需要的内容。

## 验证

- `pnpm --filter @onethu/desktop typecheck`、生产 build 通过。
- `pnpm guard:onegui` 通过，含 46 组语义色对比度；旧 CSS 9765 → 9753 行，应用内联外观样式 277 → 265，裸控件 245 → 243，字面色值 318 → 317。
- `tools/theme-home-model-test.mjs`：79 项主题注入/清理、部分主题对比度、默认组合、迁移/删除幂等断言。
- `tools/theme-home-browser-test.mjs`：[80 项浏览器断言](report.json)，覆盖真实主题点击、全部七主题 × 四材质档、Segment、有效昼夜主题、动态取色、固定工具、滑动不误拖、拖动/拉伸/键盘、删除刷新和手机重排。
- [多尺寸截断回归](layout-regression.json)：223 项通过，1280×720 / 900×600 / 390×844 / 844×390 / 320×568，包含隐藏标签页、OH、设置、OneGO、画笔和滚动。
- [上轮五项反馈回归](followup-regression.json)：34 项通过，含便笺黄色与保存恢复、竖栏、Segment、研讨间一处选时；预约请求为测试替身，未向校园系统发送预约。
- 白板 model / view / drag / fit / templates / legacy-merge 护栏通过。

截图中的作业来自浏览器测试夹具；余额和新闻空态未伪造。材质图使用临时条纹背景检查透光与模糊，不写入产品设置。未在 Android 真机或 macOS 原生 WebView 上复验本轮材质效果。

## 预览

[桌面默认首页](home-1280.png) · [手机默认首页](home-390.png) · [主题色卡](theme-picker.png) · [玻璃材质测试背景](glass-material.png)

## 重跑

```sh
node tools/theme-home-browser-test.mjs
node --import ./tools/ts-resolve-register.mjs tools/theme-home-model-test.mjs
ONETHU_TEST_OUTPUT=/tmp/onethu-layout-current/ node tools/layout-browser-test.mjs
ONETHU_TEST_OUTPUT=/tmp/onethu-followup-current/ node tools/workbench-followup-browser-test.mjs
```

计划与决策：[实施计划](../../plans/2026-10-17-theme-home-canvas.md)。此前完整 guard 已记录的 ui-copy、modal-shell 与 tabstrip 旧断言不属于本轮通过范围，本轮没有声称完整 guard 全绿。
