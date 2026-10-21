# 日程底栏遮挡与列表滚动验收

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../../README.md)；英文入口见 [English overview](../../en/index.md)。


2026-10-20，`tools/schedule-layout-browser-test.mjs` 最终整套自然退出 `0`：**313 项通过、60 份实际几何与命中采样、24 张截图、0 个浏览器运行错误**。本目录保留统一 `report.json` 和三张关键截图；报告中的全部原始截图位于 `/tmp/onethu-schedule-layout-final-complete/`。

## 复现与修复效果

旧 CSS 下，1280×600 极简模式的 23:59 作业已经渲染，块范围为 `y=542.96–596.66`，中心为 `(305.73, 569.81)`。实际可见日程工作区高 `539.97px`；中心虽位于滚动容器裁切范围，`document.elementFromPoint` 却命中底部 `ohx-slot`。因此问题是 OH 栏覆盖实际内容，而非隐藏的完整模式面板高度为零。旧版首轮脚本在课程标题计数断言停止，但在此之前已保存以上真实几何和命中结果；最终脚本已改为精确匹配课程标题。

修复后，同一视口/模式的作业范围为 `y=489.94–536.58`，日程裁切下边界为 `540px`，停在 OH 栏上方。作业中心命中自身，直接坐标点击打开准确的 23:59 截止详情。20 条同日作业列表真实滚动到底后，第 20 项全部位于裁切范围内，中心命中自身，点击或触摸可打开带“前往”的详情。

- `chromium-1280-simple-timeline-before.png`：旧版 OH 遮住晚间作业。
- `chromium-1280-simple-timeline-after.png`：最终版晚间作业可见。
- `webkit-390-practical-agenda-end.png`：最终版实用模式列表末项可滚达。

## 覆盖范围与输入方式

矩阵为 Chromium、WebKit × 1280×600、390×844 × 完整、极简、实用模式，各组合独立冷启动。示例包含周二 08:00–09:35 课程和同日 23:59 未交作业；列表改为同日 20 条未交作业。同时验证从日程离开到首页后返回，以及极简→实用→极简切换。

测量针对实际可见 `.schedule-workspace`，逐层计算祖先滚动/裁切边界，并以 `document.elementFromPoint` 验证真实中心命中。晚间作业与列表末项均在测量成功后才使用坐标点击或触摸；没有对目标调用自动滚入视口，没有设置 `scrollTop`，也没有用 DOM `dispatchEvent` 代替操作。导航与示例数据发布使用生产状态接口，仅上游数据方法替换为本地示例，不请求学校服务或真实日历。

Chromium 390 使用手机视口与 CDP 可信触摸滑动、触摸点击。Playwright 的移动 WebKit 不提供滚轮/滑动支持，因此 WebKit 390 使用 `hasTouch=true` 的窄触摸视口、桌面后端真实滚轮和原生触摸点击；脚本确认生产 `is-phone` 布局已生效。该项是 WebKit 手机布局检查，**不是 iOS、原生 WKWebView 或实体手机验收**。

## 重跑

```sh
ONETHU_TEST_OUT=/tmp/onethu-schedule-layout-final-complete \
  node tools/schedule-layout-browser-test.mjs
```

可通过 `SCHEDULE_LAYOUT_ENGINES`、`SCHEDULE_LAYOUT_MODES`、`SCHEDULE_LAYOUT_WIDTHS` 缩小矩阵。空值或非法选项会失败，不会报告零项通过。

最终 `schedule.css` SHA-256：`4532a4a89b86ae4199c93cff1ed9fbd4c686917c1299c6e09f679b1ae19ee63b`。
