# 第二轮反馈验收

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../../README.md)；英文入口见 [English overview](../../en/index.md)。


对应计划：`docs/plans/2026-10-18-feedback-round2.md`。2026-10-19 完成前端实施和浏览器验收。

## 复跑

先启动桌面开发预览，再运行：

```bash
node tools/feedback-round2-browser-test.mjs
# 如使用其他端口：
ONETHU_TEST_URL=http://127.0.0.1:5199 node tools/feedback-round2-browser-test.mjs
```

脚本使用独立浏览器环境、真实组件与课程数据夹具，不读取或修改日常使用的浏览器数据。NFC 测试只替换原生桥接调用，保留应用的能力判断、内容编码、容量检查、接收解析和落库流程。

## 结果

`report.json`：67 项断言通过、errors=[]，同时保存 6 组视口/时间轴几何测量。

- `schedule-desktop.png`：横向桌面，画布到右边和底边。
- `schedule-phone.png` / `schedule-phone-small.png`：390 / 320 手机。
- `schedule-landscape.png`：844×390 横屏。
- `schedule-vertical.png`：竖标签栏下的完整日程。
- `personal-nfc-ready.png`：名片直接传送，明确标注等待对方接收。
- `radar-desktop.png` / `radar-phone.png`：复制、NFC 接收和传送直接在雷达中；未开启与不支持状态可解释。

预览中的校历错误提示来自未登录校园服务，测试没有隐藏产品错误反馈。

第一轮 55 项回归也通过，包含 Segment 拖动指示条、玻璃模糊、自动文字对比、侧栏、首页组件与手机按钮避让。Desktop TypeScript、OneGUI system、图标和 CSS 结构检查通过。

## 验证边界

没有进行 Android 真机无线互传、实际云盘上传或跨账号接收。NFC “ready” 表示本机发送就绪，现有桥接没有对方接收确认，界面不会显示发送成功。超大名片会缩小传送副本的头像；原名片和复制口令保留原图。

OneGUI guard R8 的旧样式总行数超基线是起点提交已有问题（9766 / 9753）；本轮没有增加旧样式表。其余规则通过。
