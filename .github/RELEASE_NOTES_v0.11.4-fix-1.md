# OneTHU 0.11.4-fix-1 “Revolution”

本次修复保留 0.11.4 的 CLI、SDK、OH 和界面更新。

- 修复 Windows 后台启动与会话存储权限问题；后台暂时不可用时，桌面可继续学校登录和本机会话恢复。
- 缩短后台进程异常退出后的等待，补充脱敏启动诊断。
- 首页今日课程与课表使用同一套一级、二级课程来源；读取失败显示重试，成功空结果显示无课。
- 修复平板实用模式设置无法滚动；触屏设备编辑白板继续使用显式编辑开关。
- 手机阅读布局限制继承的桌面卡片高度，保持已保存的白板摆位与自由画布尺寸。

macOS Apple Silicon、Windows x64、Android ARM64 安装包及 CLI / SDK 独立包见下方资产。Android 沿用原正式签名，可覆盖更新。

旧版 0.11.4 更新器只比较三段数字。本次更新清单使用兼容编号 **0.11.5**，实际安装版本为 **0.11.4-fix-1**；新版客户端按实际版本比较。

## English

This repair retains the CLI, SDK, OH tools and interface updates from 0.11.4.

- Fix Windows resident startup and private session storage. Desktop university sign-in and owned local-session recovery remain available when the background runtime is unavailable.
- Detect early background-process exits and record sanitized startup diagnostics.
- Use the same primary and secondary timetable source on the home screen. Failed requests show retry; successful empty results show an empty day.
- Restore scrolling in tablet practical-mode settings and retain explicit touch-edit controls.
- Bound inherited desktop card heights in phone reading mode while preserving stored geometry and free-canvas dimensions.

Installers: macOS Apple Silicon, Windows x64 and Android ARM64. Standalone CLI and SDK archives are also included. Android keeps the existing release signing certificate.

The original 0.11.4 updater compares three numeric components. Its compatibility update number is **0.11.5**; the installed version is **0.11.4-fix-1**. Updated clients compare the actual installed version.
