/// Content-Type → 落盘后缀（只在「响应没有 Content-Disposition 真名、前端也没给出带后缀名」
/// 时兜底）。用户 2026-10-25 反馈：附件落盘名成了「下载」且无后缀——动作词被当文件名时，
/// 至少保证文件按真实类型带后缀、双击能打开。
fn extension_for_content_type(content_type: &str) -> Option<&'static str> {
    let base = content_type.split(';').next().unwrap_or("").trim();
    Some(match base {
        "application/pdf" => "pdf",
        "application/zip" | "application/x-zip-compressed" => "zip",
        "application/x-rar-compressed" | "application/vnd.rar" => "rar",
        "application/x-7z-compressed" => "7z",
        "application/msword" => "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
        "application/vnd.ms-excel" => "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => "xlsx",
        "application/vnd.ms-powerpoint" => "ppt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => "pptx",
        "text/plain" => "txt",
        "text/csv" => "csv",
        "text/markdown" => "md",
        "text/html" => "html",
        "application/json" => "json",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "video/mp4" => "mp4",
        "audio/mpeg" => "mp3",
        _ => return None,
    })
}

/// 文件名无后缀时按响应 Content-Type 补一个；已有后缀（任何语言/长度）一律不动。
fn ensure_extension(name: String, content_type: &str) -> String {
    if std::path::Path::new(&name).extension().is_some() {
        return name;
    }
    match extension_for_content_type(content_type) {
        Some(ext) => format!("{name}.{ext}"),
        None => name,
    }
}

/// Validate the original filename before MIME inference can make an HTML login
/// page look like an explicitly requested HTML attachment.
pub fn filename(resolved: &str, content_type: &str, bytes: &[u8]) -> Result<String, &'static str> {
    let name = resolved.trim();
    let lower = name.to_ascii_lowercase();
    let explicit_html = lower.ends_with(".html") || lower.ends_with(".htm");
    if !explicit_html {
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
        let head = head.trim_start_matches('\u{feff}').trim_start();
        let looks_html = head.starts_with("<!DOCTYPE") || head.starts_with("<!doctype") || head.starts_with("<html");
        let login_redirect = bytes.len() < 4096 && head.contains("location.href");
        if content_type.starts_with("text/html") || looks_html || login_redirect {
            return Err("会话已失效，需要重新登录");
        }
    }
    Ok(ensure_extension(name.to_string(), content_type))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_login_page_before_inventing_html_extension() {
        assert!(filename("下载", "text/html; charset=utf-8", b"<!DOCTYPE html><html>login</html>").is_err());
        assert!(filename("attachment-1", "application/octet-stream", b"<html>login</html>").is_err());
        assert!(filename("attachment-1", "application/octet-stream", b"location.href='login'").is_err());
    }
    #[test]
    fn keeps_explicit_html_and_existing_extensions() {
        assert_eq!(filename("example.HTML", "text/html", b"<html>course example</html>").unwrap(), "example.HTML");
        assert_eq!(filename("report.final.docx", "application/zip", b"PKfixture").unwrap(), "report.final.docx");
    }
    #[test]
    fn retains_mime_fallback_for_normal_downloads() {
        assert_eq!(filename("  课程大纲  ", "application/pdf", b"%PDF-fixture").unwrap(), "课程大纲.pdf");
        assert_eq!(filename("attachment-1", "application/zip", b"PKfixture").unwrap(), "attachment-1.zip");
        assert_eq!(filename("attachment-1", "application/octet-stream", b"fixture").unwrap(), "attachment-1");
    }
}
