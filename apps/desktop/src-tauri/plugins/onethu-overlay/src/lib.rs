//! OneTHU 全局悬浮球插件（Android 系统级悬浮层，需求 5）。
//!
//! 能力：SYSTEM_ALERT_WINDOW 授权引导 + 前台服务承载的 WindowManager 悬浮窗
//! （ball / bar / panel 三形态，可拖动、松手吸附左右边框），手势经
//! `overlay_poll_event` / 内嵌 JS 回调回传前端；对话内容由前端（JS 门面）经
//! `overlay_push_ui` 推回原生渲染——**原生侧不自己跑 OH 对话**（见报告：
//! OH chat 在 Android 上走 onethu.harness 内嵌 agent，其数据面 http_request/
//! storage 必须由 webview 门面应答，Rust 侧没有可独立调用的 chat 命令）。
//!
//! 红线：本插件任何路径都不得把 OneTHU 主窗口/Activity 拉到前台
//! （不开 Activity、不调 WebviewWindow.show/set_focus、通知点击也只切换悬浮层形态）。
//!
//! 桌面端：`overlay_supported` 返回 false，前端诚实降级到桌面实现
//! （lib/overlayDesktop.ts，另由 ball-overlay-desktop 提供）。

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};
#[cfg(target_os = "android")]
use tauri::Manager;

pub mod commands;

/// Android 插件句柄包装（newtype：app.state 按类型取，裸 PluginHandle 会与其他插件撞类型）
pub struct OnethuOverlay<R: Runtime>(pub tauri::plugin::PluginHandle<R>);

impl<R: Runtime> Clone for OnethuOverlay<R> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("onethu-overlay")
        .invoke_handler(tauri::generate_handler![
            commands::overlay_supported,
            commands::overlay_has_permission,
            commands::overlay_request_permission,
            commands::overlay_show,
            commands::overlay_hide,
            commands::overlay_set_mode,
            commands::overlay_poll_event,
            commands::overlay_ack_events,
            commands::overlay_push_ui,
            commands::overlay_status,
        ])
        .setup(|app, api| {
            #[cfg(not(target_os = "android"))]
            let _ = (&app, &api);
            // Android：注册 Kotlin 插件（app.onethu.overlay.OnethuOverlayPlugin）
            #[cfg(target_os = "android")]
            {
                let handle =
                    api.register_android_plugin("app.onethu.overlay", "OnethuOverlayPlugin")?;
                app.manage(OnethuOverlay(handle));
            }
            Ok(())
        })
        .build()
}
