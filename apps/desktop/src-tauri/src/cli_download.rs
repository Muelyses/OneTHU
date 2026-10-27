//! Bounded, account-scoped course archive downloads. The CLI layer obtains user
//! confirmation before invoking this command; resource URLs remain inside the host.
use serde::Serialize;
use sha2::{Digest, Sha256};
#[cfg(not(unix))]
use std::fs::OpenOptions;
use std::fs::{self, File};
use std::future::Future;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const LEARN_GATEWAY_PATH: &str =
    "/https/77726476706e69737468656265737421fcf2408e297e7c4377068ea48d546d30ca8cc97bcc/";
const MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const DEFAULT_DOWNLOAD_BUDGET_MS: u64 = 60_000;
const MAX_DOWNLOAD_BUDGET_MS: u64 = 150_000;
static NEXT_FILE: AtomicU64 = AtomicU64::new(0);
#[derive(Default)]
struct AccessGate {
    enabled: bool,
    revision: u64,
    generation: u64,
}
impl AccessGate {
    fn sync(&mut self, enabled: bool, revision: u64, invalidate: bool) -> Result<(), String> {
        if revision <= self.revision {
            return Err("CLI_ACCESS_REVISION_STALE".into());
        }
        self.revision = revision;
        if self.enabled != enabled || invalidate {
            self.generation = self.generation.wrapping_add(1);
        }
        self.enabled = enabled;
        Ok(())
    }
    fn check(&self, generation: u64) -> Result<(), String> {
        if !self.enabled || self.generation != generation {
            return Err("CLI_DISABLED".into());
        }
        Ok(())
    }
}
static ACCESS: Mutex<AccessGate> = Mutex::new(AccessGate {
    enabled: false,
    revision: 0,
    generation: 0,
});
#[derive(Clone, Copy)]
struct DownloadContext {
    epoch: u64,
    generation: u64,
    deadline: DownloadDeadline,
    request_id: Option<u64>,
}

// Cancellation can arrive before the download command begins. Keep short-lived
// tombstones, and hold this lock across publication to establish a commit fence.
static REQUESTS: LazyLock<Mutex<HashMap<u64, (bool, Instant)>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
fn request_check(id: Option<u64>, entries: &HashMap<u64, (bool, Instant)>) -> Result<(), String> {
    if id.is_some_and(|id| entries.get(&id).is_none_or(|entry| entry.0)) { return Err("LEARN_DOWNLOAD_CANCELLED".into()); }
    Ok(())
}
struct RequestLease(Option<u64>);
impl RequestLease {
    fn acquire(id: Option<u64>) -> Result<Self, String> {
        if let Some(id) = id {
            let mut entries = REQUESTS.lock().map_err(|_| "CLI_ACCESS_UNAVAILABLE")?;
            entries.retain(|_, entry| entry.1.elapsed() < Duration::from_secs(300));
            if entries.len() >= 2048 { return Err("CLI_DOWNLOAD_BUSY".into()); }
            if entries.contains_key(&id) { return Err("LEARN_DOWNLOAD_CANCELLED".into()); }
            entries.insert(id, (false, Instant::now()));
        }
        Ok(Self(id))
    }
}
impl Drop for RequestLease { fn drop(&mut self) { if let Some(id) = self.0 { if let Ok(mut entries) = REQUESTS.lock() { entries.remove(&id); } } } }
#[tauri::command]
pub fn cli_download_cancel(window: tauri::WebviewWindow, request_id: u64) -> Result<(), String> {
    if window.label() != "main" { return Err("CLI_ACCESS_MAIN_WINDOW_REQUIRED".into()); }
    let mut entries = REQUESTS.lock().map_err(|_| "CLI_ACCESS_UNAVAILABLE")?;
    entries.retain(|_, entry| entry.1.elapsed() < Duration::from_secs(300));
    if entries.len() >= 2048 && !entries.contains_key(&request_id) { return Err("CLI_DOWNLOAD_BUSY".into()); }
    entries.insert(request_id, (true, Instant::now()));
    Ok(())
}

#[derive(Clone, Copy)]
struct DownloadDeadline {
    at: Instant,
}
impl DownloadDeadline {
    fn from_unix_millis(
        value: Option<u64>,
        remaining_budget_ms: Option<u64>,
    ) -> Result<Self, String> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "LEARN_DOWNLOAD_CLOCK_INVALID")?
            .as_millis() as u64;
        let started = Instant::now();
        let mut deadline = Self::from_clock(value, now, started)?;
        if let Some(remaining) = remaining_budget_ms {
            if remaining == 0 {
                return Err("LEARN_DOWNLOAD_DEADLINE_EXCEEDED".into());
            }
            // The JS batch also tracks elapsed monotonic time. Its remaining
            // allowance prevents a clock rollback between files from extending
            // the next native request's budget.
            deadline.at = deadline
                .at
                .min(started + Duration::from_millis(remaining.min(MAX_DOWNLOAD_BUDGET_MS)));
        }
        Ok(deadline)
    }
    fn from_clock(
        value: Option<u64>,
        wall_now: u64,
        monotonic_now: Instant,
    ) -> Result<Self, String> {
        let remaining = value
            .unwrap_or_else(|| wall_now.saturating_add(DEFAULT_DOWNLOAD_BUDGET_MS))
            .checked_sub(wall_now)
            .filter(|remaining| *remaining > 0)
            .ok_or("LEARN_DOWNLOAD_DEADLINE_EXCEEDED")?;
        // Convert once. A later system-clock adjustment cannot prolong an active
        // native operation beyond its original monotonic deadline.
        Ok(Self {
            at: monotonic_now + Duration::from_millis(remaining.min(MAX_DOWNLOAD_BUDGET_MS)),
        })
    }
    fn check(self) -> Result<(), String> {
        if Instant::now() >= self.at {
            Err("LEARN_DOWNLOAD_DEADLINE_EXCEEDED".into())
        } else {
            Ok(())
        }
    }
}

