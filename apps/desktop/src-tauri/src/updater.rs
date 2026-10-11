//! 应用更新（清华云盘）——下载执行层（2026-10-12 task：从云盘读更新包 + 自动拉起安装页）。
//!
//! 分工：**清单读取与版本比较在前端**（`lib/updater.ts`，用既有 `seafile_read_bytes` 读
//! `/OneTHU/release/latest.json`）；本文件只管「把云盘上的安装包流式下载到本地 + 报告进度
//! + 拉起系统安装页」这三件必须原生做的事。
//!
//! ## 红线
//! - **下载与安装必须由用户触发**：本文件不发任何自主网络请求，只在被前端调用时干活；
//! - **绝不静默安装**：`updater_open_installer` 只拉起系统安装器（桌面=系统默认应用打开
//!   DMG/EXE；安卓=ACTION_VIEW + package-archive 交给 ROM 自己的安装确认页）；
//! - **绝不删用户数据**：只写 `<app_data_dir>/updates/`，失败/取消时只删自己的 `.part` 中间文件。
//!
//! ## 下载为什么按 Range 分段拉（而不是一次 bytes()）
//! ① reqwest 本仓未开 `stream` feature，拿不到 chunked 流；② 进度必须可见（验收要求 0→100%）；
//! ③ 云盘 thufs 变体的 `dl=1` 会**返回一段下载链接文本**而不是重定向（见 seafile.rs
//! `fetch_file_bytes` 的 live 实锤），所以先探测、再对真链接做 `Range` 分段——
//! 每段 ≤2MB 落盘 + 发一次进度事件，内存占用与文件大小脱钩（安卓上尤其要紧）。

use serde_json::Value as JsonValue;
use serde_json::json;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// 进度事件（前端 `listen("onethu-updater://progress")`）
pub const UPDATER_EVENT: &str = "onethu-updater://progress";
/// 与 `seafile.rs` 同源（本实例固定地址）
const SEAFILE_BASE: &str = "https://cloud.tsinghua.edu.cn";
/// 单个 Range 段大小：2MB —— 进度粒度与请求数的平衡
const CHUNK: u64 = 2 * 1024 * 1024;
/// 取消标志（`updater_cancel_download` 置位；每次下载开局清零）
static CANCEL: AtomicBool = AtomicBool::new(false);

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败：{e}"))
}

/// 进度事件：percent 由前端算（-1 = 总大小未知）
fn emit_progress(app: &AppHandle, phase: &str, received: u64, total: u64, path: &str) {
    let percent = if total > 0 { (received as f64 * 100.0 / total as f64).min(100.0) } else { -1.0 };
    let _ = app.emit(
        UPDATER_EVENT,
        json!({ "phase": phase, "received": received, "total": total, "percent": percent, "path": path }),
    );
}

/// 探测结果：要么拿到一个**可 Range 的真下载链接**，要么服务器已经把整份内容塞在响应里
struct Resolved {
    url: Option<String>,
    inline_bytes: Option<Vec<u8>>,
    total: Option<u64>,
}

