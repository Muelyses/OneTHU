# 学习 / 作业玻璃材质一致性修复

日期：2026-10-22。目标版本：0.11.1 渠道替换。

## 用户表现与根因

横屏平板的待办学习区域出现三条不一致的材质链路：课程原生 select 和未读通知条显示实色，作业轮播像透明薄片，右侧作业标题直接压在复杂壁纸上。壳层和部分详情卡片的玻璃仍正常。

1. `global.css` 的 `.hw-filter-select` 使用 MD 旧实色角色；`.notice-strip.has-unread` 的选择器优先级高于通用材质覆盖，保留实色 `--accent-soft`。
2. `.hw-carousel` 的父级 `mask-image` 建立 backdrop root。子卡片即使计算样式显示 `blur(22px)`，也采不到外面的壁纸。非中心卡片的整组 `opacity` 同样会干扰 backdrop 合成。
3. `Layout.PageHead` 是透明排版容器，迁移到 OneGUI 后包含无类名 wrapper，旧 `.page-head` 规则已无法覆盖新的 `.og-pagehead`。
4. 透彻玻璃的深色普通 surface 填充为 6%。阅读卡片在复杂背景上对采样偏差敏感；旧 `.hw-card-ddl-sub { opacity: .75 }` 还会进一步削弱对比引擎选出的字色。

## 修复边界与实现

样式集中在 `packages/gui/src/recipes/learn.css`，复用 OneGUI 现有材质角色。课程筛选、未读通知、学习分栏标题、独立与嵌入作业页头采用 `--og-fill-overlay` / `--og-overlay-blur` / `--og-line-2` / `--og-material-shadow`。`Layout.PageHead` 的 wrapper 增加 `page-head-host`，提供稳定的宿主挂点。

作业卡是阅读表面，采用同一 overlay 填充；透彻档为 60%，其他档位继续由现有材质配置控制。卡内正文和小号截止说明使用 `--og-content-1`，小字取消额外 opacity。大号截止数字保留状态颜色，自动对比引擎仍可按壁纸覆盖字色。

玻璃模式的轮播父级取消 mask。逐卡位移与缩放保持原有算法，整卡 alpha 移到内容子层。`HomeworkCarousel.tsx` 从现有 `geo.h`、步距、位移和 scale 推导每张卡自身的舞台边缘，卡片通过自身 mask 在 `--og-space-8` 的距离内渐隐。自身 mask 混合已过滤的卡片；父级保持采样畅通。中心卡正常阅读，两侧卡离开舞台时柔和消失。

没有新增全局 backdrop 扫描、逐帧 DOM 测量或全屏滤镜。轮播仍只挂载已有可见范围内的卡片。原生 option 弹出层保留实色前景/背景配对；普通表单控件与白板嵌套卡片保持原有材质策略。无玻璃档继续使用原来的父级渐隐，系统降低透明度设置继续获得实色与无 blur 的回退。

## 实际验证

`tools/learning-glass-browser-test.mjs` 使用真实 React / OneGUI 页面，独立 Chromium context、虚构课程与作业、程序生成的亮暗渐变细格纹壁纸。所有外部 HTTP 与 WebSocket 均阻断，未接触真实账户与用户壁纸。视口覆盖 1617 × 1073 横屏平板及 390 × 844 手机。

浏览器检查共 34 项：四组亮暗材质与布局、真实壁纸采样、无父级 mask/filter/opacity 隔离、玻璃强度切换、降低透明度回退、无玻璃回退、实际 CDP touch 翻卡、课程筛选、手机详情跳转以及无运行时错误。固定日期的 fixture 在触摸时逐事件推进时间，以便真实惯性估算，而不是让所有 pointermove 共用同一个时间戳。

实际截图位于 `/tmp/onethu-learning-glass/`：

- `tablet-light.png`、`tablet-dark.png`：平板双栏及自然边缘。
- `phone-light.png`、`phone-dark.png`、`phone-detail-dark.png`：手机阅读与详情。
- `card-blur.png`、`card-old-mask.png`、`card-own-mask.png`：同一中心卡的修复后、恢复旧父级 mask、自身 mask 对照。
- `report.json`：浏览器检查与每个文字元素的颜色、透明度、位置和引擎 probe。
- `pixel-proof.json`：实际背景像素与有效前景色的对比度，以及磨砂像素对照。

`tools/learning-glass-pixels-test.py` 使用截图中各标签上方三个点的背景像素中位值，合成计算样式的字色 alpha，计算有效对比度。正常字号要求 4.5:1，21px / 800 的大号截止数字与图形按钮要求 3:1。该检查同时对无文字区域比较高频标准差，验证真实磨砂而非仅检查 computed CSS。

最终 20 项有效像素对比检查与 2 项磨砂对照均通过。中心卡课程名、作业标题、小号截止说明的实际对比度为 **7.46–8.65:1**；大号截止数字最低 **4.23:1**，图形按钮最低 **4.16:1**。同一无文字 ROI 的灰度标准差从恢复旧父级 mask 时的 **4.663** 降到修复后的 **0.659**；相邻像素高频强度从 **0.4274** 降到 **0.0467**，自身 mask 与修复后的中心卡结果相同。

CSS 结构、OneGUI 单源、对比引擎护栏、桌面 TypeScript 检查及 `git diff --check` 均通过。

复验命令：

```sh
node --import /Volumes/OneTHUBuild/artifacts/mobile-round3-register.mjs tools/learning-glass-browser-test.mjs
python3 tools/learning-glass-pixels-test.py
node tools/css-parse-test.mjs
node tools/onegui-guard.mjs
node tools/contrast-guard.mjs
pnpm --filter @onethu/desktop typecheck
git diff --check
```

浏览器脚本需要可用的 Playwright 与 Chromium；上面的 loader 是本机工作环境路径。像素脚本需要 Pillow。生产实现未新增这两项运行依赖。

## 验证限制

本轮使用桌面 Chromium 的宽屏触摸模拟，尚未覆盖实体 Android GPU / WebView 组合和长时动态壁纸帧率。像素对比针对指定合成亮暗壁纸，无法代表每一种自定义背景；全局自动对比引擎的低频视频更新与定格规则原样保留。源代码未包含测试数据注入入口，虚构数据由隔离浏览器的路由 fixture 提供。
