//! OneTHU 语音合成插件（TTS，需求 4）。
//!
//! 命令面（前端 `src/lib/tts.ts` 一一对应）：
//!   tts_supported / tts_prepare / tts_speak{text,speed,pitch,voice} / tts_stop /
//!   tts_status{ready,backend,state} / tts_voices / tts_set_backend{backend}
//! 事件（Kotlin `trigger` → JS `listen`）：`onethu-tts://done { reason }`
//!   reason ∈ done | stopped | error:<code> | error:init | error:timeout
//!
//! 真实现全在 Kotlin（`app.onethu.tts.OnethuTtsPlugin` → `TtsHub` → `SystemTts`）；
//! 本 crate 只做三件事：把命令转发到 Kotlin、把 Kotlin 的返回值整成前端要的形状、
//! **在非 Android 平台上诚实回「不支持」**（桌面端不假装能出声，前端据此显示说明而不是假开关）。

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};
#[cfg(target_os = "android")]
use tauri::Manager;

pub mod commands;

/// Android 插件句柄包装（newtype：app.state 按类型取，裸 PluginHandle 会与其他插件撞类型）
pub struct OnethuTts<R: Runtime>(#[allow(dead_code)] tauri::plugin::PluginHandle<R>);

impl<R: Runtime> Clone for OnethuTts<R> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("onethu-tts")
        .invoke_handler(tauri::generate_handler![
            commands::tts_supported,
            commands::tts_prepare,
            commands::tts_speak,
            commands::tts_stop,
            commands::tts_status,
            commands::tts_voices,
            commands::tts_set_backend,
        ])
        .setup(|app, api| {
            #[cfg(not(target_os = "android"))]
            let _ = (&app, &api);
            // Android：注册 Kotlin 插件（app.onethu.tts.OnethuTtsPlugin）
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("app.onethu.tts", "OnethuTtsPlugin")?;
                app.manage(OnethuTts(handle));
            }
            Ok(())
        })
        .build()
}
