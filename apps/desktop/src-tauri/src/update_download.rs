//! Bounded, cancellable installer transport. A hash is integrity, not publisher authentication.
use sha2::{Digest, Sha256};
use std::{
    future::Future,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

pub const MAX_DOWNLOAD: u64 = 1024 * 1024 * 1024;
static NEXT_DOWNLOAD: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct DownloadGate(Mutex<Option<Arc<AtomicBool>>>);
pub struct DownloadPermit<'a> {
    gate: &'a DownloadGate,
    cancel: Arc<AtomicBool>,
}
impl DownloadGate {
    pub const fn new() -> Self {
        Self(Mutex::new(None))
    }
    pub fn begin(&self) -> Result<DownloadPermit<'_>, String> {
        let mut active = self.0.lock().map_err(|_| "下载状态不可用")?;
        if active.is_some() {
            return Err("已有更新包正在下载，请等待完成或取消后重试".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *active = Some(cancel.clone());
        Ok(DownloadPermit { gate: self, cancel })
    }
    pub fn cancel(&self) {
        if let Ok(active) = self.0.lock() {
            if let Some(token) = active.as_ref() {
                token.store(true, Ordering::SeqCst);
            }
        }
    }
}
impl Drop for DownloadPermit<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.gate.0.lock() {
            if active
                .as_ref()
                .is_some_and(|token| Arc::ptr_eq(token, &self.cancel))
            {
                *active = None;
            }
        }
    }
}
impl DownloadPermit<'_> {
    fn check(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::SeqCst) {
            Err("已取消下载".into())
        } else {
            Ok(())
        }
    }
    async fn wait<T>(&self, future: impl Future<Output = T>) -> Result<T, String> {
        self.check()?;
        tokio::pin!(future);
        loop {
            tokio::select! {
                biased;
                _ = tokio::time::sleep(Duration::from_millis(25)) => self.check()?,
                result = &mut future => { self.check()?; return Ok(result); }
            }
        }
    }
}

struct Staging {
    dir: PathBuf,
    keep: bool,
}
impl Drop for Staging {
    fn drop(&mut self) {
        if !self.keep {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }
}
pub struct Downloaded {
    pub path: PathBuf,
    pub size: u64,
    pub sha256: String,
    pub verified: bool,
}
/// Only a file this process actually finished downloading can reach the installer.
/// Keeps a bounded set; restarting the app requires downloading again.
pub struct CompletedDownloads(Mutex<Vec<(PathBuf, u64, String)>>);
impl CompletedDownloads {
    pub const fn new() -> Self {
        Self(Mutex::new(Vec::new()))
    }
    pub fn remember(&self, item: &Downloaded) -> Result<(), String> {
        let path = item.path.canonicalize().map_err(|_| "更新包已不可读")?;
        let mut entries = self.0.lock().map_err(|_| "更新记录不可用")?;
        entries.retain(|(old, _, _)| old != &path);
        entries.push((path, item.size, item.sha256.clone()));
        if entries.len() > 16 {
            entries.remove(0);
        }
        Ok(())
    }
    pub fn validate(&self, root: &Path, path: &Path) -> Result<PathBuf, String> {
        let path = installer_path(root, path)?;
        let (size, expected) = self
            .0
            .lock()
            .map_err(|_| "更新记录不可用")?
            .iter()
            .find(|(saved, _, _)| saved == &path)
            .map(|(_, size, hash)| (*size, hash.clone()))
            .ok_or("请先完成更新包下载，再打开安装器")?;
        let mut file = std::fs::File::open(&path).map_err(|_| "安装包无法读取，请重新下载")?;
        if file.metadata().map_err(|_| "安装包无法读取")?.len() != size {
            return Err("安装包下载后已改变，请重新下载".into());
        }
        let mut hasher = Sha256::new();
        let mut buffer = [0; 64 * 1024];
        loop {
            let n = file
                .read(&mut buffer)
                .map_err(|_| "安装包复核失败，请重新下载")?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
        if format!("{:x}", hasher.finalize()) != expected {
            return Err("安装包下载后已改变，请重新下载".into());
        }
        Ok(path)
    }
}

fn safe_name(name: &str) -> Result<&str, String> {
    if name.is_empty()
        || name.len() > 180
        || name.trim() != name
        || name.ends_with('.')
        || name == "."
        || name == ".."
        || name.eq_ignore_ascii_case("download.part")
        || name
            .chars()
            .any(|c| c.is_control() || "/\\:<>\"|?*".contains(c))
    {
        return Err("安装包文件名非法".into());
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
    {
        return Err("安装包文件名为系统保留名称".into());
    }
    Ok(name)
}
fn expected_hash(hash: Option<&str>) -> Result<Option<String>, String> {
    hash.map(|value| {
        let value = value.trim();
        if value.len() != 64 || !value.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("更新清单 SHA-256 格式非法".into());
        }
        Ok(value.to_ascii_lowercase())
    })
    .transpose()
}
fn allowed_url(url: &url::Url, test_http: bool) -> bool {
    url.username().is_empty()
        && url.password().is_none()
        && (url.scheme() == "https"
            || (test_http && url.scheme() == "http" && url.host_str() == Some("127.0.0.1")))
}
fn client(test_http: bool) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(25))
        .timeout(Duration::from_secs(300))
        .no_gzip()
        .no_brotli()
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 8 {
                attempt.error("更新源跳转过多")
            } else if !allowed_url(attempt.url(), test_http) {
                attempt.error("更新包跳转必须使用 HTTPS 且不含凭据")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| "无法初始化更新下载连接".into())
}

