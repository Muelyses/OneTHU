# 暂存箱点击直达与长按雷达验收

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../../README.md)；英文入口见 [English overview](../../en/index.md)。


2026-10-20，`tools/vault-radar-browser-test.mjs` 在最终源码上完成 **309 项断言**，进程自然退出 0，浏览器清理完成，无页面异常。原始结果、触摸轨迹、首按祖先样式、几何与录像时间戳保存在 [report.json](report.json)。

## 实际覆盖

使用真实 OneTHU 页面与组件、隔离的 fake-cloud 数据，在 1280×860、390×844、320×568、844×390 四种视口验证：

- 普通点击和键盘 Enter 直接打开暂存箱管理，整个打开过程没有雷达闪现；管理搜索可用，关闭后焦点返回入口。
- 内容长按才出现雷达；持续按住至少 670ms，确认旧标签页背景菜单与来源菜单不会同时出现。
- 拖入扫描盘后松手，准确新增一项；拖到 OH 后松手，真实 `ohAsk` 收到原内容，且不会误存暂存箱。
- 长按入口只移动入口；在目标外松手、取消、失焦、Escape 都释放雷达、跟随物和手势所有权，不误开来源。
- 320 宽度下先真实竖向滑动，把原第三行「研讨项目」完整滚到固定底栏上方，再长按投递 OH，内容与计数均正确。
- 深色主题、系统减少动态、应用减少动态、空箱零回波；雷达、目标文字均在视口内，短横屏扫描盘与文字不重叠。

鼠标使用 Playwright 真实输入；手机使用可信 CDP 触摸，连续轨迹每步最多 6px、间隔 16ms。手机取消为可信 `touchCancel`，桌面 `pointercancel` 与窗口 `blur` 为明确注入的生命周期事件。OH 接收函数只增加只读观察，原函数继续执行；夹具无 API 配置，并阻止外部网络请求。

## 可播放证据

| 录像 | 尺寸与时长 | 实际捕获 |
| --- | --- | --- |
| [桌面点击、长按与双目标投递](recordings/1280x860-click-hold-transfer.mp4) | 1280×860，3.802 秒 | 96 个 compositor 帧 |
| [手机点击、长按与双目标投递](recordings/390x844-click-hold-transfer.mp4) | 390×844，10.703 秒 | 277 个 compositor 帧 |

录像保留捕获时序，没有补造中间帧。手机 Chrome 原始 compositor 为 500×844，仅裁去真实 390px 页面右侧的 110px 窗口空白；代表帧执行相同裁剪。原始尺寸、裁剪矩形、各帧时间与六张代表帧索引都在报告中。

已逐张人工检查两段录像的代表连续帧：扫描扇区随时间移动，存入与 OH 的命中反馈不同，释放后雷达消失。另检查了以下最终截图，短横屏的左右布局、深色文字与空箱状态清楚，目标区和固定导航可辨认：

- [桌面长按](screenshots/1280x860-long-press.png)
- [390 手机长按](screenshots/390x844-long-press.png)
- [320 原第三行滚动后投递 OH](screenshots/320x568-scrolled-original-oh.png)
- [844 短横屏左右布局](screenshots/844x390-long-press.png)
- [深色](screenshots/390x844-dark.png)、[空箱](screenshots/390x844-empty.png)、[减少动态](screenshots/320x568-reduced.png)

## 保留的取消观察与范围

[native-cancel-observation.json](native-cancel-observation.json) 保留前期稀疏输入失败：用六次大位移 CDP touchMove 拖动时，Chrome 曾将触摸交给原生滚动，发出可信 `pointercancel`。原条目位于底栏附近和真实滚动至完整可见后都曾出现，因此不能只归因于底栏遮挡。这些尝试没有投递成功，拖动状态正确清理；连续采样下，同一个滚动后的原条目投递成功。未把这个观察宣称为所有浏览器的确定根因，也未声称生产代码修复了所有类似情况。无效的 capture-phase touchmove 与 no-op touchstart 实验已撤回。

本轮为桌面 Chrome 中的视口与触摸模拟验收，未使用实体 Android/iOS、真实云盘账号或真实模型 API。其他代理独立完成：拖动生命周期 54 项、旧 anchor 37 项 / vertical 19 项 / workspace 36 项、真实菜单竞争 7 项；Root 完成旧 vault 50 项和 short-share 52 项。这些不计入本工具的 309 项。

最终基础验证由 Root 完成：typecheck、OneGUI 护栏（469 个令牌）、CSS 与文档检查通过；桌面生产构建自然退出 0，耗时 8.63 秒。

复现：

```sh
node tools/vault-radar-browser-test.mjs
```

可用 `ONETHU_TEST_SIZES` 与 `ONETHU_RADAR_OUT` 指定范围和独立输出；`ONETHU_RADAR_SKIP_VIDEO=1` 跳过录像。`ONETHU_RADAR_TOUCH_STEP=0` 保留旧六步稀疏输入诊断方式，其原生取消观察不属于成功投递承诺。
