# 系统架构

本文档描述 OneTHU 的进程模型与各子系统设计，面向宿主贡献者。

## 1. 进程模型

```
┌─ 桌面（macOS / Windows / Linux）─────┐   ┌─ Android ─────────────────────┐
│  webview（React 应用）               │   │  webview（同一 React 应用）    │
│   ├ JS 插件：同域执行                │   │   ├ JS 插件：同左              │
│   ├ Rust sidecar 插件：独立进程      │   │   ├ onethu.harness：Rust 核心 │
│   │  stdio JSON-RPC                  │   │   │  编译进动态库（命令桥）    │
│   └ src-tauri（reqwest 传输层）      │   │   └ src-tauri：同左            │
└──────────────────────────────────────┘   └───────────────────────────────┘
```

会话维护、超时、重试与权限校验均在宿主侧实现（webview 门面与 Rust 传输层）。
`onethu.harness` 为官方骨干插件，桌面形态为独立进程，Android 形态将同一份
`core` 编译进应用进程。

网络请求统一经 Tauri 的 `http_request`（Rust reqwest 异步）发出，规避 WebView 的
同源策略与请求头限制，并设置 45 秒超时。

## 2. 会话管线

- **单一管线**：CAS 票据兑换后建立 webvpn 会话，learn 与 info 请求经包装域由
  wengine SSO 透明建立。旧的 demo 链路已移除。
- **会话守卫**：HttpClient 检测到响应含登录页特征时，先探活，失效则使用内存凭据
  完整重登（受信凭据免二次认证），随后自动重放原请求。重登失败时按指数退避冷却
  （初始 30 秒，上限 10 分钟），避免触发风控。
- **设备指纹策略**（2026-09-18 决议）：设备指纹固定，不执行轮换。轮换方案会使
  强制二次认证链路与保活、静默重登、lib 会话链相互干扰，稳定性不可控。指纹缺失时
  由选课模块的死结自愈机制处理（确认失败后清除账密凭据直接登录）。
- **状态持久化**：WKWebView 的 localStorage 可能被系统清理。会话快照与记住的密码
  同时镜像到应用数据目录的普通文件，启动时优先读取 localStorage，缺失则从文件恢复。
- **对外复用**：上述能力经 `onethu.ts` SDK 开放给插件（`TsHttpClient` 直接复用宿主
  HttpClient 实例，共享 cookie 池、通道分流与自愈重放），使插件可在不重复实现认证
  与通道逻辑的前提下接入新的校内服务。见
  [plugin-development.md §6](./plugin-development.md)。

## 3. 插件宿主

三种插件形态使用同一套权限门禁与数据接口。权限校验在 `facade.ts` 中按方法执行，
Rust 插件的 `onethu.call` 请求经 webview 门面执行相同校验。协议细节见
[plugin-development.md](./plugin-development.md)。

- **内置插件清单自愈**：启动阶段比对内置插件清单与镜像，不一致时重新注册，用户设置
  值保留。
- **Android 宿主判定**：`tauri.conf.json` 为适配 wengine 指纹固定了 Windows 版
  Chrome UA，导致 JavaScript 侧基于 UA 的平台判定失效。现改用 Rust 编译期命令
  `os_is_android()`，并以 `androidHost.ts` 的多信号判定作为补充。
- **插件功能页**：插件经 `registerTab` 注册页签，注册表由 `plugins/tabs.ts` 维护，
  路由为 `plugin:<插件id>:<页签id>`；`PluginTabHost` 渲染页头与挂载容器，容器常驻
  （切页仅切换显示，插件内部状态保留），容器经 `setTabRoot` 登记后由插件全权渲染。
  注册表的快照按 emit 重建并缓存，订阅端（`useSyncExternalStore`）不得拿到每次新建
  的数组，否则无限重渲染导致白屏。插件的渲染回调异常在页面内提示，不静默吞掉。
- **侧栏分组**：内置入口（含折叠组）、插件功能页、收藏夹三段分列并各带分组标题；
  收藏夹段限高滚动，收藏数量增长不挤压「新建收藏夹」与折叠组。
- **主题归属**：主题定义与提供它的插件是同一份状态。`installTheme` 记录 `owner`
  插件 id，插件卸载 / 停用 / 覆盖安装三条路径经 `removePluginThemes` 回收自己的
  主题（覆盖安装用 `keep` 保留新版定义，应用状态不中断）。历史上无 `owner` 的记录
  以「主题 id 与插件 id 同名」的约定与模块声明的主题 id 兜底匹配。
- **市场拉取通道**：插件安装/更新与市场名单刷新优先经 GitHub contents API，raw 域名
  降级兜底（缓存语义差异见 [plugin-development.md §8.4](./plugin-development.md)）。
