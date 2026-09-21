# 安卓 release 构建陷阱与真机取证

本文汇总 2026-09-21 一轮真机问题（在线服务打不开、PDF 预览失效、小组件不刷新、
校内启动变慢）踩出来的**判据与陷阱**。共同教训只有一句话：

> **桌面上看着好的，不代表真机上是对的。** 主窗口 UA 被伪装、release 包开 R8、
> 安卓没有 `/tmp` —— 这三点各自都能让一条代码路径在真机上静默失效。

---

## 1. 插件参数类必须 @InvokeArg（R8 下 `parseArgs` 必炸）

**症状**：点击「在线服务」毫无反应（后按设计回落系统浏览器）。

**真因**：`OpenWebModalArgs` / `SeedCookiesArgs` 漏写 `@InvokeArg`。tauri 靠该注解生成
Jackson 构造器并让 R8 保留类结构；漏注解后 release 包（`isMinifyEnabled=true`）里
`invoke.parseArgs(XxxArgs::class.java)` 报：

```
Cannot construct instance of `u0.l` (no Creators, like default constructor, exist)
```

`u0.l` 就是被混淆的 Args 类。**debug 包不跑 R8，所以开发期完全看不出来**；
桌面端也没有这条 Kotlin 链，所以桌面测试同样看不出来。

**纪律**：

- 新增插件命令，参数类一律 `@InvokeArg`；字段不用 `lateinit`（用带默认值的 `var`），
  保证无参构造器存在，校验放在使用处。
- `plugins/onethu-mobile/android/consumer-rules.pro` 已有整包兜底
  `-keep class app.onethu.mobile.** { *; }`。
- **改插件命令必须在 release 包上真机过一遍。**

## 2. 判据纪律：不能用端点字符串判断构建方式

0.7.2 安卓事故：手动 `cargo build` 漏了 `--features tauri/custom-protocol`，
WebView 直连 `devUrl`。当时的判据 `strings | grep 5180` **两种构建都命中**，属于无效判据。

正确判据只有构建方式本身。宿主已在 `lib.rs` 的 `setup` 首部加守卫：
`tauri::is_dev()` 且 dev server 连不上 → 弹原生对话框说明「这是开发版构建，请安装正式版」
后退出（用户实录：Windows 同学拿到 dev 包，打开就是 `127.0.0.1:5180` 拒绝连接）。

## 3. 安卓判定：主窗口 UA 是伪装的

`tauri.conf.json` 主窗口把 UA 写死成 Windows Chrome/79（webvpn 会话票绑定 UA 指纹，
不能改）。于是**真机上 `/android/i.test(navigator.userAgent)` 恒为 false**。

- 判安卓一律走 `src/lib/androidHost.ts` 的多信号（UA + `userAgentData.platform` +
  `navigator.platform ≈ /^Linux (armv\d|aarch)/`）。
- 受害历史：PDF 预览（pdf.js 分支从未执行）、语音命令路由、寻迹导航深链、
  卡务「调起支付宝」按钮、外部链 `intent://` 通道、插件宿主 `os_is_android` 兜底。
- 护栏：`tools/pdf-render-mode-test.mjs` 会扫描整个 `src`，禁止再出现裸 UA 判安卓。

## 4. 真机取证：安卓日志要能导出

安卓没有 `/tmp`，`log_debug` 此前只进 logcat；`println!`（含 HTTP 逐跳诊断）同理。
用户不便 adb 时，失败原因就是黑箱——这正是「在线服务没反应」拖了两轮的原因。

现在：

| 件 | 位置/用法 |
|---|---|
| 日志落点 | 安卓 `app_data_dir/logs/onethu-debug.log`（16MB 轮转）；桌面 `/tmp/onethu-debug.log` |
| Rust 侧写入 | `debug_log_line(line)`（`LOG_APP: OnceLock<AppHandle>` 在 setup 注入） |
| 用户导出 | 设置 → 关于 → **导出日志**（安卓经 `saveDownload` 桥转存系统「下载」） |
| 失败可见 | 应用内打开失败等原因直接进 toast，`showToast(text, 9000)` 给足阅读时间 |
| 计时埋点 | 启动链 `LR-STAGE … +Nms`、HTTP 逐跳 `[NATIVE-HOP{k}] {status} {N}ms {url}`、`[NET-RESOLVE] host → addrs` |

排查方法学：**先给用户可导出的日志与可读的 toast，再谈修**，不要让用户描述现象。

## 5. 构建环境坑（exFAT 外置盘）

- `res/` 下新建文件会生成 AppleDouble（`._*.xml`），AAPT 会把它当资源解析 →
  构建前 `find <res> -name '._*' -delete`。
- **XML 注释里不能出现连续连字符 `--`**。`drawable-night/onethu_widget_bg.xml` 注释写了
  `--surface`，直接导致 `parseDebugLocalResources` 报 `ResourceDirectoryParseException`，
  报错完全没提注释——排查成本极高。
- 用 write 工具新建文件会 ENOTSUP，用 `cat > f << 'EOF'` 落盘。
- 插件构建中间产物在 `/tmp/onethu-android-plugin-build`（异常时先删）；
  Rust 构建需 `CARGO_TARGET_DIR=/Users/st/Library/Caches/onethu/cargo-target`。

## 6. 小组件（RemoteViews）与网络

- 小组件是「JS 算、原生画」：原生进程无 WebView/无会话，只能重画已有数据。
  语义锚是 `src/state/widgetNativeRender.ts`，Kotlin `OnethuWidget.kt` 逐条对齐，
  改语义先改 JS 并跑 `tools/widget-native-render-test.mjs`。
- 深色跟随靠资源限定符 `values-night/` + `drawable-night/`（启动器重 inflate 自动命中），
  Span 色按 `uiMode` 选盘——**不加设置项**。
- 网络：校内每个 webvpn 包装请求实测 4–6.4 秒（外网几百毫秒），冷启动耗时主要是
  漫游链 + 并行抓取的叠加；排查看 `[NATIVE-HOP]` 与 `[NET-RESOLVE]` 两行。
