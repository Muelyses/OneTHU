//! Small shared boundaries for native IPC. These checks are not an OS sandbox.
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub fn plugin_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 160 || id == "." || id == ".."
        || id.ends_with('.') || reserved_component(id)
        || !id.chars().all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        return Err("非法插件 id".into());
    }
    Ok(())
}

fn reserved_component(value: &str) -> bool {
    let stem = value.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

/// The same interpretation on Windows and Unix; no alternate separators/ADS.
pub fn relative_path(value: &str) -> Result<PathBuf, String> {
    if value.is_empty() || value.contains(['\\', ':']) || value.chars().any(char::is_control) {
        return Err("路径必须是包内相对路径".into());
    }
    let mut result = PathBuf::new();
    for part in value.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.ends_with(['.', ' '])
            || part.contains(['<', '>', '"', '|', '?', '*']) || reserved_component(part)
        {
            return Err("路径包含非法组件".into());
        }
        result.push(part);
    }
    Ok(result)
}

/// Reject existing symlinks at every boundary. New directories may be created
/// afterward. Same-user filesystem races are outside this IPC-level boundary.
pub fn confined_path(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    let mut out = root.to_path_buf();
    reject_symlink(&out)?;
    for part in relative.components() {
        if let std::path::Component::Normal(name) = part {
            out.push(name);
            reject_symlink(&out)?;
        } else {
            return Err("路径越出受限目录".into());
        }
    }
    Ok(out)
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Err("受限目录不允许符号链接".into()),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub fn plugin_binary(root: &Path, id: &str, binary: &Path) -> Result<PathBuf, String> {
    plugin_id(id)?;
    let dir = confined_path(root, Path::new(id))?;
    let relative = binary.strip_prefix(&dir).map_err(|_| "插件程序必须位于自己的安装目录")?;
    let path = confined_path(&dir, relative)?;
    if !path.is_file() {
        return Err("插件程序不存在".into());
    }
    Ok(path)
}

static NEXT_FILE: AtomicU64 = AtomicU64::new(0);
/// Unique, create_new staging file; failed writes never replace the old file.
pub fn private_atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("缺少存储目录")?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?.as_nanos();
    let tmp = parent.join(format!(".onethu-{}-{stamp}-{}.tmp",
        std::process::id(), NEXT_FILE.fetch_add(1, Ordering::Relaxed)));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options.open(&tmp).map_err(|e| e.to_string())?;
        file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
        drop(file);
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = std::fs::remove_file(&tmp); }
    result
}

pub fn private_permissions(path: &Path) -> Result<(), String> {
    reject_symlink(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn http_url(url: &reqwest::Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return Err("仅支持不含用户名密码的 HTTP(S) 地址".into());
    }
    Ok(())
}

pub fn safe_url_log(url: &reqwest::Url) -> String {
    // Query, fragment and userinfo can all contain login tickets.
    format!("{}{}", url.origin().ascii_serialization(), url.path())
}

/// Defense in depth for unstructured messages from the webview/plugins.
/// Once a credential field is found, discard the remainder of this record:
/// cookies and authorization values can contain spaces, quotes or newlines.
/// This cannot identify an arbitrary unlabelled secret; callers must still
/// avoid logging bodies and credentials in the first place.
pub fn redact_log(raw: &str) -> String {
    let text: String = raw.chars().take(8192).collect();
    let lower = text.to_ascii_lowercase();
    let bytes = text.as_bytes();
    let mut output = String::new();
    let mut at = 0;
    while at < bytes.len() {
        let rest = &text[at..];
        if lower[at..].starts_with("http://") || lower[at..].starts_with("https://") {
            let length = rest.find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | ')' | ']' | '}'))
                .unwrap_or(rest.len());
            match reqwest::Url::parse(&rest[..length]) {
                Ok(url) => output.push_str(&safe_url_log(&url)),
                Err(_) => output.push_str("[redacted-url]"),
            }
            at += length;
            continue;
        }
        if rest.starts_with("-----BEGIN ") {
            output.push_str("[redacted-key-material]");
            break;
        }
        if bytes[at].is_ascii_alphabetic()
            && (at == 0 || !(bytes[at - 1].is_ascii_alphanumeric() || matches!(bytes[at - 1], b'_' | b'-')))
        {
            let end = at + rest.find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))).unwrap_or(rest.len());
            let field: String = lower[at..end].chars().filter(|c| *c != '_' && *c != '-').collect();
            let tail = &text[end..];
            let value = tail.trim_start_matches(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '\\'));
            let sensitive = matches!(field.as_str(), "authorization" | "proxyauthorization" | "auth"
                | "cookie" | "cookies" | "setcookie" | "password" | "passwd" | "pwd"
                | "secret" | "clientsecret" | "key" | "apikey" | "xapikey"
                | "sessionid" | "jsessionid" | "sid" | "ticket" | "serviceticket"
                | "qrcontent" | "sharecode" | "authcode") || field.ends_with("token");
            if sensitive && value.starts_with([':', '=']) {
                output.push_str(&text[at..end]);
                output.push_str("=[redacted]");
                break;
            }
            if matches!(field.as_str(), "bearer" | "basic") && tail.starts_with(char::is_whitespace) {
                output.push_str(&text[at..end]);
                output.push_str(" [redacted]");
                break;
            }
        }
        let c = rest.chars().next().unwrap();
        match c {
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            c if c.is_control() => output.extend(c.escape_unicode()),
            _ => output.push(c),
        }
        at += c.len_utf8();
    }
    output
}

pub fn redirect_request(
    from: &reqwest::Url,
    to: &reqwest::Url,
    status: u16,
    method: &mut reqwest::Method,
    body: &mut Option<Vec<u8>>,
    headers: &mut std::collections::HashMap<String, String>,
) -> Result<(), String> {
    http_url(to)?;
    if from.scheme() == "https" && to.scheme() != "https" {
        return Err("拒绝 HTTPS 重定向降级到 HTTP".into());
    }
    let change_to_get = (status == 303 && *method != reqwest::Method::HEAD)
        || (matches!(status, 301 | 302) && *method == reqwest::Method::POST);
    if change_to_get {
        *method = reqwest::Method::GET;
        *body = None;
        headers.retain(|name, _| !matches!(name.to_ascii_lowercase().as_str(),
            "content-type" | "content-length" | "content-encoding" | "transfer-encoding"));
    }
    if from.origin() != to.origin() {
        // Never forward credentials in a preserved POST/PUT body to a new origin.
        if body.as_ref().is_some_and(|bytes| !bytes.is_empty()) {
            return Err("跨站重定向不能自动重发请求体".into());
        }
        // Custom token headers are not known in advance; keep only public
        // representation preferences. Cookie jar will select target cookies.
        headers.retain(|name, _| matches!(name.to_ascii_lowercase().as_str(),
            "accept" | "accept-language" | "accept-encoding" | "user-agent"));
    }
    Ok(())
}

#[cfg(test)]
#[path = "native_security_tests.rs"]
mod tests;
