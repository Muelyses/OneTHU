# OneTHU 0.11.4-fix-1 · Revolution

[English](en/release-0.11.4-fix-1.md) · [安装包](https://github.com/smartThise/OneTHU/releases/tag/v0.11.4-fix-1) · [清华云盘](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/)

保留 0.11.4 的 CLI、SDK、OH 与界面功能，修复本轮登录、课程与触屏问题。

- Windows：修复后台启动与会话文件权限问题。后台暂时不可用时，桌面可继续学校登录和本机会话恢复；账号、退出状态和二次验证继续约束后续移交。
- 首页课程：白板及简化模式共用一级、二级课表来源；读取中显示加载，失败提供重试，成功空结果显示无课。
- 平板：实用设置可以滑动到底部。触屏白板默认阅读，显式开启编辑后才能移动和缩放。
- 手机：阅读布局限制继承的桌面卡片高度，保留白板数据与自由画布尺寸。

三端安装版本均为 **0.11.4-fix-1**。Android ARM64 versionCode **11014**，沿用原正式证书和 Logo。Windows 提供 NSIS EXE，macOS 提供 Apple Silicon DMG。CLI 与 SDK 独立包同步发布。

旧 0.11.4 更新器只比较三段数字，因此可能显示兼容更新编号 **0.11.5**。本次实际安装版本为 **0.11.4-fix-1**，新版更新器按实际版本判断，避免重复提醒。

源码冻结在 `ec2b8b341aeeeba0bcb3e0870399211f02785dc9`。Windows 安装器的工作流修补单独记录，实际构建仍检出冻结标签。完整验证及环境限制见 [修复记录](reviews/2026-10-27-release-fix1.md)。
