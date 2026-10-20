# 原生边界安全审查 · 2026-10-20

本轮检查并修复原生 invoke、插件安装与启动、文件镜像、原生 HTTP 跳转和敏感日志。仅使用本机 HTTP 服务和隔离临时文件，不读取真实凭据、不调用学校接口、不发布。整包升级的覆盖及签名信任缺口仍以 `2026-10-20-updater-audit.md` 为准；没有新增资源热更新。

## 已修复

| 缺陷与影响 | 修复落点 |
| --- | --- |
| `plugin_dir` 只限制字符，允许 `.`/`..`；以 `..` 卸载会越过插件目录。ZIP 的 `manifest.entry/bin` 也未校验，可能读取包外文件或修改包外程序权限。 | `native_security.rs:5` 校验 ID，`:23` 跨平台相对路径，`:41` 拒绝目录链符号链接；`lib.rs` 导入、logo、卸载及内置 sidecar 共用约束。 |
| ZIP 导入先覆盖已安装目录，再发现非法路径/缺入口；失败后旧插件已损坏。 | `plugin_package.rs:73` 先校验路径、大小、manifest、重复文件和入口，在独立目录解包；成功验证后切换，普通替换错误恢复旧目录。上限 4096 项、总展开大小 1 GiB、清单 1 MiB、JS 入口 32 MiB。 |
| `plugin_spawn` 可执行任意路径；插件 storage 的 ID 可参与路径拼接，损坏 JSON/写入失败被当成成功或空存储。 | `native_security.rs:64` 将程序限制在对应安装目录，拒绝链接/跨插件路径；`plugins.rs:197` 区分缺失、损坏和 I/O 失败，返回 JSON-RPC error，唯一临时文件写入后替换。旧进程退出/响应也不再摘除或写入替代它的新进程。 |
| 记忆镜像只做词法 `..` 检查，已有符号链接或固定 `.tmp` 链接可越出镜像根。 | `memory_mirror.rs` 每级拒绝符号链接；使用 `create_new` 唯一临时文件；列表跳过链接。保留云盘路径常见的开头 `/` 相对根语义。 |
| `http_native` 每次跳转都重放原始 Authorization、自定义 token 头及保留的请求体；跳转耗尽返回空响应。 | `native_security.rs:187` 按 origin（含端口）处理：同源保持，跨源只保留公开表示偏好，拒绝自动跨源重发非空请求体和 HTTPS 降级；302 POST / 303 的 GET 跳转仍可用，Cookie 仍由目标域仓选择。`lib.rs:1390` 显式重定向上限错误并应用单跳超时。 |
| 原生日志记录完整 Cookie、POST headers/body、学习响应和场馆 JSON，桌面写公共 `/tmp/onethu-debug.log`。 | 删除这些 dump；逐跳只记不含 query、fragment、userinfo 的 URL、状态、方法和耗时；所有平台改为应用数据目录 `logs/`，Unix 0600。场馆 query 和响应内容不再落日志。复核再删除 CLOUD-SHELL HTML 全文 dump；`debug_log_line` 共用 `redact_log` 后才写文件及 Android logcat：去 URL query/fragment/userinfo，识别 Cookie/Authorization/token/password/API key 等字段后丢弃该条记录余下内容，并转义控制字符、限制单条长度。 |
| Cookie 落盘/回种丢失 Secure，host-only Cookie 未被旧 TSV 正确保存；清指定域时通过重建其他 Cookie 丢属性。 | `lib.rs:1283` 保存 cookie_store 完整 JSON 属性（同一路径），兼容旧 TSV，并恢复旧 Secure 标志；清域直接删匹配项，保留其他项原属性。会话 Cookie 持久化这一既有产品语义保留。 |
| Windows 打开文件/URL 使用 `cmd /C start` 拼接，路径可能被 shell 二次解释。 | `lib.rs:633` 使用现有 Tauri opener Rust API；本地文件仍校验绝对路径且存在，URL 校验 HTTP(S) 且无 userinfo。锁定依赖 open 5.4.2 的 Windows 实现通过环境值传递目标，不拼进命令源码。 |
| 状态文件/原生 Cookie 使用普通权限和固定临时名。 | `native_security.rs:77` 唯一 `create_new` 临时文件、flush/sync、rename；Unix 0600，旧状态文件读取及旧 Cookie 载入时收紧权限。写失败不把旧内容替换成半份。 |

