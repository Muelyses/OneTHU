//! 插件命令（JS 入口；Android 经 run_mobile_plugin 转发到 Kotlin 同名 @Command）。
//!
//! 约定（与 onethu-speech / onethu-calendar 一致）：
//!  - 命令名 snake_case（前端 `plugin:onethu-tts|tts_speak`），Kotlin 侧是 camelCase 方法名
//!    （ttsSpeak），`run_mobile_plugin` 的第一参就是那个方法名，不做任何自动转换；
//!  - 只有 Android 有真实现，其余平台按「不支持」处理：查询类回空值/unsupported，
//!    动作类回 Err（前端 lib/tts.ts 会把它翻译成「当前平台不支持」，而不是假装成功）。

use tauri::{AppHandle, Runtime};
#[cfg(target_os = "android")]
use tauri::Manager;

/// Android 状态里取插件句柄（非 Android 走不到这里）
#[cfg(target_os = "android")]
fn handle<R: Runtime>(app: &AppHandle<R>) -> tauri::plugin::PluginHandle<R> {
    app.state::<crate::OnethuTts<R>>().0.clone()
}

/// 当前平台/引擎是否可能出声（Android 且系统引擎没被判死）
#[tauri::command]
pub async fn tts_supported<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let v: serde_json::Value = handle(&app)
            .run_mobile_plugin("ttsSupported", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(v.get("value").and_then(|g| g.as_bool()).unwrap_or(false))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(false)
    }
}

/// 触发引擎初始化（Android：TextToSpeech 的 onInit 是异步的，命令返回 ≠ 已就绪）。
/// 失败后再次调用 = 重试（Kotlin 侧会先 reset 再重新初始化）。
#[tauri::command]
pub async fn tts_prepare<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _: serde_json::Value = handle(&app)
            .run_mobile_plugin("ttsPrepare", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Err("此平台暂不支持本地语音合成".into())
    }
}

/// 开始朗读（QUEUE_FLUSH：新的一句天然打断旧的）。
/// speed/pitch 由前端按偏好传入并已收进 0.5~2.0；Kotlin 侧还会再收一次。
/// 引擎正在初始化时 Kotlin 会**排队**（受理但不立即出声），初始化失败/超时经事件回告。
#[tauri::command]
pub async fn tts_speak<R: Runtime>(
    app: AppHandle<R>,
    text: String,
    speed: Option<f64>,
    pitch: Option<f64>,
    voice: Option<String>,
) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("空文本".into());
    }
    #[cfg(target_os = "android")]
    {
        let _: serde_json::Value = handle(&app)
            .run_mobile_plugin(
                "ttsSpeak",
                serde_json::json!({
                    "text": text,
                    "speed": speed.unwrap_or(1.0),
                    "pitch": pitch.unwrap_or(1.0),
                    "voice": voice.unwrap_or_default(),
                }),
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (&app, &text, &speed, &pitch, &voice);
        Err("此平台暂不支持本地语音合成".into())
    }
}

/// 停止朗读（无话可停时也当成功：关开关/关面板会无条件调一次）
#[tauri::command]
pub async fn tts_stop<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _: serde_json::Value = handle(&app)
            .run_mobile_plugin("ttsStop", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(())
    }
}

/// 引擎状态：{ ready, backend, state, engine, reason }
/// state ∈ unsupported | none | initializing | ready | speaking | error
#[tauri::command]
pub async fn tts_status<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        handle(&app)
            .run_mobile_plugin("ttsStatus", serde_json::json!({}))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(serde_json::json!({
            "ready": false,
            "backend": "system",
            "state": "unsupported",
        }))
    }
}

/// 系统引擎的普通话音色名列表（没有引擎/桌面端 = 空数组，前端据此禁用下拉）
#[tauri::command]
pub async fn tts_voices<R: Runtime>(app: AppHandle<R>) -> Result<Vec<String>, String> {
    #[cfg(target_os = "android")]
    {
        let v: serde_json::Value = handle(&app)
            .run_mobile_plugin("ttsVoices", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(v.get("voices")
            .and_then(|a| a.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(Vec::new())
    }
}

/// 切换后端：system（系统引擎，本期唯一实现）；neural 由 Kotlin 明确拒绝（不假装切过去了）
#[tauri::command]
pub async fn tts_set_backend<R: Runtime>(
    app: AppHandle<R>,
    backend: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _: serde_json::Value = handle(&app)
            .run_mobile_plugin("ttsSetBackend", serde_json::json!({ "backend": backend }))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (&app, &backend);
        Err("此平台暂不支持本地语音合成".into())
    }
}