/// The loopback switch is private to offline unit tests; production always passes false.
pub async fn download(
    root: &Path,
    url: &str,
    name: &str,
    size: Option<u64>,
    hash: Option<&str>,
    permit: &DownloadPermit<'_>,
    progress: impl Fn(&str, u64, u64, &Path),
) -> Result<Downloaded, String> {
    download_inner(root, url, name, size, hash, permit, progress, false).await
}
async fn download_inner(
    root: &Path,
    url: &str,
    name: &str,
    size: Option<u64>,
    hash: Option<&str>,
    permit: &DownloadPermit<'_>,
    progress: impl Fn(&str, u64, u64, &Path),
    test_http: bool,
) -> Result<Downloaded, String> {
    let name = safe_name(name)?;
    let hash = expected_hash(hash)?;
    if size.is_some_and(|n| n == 0 || n > MAX_DOWNLOAD) {
        return Err("更新包大小超出允许范围（1 GiB）".into());
    }
    let address = url::Url::parse(url).map_err(|_| "更新包地址非法")?;
    if !allowed_url(&address, test_http) {
        return Err("更新包地址必须使用 HTTPS 且不含凭据".into());
    }
    permit.check()?;
    std::fs::create_dir_all(root).map_err(|e| format!("创建更新目录失败：{e}"))?;
    let nonce = NEXT_DOWNLOAD.fetch_add(1, Ordering::Relaxed);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "系统时间错误")?
        .as_nanos();
    let dir = root.join(format!("{}-{stamp}-{nonce}", std::process::id()));
    std::fs::create_dir(&dir).map_err(|e| format!("创建下载临时目录失败：{e}"))?;
    let mut staging = Staging { dir, keep: false };
    let final_path = staging.dir.join(name);
    let part_path = staging.dir.join("download.part");
    progress("probe", 0, size.unwrap_or(0), &final_path);
    let mut response = permit
        .wait(
            client(test_http)?
                .get(address)
                .header("Accept-Encoding", "identity")
                .send(),
        )
        .await?
        .map_err(|e| format!("连接更新源失败：{}", e.without_url()))?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(format!("更新源拒绝完整下载：HTTP {}", response.status()));
    }
    if response
        .headers()
        .get("content-encoding")
        .is_some_and(|value| value != "identity")
    {
        return Err("更新源返回了非原始安装包编码，已拒绝".into());
    }
    let length = response.content_length();
    if length.is_some_and(|n| n > MAX_DOWNLOAD) {
        return Err("更新包超过 1 GiB 限制".into());
    }
    if let (Some(expected), Some(actual)) = (size, length) {
        if expected != actual {
            return Err(format!(
                "更新包大小不符：清单 {expected} 字节，响应 {actual} 字节"
            ));
        }
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&part_path)
        .map_err(|e| format!("创建临时文件失败：{e}"))?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let total = size.or(length).unwrap_or(0);
    progress("download", received, total, &final_path);
    while let Some(chunk) = permit
        .wait(response.chunk())
        .await?
        .map_err(|e| format!("下载中断：{}", e.without_url()))?
    {
        received = received
            .checked_add(chunk.len() as u64)
            .ok_or("下载大小溢出")?;
        if received > size.unwrap_or(MAX_DOWNLOAD).min(MAX_DOWNLOAD) {
            return Err("更新包超过预期大小，已丢弃".into());
        }
        file.write_all(&chunk)
            .map_err(|e| format!("写入更新包失败：{e}"))?;
        hasher.update(&chunk);
        progress("download", received, total, &final_path);
    }
    permit.check()?;
    if received == 0 || size.or(length).is_some_and(|n| n != received) {
        return Err("更新包为空或下载不完整，已丢弃".into());
    }
    let digest = format!("{:x}", hasher.finalize());
    if hash.as_ref().is_some_and(|expected| expected != &digest) {
        return Err("更新包 SHA-256 校验不通过，已丢弃".into());
    }
    file.flush()
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("更新包落盘失败：{e}"))?;
    drop(file);
    permit.check()?;
    std::fs::rename(&part_path, &final_path).map_err(|e| format!("更新包提交失败：{e}"))?;
    staging.keep = true;
    progress("done", received, received, &final_path);
    Ok(Downloaded {
        path: final_path,
        size: received,
        sha256: digest,
        verified: hash.is_some(),
    })
}

pub fn installer_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|_| "更新目录不存在，请重新下载")?;
    let resolved = path
        .canonicalize()
        .map_err(|_| "安装包不存在，请重新下载")?;
    if !resolved.starts_with(&root)
        || !resolved.is_file()
        || resolved
            .file_name()
            .is_none_or(|name| name == "download.part")
    {
        return Err("仅能打开已完成下载的更新安装包".into());
    }
    Ok(resolved)
}

#[cfg(test)]
#[path = "update_download_tests.rs"]
mod tests;