/// Drop the in-flight request/body future on expiry. Poll authorization while
/// waiting too: a stalled socket must not defer revocation for 45 seconds.
async fn bounded_network_wait<F: Future>(
    deadline: DownloadDeadline,
    future: F,
    mut check: impl FnMut() -> Result<(), String>,
) -> Result<F::Output, String> {
    deadline.check()?;
    check()?;
    let stop = deadline.at.min(Instant::now() + Duration::from_secs(45));
    let timeout = tokio::time::sleep_until(tokio::time::Instant::from_std(stop));
    tokio::pin!(timeout);
    tokio::pin!(future);
    loop {
        tokio::select! {
            value = &mut future => { deadline.check()?; check()?; return Ok(value); }
            _ = &mut timeout => {
                deadline.check()?;
                return Err("LEARN_DOWNLOAD_TIMEOUT".into());
            }
            _ = tokio::time::sleep(Duration::from_millis(100)) => { deadline.check()?; check()?; }
        }
    }
}

/// The UI sends monotonically increasing revisions on boot and every toggle.
/// A late enabled message cannot undo a newer revocation.
#[tauri::command]
pub fn cli_access_sync(
    window: tauri::WebviewWindow,
    enabled: bool,
    revision: u64,
    invalidate: Option<bool>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("CLI_ACCESS_MAIN_WINDOW_REQUIRED".into());
    }
    if enabled {
        crate::privacy_consent::require_oh().map_err(|_| "OH_AUTHORIZATION_REQUIRED")?;
    }
    ACCESS
        .lock()
        .map_err(|_| "CLI_ACCESS_UNAVAILABLE")?
        .sync(enabled, revision, invalidate.unwrap_or(false))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    absolute_path: String,
    filename: String,
    bytes: u64,
    sha256: String,
    mime: String,
    resource_id: String,
    reused: bool,
}

fn resource_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "LEARN_RESOURCE_URL_INVALID")?;
    crate::native_security::http_url(&url)?;
    let allowed = url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && match url.host_str() {
            Some("learn.tsinghua.edu.cn") => true,
            Some("webvpn.tsinghua.edu.cn") => url.path().starts_with(LEARN_GATEWAY_PATH),
            _ => false,
        };
    if !allowed {
        return Err("LEARN_RESOURCE_URL_REJECTED".into());
    }
    crate::privacy_consent::check_url(&url)?;
    Ok(url)
}

fn ensure_context(context: DownloadContext) -> Result<(), String> {
    context.deadline.check()?;
    request_check(context.request_id, &*REQUESTS.lock().map_err(|_| "CLI_ACCESS_UNAVAILABLE")?)?;
    crate::privacy_consent::require_oh().map_err(|_| "OH_AUTHORIZATION_REQUIRED")?;
    ACCESS
        .lock()
        .map_err(|_| "CLI_ACCESS_UNAVAILABLE")?
        .check(context.generation)?;
    crate::NATIVE_JAR_ARC.ensure_epoch(context.epoch)
}