- **系统通知投递**：规则在 JS 侧算（`state/notifyPlan.ts` 出计划、`state/notifyInputs.ts`
  取数、`notifyScheduler.ts` 与原生实际排程对账），原生只做投递；覆盖对象为**课表与考试、
  自定义日程（含 rrule 展开，用事件自带 alarmMinutes 优先）、未交作业 DDL、每日早报**
  （只有日程的日子也发早报，否则用户会以为「没提醒 = 没事」）——Android 经 `onethu-mobile` 插件落 AlarmManager，
  macOS 用 `UNUserNotificationCenter`，Windows 用 WinRT toast + `AddToSchedule`。
  落点（点击通知打开哪一页）由原生存下、应用回前台时取走并导航：Android 由点击广播写进
  SharedPreferences，macOS 由 `UNUserNotificationCenterDelegate` 回调按通知 identifier 反查
  （映射落盘，以覆盖「点通知冷启动应用」这条路径）；**Windows 尚未接**——toast 点击要注册
  COM 激活器（`INotificationActivationCallback` + `ToastActivatorCLSID`），当前点击只把应用
  带到前台（见 `src/notify_windows.rs` 文件头）。
- **自检（设置 → 通知 → 自检）**：逐层探测后端类型、授权、精确提醒、小组件落地与快照时间、
  排程写入与回读、真实投递，最后撤销探针，给出一份「哪一层不通过」的结论。链路横跨 JS 调度、
  原生桥、系统权限、系统设置四层，用户只能说「没收到」，因此把分层结论做成一次点击的产物，
  编排逻辑在 `state/notifyDoctor.ts`（副作用全注入，可测）。
- **渠道管理与授权引导**：渠道与精确闹钟授权都在系统设置里，应用只能带路——`notify_open_settings`
  按 `channels` / `exact-alarm` / `app` 打开对应系统页（Android 走 `Settings.ACTION_*`，
  macOS/Windows 走 URL scheme）。设置页显示什么文案、给不给按钮，由纯函数
  `state/notifyStatus.ts` 决定（每种「后端 × 授权 × 精确」组合都要讲到点上，故单独可测）。

## 4. 主题系统

主题以插件形式提供（`manifest.category === "theme"`），实现方式为覆盖 `tokens.css`
的 CSS 变量，可选替换 logo 与附加 CSS。内置主题不可删除，仅插件主题可由用户删除
（历史上删除的内置主题可经「恢复内置主题」找回）。

昼夜调度实现于 `state/theme.ts`：

- 开启 `followSystem` 后，通过 `matchMedia("(prefers-color-scheme: dark)")` 监听系统
  深色模式变化，在 `dayThemeId` 与 `nightThemeId` 两个主题之间切换。
- 手动调用 `apply` 会关闭跟随模式，以保证「手动选择即固定」的语义。
- 声明 `dark: true` 的主题激活时，将 `document.documentElement.style.colorScheme`
  设为 `dark`，使原生控件与滚动条同步切换；切换回浅色主题或默认外观时恢复 `light`，
  维持原有针对 Android WebView 强制反色的防护。
- 内置深色主题「凝夜」（`onethu.theme.night`）在主题层以附加 CSS 修正
  `global.css` 中硬编码的浅色元素。

## 5. 模型调度（onethu.harness）

内置对话插件对接清华大学 MadModel 服务（`madmodel.cs.tsinghua.edu.cn`），该服务在
校园网内免登录提供 DeepSeek 模型，接口兼容 OpenAI 协议。

**服务端行为**（实测结论）：

| 行为 | 说明 |
|---|---|
| 令牌签发 | `GET /model-api/auth-login/check` 在校园网内返回有效期 6 小时的 JWT |
| 校外访问 | 校园网外 IP 的全部请求被重定向至统一认证（HTTP 307），该限制位于令牌校验之前，校外持有的令牌无效 |
| webvpn | 该域名未纳入 webvpn 服务范围，无法经 webvpn 建立会话 |

**模型源设置**：插件设置项 `provider` 提供三个取值——`madmodel`（清华免费服务）、
`custom`（自费 API）、空值（自动：已配置密钥时使用自费，否则使用免费服务）。设置入口
位于插件页的插件卡片内，由 `manifest.settings` 渲染。

**校外环境处理**：

1. **可达性探测**：后台任务每 10 分钟执行一次探测（直连
   `GET /model-api/auth-login/check`，不跟随重定向），每次对话前也会执行。探测结果
   写入 `madmodelReachable`，有效期为 10 分钟。
