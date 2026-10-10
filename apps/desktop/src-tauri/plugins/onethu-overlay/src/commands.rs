//! 插件命令（JS 入口；Android 经 run_mobile_plugin 转发到 Kotlin 同名 @Command）。
//!
//! 命令面（JS 名 / Kotlin 方法）
//!   overlay_supported          / overlaySupported          本平台是否支持系统悬浮层
//!   overlay_has_permission     / overlayHasPermission      是否已获「显示在其他应用上层」
//!   overlay_request_permission / overlayRequestPermission  拉起系统授权页（ACTION_MANAGE_OVERLAY_PERMISSION）
//!   overlay_show               / overlayShow               显示悬浮球（启动前台服务）
//!   overlay_hide               / overlayHide               「本次关闭悬浮球」（停服务 + 持久化关闭语义）
//!   overlay_set_mode           / overlaySetMode            ball | bar | panel | hidden
//!   overlay_poll_event         / overlayPollEvent          拉取未确认手势（{id,type,x,y[,text]} 数组）
//!   overlay_ack_events         / overlayAckEvents          确认已处理到 id（清队列）
//!   overlay_push_ui            / overlayPushUi             前端 → 原生界面状态（消息/转写/电平/主题）
//!   overlay_pick_attach        / overlayPickAttach         拉起系统选择器（camera|gallery|file），
//!                                                         结果以事件 attach{path,name,mime,size} 推回 JS
//!   overlay_status             / overlayStatus             诊断（权限 / 是否在显示 / 形态 / 关闭标记）
//!
//! 桌面端一律返回「不支持」，前端 lib/overlay.ts 走 overlayDesktop.ts。

use tauri::{AppHandle, Runtime};
#[cfg(target_os = "android")]
use tauri::Manager;

/// 本平台是否有系统级悬浮层（Android=true；桌面端由 overlayDesktop 提供，不走这里）
#[tauri::command]
pub async fn overlay_supported<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuOverlay<R>>().0.clone();
        handle
            .run_mobile_plugin::<serde_json::Value>("overlaySupported", serde_json::json!({}))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(serde_json::json!({ "value": false, "reason": "not-android" }))
    }
}

/// 是否已授予「显示在其他应用上层」（SYSTEM_ALERT_WINDOW appop）
#[tauri::command]
pub async fn overlay_has_permission<R: Runtime>(
    app: AppHandle<R>,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuOverlay<R>>().0.clone();
        handle
            .run_mobile_plugin::<serde_json::Value>("overlayHasPermission", serde_json::json!({}))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(serde_json::json!({ "value": false }))
    }
}

/// 拉起系统「显示在其他应用上层」授权页（本应用详情页；不显示任何应用内弹窗）
#[tauri::command]
pub async fn overlay_request_permission<R: Runtime>(
    app: AppHandle<R>,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuOverlay<R>>().0.clone();
        handle
            .run_mobile_plugin::<serde_json::Value>(
                "overlayRequestPermission",
                serde_json::json!({}),
            )
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(serde_json::json!({ "ok": false, "reason": "not-android" }))
    }
}

/// 显示悬浮球：前台服务（specialUse）+ 悬浮窗；缺权限时回 {ok:false, reason:"no-permission"}
#[tauri::command]
pub async fn overlay_show<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuOverlay<R>>().0.clone();
        handle
            .run_mobile_plugin::<serde_json::Value>("overlayShow", serde_json::json!({}))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(serde_json::json!({ "ok": false, "reason": "not-android" }))
    }
}

/// 「本次关闭悬浮球」：移除悬浮窗 + 停前台服务 + 持久化「用户本次已关闭」
#[tauri::command]
pub async fn overlay_hide<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuOverlay<R>>().0.clone();
        handle
            .run_mobile_plugin::<serde_json::Value>("overlayHide", serde_json::json!({}))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(serde_json::json!({ "ok": true, "reason": "not-android" }))
    }
}

/// 形态切换：ball（52dp 圆）| bar（全宽 56dp 语音条）| panel（半屏对话面板）| hidden
#[tauri::command]
pub async fn overlay_set_mode<R: Runtime>(
    app: AppHandle<R>,
    mode: String,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuOverlay<R>>().0.clone();
        handle
            .run_mobile_plugin::<serde_json::Value>(
                "overlaySetMode",
                serde_json::json!({ "mode": mode }),
            )
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (&app, &mode);
        Ok(serde_json::json!({ "ok": false, "reason": "not-android" }))
    }
}

/// 拉取 id > since 的未确认手势事件：{ events: [{id,type,x,y[,text]}] }
#[tauri::command]
pub async fn overlay_poll_event<R: Runtime>(
    app: AppHandle<R>,
    since: i64,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuOverlay<R>>().0.clone();
        handle
            .run_mobile_plugin::<serde_json::Value>(
                "overlayPollEvent",
                serde_json::json!({ "since": since }),
            )
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (&app, since);
        Ok(serde_json::json!({ "events": [] }))
    }
}

/// 确认已处理到 id（原生据此清队列；不确认的事件会在 TTL 内由轮询重投一次）
#[tauri::command]
pub async fn overlay_ack_events<R: Runtime>(
    app: AppHandle<R>,
    id: i64,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuOverlay<R>>().0.clone();
        handle
            .run_mobile_plugin::<serde_json::Value>("overlayAckEvents", serde_json::json!({ "id": id }))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (&app, id);
        Ok(serde_json::json!({ "ok": false, "reason": "not-android" }))
    }
}

/// 前端 → 原生界面状态（JSON 字符串，字段见 lib/overlayAndroid.ts pushUi）：
/// `{messages:[{role,text}], transcript, level, listening, busy, theme}`
#[tauri::command]
pub async fn overlay_push_ui<R: Runtime>(
    app: AppHandle<R>,
    state: String,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuOverlay<R>>().0.clone();
        handle
            .run_mobile_plugin::<serde_json::Value>(
                "overlayPushUi",
                serde_json::json!({ "state": state }),
            )
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (&app, &state);
        Ok(serde_json::json!({ "ok": false, "reason": "not-android" }))
    }
}

/// 附件选择（需求 6）：camera=ACTION_IMAGE_CAPTURE(+FileProvider) / gallery=Photo Picker /
/// file=ACTION_OPEN_DOCUMENT。结果物化成 cacheDir 真实路径后，以事件 `attach` 推回前端。
#[tauri::command]
pub async fn overlay_pick_attach<R: Runtime>(
    app: AppHandle<R>,
    kind: String,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuOverlay<R>>().0.clone();
        // 用户挑图/拍照要等：用 async 版本，不长时间占住工作线程
        handle
            .run_mobile_plugin_async::<serde_json::Value>(
                "overlayPickAttach",
                serde_json::json!({ "kind": kind }),
            )
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (&app, &kind);
        Ok(serde_json::json!({ "ok": false, "reason": "not-android" }))
    }
}

/// 诊断：{ supported, hasPermission, showing, mode, closedByUser }
#[tauri::command]
pub async fn overlay_status<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuOverlay<R>>().0.clone();
        handle
            .run_mobile_plugin::<serde_json::Value>("overlayStatus", serde_json::json!({}))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(serde_json::json!({
            "supported": false, "hasPermission": false, "showing": false,
            "mode": "hidden", "closedByUser": false,
        }))
    }
}
