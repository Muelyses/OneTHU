# 桌面 OH 多悬浮球：生命周期修复

## 反馈与根因

Windows 用户截图中存在五个 OH 球，并反馈每次打开 OneTHU 都会增加一个。截图无法确定进程数量，源码中存在可以形成该现象的完整路径：

1. `oh-orb` 在单个进程中采用固定 label，懒创建已有异步互斥；重复调用 `overlay_show` 会复用该窗口。
2. 桌面程序原先没有单实例注册。重复打开可建立新的主进程，每个进程都能持有自己的 `oh-orb`。
3. main 关闭时直接销毁，剩余 OH 窗口保持旧进程运行；OH 的“回到 OneTHU”只查找 main，随后失效。
4. OH 的“本次关闭”只隐藏自身。主窗口已经销毁时，隐藏的 OH 仍可能使进程驻留。

## 修改

- 正式桌面构建首先注册 Tauri 官方 single-instance 插件。重复启动唤回现有 main；插件负责结束第二次启动。未启用按版本分隔实例的 semver 功能，同一产品升级仍使用同一实例身份。
- `tauri::is_dev()` 构建保持独立，允许本地开发预览和正式安装版同时打开，现有开发数据目录保持原位置。
- main 关闭且 OH 可见时保留并隐藏 main，OH 可继续后台使用。第二次启动、macOS Dock 再打开、OH 的“回到 OneTHU”共用显式激活入口。
- main 关闭且 OH 已隐藏时结束程序；先关闭 main、随后关闭 OH 也结束程序。最小化 main 和后台切换继续保持运行。
- main 显示成功即恢复其生命周期所有权；Windows 拒绝聚焦只写诊断，不会使之后关闭 OH 意外退出已显示的主窗口。
- 关闭 main 的过程中再次检查 OH 可见状态，覆盖 OH 同时关闭的边界。原有异步懒建窗、原生拖动和 OH 自动路径不唤回 main 的行为保留。

依赖锁只增加 `tauri-plugin-single-instance 2.4.5`；保持现有 Tauri 2.11.6 图。较新的插件 2.5.x 要求 Tauri 2.12，本次通过 `[patch.crates-io]` 引入官方 2.4.5 的小型本地副本，移植上游 Windows 冷启动竞争修复：发现已有 mutex 后，最多等待 40 × 25 ms 寻找 IPC 窗口；就绪或超时都会退出第二实例。向已有窗口转发使用 10 秒上限。MIT/Apache 许可、原始 crate 校验和、源码提交与维护步骤随副本保留。

## 验证与边界

`node tools/desktop-lifecycle-policy-test.mjs` 在当前平台使用 rustc 编译实际策略模块，运行八项窗口行为测试（多次复开、先关 main 再关 OH、无 OH 关 main、主窗最小化、hide 失败、show 失败、focus 失败、关闭过程竞争）和三项实际启动控制流测试（IPC 立即就绪、延迟就绪、超时均退出第二实例）。临时目录独立且执行后清理，支持 Windows `.exe`。已有 `windows-webview-threading-test.mjs` 继续通过。

原生窗口适配和系统级单实例 IPC 仍需 Windows 实机验收：连续打开安装版、关闭 main 后使用 OH、点击“回到 OneTHU”、主窗关闭后收起 OH、重启后仅保留一个球。自动化策略测试不等同于这组 Windows GUI 验收。

最终本机结果：11 项实际策略测试通过、WebView 线程护栏通过、`cargo check --lib --offline` 在 macOS ARM64 通过（使用本地 vendor 后 6.96 秒），`git diff --check` 与 176 份文档文案检查通过。Rust 输出仍有原有未使用项及第三方未来兼容性告警；本次生命周期模块没有新增编译告警。Windows adapter/IPC 的目标编译交由本次 Actions Windows 构建完成。

vendor 有效文件共 14 个、46,086 字节，含源码与双许可证。来源与回移植细节见 `apps/desktop/src-tauri/vendor/tauri-plugin-single-instance/ONETHU_PATCH.md`。

## 覆盖安装与旧实例

本项目当前 Tauri CLI 2.11.4 的默认 NSIS 模板在覆盖前使用 `CheckIfAppIsRunning` 检测程序，交互安装由用户确认关闭旧程序。该实现按可执行文件名检测；currentUser 安装限定当前用户。[对应版本源码](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/windows/nsis/utils.nsh)

已经运行的旧包没有本次单实例协议，新程序无法把旧进程自动合并。更新前保存编辑内容，按安装器提示关闭旧程序；如旧球仍在，可在任务管理器确认并结束旧 OneTHU，或重启系统后打开新版。应用没有新增扫描或终止其他进程的功能。开发预览也名为 `onethu` 时，应在运行 Windows 安装器前手动关闭，避免安装器原有按名称检测影响它。

应用内 `updater_open_installer` 继续校验下载并打开可见安装器，安装确认和关闭旧程序由系统安装流程接手。