场馆内联 token 的 HTML/JS 注入由并行 HTML 审查修复，已包含在最终原生编译中；独立工具 `tools/venue-token-script-browser-test.mjs` 为该代理提供的 35 条 Chromium/WebKit 检查，不计入下面的 20 组。

## 验证

以下命令均自然退出 0，共 **20 组 Rust 检查**；不是 20 次真实账户操作。

```sh
CARGO_TARGET_DIR=/Volumes/OneTHUBuild/oh-desktop/cargo-target cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib security --offline
CARGO_TARGET_DIR=/Volumes/OneTHUBuild/oh-desktop/cargo-target cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib plugin_package::tests --offline
CARGO_TARGET_DIR=/Volumes/OneTHUBuild/oh-desktop/cargo-target cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib memory_mirror::tests --offline
```

- 11 组：敏感日志字段/URL/控制字符脱敏；真实双本地 HTTP origin 的 302 去鉴权/去 body、同源 307 保持、跨源 307 拒绝且目标零请求、26 跳限制；路径、可执行文件范围、0600/失败保留、Cookie 往返、损坏 storage。
- 4 组：实际 ZIP 正常导入/替换、恶意 ID/manifest/zip-slip、缺程序/歧义 JS、符号链接目标，均检查旧安装保留。
- 5 组：镜像读写/列表/删除/大小及符号链接、固定临时名攻击。
- macOS 原生测试目标编译通过；`aarch64-linux-android` 离线 `cargo check --lib` 自然退出 0（6.58 秒），没有声称真机安装通过。
- 定向 `git diff --check` 通过。

末轮统一日志兜底验证：`/tmp/onethu-native-security-sink.log`（11 组全部自然退出 0），所有输入均为合成字符串，未读取真实日志。

本机日志：`/tmp/onethu-native-security-final.log`、`/tmp/onethu-plugin-package-security.log`、`/tmp/onethu-memory-mirror-security.log`、`/tmp/onethu-native-security-android.log`。

## 保留边界

- 原生插件仍是用户安装并授权运行的本机进程，拥有当前用户权限；这些 IPC 路径约束不是操作系统沙箱或插件签名体系。主应用已有通用文件/网络能力，未重构所有 invoke 的权限模型。
- 路径检查阻止既存链接，未声称防住同一 OS 用户在检查与操作之间并发替换目录的攻击。插件目录切换两次 rename 之间若进程被强杀，可能留下 `.previous` 备份，需要恢复；没有声称目录替换完全抗断电。
- 私有文件权限不等于加密/Keychain。当前会话、remember-password、插件状态的凭据仍可能存在本地明文；Windows 使用应用目录继承 ACL，本轮没有 Windows 实机权限验证。
- 原生日志入口对已标记的常见凭据字段和 URL 作统一兜底；任意无标记秘密或未知字段仍无法通用识别，调用方仍须禁止记录凭据/正文。历史 `/tmp` 日志未静默删除。URL 路径仍供诊断，含路径型分享凭据的调用方应避免写日志。
- 本轮真实网络验证只到本地假服务。学校 SSO 的常见 302/303 和同源请求语义有回归覆盖，但未实际登录学校；依赖跨源 307/308 重发 body 的服务现在需要调用方显式重新确认/发起。
- `read_file_text`、媒体本地读取、外部浏览器调试等是现有用户选择文件/插件功能所需的通用能力；本轮只读盘点，没有宣称全仓原生面已完成渗透测试。
