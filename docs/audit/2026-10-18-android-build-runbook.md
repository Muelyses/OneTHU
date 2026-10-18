# Android 构建 / 模拟器验证 Runbook（2026-10-18）

## 环境

- Android SDK/NDK：`/Volumes/OneTHUBuild/oh-android-sdk`（NDK 27.1.12297006）
- JDK：17（`/usr/libexec/java_home -v 17`）
- AVD：`onethu-demo`（android-35 google_apis arm64-v8a）
- Gradle 工程：`apps/desktop/src-tauri/gen/android`（**软链到 `/Volumes/OneTHUBuild/onethu-android`**；Android 工程/构建缓存必须在 SSD，禁止再放内盘）

> 关键：`tauri android build` 默认不注入 NDK 的 linker/CC，Rust 会误用宿主 `cc` 链接 Android
> 目标。必须显式导出以下环境变量（本 runbook 已实测）：

```bash
NDK=/Volumes/OneTHUBuild/oh-android-sdk/ndk/27.1.12297006
BIN=$NDK/toolchains/llvm/prebuilt/darwin-x86_64/bin
export PATH=$BIN:$PATH NDK_HOME=$NDK
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=$BIN/aarch64-linux-android34-clang
export CC_aarch64_linux_android=$BIN/aarch64-linux-android34-clang
export CXX_aarch64_linux_android=$BIN/aarch64-linux-android34-clang++
export AR_aarch64_linux_android=$BIN/llvm-ar
```

## 只编译 Kotlin（最快抓 native 语法错误）

```bash
cd apps/desktop/src-tauri/gen/android
JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew \
  :tauri-plugin-onethu-mobile:compileDebugKotlin :app:compileArmDebugKotlin --offline
```

## 打 debug APK

```bash
cd apps/desktop
# 先导出上面的 NDK 环境变量
pnpm tauri android build --debug
# 产物：src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

## 模拟器安装/启动

```bash
EMU=/Volumes/OneTHUBuild/oh-android-sdk/emulator/emulator
ADB=/Volumes/OneTHUBuild/oh-android-sdk/platform-tools/adb
$EMU -avd onethu-demo -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot &
$ADB wait-for-device
$ADB install -r apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
$ADB shell am start -W -n app.onethu.desktop/.MainActivity
$ADB exec-out screencap -p > /tmp/onethu-emulator.png
```

## 2026-10-18 实测结果

- Kotlin 编译：`BUILD SUCCESSFUL`（插件 + app）。
- debug APK：`BUILD SUCCESSFUL`，universal APK 277MB。
- 模拟器安装成功，`MainActivity` 冷启动成功，进入登录页（截图 `docs/assets/android-emulator-login-2026-10-18.png`）。
- 登录页按系统返回键 → App 进程退出、回桌面；无 `FATAL EXCEPTION`。
- 模拟器没有 NFC 硬件，**无法验证 ReaderMode/HCE**；也未登录，无法验证暂存箱/云端 UI。

## 内盘空间纪律（2026-10-18 教训）

- Tauri/Gradle 构建曾把 Android 工程放在 `/Users/st/onethu-android`（内盘），加上模拟器 AVD，
  一度把内盘写到只剩几百 MB；已删除并改软链到 `/Volumes/OneTHUBuild/onethu-android`。
- 以后构建前确认 `apps/desktop/src-tauri/gen/android` 软链指向外置 SSD；模拟器 AVD 也应在 SSD。
- 不要在 `~/` 下新建 Android/Gradle 工程目录。

## 已知限制

- `tauri android build` 未自动设置 NDK linker，需按上面 env 导出；可考虑后续加脚本封装。
- 生成的 `gen/schemas/*-schema.json` 会随权限/命令变化更新，需随提交。
