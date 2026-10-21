//! Validate an entire plugin package before replacing an installed directory.
use crate::native_security::{confined_path, plugin_id, relative_path};
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_PACKAGE: u64 = 1024 * 1024 * 1024;
const MAX_MANIFEST: u64 = 1024 * 1024;
static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

struct Stage(PathBuf);
impl Drop for Stage {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}
fn stage(root: &Path) -> Result<Stage, String> {
    confined_path(root, Path::new(""))?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?.as_nanos();
    let name = format!(".install-{}-{stamp}-{}", std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    let path = root.join(name);
    std::fs::create_dir(&path).map_err(|e| e.to_string())?;
    Ok(Stage(path))
}

fn commit(stage: &Stage, target: &Path) -> Result<(), String> {
    let backup = stage.0.with_extension("previous");
    let exists = target.exists();
    if exists {
        std::fs::rename(target, &backup).map_err(|e| format!("保留旧插件失败：{e}"))?;
    }
    if let Err(error) = std::fs::rename(&stage.0, target) {
        if exists {
            std::fs::rename(&backup, target)
                .map_err(|restore| format!("安装失败：{error}；旧插件位于 {}，恢复失败：{restore}", backup.display()))?;
        }
        return Err(format!("安装插件失败：{error}"));
    }
    if exists { let _ = std::fs::remove_dir_all(backup); }
    Ok(())
}

fn executable(path: &Path) -> Result<(), String> {
    if !path.is_file() { return Err("插件包缺少声明的程序文件".into()); }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn install_rust(root: &Path, id: &str, source: &Path, bin: &str) -> Result<String, String> {
    plugin_id(id)?;
    let binary = relative_path(bin)?;
    let target = confined_path(root, Path::new(id))?;
    let stage = stage(root)?;
    let mut total = 0u64;
    for entry in std::fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() { continue; }
        total = total.checked_add(entry.metadata().map_err(|e| e.to_string())?.len()).ok_or("插件过大")?;
        if total > MAX_PACKAGE { return Err("插件包超过 1GB".into()); }
        let rel = relative_path(&entry.file_name().to_string_lossy())?;
        std::fs::copy(entry.path(), stage.0.join(rel)).map_err(|e| e.to_string())?;
    }
    executable(&stage.0.join(&binary))?;
    commit(&stage, &target)?;
    Ok(target.join(binary).to_string_lossy().into_owned())
}

pub fn import_zip(root: &Path, archive_path: &Path) -> Result<Value, String> {
    let file = std::fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    if archive.len() > 4096 { return Err("插件包文件数量超过上限".into()); }
    let mut total = 0u64;
    let mut manifest_entry = None;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().trim_end_matches('/');
        relative_path(name)?;
        if entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) {
            return Err("插件包不允许符号链接".into());
        }
        total = total.checked_add(entry.size()).ok_or("插件过大")?;
        if total > MAX_PACKAGE { return Err("插件包超过 1GB".into()); }
        if !entry.is_dir() && name.split('/').count() <= 2 && name.rsplit('/').next() == Some("manifest.json") {
            if manifest_entry.is_some() { return Err("插件包有多个 manifest.json".into()); }
            if entry.size() > MAX_MANIFEST { return Err("插件清单过大".into()); }
            manifest_entry = Some((i, name.rsplit_once('/').map(|(prefix, _)| format!("{prefix}/")).unwrap_or_default()));
        }
    }
    let (index, prefix) = manifest_entry.ok_or("压缩包根目录未找到 manifest.json")?;
    let mut manifest_text = String::new();
    archive.by_index(index).map_err(|e| e.to_string())?.take(MAX_MANIFEST + 1)
        .read_to_string(&mut manifest_text).map_err(|e| e.to_string())?;
    if manifest_text.len() as u64 > MAX_MANIFEST { return Err("插件清单过大".into()); }
    let manifest: Value = serde_json::from_str(&manifest_text).map_err(|e| e.to_string())?;
    let id = manifest.get("id").and_then(Value::as_str).ok_or("manifest.json 缺 id")?;
    plugin_id(id)?;
    let target = confined_path(root, Path::new(id))?;
    let kind = manifest.get("kind").and_then(Value::as_str).unwrap_or("js");
    if !matches!(kind, "js" | "rust") { return Err("不支持的插件类型".into()); }
    // Validate manifest references before creating or changing installed files.
    let declared = if kind == "rust" {
        Some(relative_path(manifest.get("bin").and_then(Value::as_str).ok_or("rust 插件 manifest 缺 bin")?)?)
    } else {
        manifest.get("entry").and_then(Value::as_str).map(relative_path).transpose()?
    };
    let stage = stage(root)?;
    let mut seen = std::collections::HashSet::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() { continue; }
        let name = entry.name().to_string();
        let rel = name.strip_prefix(&prefix).ok_or("插件包包含根目录外的文件")?;
        let relative = relative_path(rel)?;
        // Case-insensitive duplicates are ambiguous on Windows/macOS volumes.
        if !seen.insert(rel.to_lowercase()) { return Err("插件包有重复文件路径".into()); }
        let dest = stage.0.join(relative);
        if let Some(parent) = dest.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        let mut output = std::fs::OpenOptions::new().write(true).create_new(true)
            .open(dest).map_err(|e| e.to_string())?;
        let expected = entry.size();
        let copied = std::io::copy(&mut (&mut entry).take(expected + 1), &mut output).map_err(|e| e.to_string())?;
        if copied != expected { return Err("插件文件大小与清单不符".into()); }
    }
    if kind == "rust" {
        let binary = declared.ok_or("缺少程序入口")?;
        executable(&stage.0.join(&binary))?;
        commit(&stage, &target)?;
        return Ok(json!({"kind": "rust", "manifest": manifest, "binPath": target.join(binary).to_string_lossy()}));
    }
    let entry = match declared {
        Some(path) => path,
        None => {
            let files = std::fs::read_dir(&stage.0).map_err(|e| e.to_string())?
                .filter_map(Result::ok).filter(|e| e.path().extension().is_some_and(|v| v == "js"))
                .collect::<Vec<_>>();
            if files.len() != 1 { return Err("js 插件须声明 entry 或包含唯一根目录 .js".into()); }
            PathBuf::from(files[0].file_name())
        }
    };
    let mut code = String::new();
    std::fs::File::open(stage.0.join(entry)).map_err(|e| e.to_string())?
        .take(32 * 1024 * 1024 + 1).read_to_string(&mut code).map_err(|e| e.to_string())?;
    if code.len() > 32 * 1024 * 1024 { return Err("插件入口源码过大".into()); }
    commit(&stage, &target)?;
    Ok(json!({"kind": "js", "manifest": manifest, "code": code}))
}

#[cfg(test)]
#[path = "plugin_package_tests.rs"]
mod tests;