fn unsafe_link(meta: &fs::Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Covers junctions and other reparse points as well as symbolic links.
        if meta.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

/// Inspect every existing component, including the root supplied by the caller.
/// The caller must select/create the destination first; this operation never
/// creates a parent path through a link or silently follows a redirected folder.
fn output_directory(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("CLI_OUTPUT_DIRECTORY_MUST_BE_ABSOLUTE".into());
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir | Component::CurDir => {
                return Err("CLI_OUTPUT_DIRECTORY_INVALID".into())
            }
            _ => current.push(component.as_os_str()),
        }
        // A Windows drive prefix is not a directory until its root separator.
        if !current.has_root() {
            continue;
        }
        let meta =
            fs::symlink_metadata(&current).map_err(|_| "CLI_OUTPUT_DIRECTORY_UNAVAILABLE")?;
        if unsafe_link(&meta) {
            return Err("CLI_OUTPUT_DIRECTORY_SYMLINK".into());
        }
        if !meta.is_dir() {
            return Err("CLI_OUTPUT_DIRECTORY_NOT_DIRECTORY".into());
        }
    }
    path.canonicalize()
        .map_err(|_| "CLI_OUTPUT_DIRECTORY_UNAVAILABLE".into())
}
fn verify_directory(original: &Path, canonical: &Path) -> Result<(), String> {
    if output_directory(original)? != canonical {
        return Err("CLI_OUTPUT_DIRECTORY_CHANGED".into());
    }
    Ok(())
}
fn safe_filename(raw: &str) -> String {
    let mut name = String::new();
    for ch in raw.chars() {
        let ch = if ch.is_control()
            || matches!(ch, '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*')
        {
            '_'
        } else {
            ch
        };
        if name.len() + ch.len_utf8() > 180 {
            break;
        }
        name.push(ch);
    }
    let mut name = name.trim().trim_end_matches(['.', ' ']).to_string();
    if name.is_empty() || name == "." || name == ".." {
        name = "resource".into();
    }
    if crate::native_security::relative_path(&name).is_err() {
        name = format!("resource-{name}");
    }
    name
}
fn candidate_name(name: &str, resource_id: &str, attempt: usize) -> String {
    if attempt == 0 {
        return name.into();
    }
    let digest = format!("{:x}", Sha256::digest(resource_id.as_bytes()));
    let stem = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("resource");
    let extension = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| format!(".{s}"))
        .unwrap_or_default();
    if attempt == 1 {
        format!("{stem}-{}{extension}", &digest[..12])
    } else {
        format!("{stem}-{}-{attempt}{extension}", &digest[..12])
    }
}
fn reject_login_html(head: &[u8], mime: &str, filename: &str) -> Result<(), String> {
    let head = String::from_utf8_lossy(head).to_ascii_lowercase();
    let looks_html = mime.starts_with("text/html")
        || head
            .trim_start_matches('\u{feff}')
            .trim_start()
            .starts_with("<html")
        || head
            .trim_start_matches('\u{feff}')
            .trim_start()
            .starts_with("<!doctype")
        || head
            .trim_start_matches('\u{feff}')
            .trim_start()
            .starts_with("<script");
    let is_login = head.contains("id=\"sm2publickey\"")
        || head.contains("id='sm2publickey'")
        || head.contains("name=\"i_pass\"")
        || head.contains("name='i_pass'")
        || head.contains("/do/off/ui/auth/login/")
        || head.contains("j_spring_security_check")
        || head.contains("电子身份服务系统")
        || head.contains("class=\"re_log")
        || head.contains("class='re_log")
        || head.contains("oauth.tsinghua.edu.cn/thu-oauth/auth")
        || (head.contains("__vpn_hostname_data")
            && head.contains("__vpn_app_hostname_data")
            && head.len() < 4096)
        || (head.len() < 4096 && head.contains("location.href"));
    let html_name = filename.to_ascii_lowercase().ends_with(".html")
        || filename.to_ascii_lowercase().ends_with(".htm");
    if looks_html && (is_login || !html_name) {
        return Err("LEARN_DOWNLOAD_AUTH_REQUIRED".into());
    }
    Ok(())
}
/// Unix operations are relative to a directory descriptor, so replacing a
/// checked parent with a symlink cannot redirect a write. Windows holds every
/// ancestor open without FILE_SHARE_DELETE, preventing junction/rename swaps.
struct PinnedDirectory {
    path: PathBuf,
    #[cfg(unix)]
    handle: File,
    #[cfg(windows)]
    _ancestors: Vec<File>,
}
#[cfg(unix)]
mod dir_ops {
    use super::*;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;
    #[cfg(target_os = "macos")]
    pub const NOFOLLOW: i32 = 0x100;
    #[cfg(not(target_os = "macos"))]
    pub const NOFOLLOW: i32 = 0x20000;
    #[cfg(target_os = "macos")]
    const DIRECTORY: i32 = 0x100000;
    #[cfg(not(target_os = "macos"))]
    const DIRECTORY: i32 = 0x10000;
    #[cfg(target_os = "macos")]
    const CREATE_EXCLUSIVE: i32 = 0x200 | 0x800;
    #[cfg(not(target_os = "macos"))]
    const CREATE_EXCLUSIVE: i32 = 0x40 | 0x80;
    #[cfg(target_os = "macos")]
    const CLOSE_ON_EXEC: i32 = 0x1000000;
    #[cfg(not(target_os = "macos"))]
    const CLOSE_ON_EXEC: i32 = 0x80000;
    unsafe extern "C" {
        fn openat(fd: i32, name: *const std::os::raw::c_char, flags: i32, ...) -> i32;
        fn unlinkat(fd: i32, name: *const std::os::raw::c_char, flags: i32) -> i32;
        #[cfg(target_os = "macos")]
        fn renameatx_np(
            from_fd: i32,
            from: *const std::os::raw::c_char,
            to_fd: i32,
            to: *const std::os::raw::c_char,
            flags: u32,
        ) -> i32;
        #[cfg(not(target_os = "macos"))]
        fn linkat(
            from_fd: i32,
            from: *const std::os::raw::c_char,
            to_fd: i32,
            to: *const std::os::raw::c_char,
            flags: i32,
        ) -> i32;
    }
    fn open(dir: &File, name: &std::ffi::OsStr, flags: i32) -> std::io::Result<File> {
        let name = std::ffi::CString::new(name.as_bytes())?;
        let fd = unsafe {
            openat(
                dir.as_raw_fd(),
                name.as_ptr(),
                flags | NOFOLLOW | CLOSE_ON_EXEC,
                0o600_i32,
            )
        };
        if fd < 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(unsafe { File::from_raw_fd(fd) })
        }
    }
    pub fn directory(path: &Path) -> std::io::Result<File> {
        let mut handle = File::open("/")?;
        for component in path.components() {
            if let Component::Normal(name) = component {
                handle = open(&handle, name, DIRECTORY)?;
            }
        }
        Ok(handle)
    }
    pub fn file(dir: &File, name: &str, create: bool) -> std::io::Result<File> {
        open(
            dir,
            std::ffi::OsStr::new(name),
            if create { 1 | CREATE_EXCLUSIVE } else { 0 },
        )
    }
    pub fn remove(dir: &File, name: &str) {
        if let Ok(name) = std::ffi::CString::new(name) {
            unsafe {
                unlinkat(dir.as_raw_fd(), name.as_ptr(), 0);
            }
        }
    }
    pub fn publish(dir: &File, from: &str, to: &str) -> std::io::Result<()> {
        let from = std::ffi::CString::new(from)?;
        let to = std::ffi::CString::new(to)?;
        #[cfg(target_os = "macos")]
        let result = unsafe {
            renameatx_np(
                dir.as_raw_fd(),
                from.as_ptr(),
                dir.as_raw_fd(),
                to.as_ptr(),
                4,
            )
        };
        #[cfg(not(target_os = "macos"))]
        let result = unsafe {
            linkat(
                dir.as_raw_fd(),
                from.as_ptr(),
                dir.as_raw_fd(),
                to.as_ptr(),
                0,
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }
}
impl PinnedDirectory {
    fn open(path: &Path) -> Result<Arc<Self>, String> {
        let canonical = output_directory(path)?;
        #[cfg(unix)]
        let handle = dir_ops::directory(path).map_err(|_| "CLI_OUTPUT_DIRECTORY_UNAVAILABLE")?;
        #[cfg(windows)]
        let ancestors = {
            use std::os::windows::fs::OpenOptionsExt;
            let mut handles = Vec::new();
            let mut current = PathBuf::new();
            for component in path.components() {
                current.push(component.as_os_str());
                if !current.has_root() {
                    continue;
                }
                let file = OpenOptions::new()
                    .read(true)
                    .access_mode(0)
                    .share_mode(3)
                    .custom_flags(0x02000000 | 0x00200000)
                    .open(&current)
                    .map_err(|_| "CLI_OUTPUT_DIRECTORY_UNAVAILABLE")?;
                if unsafe_link(
                    &file
                        .metadata()
                        .map_err(|_| "CLI_OUTPUT_DIRECTORY_UNAVAILABLE")?,
                ) {
                    return Err("CLI_OUTPUT_DIRECTORY_SYMLINK".into());
                }
                handles.push(file);
            }
            handles
        };
        verify_directory(path, &canonical)?;
        Ok(Arc::new(Self {
            path: canonical,
            #[cfg(unix)]
            handle,
            #[cfg(windows)]
            _ancestors: ancestors,
        }))
    }
    fn file(&self, name: &str, create: bool) -> std::io::Result<File> {
        #[cfg(unix)]
        {
            dir_ops::file(&self.handle, name, create)
        }
        #[cfg(not(unix))]
        {
            let mut options = OpenOptions::new();
            if create {
                options.write(true).create_new(true);
            } else {
                options.read(true);
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                options.custom_flags(0x00200000);
            }
            options.open(self.path.join(name))
        }
    }
    fn remove(&self, name: &str) {
        #[cfg(unix)]
        dir_ops::remove(&self.handle, name);
        #[cfg(not(unix))]
        {
            let _ = fs::remove_file(self.path.join(name));
        }
    }
    fn publish(&self, from: &str, to: &str) -> std::io::Result<()> {
        #[cfg(unix)]
        {
            dir_ops::publish(&self.handle, from, to)
        }
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            #[link(name = "kernel32")]
            unsafe extern "system" {
                fn MoveFileExW(existing: *const u16, new_name: *const u16, flags: u32) -> i32;
            }
            let from: Vec<u16> = self
                .path
                .join(from)
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect();
            let to: Vec<u16> = self
                .path
                .join(to)
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect();
            if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } != 0 {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            }
        }
        #[cfg(not(any(unix, windows)))]
        {
            fs::hard_link(self.path.join(from), self.path.join(to))
        }
    }
}
fn create_staging(root: &Arc<PinnedDirectory>) -> Result<(Staging, File), String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "CLI_CLOCK_ERROR")?
        .as_nanos();
    let name = format!(
        ".onethu-cli-{}-{stamp}-{}.partial",
        std::process::id(),
        NEXT_FILE.fetch_add(1, Ordering::Relaxed)
    );
    let file = root
        .file(&name, true)
        .map_err(|_| "CLI_OUTPUT_CREATE_FAILED")?;
    Ok((
        Staging {
            root: root.clone(),
            name,
            keep: false,
        },
        file,
    ))
}
struct Staging {
    root: Arc<PinnedDirectory>,
    name: String,
    keep: bool,
}
impl Staging {
    fn keep(mut self) {
        self.keep = true;
    }
}
impl Drop for Staging {
    fn drop(&mut self) {
        if !self.keep {
            self.root.remove(&self.name);
        }
    }
}
fn unsupported_publish(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::Unsupported
        || matches!(error.raw_os_error(), Some(45) | Some(95))
}
/// An exFAT destination may lack atomic no-replace rename. Reserve the final
/// name using create_new, then copy the verified staging file in bounded chunks.
/// A failure leaves the cleanup guard armed. This fallback has a visible partial
/// file while copying; no successful result is returned before sync and fencing.
fn publish_copy_exclusive(
    source: &Staging,
    destination: &str,
    expected: Option<(u64, &str)>,
    mut check: impl FnMut() -> Result<(), String>,
) -> Result<Option<Staging>, String> {
    check()?;
    let mut output = match source.root.file(destination, true) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Ok(None),
        Err(_) => return Err("CLI_OUTPUT_CREATE_FAILED".into()),
    };
    let pending = Staging {
        root: source.root.clone(),
        name: destination.into(),
        keep: false,
    };
    let mut input = source
        .root
        .file(&source.name, false)
        .map_err(|_| "CLI_OUTPUT_INSPECTION_FAILED")?;
    let mut buffer = [0u8; 64 * 1024];
    let mut bytes = 0u64;
    let mut digest = Sha256::new();
    loop {
        check()?;
        let read = input
            .read(&mut buffer)
            .map_err(|_| "CLI_OUTPUT_READ_FAILED")?;
        if read == 0 {
            break;
        }
        bytes += read as u64;
        if bytes > MAX_BYTES {
            return Err("LEARN_DOWNLOAD_TOO_LARGE".into());
        }
        digest.update(&buffer[..read]);
        output
            .write_all(&buffer[..read])
            .map_err(|_| "CLI_OUTPUT_WRITE_FAILED")?;
    }
    if let Some((size, sha256)) = expected {
        if size != bytes || sha256 != format!("{:x}", digest.finalize()) {
            return Err("CLI_OUTPUT_HASH_MISMATCH".into());
        }
    }
    check()?;
    output.sync_all().map_err(|_| "CLI_OUTPUT_WRITE_FAILED")?;
    check()?;
    drop(output);
    Ok(Some(pending))
}
fn existing_digest(
    root: &PinnedDirectory,
    name: &str,
    context: Option<DownloadContext>,
) -> Result<Option<(u64, String)>, String> {
    let mut file = match root.file(name, false) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("CLI_OUTPUT_INSPECTION_FAILED".into()),
    };
    let meta = file
        .metadata()
        .map_err(|_| "CLI_OUTPUT_INSPECTION_FAILED")?;
    if unsafe_link(&meta) {
        return Err("CLI_OUTPUT_FILE_SYMLINK".into());
    }
    if !meta.is_file() {
        return Ok(Some((u64::MAX, String::new())));
    }
    let mut digest = Sha256::new();
    let mut size = 0;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        if let Some(context) = context {
            ensure_context(context)?;
        }
        let read = file
            .read(&mut buffer)
            .map_err(|_| "CLI_OUTPUT_INSPECTION_FAILED")?;
        if read == 0 {
            break;
        }
        size += read as u64;
        if size > MAX_BYTES {
            return Ok(Some((u64::MAX, String::new())));
        }
        digest.update(&buffer[..read]);
    }
    Ok(Some((size, format!("{:x}", digest.finalize()))))
}

