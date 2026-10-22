//! Bounded, app-owned file access for portable wallpaper backups.
use std::io::Read;
use std::path::Path;

const MAX_BYTES: u64 = 12 * 1024 * 1024;

pub fn read(root: &Path, path: &Path) -> Result<Vec<u8>, String> {
    let root = root.canonicalize().map_err(|e| format!("定位壁纸目录失败：{e}"))?;
    let path = path.canonicalize().map_err(|e| format!("读取壁纸失败：{e}"))?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err("仅支持读取当前设备壁纸目录内的文件".into());
    }
    let file = std::fs::File::open(path).map_err(|e| format!("读取壁纸失败：{e}"))?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_BYTES {
        return Err("壁纸文件超过 12 MiB".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|e| format!("读取壁纸失败：{e}"))?;
    if bytes.len() as u64 > MAX_BYTES { return Err("壁纸文件超过 12 MiB".into()); }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let dir = std::env::temp_dir().join(format!("onethu-wallpaper-test-{}-{stamp}-{id}", std::process::id()));
            std::fs::create_dir_all(dir.join("wallpapers")).unwrap();
            Self(dir)
        }
        fn root(&self) -> std::path::PathBuf { self.0.join("wallpapers") }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
    #[test]
    fn own_file_round_trip_and_external_path_rejected() {
        let f = Fixture::new(); let own = f.root().join("test.png");
        std::fs::write(&own, b"fixture bytes").unwrap();
        assert_eq!(read(&f.root(), &own).unwrap(), b"fixture bytes");
        let external = f.0.join("secret.txt"); std::fs::write(&external, b"private").unwrap();
        assert!(read(&f.root(), &external).is_err());
        assert!(read(&f.root(), &f.root().join("../secret.txt")).is_err());
        assert!(read(&f.root(), &f.root()).is_err());
    }
    #[test]
    fn large_file_rejected_before_read() {
        let f = Fixture::new(); let path = f.root().join("large.mp4");
        std::fs::File::create(&path).unwrap().set_len(MAX_BYTES + 1).unwrap();
        assert!(read(&f.root(), &path).unwrap_err().contains("12 MiB"));
    }
    #[cfg(unix)]
    #[test]
    fn symlink_escape_rejected() {
        let f = Fixture::new(); let external = f.0.join("secret.txt");
        std::fs::write(&external, b"private").unwrap();
        let link = f.root().join("photo.jpg");
        std::os::unix::fs::symlink(external, &link).unwrap();
        assert!(read(&f.root(), &link).is_err());
    }
}
