# Android 小组件语言契约与验收

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


日期：2026-10-20。范围仅快照、原生重算和推送生命周期；未写真实手机桌面、学校接口或个人日历。

## 已完成

- `widgetSnapshot.ts` 为列表、详情、收藏夹、快捷方式生成 `locale` 和 `widgetText`。顶层推送及插件槽位也携带同一契约。只传 62 个小组件模板，不复制全站词典，不传账户凭据。
- `widgetText.ts` 用明确捕获的语言解析模板，时间/计数保留 CLDR 的 zero/one/two/few/many/other 分支；变量仅做一次具名纯文本替换。语言不改变实例 ID、事件身份、原始标题、位置、时间戳、关系字段或点击目标。
- `widgetNativeRender.ts` 和 Kotlin `WidgetText.kt` 使用快照自己的语言重算日期、倒计时、正在上课、计数与空态。即使应用或系统语言不同，既存非中文快照不会因定时刷新变回中文。无新字段的旧快照仍用中文。
- `widgetRuntime.ts` 订阅语言变更主动推送。异步采集跨语言代际时丢弃旧快照；原生写入串行，已经开始的旧写入完成后才写新语言，最终状态保持最新语言。停止运行时解除订阅，并拒绝尚在构建的快照落盘。
- 原子详情标题保留原题，不再由于有 `titleAt` 就在原生重画时误变成「今天」。今日列表仍按日期重算标题。

## 一并修复的已证实存储边界

1. 旧 `widgetPush` 存入 bare slots，而渲染器取 `root.slots`，两端形状不一致。现在存入包含 slots/locale/widgetText 的 wrapper，读取同时兼容旧 bare slots；翻转点扫描也逐槽扫描。
2. 旧原生命令忽略前端 `prune=false`，读取实例列表失败时仍可能删除已保存实例。现在仅在确实提供 instances 且 prune=true 时修剪。失败枚举和缺少实例字段都保留已有内容。

## 纯词典翻译交接

翻译源为 `apps/desktop/src/i18n/locales/*.ts` 中的 `native.widget.*`；初始登记在 `docs/i18n/native-widget-seed.json`。共 20 个普通模板及 7 组 × 6 个复数分支。英文空值保持中文回退，不能把本轮工程接通称作英文全部翻译完成。

Android 的 `src/main/assets/onethu-widget-zh.json` 只为旧快照保留中文兼容，是由中文词典生成的产物，不是独立翻译源。更新中文源后运行：

```sh
node tools/i18n/widget-fallback.mjs --write
```

正常填英文或新增目标语言不需要改 Kotlin、快照逻辑或原生产物。保持 `{count}`、`{month}`、`{day}`、`{time}`、`{title}`、`{remaining}`、`{slot}` 具名占位符，不引入 HTML 或 ICU 表达式。每个复数分支都译为该语言合适的形式，特别保留 other 兜底。`joiner` 是显示分隔符，可本地化；协议 relation/type/target 不翻译。

## 验证

以下均自然退出 0：

```sh
node --import ./tools/ts-resolve-register.mjs tools/widget-i18n-test.mjs
node --import ./tools/ts-resolve-register.mjs tools/widget-native-render-test.mjs
node tools/i18n/widget-fallback.mjs
node tools/widget-native-kotlin-test.mjs
```

- 新 TS 专项 22 项：真实快照与重算、原文/身份不变、跨语言背景重算、旧快照回退、复数、纯文本替换、异步采集中改语言、原生写入顺序、停止清理、读取实例失败不修剪。
- 既有 native-render 套保留时间状态、过滤、可见计数、跨午夜、自定义日程、尺寸相关契约；仅将硬编码中文源码断言迁到模板调用契约。
- 62 个原生兼容模板与 seed 和合入后的中文词典一致。
- 真 Kotlin 编译：使用已缓存 Kotlin 1.9.25 和 Android API 36，实际编译 `OnethuWidget.kt` 与 `WidgetText.kt`；只为生成的 R 资源 ID、无关 LaunchTarget 和通知权限辅助函数提供隔离 stub。
- 真 JVM 执行 14 项：实际 `WidgetText.kt` 与从生产文件读取的完整 `widgetPush` 方法体，存储/Invoke/JSON 适配器使用内存 mock。验证模板、语言传递、中文兼容、额外复数分类、prune=false 保留、缺枚举保留、显式修剪及旧新槽位读取。

限制：没有完整 APK 打包或 Android launcher/不同厂商设备实测；Android ICU 的实际设备版本及字体排版未在手机上验证。编译和 JVM 适配器结果不等同于设备端跨进程验收。
