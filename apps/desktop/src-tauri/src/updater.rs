//! 应用更新——下载执行层（2026-10-12）。
//!
//! 分工：**清单获取、源选择、版本比较都在前端**（`lib/updater.ts`：主源 GitHub Releases 的
//! latest.json，备用/校内源清华云盘官方镜像分享链接，自动切换、不让用户挑）；本文件只管
//! 原生必须做的三件事：**把 URL 流式下载到本地 + 报进度 + 拉起系统安装页**。
//!
//! ## 红线
//! - **下载与安装必须由用户触发**：本文件不发起任何自主请求，只在被前端调用时干活；
//! - **绝不静默安装**：`updater_open_installer` 只把系统安装器拉到前台（桌面走
//!   `onethu_open_path`；安卓 = FileProvider → ACTION_VIEW，确认页由 ROM 出）；
//! - **绝不删用户数据**：只写 `<cache_dir>/updates/`，失败/取消只删自己的 `.part`。
//!
//! ## 为什么落 cache_dir 而不是 app_data_dir（2026-10-11 实测要求）
//! 安卓安装要经宿主 FileProvider 把本地文件转成 `content://`，而宿主的
//! `res/xml/file_paths.xml` **只覆盖 `<cache-path path="."/>`** —— 落 app_data_dir
//! （`/data/data/<pkg>/files`）会让 `getUriForFile` 抛 IllegalArgumentException：
//! 安装包"下载成功但装不上"。故固定落 `cache_dir()/updates/`。
//!
//! ## 为什么按 Range 分段拉
//! ① reqwest 本仓未开 `stream` feature，拿不到 chunked 流；② 进度必须可见；
//! ③ 实测两个源都支持 Range（云盘分享 `dl=1` → 302 → seafhttp：`accept-ranges: bytes`
//! + `content-range: bytes 0-1023/9516505`；GitHub Releases 资产同样支持）——
//! 每段 ≤2MB 落盘 + 发一次进度事件，内存占用与包大小脱钩。

use serde_json::json;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// 进度事件（前端 `listen("onethu-updater://progress")`）
pub const UPDATER_EVENT: &str = "onethu-updater://progress";
/// 单个 Range 段大小：2MB —— 进度粒度与请求数的平衡
const CHUNK: u64 = 2 * 1024 * 1024;
/// 取消标志（`updater_cancel_download` 置位；每次下载开局清零）
static CANCEL: AtomicBool = AtomicBool::new(false);

fn http() -> Result<reqwest::Client, String> {
    // 跟随重定向：GitHub 资产 → objects.githubusercontent.com；云盘分享 → seafhttp（实测）
    reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败：{e}"))
}

fn emit_progress(app: &AppHandle, phase: &str, received: u64, total: u64, path: &str) {
    let percent = if total > 0 { (received as f64 * 100.0 / total as f64).min(100.0) } else { -1.0 };
    let _ = app.emit(
        UPDATER_EVENT,
        json!({ "phase": phase, "received": received, "total": total, "percent": percent, "path": path }),
    );
}

fn parse_total_from_content_range(v: Option<&reqwest::header::HeaderValue>) -> Option<u64> {
    let s = v?.to_str().ok()?;
    s.rsplit('/').next()?.trim().parse::<u64>().ok()
}

