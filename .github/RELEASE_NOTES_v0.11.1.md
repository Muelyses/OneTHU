# OneTHU 0.11.1 · Revolution

二级选课课表与手机交互修复，macOS、Windows 和 Android 同步发布。

- 二级课表兼容学校中文与英文周次（含 `week 4`），恢复语言切换后遗漏的课程。
- 校历加载后自动补齐二级课程。
- 时间轴与月历列表统一显示二级课表及课程详情。
- 刷新异常提供重试提示，其他课程继续展示。
- 系统日历采用经过完整性校验的新版学期缓存。
- Android 沿用正式签名与原版 Logo，versionCode 11008。

- 手机完整／实用模式加入导览与设置中的布局选择；白板新增撤销、恢复默认并保留编辑前缩放。
- 暂存箱支持边缘半收起、点按打开、拖回自由放置；Android OH 收起入口更醒目。
- 修复组织管理被设置浮层挡住、检查更新加载按钮变空的问题；更新检查支持超时、取消和重试。

更新后可在日程设置中点击“刷新”重取课程。

下载：按系统选择下方安装包；清华云盘也可直接进入 [macOS](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/?p=%2FmacOS%2F)、[Windows](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/?p=%2FWindows%2F)、[Android](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/?p=%2FAndroid%2F) 文件夹。`SHA256SUMS.txt` 提供三端安装包校验码。

---

Secondary timetable and phone interaction fixes for macOS, Windows and Android.

- Secondary courses load automatically when the academic calendar is ready.
- Both the weekly timeline and monthly agenda display secondary courses and details.
- Failed refreshes show a retry message while other courses remain visible.
- System-calendar sync uses a newly validated complete-semester cache.
- Android retains its production certificate and canonical logo; versionCode 11008.

Refresh in Schedule settings after upgrading. Choose the installer for your platform below, or use the linked Tsinghua cloud folders. SHA-256 checksums are included.

- Full/Practical phone onboarding and settings offer separate navigation choices; board editing adds Undo and Restore defaults while retaining zoom.
- The vault can dock and half-hide at screen edges, and Android OH has a clearer Collapse control.
- Organization actions reveal their destination. Update checks show readable progress, bounded fallback, Cancel and Retry.