2. **状态调度**（Rust 侧 `config.rs`）：校园网内使用免费服务并自动续期令牌（阈值
   5 小时 50 分）；校外且已配置自费密钥时自动切换至自费 API；校外且无自费密钥时
   保持免费服务参数。
3. **错误提示**：校外且无自费密钥时，请求在发送前被拦截，返回包含处理指引的错误
   信息（连接校园网或学校 VPN，或在插件设置中切换至自费 API）。若仍出现 307 响应，
   宿主返回明确错误并触发一次令牌重签。

**MCP 服务器**：宿主侧配置存于 `localStorage` 键 `onethu.mcp.servers.v1`
（`lib/mcpStore.ts`，逐条增删改），在 `settings.get` 时以 `mcpServers` JSON 注入 OH
的插件设置。Rust 侧不读配置文件，仅在 `execute` 时接收该字段并据此派生
`mcp_<服务器名>_<工具名>` 工具。管理入口为插件页 OH 卡片内的「MCP」弹窗。

## 6. 外部作业源

雨课堂、TUOJ（AI 版与经典版）、Tyche 三源统一映射为 `ExternalHomework` 模型，以
`ext:` 前缀并入作业页。凭据维护、故障恢复与新源接入方式见
[external-homework.md](./external-homework.md)。

## 7. 扫码与内嵌浏览

- **雨课堂扫码登录**：长轮询的传输层超时设置为本地计时加 10 秒，避免传输层先于本地
  计时中断请求而将「未扫码」误判为错误；传输层中断按未扫码处理，沿用同一令牌继续
  轮询，避免二维码失效。
- **前台服务保活**（Android）：扫码期间启动前台服务并显示常驻通知，避免应用在后台
  被系统冻结。
- **官方网页登录**（雨课堂）：在应用内 WebView 打开官方登录页并读取 Cookie。移动端
  使用全屏模态（Tauri 命令 `open_web_modal`，插件接口为 `ui.webModal`，需 `webview`
  权限）。
- **TUOJ 会话恢复**：接口返回 401 或 403 时静默重新漫游一次并重新拉取数据。限制条件
  为：同源两次自动重试间隔不小于 10 分钟，每进程每源不超过 3 次，同源并发 401 共享
  同一请求，用户显式退出后不自动重登。

## 8. 构建与发布

| 操作 | 命令 |
|---|---|
| 重建桌面 sidecar | `cd apps/desktop && node scripts/build-harness.mjs` |
| 启动开发环境 | `cd apps/desktop && ./scripts/dev-launch.sh` |
| 构建 Android 安装包 | `JAVA_HOME=… ANDROID_HOME=… npx tauri android build --apk --target aarch64`，随后执行 zipalign 与 apksigner 签名 |
| 前端类型检查 | `pnpm --filter @onethu/core typecheck`；`cd apps/desktop && npx tsc --noEmit` |
| Rust 检查 | `cd plugins/OneTHU-Harness/core && cargo check` |
| 数据层测试 | `node tools/exthw-status-test.mjs`、`tools/tuoj-cas-test.mjs`、`tools/ykt-qr-test.mjs` |
| SDK 分流测试 | `node --import ./tools/ts-resolve-register.mjs tools/ts-sdk-test.mjs` |
| 插件 UI 逻辑测试 | `node --import ./tools/ts-resolve-register.mjs tools/plugin-ui-test.mjs` |
| 主题插件联动测试 | `node --import ./tools/ts-resolve-register.mjs tools/theme-plugin-sync-test.mjs` |
| 通知状态文案测试 | `node --import ./tools/ts-resolve-register.mjs tools/notify-status-test.mjs` |
| 通知自检编排测试 | `node --import ./tools/ts-resolve-register.mjs tools/notify-doctor-test.mjs` |
| Windows 通知模块编译检查 | `cd tools/win-notify-check && cargo check --target x86_64-pc-windows-msvc` |
| Android 目标交叉检查 | `cd apps/desktop/src-tauri` 后设 `CC_aarch64_linux_android` / `AR_aarch64_linux_android` / `CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER` 指 NDK 的 `aarch64-linux-android24-clang`，再 `cargo check --target aarch64-linux-android`（桌面 `cargo check` 不编译 `#[cfg(mobile)]` 分支，这是唯一能提前发现 Android 侧编译错误的手段） |
| Rust 单测（通知载荷解析等） | `cd apps/desktop/src-tauri && cargo test --lib` |
| 市场名单解析测试 | `node --import ./tools/ts-resolve-register.mjs tools/market-parse-test.mjs` |

分支约定：开发在 `dev2` 分支，发布时推送至 `dev3`（GitHub 与清华 Git 两个远端）。