/// 下载更新包到 `<cache_dir>/updates/<fileName>`。
/// - `url`：任何直链（GitHub Releases 资产 / 云盘分享 `dl=1` 链接 / 自定义源）；
/// - 进度：`onethu-updater://progress`（phase: probe|download|done|cancelled）；
/// - `expect_size`：收尾比对字节数（清单 size）；
/// - `expect_sha256`：收尾比对哈希（清单 sha256；**不符即删文件并报错，拒绝交给安装器**）；
/// - 取消：`updater_cancel_download` → 下一个分段检查点返回 Err("已取消…") 并清 `.part`。
#[tauri::command]
pub async fn updater_download(
    app: AppHandle,
    url: String,
    file_name: String,
    expect_size: Option<u64>,
    expect_sha256: Option<String>,
) -> Result<serde_json::Value, String> {
    CANCEL.store(false, Ordering::SeqCst);
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("下载地址必须是 http(s) 直链".into());
    }
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
        .cache_dir()
        .map_err(|e| format!("无法定位缓存目录：{e}"))?
        .join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建下载目录失败：{e}"))?;
    let final_path = dir.join(&safe);
    let part_path = dir.join(format!("{safe}.part"));
    let _ = std::fs::remove_file(&part_path);
    let shown = final_path.to_string_lossy().to_string();

    let client = http()?;
    emit_progress(&app, "probe", 0, 0, &shown);
    let probe = client
        .get(&url)
        .header("Range", "bytes=0-0")
        .send()
        .await
        .map_err(|e| format!("连接更新源失败：{e}"))?;
    let code = probe.status();
    if code.as_u16() == 404 {
        return Err("更新源上没有这个文件（HTTP 404：清单里的地址过期 / 资产未上传）".into());
    }
    if !(code.is_success() || code.as_u16() == 206) {
        return Err(format!("更新源拒绝下载：HTTP {code}"));
    }
    let mut total = parse_total_from_content_range(probe.headers().get("content-range")).unwrap_or(0);
    emit_progress(&app, "download", 0, total, &shown);

    let mut file = std::fs::File::create(&part_path).map_err(|e| format!("创建临时文件失败：{e}"))?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;

    if code.as_u16() == 206 {
        // 支持 Range：2MB 一段，逐段落盘 + 报进度
        loop {
            if CANCEL.load(Ordering::SeqCst) {
                let _ = std::fs::remove_file(&part_path);
                emit_progress(&app, "cancelled", received, total, &shown);
                return Err("已取消下载".into());
            }
            if total > 0 && received >= total {
                break;
            }
            let resp = client
                .get(&url)
                .header("Range", format!("bytes={received}-{}", received + CHUNK - 1))
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
                break;
            }
            file.write_all(&seg).map_err(|e| format!("写入失败：{e}"))?;
            hasher.update(&seg);
            received += seg.len() as u64;
            emit_progress(&app, "download", received, total.max(received), &shown);
            if (seg.len() as u64) < CHUNK {
                break;
            }
        }
    } else {
        // 服务器忽略 Range（200 + 全量）：一次收完（无中间进度，但仍然校验大小/哈希）
        if CANCEL.load(Ordering::SeqCst) {
            let _ = std::fs::remove_file(&part_path);
            return Err("已取消下载".into());
        }
        let body = probe.bytes().await.map_err(|e| format!("读取响应失败：{e}"))?;
        file.write_all(&body).map_err(|e| format!("写入失败：{e}"))?;
        hasher.update(&body);
        received = body.len() as u64;
        total = received;
        emit_progress(&app, "download", received, total, &shown);
    }

    file.flush().map_err(|e| format!("落盘失败：{e}"))?;
    drop(file);
    if received == 0 {
        let _ = std::fs::remove_file(&part_path);
        return Err("下载到 0 字节（更新源返回空内容）".into());
    }
    if let Some(expect) = expect_size {
        if expect > 0 && received != expect {
            let _ = std::fs::remove_file(&part_path);
            return Err(format!("文件大小不符：清单说 {expect} 字节，实得 {received} 字节（上传未完成或清单过期）"));
        }
    }
    let digest = format!("{:x}", hasher.finalize());
    // E0382：expect_sha256 在这里被 move（校验值先定型），后面 reporting 还要用 is_some ——
    // 所以在这之前克隆出「规范化后的校验值」。
    let expect_hash_norm = expect_sha256
        .as_ref()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty());
    if let Some(expect) = expect_hash_norm {
        if expect != digest {
            let _ = std::fs::remove_file(&part_path);
            return Err(format!("sha256 校验不通过（清单 {expect} / 实得 {digest}）：已丢弃下载文件，拒绝交给安装器"));
        }
    }
    std::fs::rename(&part_path, &final_path).map_err(|e| format!("保存失败：{e}"))?;
    emit_progress(&app, "done", received, received, &shown);
    Ok(json!({
        "path": shown,
        "dir": dir.to_string_lossy(),
        "size": received,
        "sha256": digest,
        "verified": expect_sha256.is_some(),
    }))
}

/// 取消进行中的下载（下一次分段检查点生效；已下载的 `.part` 会被清掉）
#[tauri::command]
pub async fn updater_cancel_download() -> Result<(), String> {
    CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}

/// 拉起系统安装页。**只拉起，不静默安装**：
/// - 安卓：经 onethu-mobile 插件的 `installApk`（FileProvider → `content://` → ACTION_VIEW
///   + application/vnd.android.package-archive），之后由 ROM 自己的安装确认页接手；
/// - 桌面：本命令不实现打开（桌面走既有 `onethu_open_path`，前端按平台分流），
///   这里返回明确错误而不是静默成功——避免「以为打开了其实没有」。
#[tauri::command]
pub async fn updater_open_installer(app: AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        if !path.starts_with('/') {
            return Err("安装包路径非法（需绝对路径）".into());
        }
        let handle = app
            .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
            .0
            .clone();
        let _: serde_json::Value = handle
            .run_mobile_plugin("installApk", json!({ "path": path }))
            .map_err(|e| format!("拉起系统安装页失败：{e}（请确认已允许「安装未知应用」）"))?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (&app, &path);
        Err("桌面端请用系统默认应用打开（onethu_open_path）".into())
    }
}