#[tauri::command]
pub async fn cli_download_learn_resource(
    window: tauri::WebviewWindow,
    url: String,
    cookies: String,
    filename: String,
    resource_id: String,
    output_dir: String,
    expected_epoch: u64,
    deadline_unix_ms: Option<u64>,
    remaining_budget_ms: Option<u64>,
    request_id: Option<u64>,
) -> Result<DownloadResult, String> {
    if window.label() != "main" {
        return Err("CLI_ACCESS_MAIN_WINDOW_REQUIRED".into());
    }
    if resource_id.len() != 70
        || !resource_id.starts_with("learn:")
        || !resource_id[6..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("LEARN_RESOURCE_REFERENCE_INVALID".into());
    }
    let generation = {
        let access = ACCESS.lock().map_err(|_| "CLI_ACCESS_UNAVAILABLE")?;
        access.check(access.generation)?;
        access.generation
    };
    let _request_lease = RequestLease::acquire(request_id)?;
    let context = DownloadContext {
        request_id,
        epoch: expected_epoch,
        generation,
        deadline: DownloadDeadline::from_unix_millis(deadline_unix_ms, remaining_budget_ms)?,
    };
    ensure_context(context)?;
    let original = PathBuf::from(&output_dir);
    let directory = PinnedDirectory::open(&original)?;
    let root = &directory.path;
    let client = crate::native_client_at_epoch(expected_epoch)?;
    let initial = resource_url(&url)?;
    let mut target = initial.clone();
    let mut response = None;
    for hop in 0..=10 {
        ensure_context(context)?;
        let mut request = client.get(target.clone());
        // The native jar supplies cookies on each origin. JS-only cookies are
        // merged only for the exact initial URL's origin, never another origin.
        if target.origin() == initial.origin() {
            request = request.header(
                reqwest::header::COOKIE,
                crate::merge_session_cookies(target.as_str(), &cookies),
            );
        }
        let next =
            bounded_network_wait(context.deadline, request.send(), || ensure_context(context))
                .await?
                .map_err(|_| "LEARN_DOWNLOAD_NETWORK_FAILED")?;
        ensure_context(context)?;
        if next.status().is_redirection() {
            if hop == 10 {
                return Err("LEARN_DOWNLOAD_REDIRECT_LIMIT".into());
            }
            let location = next
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("LEARN_DOWNLOAD_REDIRECT_INVALID")?;
            let joined = target
                .join(location)
                .map_err(|_| "LEARN_DOWNLOAD_REDIRECT_INVALID")?;
            target =
                resource_url(joined.as_str()).map_err(|_| "LEARN_DOWNLOAD_REDIRECT_REJECTED")?;
            continue;
        }
        if !next.status().is_success() {
            return Err(format!("LEARN_DOWNLOAD_HTTP_{}", next.status().as_u16()));
        }
        if next.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            return Err("LEARN_DOWNLOAD_PARTIAL_RESPONSE".into());
        }
        response = Some(next);
        break;
    }
    let mut response = response.ok_or("LEARN_DOWNLOAD_NO_RESPONSE")?;
    if response.content_length().is_some_and(|n| n > MAX_BYTES) {
        return Err("LEARN_DOWNLOAD_TOO_LARGE".into());
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let actual_name = response
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .and_then(crate::parse_cd_filename)
        .unwrap_or(filename);
    let name = safe_filename(&actual_name);
    verify_directory(&original, &root)?;
    ensure_context(context)?;
    let (staging, mut file) = create_staging(&directory)?;
    verify_directory(&original, &root)?;
    let mut bytes = 0u64;
    let mut hash = Sha256::new();
    let mut head = Vec::new();
    while let Some(chunk) = bounded_network_wait(context.deadline, response.chunk(), || {
        ensure_context(context)
    })
    .await?
    .map_err(|_| "LEARN_DOWNLOAD_NETWORK_FAILED")?
    {
        ensure_context(context)?;
        bytes += chunk.len() as u64;
        if bytes > MAX_BYTES {
            return Err("LEARN_DOWNLOAD_TOO_LARGE".into());
        }
        if head.len() < 64 * 1024 {
            head.extend_from_slice(&chunk[..chunk.len().min(64 * 1024 - head.len())]);
            reject_login_html(&head, &mime, &name)?;
        }
        for block in chunk.chunks(64 * 1024) {
            ensure_context(context)?;
            hash.update(block);
            file.write_all(block)
                .map_err(|_| "CLI_OUTPUT_WRITE_FAILED")?;
        }
    }
    if bytes == 0 {
        return Err("LEARN_DOWNLOAD_EMPTY".into());
    }
    if response
        .content_length()
        .is_some_and(|length| length != bytes)
    {
        return Err("LEARN_DOWNLOAD_LENGTH_MISMATCH".into());
    }
    ensure_context(context)?;
    file.sync_all().map_err(|_| "CLI_OUTPUT_WRITE_FAILED")?;
    ensure_context(context)?;
    drop(file);
    let sha256 = format!("{:x}", hash.finalize());
    // Logout/account switch needs the jar's write lock. Hold a read lock through
    // final publication so an old account cannot publish after the clear fence.
    ensure_context(context)?;
    verify_directory(&original, &root)?;
    for attempt in 0..100 {
        let final_name = candidate_name(&name, &resource_id, attempt);
        let path = root.join(crate::native_security::relative_path(&final_name)?);
        if let Some((size, digest)) = existing_digest(&directory, &final_name, Some(context))? {
            if size == bytes && digest == sha256 {
                let _account_guard = crate::NATIVE_JAR_ARC
                    .0
                    .read()
                    .map_err(|_| "AUTH_SESSION_CHANGED")?;
                ensure_context(context)?;
                let access_guard = ACCESS.lock().map_err(|_| "CLI_ACCESS_UNAVAILABLE")?;
                access_guard.check(context.generation)?;
                verify_directory(&original, &root)?;
                context.deadline.check()?;
                let requests = REQUESTS.lock().map_err(|_| "CLI_ACCESS_UNAVAILABLE")?;
                request_check(context.request_id, &requests)?;
                return Ok(DownloadResult {
                    absolute_path: path.to_string_lossy().into_owned(),
                    filename: final_name,
                    bytes,
                    sha256,
                    mime,
                    resource_id,
                    reused: true,
                });
            }
            continue;
        }
        // Publish the finished file with platform no-replace semantics.
        let account_guard = crate::NATIVE_JAR_ARC
            .0
            .read()
            .map_err(|_| "AUTH_SESSION_CHANGED")?;
        ensure_context(context)?;
        let access_guard = ACCESS.lock().map_err(|_| "CLI_ACCESS_UNAVAILABLE")?;
        access_guard.check(context.generation)?;
        verify_directory(&original, &root)?;
        let requests = REQUESTS.lock().map_err(|_| "CLI_ACCESS_UNAVAILABLE")?;
        request_check(context.request_id, &requests)?;
        match directory.publish(&staging.name, &final_name) {
            Ok(()) => {
                let pending = Staging {
                    root: directory.clone(),
                    name: final_name.clone(),
                    keep: false,
                };
                verify_directory(&original, &root)?;
                crate::privacy_consent::require_oh().map_err(|_| "OH_AUTHORIZATION_REQUIRED")?;
                context.deadline.check()?;
                pending.keep();
                return Ok(DownloadResult {
                    absolute_path: path.to_string_lossy().into_owned(),
                    filename: final_name,
                    bytes,
                    sha256,
                    mime,
                    resource_id,
                    reused: false,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) if unsupported_publish(&error) => {
                drop(requests);
                drop(access_guard);
                drop(account_guard);
                // Do not hold the account lock across a potentially large copy;
                // logout and consent changes stop the next chunk and clean up.
                let pending =
                    publish_copy_exclusive(&staging, &final_name, Some((bytes, &sha256)), || {
                        ensure_context(context)?;
                        verify_directory(&original, &root)
                    })?;
                if let Some(pending) = pending {
                    let _account_guard = crate::NATIVE_JAR_ARC
                        .0
                        .read()
                        .map_err(|_| "AUTH_SESSION_CHANGED")?;
                    ensure_context(context)?;
                    verify_directory(&original, &root)?;
                    let access_guard = ACCESS.lock().map_err(|_| "CLI_ACCESS_UNAVAILABLE")?;
                    access_guard.check(context.generation)?;
                    crate::privacy_consent::require_oh()
                        .map_err(|_| "OH_AUTHORIZATION_REQUIRED")?;
                    context.deadline.check()?;
                    let requests = REQUESTS.lock().map_err(|_| "CLI_ACCESS_UNAVAILABLE")?;
                    request_check(context.request_id, &requests)?;
                    pending.keep();
                    return Ok(DownloadResult {
                        absolute_path: path.to_string_lossy().into_owned(),
                        filename: final_name,
                        bytes,
                        sha256,
                        mime,
                        resource_id,
                        reused: false,
                    });
                }
            }
            Err(_) => return Err("CLI_OUTPUT_ATOMIC_PUBLISH_FAILED".into()),
        }
    }
    Err("CLI_OUTPUT_NAME_CONFLICT".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancelled_download_request_cannot_start_or_publish() {
        let id = 9_000_000_111;
        let lease = RequestLease::acquire(Some(id)).unwrap();
        request_check(Some(id), &REQUESTS.lock().unwrap()).unwrap();
        REQUESTS.lock().unwrap().insert(id, (true, Instant::now()));
        assert!(request_check(Some(id), &REQUESTS.lock().unwrap()).is_err());
        assert!(RequestLease::acquire(Some(id)).is_err());
        drop(lease);
        assert!(request_check(Some(id), &REQUESTS.lock().unwrap()).is_err());
        let early = 9_000_000_112;
        REQUESTS.lock().unwrap().insert(early, (true, Instant::now()));
        assert!(RequestLease::acquire(Some(early)).is_err());
        REQUESTS.lock().unwrap().remove(&early);
    }
    fn temp() -> PathBuf {
        let base = std::env::var_os("ONETHU_CLI_TEST_DIRECTORY")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let root = base.join(format!(
            "onethu-cli-download-test-{}-{}",
            std::process::id(),
            NEXT_FILE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }
    #[test]
    fn deadline_is_absolute_bounded_and_monotonic() {
        let now = Instant::now();
        let wall = 1_800_000_000_000;
        let default = DownloadDeadline::from_clock(None, wall, now).unwrap();
        assert_eq!(default.at.duration_since(now), Duration::from_secs(60));
        let short = DownloadDeadline::from_clock(Some(wall + 1200), wall, now).unwrap();
        assert_eq!(short.at.duration_since(now), Duration::from_millis(1200));
        let bounded = DownloadDeadline::from_clock(Some(wall + 600_000), wall, now).unwrap();
        assert_eq!(bounded.at.duration_since(now), Duration::from_secs(150));
        for expired in [wall, wall - 1, 0] {
            assert_eq!(
                DownloadDeadline::from_clock(Some(expired), wall, now)
                    .err()
                    .unwrap(),
                "LEARN_DOWNLOAD_DEADLINE_EXCEEDED"
            );
        }
        let capped = DownloadDeadline::from_unix_millis(None, Some(200)).unwrap();
        assert!(capped.at.duration_since(Instant::now()) <= Duration::from_millis(200));
        assert!(DownloadDeadline::from_unix_millis(None, Some(0)).is_err());
    }
    #[tokio::test]
    async fn deadline_drops_a_stalled_network_future_and_removes_partial_output() {
        let path = temp();
        let root = PinnedDirectory::open(&path).unwrap();
        let (staging, mut file) = create_staging(&root).unwrap();
        file.write_all(b"partial").unwrap();
        drop(file);
        let partial = path.join(&staging.name);
        let dropped = Arc::new(std::sync::atomic::AtomicBool::new(false));
        struct Dropped(Arc<std::sync::atomic::AtomicBool>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }
        let marker = Dropped(dropped.clone());
        let stalled = async move {
            let _marker = marker;
            let _cleanup = staging;
            std::future::pending::<()>().await
        };
        let deadline = DownloadDeadline {
            at: Instant::now() + Duration::from_millis(25),
        };
        let result = bounded_network_wait(deadline, stalled, || Ok(())).await;
        assert_eq!(result.unwrap_err(), "LEARN_DOWNLOAD_DEADLINE_EXCEEDED");
        assert!(dropped.load(Ordering::SeqCst));
        assert!(!partial.exists());
        drop(root);
        fs::remove_dir_all(path).unwrap();
    }
    #[tokio::test]
    async fn network_wait_observes_revocation_while_no_bytes_arrive() {
        let deadline = DownloadDeadline {
            at: Instant::now() + Duration::from_secs(10),
        };
        let mut checks = 0;
        let started = Instant::now();
        let result = bounded_network_wait(deadline, std::future::pending::<()>(), || {
            checks += 1;
            if checks > 1 {
                Err("CLI_DISABLED".into())
            } else {
                Ok(())
            }
        })
        .await;
        assert_eq!(result.unwrap_err(), "CLI_DISABLED");
        assert!(started.elapsed() < Duration::from_secs(2));
    }
    #[tokio::test]
    async fn deadline_closes_a_real_loopback_socket_waiting_for_headers() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let peer = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut head = Vec::new();
            let mut byte = [0];
            while !head.ends_with(b"\r\n\r\n") {
                assert_eq!(socket.read(&mut byte).unwrap(), 1);
                head.push(byte[0]);
            }
            let _ = ready_tx.send(());
            // No response is sent. Dropping the request must close the connection.
            matches!(socket.read(&mut byte), Ok(0))
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let deadline = DownloadDeadline {
            at: Instant::now() + Duration::from_millis(400),
        };
        let result = bounded_network_wait(
            deadline,
            client.get(format!("http://{address}/fixture")).send(),
            || Ok(()),
        )
        .await;
        ready_rx.await.unwrap();
        assert_eq!(result.err().unwrap(), "LEARN_DOWNLOAD_DEADLINE_EXCEEDED");
        assert!(
            tokio::task::spawn_blocking(move || peer.join().unwrap())
                .await
                .unwrap(),
            "expired request left the socket active"
        );
    }
    #[test]
    fn access_gate_defaults_closed_and_revocation_cannot_be_undone_by_stale_messages() {
        let mut access = AccessGate::default();
        assert!(access.check(0).is_err());
        access.sync(true, 10, false).unwrap();
        let generation = access.generation;
        access.check(generation).unwrap();
        access.sync(false, 12, false).unwrap();
        assert!(access.check(generation).is_err());
        assert!(access.sync(true, 11, false).is_err());
        assert!(access.check(generation).is_err());
        access.sync(true, 13, false).unwrap();
        assert!(access.check(generation).is_err());
        access.check(access.generation).unwrap();
    }
    #[test]
    fn execution_policy_change_invalidates_downloads_while_service_remains_enabled() {
        let mut access = AccessGate::default();
        access.sync(true, 1, false).unwrap();
        let old = access.generation;
        access.sync(true, 2, false).unwrap();
        access.check(old).unwrap();
        access.sync(true, 3, true).unwrap();
        assert!(access.enabled);
        assert!(access.check(old).is_err());
        access.check(access.generation).unwrap();
        let current = access.generation;
        assert!(access.sync(true, 2, true).is_err());
        access.check(current).unwrap();
    }
    #[test]
    fn downloads_only_accept_learning_origins_and_learning_gateway_routes() {
        assert!(resource_url("https://learn.tsinghua.edu.cn/b/file?wjid=fixture").is_ok());
        assert!(resource_url(&format!(
            "https://webvpn.tsinghua.edu.cn{LEARN_GATEWAY_PATH}b/file"
        ))
        .is_ok());
        for url in [
            "http://learn.tsinghua.edu.cn/f",
            "https://user:pass@learn.tsinghua.edu.cn/f",
            "https://learn.tsinghua.edu.cn:9443/f",
            "https://webvpn.tsinghua.edu.cn/login",
            "https://example.com/file",
            "file:///etc/passwd",
            "https://127.0.0.1/f",
        ] {
            assert!(resource_url(url).is_err(), "{url}");
        }
    }
    #[test]
    fn filenames_are_single_cross_platform_components() {
        for raw in [
            "../notes.md",
            "..\\notes.md",
            "C:\\secret",
            "CON",
            "NUL.txt",
            "a\0b",
            "a:b",
            "資料.pdf",
            "..",
            "x. ",
        ] {
            let safe = safe_filename(raw);
            assert!(
                crate::native_security::relative_path(&safe).is_ok(),
                "{raw:?} -> {safe:?}"
            );
            assert!(!safe.contains(['/', '\\', ':']));
        }
        assert!(safe_filename(&"汉".repeat(100)).len() <= 180);
    }
    #[test]
    fn known_login_pages_are_rejected_even_with_html_extension() {
        for head in [
            "<html><input name=\"i_pass\"></html>",
            "<script>location.href='/login'</script>",
            "<html>电子身份服务系统</html>",
        ] {
            assert!(reject_login_html(head.as_bytes(), "text/html", "notes.html").is_err());
        }
        assert!(reject_login_html(
            b"<html><p>Lecture notes</p></html>",
            "text/html",
            "notes.html"
        )
        .is_ok());
        assert!(reject_login_html(b"<html>gateway</html>", "text/html", "notes.pdf").is_err());
        assert!(reject_login_html(
            b"%PDF-1.4 example lecture: location.href and j_spring_security_check",
            "application/pdf",
            "lecture.pdf"
        )
        .is_ok());
    }
    #[test]
    fn path_policy_rejects_relative_parent_components_and_missing_folders() {
        assert!(output_directory(Path::new("relative")).is_err());
        let root = temp();
        assert!(output_directory(&root.join("..")).is_err());
        assert!(output_directory(&root.join("missing")).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn destination_symlinks_and_intermediate_symlinks_are_rejected() {
        let root = temp();
        fs::create_dir(root.join("real")).unwrap();
        std::os::unix::fs::symlink(root.join("real"), root.join("link")).unwrap();
        assert!(output_directory(&root.join("link")).is_err());
        fs::create_dir(root.join("real/child")).unwrap();
        assert!(output_directory(&root.join("link/child")).is_err());
        fs::write(root.join("real/file"), b"private").unwrap();
        std::os::unix::fs::symlink(root.join("real/file"), root.join("file")).unwrap();
        let directory = PinnedDirectory::open(&root).unwrap();
        assert!(existing_digest(&directory, "file", None).is_err());
        drop(directory);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn publication_preserves_existing_files_and_staging_is_cleaned() {
        let root = temp();
        let target = root.join("notes.pdf");
        fs::write(&target, b"old notes").unwrap();
        let directory = PinnedDirectory::open(&root).unwrap();
        let (stage, mut file) = create_staging(&directory).unwrap();
        file.write_all(b"new notes").unwrap();
        drop(file);
        let path = root.join(&stage.name);
        assert!(directory.publish(&stage.name, "notes.pdf").is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old notes");
        assert_ne!(
            candidate_name("notes.pdf", "ref", 0),
            candidate_name("notes.pdf", "ref", 1)
        );
        let fresh = root.join("fresh.pdf");
        match directory.publish(&stage.name, "fresh.pdf") {
            Ok(()) => (),
            Err(error) if unsupported_publish(&error) => {
                publish_copy_exclusive(&stage, "fresh.pdf", None, || Ok(()))
                    .unwrap()
                    .unwrap()
                    .keep()
            }
            Err(error) => panic!("{error}"),
        }
        assert_eq!(fs::read(&fresh).unwrap(), b"new notes");
        drop(stage);
        assert!(!path.exists());
        drop(directory);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn copy_publication_preserves_existing_files_and_cleans_failures() {
        let root = temp();
        let directory = PinnedDirectory::open(&root).unwrap();
        let (stage, mut file) = create_staging(&directory).unwrap();
        file.write_all(&vec![7; 180_000]).unwrap();
        drop(file);
        fs::write(root.join("existing"), b"keep").unwrap();
        assert!(publish_copy_exclusive(&stage, "existing", None, || Ok(()))
            .unwrap()
            .is_none());
        assert_eq!(fs::read(root.join("existing")).unwrap(), b"keep");
        let mut checks = 0;
        assert!(publish_copy_exclusive(&stage, "cancelled", None, || {
            checks += 1;
            if checks == 3 {
                Err("AUTH_SESSION_CHANGED".into())
            } else {
                Ok(())
            }
        })
        .is_err());
        assert!(!root.join("cancelled").exists());
        assert!(
            publish_copy_exclusive(&stage, "bad-hash", Some((180_000, "wrong-hash")), || Ok(()))
                .is_err()
        );
        assert!(!root.join("bad-hash").exists());
        let pending = publish_copy_exclusive(&stage, "good", None, || Ok(()))
            .unwrap()
            .unwrap();
        pending.keep();
        assert_eq!(fs::read(root.join("good")).unwrap(), vec![7; 180_000]);
        drop(stage);
        drop(directory);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn replacing_parent_with_symlink_cannot_redirect_descriptor_writes() {
        let root = temp();
        let original = root.join("original");
        let moved = root.join("moved");
        let outside = root.join("outside");
        fs::create_dir(&original).unwrap();
        fs::create_dir(&outside).unwrap();
        let directory = PinnedDirectory::open(&original).unwrap();
        fs::rename(&original, &moved).unwrap();
        std::os::unix::fs::symlink(&outside, &original).unwrap();
        assert!(verify_directory(&original, &directory.path).is_err());
        let (stage, mut file) = create_staging(&directory).unwrap();
        file.write_all(b"fixture").unwrap();
        drop(file);
        assert!(moved.join(&stage.name).is_file());
        assert!(!outside.join(&stage.name).exists());
        drop(stage);
        assert_eq!(fs::read_dir(&moved).unwrap().count(), 0);
        drop(directory);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn hash_is_byte_exact() {
        let root = temp();
        let path = root.join("data");
        fs::write(&path, b"abc").unwrap();
        let directory = PinnedDirectory::open(&root).unwrap();
        assert_eq!(
            existing_digest(&directory, "data", None).unwrap(),
            Some((
                3,
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into()
            ))
        );
        drop(directory);
        fs::remove_dir_all(root).unwrap();
    }
}
