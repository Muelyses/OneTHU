# OneTHU 0.11.3 · Revolution

此次更新集中修复登录恢复和设备身份，并让登录界面也能获取新版。

- 登录页新增更新公告和手动检查入口。暂时无法登录学校账号时，可直接查看、下载并安装修复版。
- 三种模式、中英文共用更新提醒；可延后 1 小时、1 天或 7 天。自动弹窗会等待登录和验证码输入结束。
- 学校网关、限流和服务故障单独处理，减少刷新和恢复过程中重复提交密码的情况。
- 同一安装复用设备指纹与已知账号会话，强化换账号、退出和会话恢复的归属校验。
- 保留既有二次验证与显式信任设备选择，停止自动勾选学校的“本次统一登录”选项。

macOS ARM64、Windows x64 与 Android ARM64。Android 使用原正式签名、原版 Logo，versionCode **11012**，可覆盖安装。旧版本登录受阻时，可从本页或[官网下载页](https://onethu.github.io/download.html)直接下载安装包。

[完整中文说明](https://onethu.github.io/docs/release-0.11.3/) · [清华云盘镜像](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/)

---

# OneTHU 0.11.3 · Revolution

This release improves session recovery and device identity, and makes updates available from the sign-in screen.

- Review release announcements and check for updates before signing in. Download and install fixes while university authentication is unavailable.
- All three modes support Chinese and English reminders, with delays of one hour, one day or seven days. Automatic prompts wait while sign-in or verification is underway.
- Handle gateway pages, rate limits and service failures separately, reducing repeated password submissions during refresh and recovery.
- Reuse the installation fingerprint and known account sessions, with stronger ownership checks during account changes, sign-out and recovery.
- Keep two-factor verification and explicit trusted-device choices, while leaving the university's session single-sign-on checkbox unselected by default.

Available for macOS ARM64, Windows x64 and Android ARM64. Android keeps its production signing certificate and canonical logo, with versionCode **11012** for in-place upgrades. If an older version cannot sign in, download an installer here or from the [official download page](https://onethu.github.io/en/download.html).

[Full English notes](https://onethu.github.io/docs/en/release-0.11.3/) · [Tsinghua Cloud mirror](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/)
