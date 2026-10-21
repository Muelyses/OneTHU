# OneTHU 0.11 · Revolution

从 0.10 的公测版走向统一的校园工作台。主题、壁纸、布局按你的习惯调整，原版上下 Logo 保持不变。

## 这一版有什么

- **三种使用模式**：极简、实用、完整模式分别组织入口和导览；切换模式保留原有数据和完整模式设置。
- **全新 OneGUI**：统一组件、视觉令牌、分段导航、玻璃材质与文字对比度，修补手机与 Windows 的布局、滚动和遮挡问题。
- **工作台由你安排**：白板组件可移动、缩放、删除；OneShot、标签页、工作区、OneGO! 与可移动刷新/暂存入口各司其职。
- **长按暂存，再分享**：作业、课件、组件及已接入的内容可拖入暂存箱，通过在线短口令收发。NFC 目前可用性不稳定，请尽量使用口令。
- **好友、名片与组织**：个人资料同步，组织成员、文件、项目与公告管理；兼容变更自动合并，不能合并的冲突以卡片对比明确选择。
- **日程与作业截止**：汇集课程、作业 DDL 与自定义安排，修补极简/实用模式的作业来源、列表滚动和组件内跳转留白。
- **搜索、OH 与清小搭**：三模式均有搜索说明；完整模式支持 OneTHU Harness、插件、清小搭对话/历史/智能体和技能广场。内置轻量环境支持兼容的资料与纯 JavaScript 技能，重型运行环境交给电脑 Agent。
- **中英文体验**：界面国际化、语言选择第 0 步、模式专属导览，以及分别录制的中英文界面截图和长按演示。官网、README 和现行文档提供中英文入口。
- **稳定性修补**：Windows 登录窗口线程与交互、认证重试与 2FA、资料库归属、防重复建库、账户隔离、同步冲突和 Android 返回历史等修补。

## 下载与安装

| 平台 | 安装包 |
|---|---|
| macOS · Apple Silicon | `OneTHU_0.11.0_aarch64.dmg` |
| Windows · x64 | `OneTHU_0.11.0_x64-setup.exe` |
| Android · ARM64 | `OneTHU_0.11.0_arm64.apk` |

Android 沿用 GitHub 正式版签名，支持同证书正式版覆盖升级；使用 debug 签名的测试包无法直接覆盖安装，请先导出需要保留的数据再迁移。校验值见随附的 `SHA256SUMS.txt`。macOS/Windows 安装包未使用商业发行证书；请从本 Release 下载。

## 使用范围

OneTHU 是非官方校园工具。部分服务需要独立授权，真实双校园账号协作及所有厂商设备组合尚未完成统一验收。NFC 请优先改用短口令；内置技能环境不等于完整 Python/Node/系统环境。公开演示全部使用虚构数据。

[官网](https://onethu.github.io/) · [开始使用](https://onethu.github.io/docs/getting-started/) · [开发者](https://onethu.github.io/developers.html) · [完整源码](https://github.com/smartThise/OneTHU)

---

## English

OneTHU 0.11 **Revolution** brings a unified OneGUI interface, customizable themes/wallpapers/layouts, three experience modes, a flexible whiteboard, staging and online share codes, contacts and organizations, course/assignment scheduling, search, OH, OneTHU Harness, plugins, and Xiaoda agents and skills.

This release includes authentication and account-isolation fixes, profile synchronization and conflict handling, Windows interaction/layout repairs, Android back navigation, bilingual onboarding, and separately captured English demos. Switching modes preserves your existing data and full-mode preferences.

Downloads: **macOS Apple Silicon DMG**, **Windows x64 installer**, and **Android ARM64 APK**. Android retains the GitHub release signing identity. Debug-signed test builds cannot be upgraded in place to this release; export data you need before migrating. Check downloads against `SHA256SUMS.txt`. Desktop packages do not have commercial distribution certificates.

**NFC is currently unreliable; prefer online share codes.** Heavy Python/Node/system-dependent skills require a compatible desktop Agent. Live two-account collaboration and every device/vendor combination have not been universally validated. OneTHU is an unofficial campus tool; all public demos use fictional data.

[English website](https://onethu.github.io/en/) · [English guide](https://onethu.github.io/docs/en/getting-started/)


**清华云盘镜像 / Cloud mirror**：[固定下载入口](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/)，按 `Android` / `macOS` / `Windows` 系统目录直接下载 / download directly from your platform folder。三端安装包与校验文件已同步，匿名下载 SHA-256 核对一致 / all three installers and checksums are mirrored and verified.