/// 解析云盘下载入口 → 真链接（thufs 变体返回「带引号的链接文本」；个别情况直接回字节）
async fn resolve_download(
    client: &reqwest::Client,
    token: &str,
    repo_id: &str,
    path: &str,
) -> Result<Resolved, String> {
    let url = format!("{SEAFILE_BASE}/api2/repos/{repo_id}/file/");
    let resp = client
        .get(&url)
        .query(&[("p", path), ("dl", "1")])
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("云盘连接失败：{e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("云盘下载入口 HTTP {status}（token 失效 / 路径不存在 / 该库无权限）"));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("读取云盘响应失败：{e}"))?;
    let text = String::from_utf8_lossy(&bytes);
    let trimmed = text.trim().trim_matches('"').trim().to_string();
    if bytes.len() < 4096 && (trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Ok(Resolved { url: Some(trimmed), inline_bytes: None, total: None });
    }
    // 服务器直接回文件内容（未走「链接文本」形态）：没有可 Range 的 URL，交给调用方整段落盘
    Ok(Resolved { url: None, inline_bytes: Some(bytes.to_vec()), total: Some(bytes.len() as u64) })
}

/// 从 `content-range: bytes 0-0/12345` 里取总大小
fn parse_total_from_content_range(v: Option<&reqwest::header::HeaderValue>) -> Option<u64> {
    let s = v?.to_str().ok()?;
    let after = s.rsplit('/').next()?;
    after.trim().parse::<u64>().ok()
}

/// 下载更新包到 `<app_data_dir>/updates/<fileName>`。
/// - 进度事件：`onethu-updater://progress`（phase: probe|download|done|verify）
/// - `expect_size`：非空则收尾比对字节数（清单里的 size），不符直接报错并删 `.part`
/// - 取消：任意时刻前端调 `updater_cancel_download` → 本函数返回 Err("已取消…")，`.part` 删除
#[tauri::command]
pub async fn updater_download(
    app: AppHandle,
    token: String,
    repo_id: String,
    path: String,
    file_name: String,
    expect_size: Option<u64>,
) -> Result<JsonValue, String> {
    CANCEL.store(false, Ordering::SeqCst);
    // 文件名安全化：只取 basename、去掉分隔符（远端名/清单 name 都可能在别的机器上生成）
    let safe: String = file_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("onethu-update.bin")
        .chars()
        .map(|c| if c == '/' || c == '\\' || c == ':' { '_' } else { c })
        .collect();
    let safe = if safe.trim().is_empty() { "onethu-update.bin".to_string() } else { safe };
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))?
        .join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建下载目录失败：{e}"))?;
    let final_path = dir.join(&safe);
    let part_path = dir.join(format!("{safe}.part"));
    let _ = std::fs::remove_file(&part_path);

    let client = http()?;
    emit_progress(&app, "probe", 0, 0, &final_path.to_string_lossy());
    let resolved = resolve_download(&client, &token, &repo_id, &path).await?;

    let mut file = std::fs::File::create(&part_path).map_err(|e| format!("创建临时文件失败：{e}"))?;
    let mut received: u64 = 0;
    let mut total: u64 = resolved.total.unwrap_or(0);

    match (resolved.url, resolved.inline_bytes) {
        // ① 真链接：先探一段拿总大小，再按 Range 分段
        (Some(real), _) => {
            let probe = client
                .get(&real)
                .header("Range", "bytes=0-0")
                .send()
                .await
                .map_err(|e| format!("下载链接不可达：{e}"))?;
            let probe_status = probe.status();
            total = parse_total_from_content_range(probe.headers().get("content-range")).unwrap_or(0);
            let probe_len = probe.content_length().unwrap_or(0);
            emit_progress(&app, "download", 0, total, &final_path.to_string_lossy());
            let ranged = probe_status.as_u16() == 206;
            // 服务器忽略 Range（200 + 全量）：探测响应本身就是整份内容，直接落盘
            let mut pending_probe: Option<Vec<u8>> = None;
            if !ranged && probe_len > 8 {
                pending_probe = Some(probe.bytes().await.map_err(|e| format!("读取响应失败：{e}"))?.to_vec());
                total = pending_probe.as_ref().map(|b| b.len() as u64).unwrap_or(0);
            }
            if let Some(b) = pending_probe {
                if CANCEL.load(Ordering::SeqCst) {
                    let _ = std::fs::remove_file(&part_path);
                    return Err("已取消下载".into());
                }
                file.write_all(&b).map_err(|e| format!("写入失败：{e}"))?;
                received = b.len() as u64;
                emit_progress(&app, "download", received, total.max(received), &final_path.to_string_lossy());
            } else {
                loop {
                    if CANCEL.load(Ordering::SeqCst) {
                        let _ = std::fs::remove_file(&part_path);
                        emit_progress(&app, "cancelled", received, total, &final_path.to_string_lossy());
                        return Err("已取消下载".into());
                    }
                    if total > 0 && received >= total {
                        break;
                    }
                    let end = received + CHUNK - 1;
                    let resp = client
                        .get(&real)
                        .header("Range", format!("bytes={received}-{end}"))
                        .send()
                        .await
                        .map_err(|e| format!("下载中断（已收 {received} 字节）：{e}"))?;
                    let st = resp.status();
                    if !(st.is_success() || st.as_u16() == 206) {
                        let _ = std::fs::remove_file(&part_path);
                        return Err(format!("下载中断：HTTP {st}（已收 {received} 字节）"));
                    }
                    let seg = resp.bytes().await.map_err(|e| format!("读取分段失败：{e}"))?;
                    if seg.is_empty() {
                        break; // 服务器给空段 = 到尾
                    }
                    file.write_all(&seg).map_err(|e| format!("写入失败：{e}"))?;
                    received += seg.len() as u64;
                    emit_progress(&app, "download", received, total.max(received), &final_path.to_string_lossy());
                    if (seg.len() as u64) < CHUNK {
                        break;
                    }
                }
            }
        }
        // ② 直接给了内容（无链接可复用）
        (None, Some(bytes)) => {
            if CANCEL.load(Ordering::SeqCst) {
                let _ = std::fs::remove_file(&part_path);
                return Err("已取消下载".into());
            }
            file.write_all(&bytes).map_err(|e| format!("写入失败：{e}"))?;
            received = bytes.len() as u64;
            total = received;
            emit_progress(&app, "download", received, total, &final_path.to_string_lossy());
        }
        (None, None) => return Err("云盘没有给出可下载的内容".into()),
    }

    file.flush().map_err(|e| format!("落盘失败：{e}"))?;
    drop(file);
    if let Some(expect) = expect_size {
        if expect > 0 && received != expect {
            let _ = std::fs::remove_file(&part_path);
            return Err(format!("文件大小不符：期望 {expect} 字节，实得 {received} 字节（可能上传未完成或清单过期）"));
        }
    }
    if received == 0 {
        let _ = std::fs::remove_file(&part_path);
        return Err("下载到 0 字节（云盘返回空内容）".into());
    }
    std::fs::rename(&part_path, &final_path).map_err(|e| format!("保存失败：{e}"))?;
    emit_progress(&app, "done", received, received, &final_path.to_string_lossy());
    Ok(json!({
        "path": final_path.to_string_lossy(),
        "dir": dir.to_string_lossy(),
        "size": received,
    }))
}

/// 取消进行中的下载（下一次分段检查点生效；已下载的 `.part` 会被清掉）
#[tauri::command]
pub async fn updater_cancel_download() -> Result<(), String> {
    CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}

/// 拉起系统安装页。**只拉起，不静默安装**：
/// - 安卓：经 onethu-mobile 插件的 `installApk`（FileProvider → content:// → ACTION_VIEW
///   + application/vnd.android.package-archive），后续确认页由 ROM 自己出；
/// - 桌面：本命令**不实现**打开（桌面走既有 `onethu_open_path`，由前端按平台分流），
///   这里返回明确错误而不是静默成功——避免「以为打开了其实没有」。
#[tauri::command]
pub async fn updater_open_installer(app: AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        if !path.starts_with('/') {
            return Err("安装包路径非法（需绝对路径）".into());
        }
        let handle = app
            .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
            .0
            .clone();
        let _: serde_json::JsonValue = handle
            .run_mobile_plugin("installApk", json!({ "path": path }))
            .map_err(|e| format!("拉起系统安装页失败：{e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (&app, &path);
        Err("桌面端请用系统默认应用打开（onethu_open_path）".into())
    }
}
