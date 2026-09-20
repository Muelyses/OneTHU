//! 下载位置：网络学堂附件与云盘文件落盘处，三端各自落地。
//!
//! - 桌面（macOS / Windows）：本机目录，默认取系统「下载」（Windows 上被重定向到
//!   别的盘符也算数），用户可用系统文件夹选择器改，配置存在应用状态目录。
//! - Android：没有「随便写一个路径」这回事——要落到用户看得见的位置，要么走 MediaStore
//!   （系统「下载」），要么由用户**授权一个目录**（SAF 目录树）。目录树授权与文档创建
//!   只有 Activity 侧做得到，故这里只转发给 onethu-mobile 插件（见 DownloadPrefs.kt）。
//!
//! 「另存为」（save_file_as）是同一件事的单次版本：桌面弹系统保存对话框，Android 弹
//! ACTION_CREATE_DOCUMENT，取消都返回 Ok(None)——用户改主意不是错误。

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadDirectory {
    path: String,
    is_default: bool,
}

#[cfg(not(target_os = "android"))]
const STATE_KEY: &str = "download-directory";

#[cfg(not(target_os = "android"))]
fn default_directory<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    // 尊重 Windows 系统中重定向后的「下载」文件夹。
    app.path()
        .download_dir()
        .map_err(|e| format!("无法定位下载目录：{e}"))
}

#[cfg(not(target_os = "android"))]
fn directory_setting<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<DownloadDirectory, String> {
    let saved = crate::state_read(app.clone(), STATE_KEY.into())?;
    let custom: Option<std::path::PathBuf> = saved
        .map(|text| serde_json::from_str(&text).map_err(|e| format!("无法读取下载位置：{e}")))
        .transpose()?;
    let is_default = custom.is_none();
    let path = match custom {
        Some(path) if path.is_absolute() => path,
        Some(_) => return Err("下载位置必须是绝对路径，请重新选择文件夹".into()),
        None => default_directory(app)?,
    };
    Ok(DownloadDirectory {
        path: path.to_string_lossy().into_owned(),
        is_default,
    })
}

#[cfg(not(target_os = "android"))]
pub fn directory<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<std::path::PathBuf, String> {
    Ok(std::path::PathBuf::from(directory_setting(app)?.path))
}

/// 读取当前下载位置。桌面：本机路径；Android：授权目录的显示名（SAF 给不出真实路径）。
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn download_directory_get<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<DownloadDirectory>, String> {
    directory_setting(&app).map(Some)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn download_directory_get(app: tauri::AppHandle) -> Result<Option<DownloadDirectory>, String> {
    let raw = mobile_call(app, "downloadDirGet", serde_json::json!({})).await?;
    Ok(from_mobile(raw))
}

/// 选择下载位置。桌面：系统文件夹选择器；Android：SAF 目录树（授权持久化，重启仍有效）。
/// 取消时不修改配置。
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn download_directory_pick<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<DownloadDirectory>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file().set_title("选择下载文件夹");
    if let Ok(current) = directory(&app) {
        if current.is_dir() {
            dialog = dialog.set_directory(current);
        }
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog.pick_folder(move |path| {
        let _ = tx.send(path);
    });
    let Some(picked) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    if !path.is_absolute() || !path.is_dir() {
        return Err("请选择有效的下载文件夹".into());
    }
    let content = serde_json::to_string(&path).map_err(|e| e.to_string())?;
    crate::state_write(app.clone(), STATE_KEY.into(), content)?;
    directory_setting(&app).map(Some)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn download_directory_pick(app: tauri::AppHandle) -> Result<Option<DownloadDirectory>, String> {
    let raw = mobile_call(app, "downloadDirPick", serde_json::json!({})).await?;
    Ok(from_mobile(raw))
}

/// 恢复默认（桌面 = 系统「下载」目录；Android = 撤销自定义目录，回到系统下载）。
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn download_directory_reset<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<DownloadDirectory>, String> {
    let path = default_directory(&app)?;
    crate::state_delete(app, STATE_KEY.into())?;
    Ok(Some(DownloadDirectory {
        path: path.to_string_lossy().into_owned(),
        is_default: true,
    }))
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn download_directory_reset(app: tauri::AppHandle) -> Result<Option<DownloadDirectory>, String> {
    let raw = mobile_call(app, "downloadDirReset", serde_json::json!({})).await?;
    Ok(from_mobile(raw))
}

/* ── Android：把命令转给 onethu-mobile 插件 ──
 * SAF 的目录树授权、文档创建都只有 Activity 侧做得到（要 startActivityForResult），
 * Rust 这边只做转发与形状归一。 */

#[cfg(target_os = "android")]
async fn mobile_call(
    app: tauri::AppHandle,
    method: &str,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use tauri::Manager;   // .state() 来自 Manager trait
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async(method, payload)
        .await
        .map_err(|e| e.to_string())
}

/// 插件回传 → 命令返回形状（path 是给用户看的显示名）
#[cfg(target_os = "android")]
fn from_mobile(raw: serde_json::Value) -> Option<DownloadDirectory> {
    let path = raw.get("path").and_then(|v| v.as_str()).unwrap_or("系统下载");
    Some(DownloadDirectory {
        path: path.to_string(),
        is_default: raw.get("isDefault").and_then(|v| v.as_bool()).unwrap_or(true),
    })
}
