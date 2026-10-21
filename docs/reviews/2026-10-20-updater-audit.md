# 整包更新执行层审查与修复（2026-10-20）

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


用户在本轮明确撤销了新增正式资源热更新的要求。当前只保留并修复已有整包升级，不新增资源 loader、健康确认、签名发布平台，也不以开发 HMR 代替正式升级证据。本轮没有发布更新、读取真实签名私钥或运行系统安装。

## 当前链路

- 开发：`tauri.conf.json` 的 `devUrl` 指向 Vite；这是开发 HMR。
- 正式资源：`frontendDist` 随原生包内嵌。当前没有独立资源 OTA 切换和启动回滚功能。
- 整包更新：`lib/updater.ts` 获取 GitHub / 公开云盘镜像清单、选择平台并比较版本；Rust 下载文件；用户触发后打开系统安装确认页。APK 仍由 Android 校验包名、版本和签名，桌面由系统安装器处理；这不是无重启前端更新。
- `.github/workflows/release.yml` 当前构建并上传 Actions artifact，没有生成发行者签名清单。APK 本地脚本默认沿用现有 debug keystore，不能擅自换证书导致已有安装无法覆盖升级。

## 已修复

1. **取消与并发**：旧下载共享一个随新请求清零的取消位；现在每次独立取消票、单下载闸门，等待响应头和 body chunk 都可取消。取消使真实 HTTP future/response 被丢弃，不是放弃等待后让旧下载继续。
2. **流式和资源一致性**：当前 reqwest 已有无需额外 feature 的 `Response::chunk`。改为一次 GET 流式写入，去掉缺乏 Content-Range / ETag 约束的多次 Range 拼接，也不再为不支持 Range 的服务器一次收完整包。仅接受完整 200 响应；总量上限 1 GiB，连接 25 秒、整个请求 300 秒，无无限重试。
3. **失败与提交**：每次独立暂存目录；正常错误、取消、异步任务被丢弃时清理自己的临时目录。大小/哈希校验和 `sync_all` 成功后才 rename 为完成文件。旧已下载包、账号与应用数据不被覆盖。
4. **输入边界**：安装包和重定向要求 HTTPS、不允许 URL 中嵌凭据；隔离测试的 HTTP 开关不暴露给生产 IPC。拒绝路径片段、控制字符、系统保留文件名、非法或空 SHA-256、超限大小、非原始编码。没有提供哈希时 `verified=false`，不会因空字符串误报校验通过。
5. **安装入口**：桌面和 Android 均经过 `updater_open_installer`。规范路径须位于更新缓存，只接受本进程成功完成的下载记录，打开前重新比对大小和 SHA-256；拒绝手工塞入文件、下载后改写、未完成文件和错误平台后缀。记录最多 16 条；重启后须重新下载再由应用打开安装器。仍只拉起系统确认页，不静默安装。
6. **APK 脚本**：先创建输出目录再重定向构建日志；签名口令不再传入命令行 `pass:...`，改为 apksigner 的 `env:` 参数，签名后执行 `verify`。没有读取或改动实际 keystore，也没有改变既有签名身份。

相关实现：`apps/desktop/src-tauri/src/updater.rs`、`update_download.rs`、`update_download_tests.rs`，`apps/desktop/src/lib/updater.ts` 的安装入口，以及 `apps/desktop/scripts/build-release-apk.sh`。

## 可重跑验证

```sh
CARGO_TARGET_DIR=/Volumes/OneTHUBuild/oh-desktop/cargo-target \
  cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --lib updater::download::tests --offline
node tools/update-install-test.mjs
bash -n apps/desktop/scripts/build-release-apk.sh
```

- **10 个 Rust 测试组通过**：实际本地 TCP 服务、真实 reqwest 和文件系统；包括分批传输/哈希、chunked 无长度、篡改/截断/206/超限拒绝、并发闸门、响应头和流中取消时服务端观察 socket 关闭、丢弃 future 后清理、文件 I/O 失败保留旧包、安装前二次校验。没有真实远端请求。
- **14 项 TS/IPC 检查通过**：执行生产 `installDownloaded` 函数，四平台都走同一原生验证入口；空路径不调用、原生拒绝不伪装成功。IPC 是隔离替身，不声称启动了系统安装器。
- APK 脚本语法检查通过；没有运行真实签名或 APK 发布构建。
- `cargo check --lib --target aarch64-linux-android --offline`：自然退出 0，包含 Android 安装路径分支；使用已安装 NDK 27.1 的 clang/llvm-ar 和独立 APFS target。它是编译验证，没有生成或安装 APK。macOS 原生分支随上述 Rust 测试编译通过。
- 日志：`/tmp/onethu-update-download-final.log`、`/tmp/onethu-update-android-check.log`。

## 信任与未验证范围

- **哈希不等于发行者签名**。当前清单仍依赖 HTTPS 源可信性，云盘目录回退甚至只有大小；本轮没有伪称建立了发行签名信任链。自定义源也不等于官方发布源。
- 没有从实际安装旧版完成一次 macOS/Windows/Android 的系统覆盖升级，也没有验证真实设备的安装中断、磁盘耗尽、包签名迁移和系统安装器回退。测试中的文件错误是隔离 I/O 失败，不等同真实磁盘耗尽。
- 暂存提交原子性仅针对下载文件。完成后系统安装过程由系统接管，应用没有实现原生包的事务回滚。进程被强杀或系统断电不会执行 Rust Drop，可能遗留该次暂存目录；不会把它加入完成下载记录或自动交安装器。
- 更新缓存与应用数据目录分开，执行层不删除账号、草稿、工作区或白板存档；这不是对所有未来安装包内数据迁移的保证。
- Linux 没有独立的既有官方发布产物链；前端旧镜像目录映射到 macOS 是已有缺口。新的原生入口会拒绝把 DMG 当 Linux 包执行；本轮不承诺 Linux 官方升级可用。
