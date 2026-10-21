//! Data-only Agent Skills. Import never executes package scripts or installers.
use crate::native_security::{confined_path, relative_path};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, io::{Cursor, Read}, path::Path};

pub const MAX_ZIP: usize = 8 * 1024 * 1024;
const MAX_EXPANDED: u64 = 32 * 1024 * 1024;
const MAX_FILE: u64 = 4 * 1024 * 1024;
pub const MAX_TEXT: usize = 256 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub sha256: String,
    pub installed_at: u64,
    pub enabled: bool,
    pub compatibility: String,
    pub requirements: Vec<String>,
    pub files: Vec<String>,
    pub expanded_bytes: u64,
}

pub struct Package {
    pub files: Vec<(String, Vec<u8>)>,
    pub requirements: Vec<String>,
    pub compatibility: String,
    pub expanded_bytes: u64,
    pub sha256: String,
}

/// Conservative capability assessment, not a claim that arbitrary Markdown is safe.
/// Unsupported script/installer/service requirements prevent activation in the portable runtime.
fn requirements(files: &[(String, Vec<u8>)]) -> Vec<String> {
    let mut reasons = std::collections::BTreeSet::new();
    for (path, bytes) in files {
        let name = path.to_lowercase();
        let extension = name.rsplit('.').next().unwrap_or("");
        if matches!(extension, "py" | "pyc" | "pyo") { reasons.insert("python"); }
        if matches!(extension, "mjs" | "cjs" | "ts") || name.ends_with("package.json") { reasons.insert("node"); }
        if extension == "js" {
            let text = String::from_utf8_lossy(bytes);
            if ["require(", "require (", "import ", "import(", "export ", "process.", "fetch(", "fetch (", "XMLHttpRequest", "WebSocket", "document.", "window.", "setTimeout", "setInterval", "Deno."].iter().any(|s| text.contains(s)) {
                reasons.insert("node");
            }
        }
        if matches!(extension, "sh" | "bash" | "ps1" | "bat" | "cmd" | "exe" | "dll" | "so" | "dylib" | "wasm" | "jar") { reasons.insert("native"); }
        if name.ends_with("requirements.txt") || name.ends_with("pyproject.toml") { reasons.insert("python"); }
        if !matches!(extension, "js" | "md" | "txt" | "json" | "yaml" | "yml" | "toml" | "csv" | "svg" | "png" | "jpg" | "jpeg" | "webp" | "gif" | "pdf") && !matches!(name.as_str(), "license" | "readme" | "notice") {
            reasons.insert("unknown-file");
        }
        if matches!(extension, "md" | "txt" | "toml" | "json" | "yml" | "yaml") {
            let text = String::from_utf8_lossy(bytes).to_lowercase();
            if ["pip install", "pip3 install", "npm install", "npx ", "clawhub", "uv run", "uv sync", "brew install", "apt install"].iter().any(|s| text.contains(s)) { reasons.insert("installer"); }
            if ["localhost:", "127.0.0.1:", "api_key", "api key", "api-key", "mcp server", "mcp服务器", "mcp 服务器", "docker "].iter().any(|s| text.contains(s)) { reasons.insert("external-service"); }
            if ["python ", "python3 "].iter().any(|s| text.contains(s)) { reasons.insert("python"); }
            if ["node ", "nodejs", "node.js"].iter().any(|s| text.contains(s)) { reasons.insert("node"); }
        }
    }
    reasons.into_iter().map(String::from).collect()
}

pub fn inspect(bytes: &[u8]) -> Result<Package, String> {
    if bytes.len() > MAX_ZIP { return Err("SKILL_PACKAGE_TOO_LARGE".into()); }
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "SKILL_INVALID_ZIP")?;
    if zip.len() > 512 { return Err("SKILL_TOO_MANY_FILES".into()); }
    let mut names = HashSet::new();
    let mut root = None;
    let mut total = 0u64;
    for index in 0..zip.len() {
        let file = zip.by_index(index).map_err(|_| "SKILL_INVALID_ZIP")?;
        let name = file.name().trim_end_matches('/');
        relative_path(name).map_err(|_| "SKILL_UNSAFE_PATH")?;
        let mode = file.unix_mode().unwrap_or(0) & 0o170000;
        if !matches!(mode, 0 | 0o100000 | 0o040000) { return Err("SKILL_UNSAFE_PATH".into()); }
        if !names.insert(name.to_lowercase()) { return Err("SKILL_DUPLICATE_PATH".into()); }
        total = total.checked_add(file.size()).ok_or("SKILL_PACKAGE_TOO_LARGE")?;
        if total > MAX_EXPANDED || file.size() > MAX_FILE || file.size() > file.compressed_size().saturating_mul(200).saturating_add(1024) {
            return Err("SKILL_PACKAGE_TOO_LARGE".into());
        }
        if !file.is_dir() && name.rsplit('/').next() == Some("SKILL.md") && name.split('/').count() <= 2 {
            if root.is_some() { return Err("SKILL_AMBIGUOUS_ROOT".into()); }
            root = Some(name.strip_suffix("SKILL.md").unwrap().to_string());
        }
    }
    let prefix = root.ok_or("SKILL_MISSING_MANIFEST")?;
    let mut files = Vec::new();
    for index in 0..zip.len() {
        let mut file = zip.by_index(index).map_err(|_| "SKILL_INVALID_ZIP")?;
        if file.is_dir() { continue; }
        let path = file.name().strip_prefix(&prefix).filter(|p| !p.is_empty()).ok_or("SKILL_AMBIGUOUS_ROOT")?.to_string();
        let expected = file.size();
        let mut data = Vec::new();
        (&mut file).take(expected + 1).read_to_end(&mut data).map_err(|_| "SKILL_INVALID_ZIP")?;
        if data.len() as u64 != expected { return Err("SKILL_INVALID_ZIP".into()); }
        files.push((path, data));
    }
    let manifest = &files.iter().find(|(p, _)| p == "SKILL.md").ok_or("SKILL_MISSING_MANIFEST")?.1;
    if manifest.is_empty() || manifest.len() > MAX_TEXT || std::str::from_utf8(manifest).is_err() { return Err("SKILL_INVALID_MANIFEST".into()); }
    let requirements = requirements(&files);
    let has_javascript = files.iter().any(|(p, _)| p.ends_with(".js"));
    Ok(Package {
        compatibility: if !requirements.is_empty() { "external-agent" } else if has_javascript { "javascript" } else { "text" }.into(),
        requirements, files, expanded_bytes: total, sha256: format!("{:x}", Sha256::digest(bytes)),
    })
}

pub fn write_content(target: &Path, package: &Package) -> Result<(), String> {
    for (name, bytes) in &package.files {
        let path = confined_path(target, &relative_path(name)?)?;
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        use std::io::Write;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        options.open(path).and_then(|mut f| f.write_all(bytes)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "skill_package_tests.rs"]
mod tests;
