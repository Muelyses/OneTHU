# OneTHU 0.11.2 · Revolution

macOS、Windows 与 Android 的稳定性和交互更新。0.11.1 用户可直接升级，现有数据与设置保留。

## 本次更新

- **网络学堂恢复更可靠。** 按实际响应区分会话失效、网关异常和限流；并发请求共用一次会话恢复。作业详情加载失败提供重试，已有完整数据继续保留。
- **壁纸可跨设备恢复。** 备份包含图片或视频内容，恢复后保存到当前设备。缺少备份、权限不足和大小超限分别提示。两台设备均升级后，可从来源设备上传、到另一台设备恢复。
- **横屏平板保留编辑开关。** 宽屏布局适配横屏，浏览时可滚动、打开内容；点击“编辑”后开放组件移动和缩放。
- **玻璃效果覆盖更一致。** 学习筛选框、通知条、作业卡片与详情标题统一使用玻璃材质，主题、玻璃强度和自动文字对比设置继续生效。
- **桌面窗口归属更清晰。** 正式版重复启动会唤回已有主窗口。OH 显示时关闭主窗口会将其隐藏，可通过 OH 重新打开；主窗口和 OH 均关闭后退出。

三种模式新增统一的更新弹窗，可直接前往软件更新，或选择 1 小时、1 天、7 天后提醒。提醒期限会在重启后保留，更新的版本会重新提醒。中英文界面均支持；手动检查更新入口继续保留。

- 新闻单位名称随界面语言更新，中文和英文缓存分别保存，切换语言后显示对应名称。
- 手机白板「确认添加」优化触摸响应与退场，轻微手指移动也能正常确认。
- 简洁首页去掉重复口号，保留今日待办、今日课程标题和内容。

本版本包含 0.11.1 的二级课表、手机布局与预览数据隔离等修复。

## 升级说明

- 壁纸旧备份若只保存原设备路径，请在仍保留原图的来源设备升级后重新上传。单个媒体上限 12 MiB，整份备份上限 24 MiB；超限会提示并保留当前壁纸。上传和恢复沿用现有手动入口与云盘授权。
- Windows 覆盖安装时，请允许安装器关闭旧 OneTHU 进程，以清理旧版残留的 OH 窗口。
- Android 使用正式签名与原版 Logo，versionCode 为 **11011**，支持从之前的正式版覆盖升级。

下载：按系统选择下方安装包，或进入清华云盘的 [macOS](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/?p=%2FmacOS%2F)、[Windows](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/?p=%2FWindows%2F)、[Android](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/?p=%2FAndroid%2F) 文件夹。`SHA256SUMS.txt` 提供三端安装包的 SHA-256 校验码。

---

# OneTHU 0.11.2 · Revolution

Stability and interaction improvements for macOS, Windows and Android. Upgrade directly from 0.11.1 while keeping existing data and settings.

## Changes

- **More reliable Web Learning recovery.** Expired sessions, gateway failures and rate limits are handled according to the actual response. Concurrent requests share one recovery attempt. Failed assignment details remain retryable, and the last complete data is retained.
- **Portable wallpaper backups.** Backups include image or video content and restore it to the current device. Missing backups, permission failures and size limits have distinct messages. Update both devices, upload from the source device, then restore on the other.
- **Edit controls on landscape tablets.** The wide layout remains available for browsing and opening content. Moving or resizing widgets requires Edit mode.
- **Consistent glass surfaces.** Course filters, notification strips, assignment cards and detail headings share the same glass treatment, with theme, glass strength and automatic text contrast settings preserved.
- **Clear desktop window behavior.** Launching the release again brings back its existing main window. Closing the main window while OH is visible hides it so OH can reopen it. Closing both exits the app.

All three modes share an update prompt: go directly to Software Update, or choose a reminder in 1 hour, 1 day or 7 days. The delay survives restarts; a newer release can notify you again. Both Chinese and English interfaces are supported, and manual checks remain available.

- News source names follow the interface language. Separate Chinese and English caches prevent stale labels after switching languages.
- The phone widget confirmation button responds to small finger movements, with a lighter closing transition.
- The simple home screen keeps its task and class headings while removing redundant slogans.

This version includes the secondary timetable, phone layout and preview data isolation fixes from 0.11.1.

## Upgrade notes

- If an old wallpaper backup contains only source-device paths, update the device that still holds the original media and upload again. The limit is 12 MiB per media item and 24 MiB per backup. A size-limit message preserves the current wallpaper. Upload and restore retain their existing manual controls and cloud authorization.
- On Windows, allow the installer to close old OneTHU processes during installation to clear lingering OH windows from older builds.
- Android retains its production signing certificate and canonical logo. Its versionCode is **11011**, allowing an in-place upgrade from earlier production builds.

Choose a platform installer below or use the Tsinghua Cloud folders linked above. `SHA256SUMS.txt` contains SHA-256 checksums for all three installers.
