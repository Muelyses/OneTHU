# OneTHU 0.11.1 · Revolution

二级选课课表与手机交互修复，macOS、Windows 和 Android 同步发布。

2026-10-22 安装包再次修订：改善网络学堂会话恢复、壁纸跨设备备份、横屏平板编辑操作及玻璃材质覆盖。包含先前的预览数据隔离修复。已安装旧 0.11.1 的用户请重新下载覆盖安装，用户数据保留；相同版本号不会触发旧客户端的升级提醒。

- 网络学堂按实际响应处理会话失效、网关异常和限流；并发请求共用一次恢复，作业详情加载失败保留重试提示。
- 壁纸备份包含媒体内容，支持跨设备恢复。只含旧设备路径的备份，请在原设备更新后重新上传；找不到备份和权限不足分别提示。
- 横屏平板保留宽屏布局，点击“编辑”后才开放白板组件移动和缩放。
- 统一学习筛选框、通知条、作业卡片与详情标题的玻璃材质，保留主题、玻璃强度及自动文字对比设置。
- 桌面正式版重复启动会唤回已有窗口；保留 OH 悬浮球时可重新打开主窗，主窗和悬浮球均关闭后退出。Windows 若已有旧版悬浮球残留，请在覆盖安装时允许安装器关闭旧 OneTHU。

- 二级课表兼容学校中文与英文周次（含 `week 4`），恢复语言切换后遗漏的课程。
- 校历加载后自动补齐二级课程。
- 时间轴与月历列表统一显示二级课表及课程详情。
- 刷新异常提供重试提示，其他课程继续展示。
- 系统日历采用经过完整性校验的新版学期缓存。
- Android 沿用正式签名与原版 Logo，versionCode 11010。

- 手机左上角按钮可展开纵向功能浮层以替代 OneShot，极简五项、完整／实用全部一级入口；完整／实用导览提供布局选择。白板新增撤销、恢复默认并保留编辑前缩放。
- 暂存箱支持边缘半收起、点按打开、拖回自由放置；Android OH 收起入口更醒目。
- 修复组织管理被设置浮层挡住、检查更新加载按钮变空的问题；更新检查支持超时、取消和重试。

更新后可在日程设置中点击“刷新”重取课程。

下载：按系统选择下方安装包；清华云盘也可直接进入 [macOS](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/?p=%2FmacOS%2F)、[Windows](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/?p=%2FWindows%2F)、[Android](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/?p=%2FAndroid%2F) 文件夹。`SHA256SUMS.txt` 提供三端安装包校验码。

---

Secondary timetable and phone interaction fixes for macOS, Windows and Android.

Further installer revision, October 22: improves Web Learning session recovery, portable wallpaper backups, landscape tablet editing and glass surfaces. Includes the earlier widget preview data isolation fix. Existing 0.11.1 users should download and install this revision over their current installation to retain data. Older clients do not offer an update notification for the same version number.

- Web Learning distinguishes expired sessions, gateway failures and rate limits. Concurrent requests share one recovery attempt, and failed assignment details remain retryable.
- Wallpaper backups include the media for cross-device restoration. Backups containing old device paths require a fresh upload from the updated source device; missing backups and permission failures have separate messages.
- Landscape tablets retain their wide layout and require Edit mode before moving or resizing board widgets.
- Course filters, notification strips, assignment cards and detail headings share consistent glass surfaces while retaining theme, glass strength and automatic text contrast settings.
- Launching the desktop release again activates its existing window. The main window remains available while OH is in use, and closing both exits the app. If old OH windows remain on Windows, allow the installer to close the previous OneTHU processes during replacement.

- Secondary courses load automatically when the academic calendar is ready.
- Both the weekly timeline and monthly agenda display secondary courses and details.
- Failed refreshes show a retry message while other courses remain visible.
- System-calendar sync uses a newly validated complete-semester cache.
- Android retains its production certificate and canonical logo; versionCode 11010.

Refresh in Schedule settings after upgrading. Choose the installer for your platform below, or use the linked Tsinghua cloud folders. SHA-256 checksums are included.

- A top-left phone button opens a vertical feature overlay in place of OneShot: five entries in Minimal, all primary features in Full/Practical. Full/Practical onboarding offers the layout choice. Board editing adds Undo and Restore defaults while retaining zoom.
- The vault can dock and half-hide at screen edges, and Android OH has a clearer Collapse control.
- Organization actions reveal their destination. Update checks show readable progress, bounded fallback, Cancel and Retry.
