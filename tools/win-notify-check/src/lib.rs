//! Windows 通知模块的**隔离编译检查**。
//!
//! 为什么需要它：主 crate 依赖 ring，在 macOS 上 `cargo check --target
//! x86_64-pc-windows-msvc` 会卡在 ring 的 C 构建脚本（没有 MSVC 工具链），
//! 于是「Windows 通知代码到底编不编得过」在没有 Windows 机器时无从验证。
//! 本检查器不依赖主 crate，只把 src-tauri 的两个通知模块按原文件编进 Windows 目标，
//! 逐个 API 核对 WinRT / 注册表调用。
//!
//! 跑法（工作目录 tools/win-notify-check）：
//!   rustup target add x86_64-pc-windows-msvc      # 只需一次
//!   cargo check --target x86_64-pc-windows-msvc
//!
//! 反向验证（确认它真的在编我们的代码）：把 notify_windows.rs 里任一 API 名改错，
//! 本检查应立即报 E0599 并指出该结构体——不要相信「通过」而不做这一步。

#[path = "../../../apps/desktop/src-tauri/src/notify_windows.rs"]
pub mod notify_windows;

#[path = "../../../apps/desktop/src-tauri/src/notify.rs"]
pub mod notify;
