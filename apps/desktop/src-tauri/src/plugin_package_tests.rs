use super::*;
use std::io::Write;
static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
fn root() -> PathBuf {
    let path = std::env::temp_dir().join(format!("onethu-plugin-security-{}-{}", std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    std::fs::create_dir_all(&path).unwrap(); path
}
fn package(root: &Path, manifest: &str, extra: &[(&str, &str)]) -> PathBuf {
    let file = root.join("package.zip");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&file).unwrap());
    zip.start_file("manifest.json", zip::write::SimpleFileOptions::default()).unwrap();
    zip.write_all(manifest.as_bytes()).unwrap();
    for (name, value) in extra {
        zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(value.as_bytes()).unwrap();
    }
    zip.finish().unwrap(); file
}
#[test]
fn valid_package_import_and_replacement() {
    let root = root();
    let zip = package(&root, r#"{"id":"sample","entry":"main.js"}"#, &[("main.js", "version1")]);
    assert_eq!(import_zip(&root, &zip).unwrap()["code"], "version1");
    let zip = package(&root, r#"{"id":"sample","entry":"src/main.js"}"#, &[("src/main.js", "version2")]);
    assert_eq!(import_zip(&root, &zip).unwrap()["code"], "version2");
    assert!(!root.join("sample/main.js").exists());
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn invalid_manifest_and_archive_do_not_touch_existing_install() {
    let root = root();
    std::fs::create_dir(root.join("sample")).unwrap();
    std::fs::write(root.join("sample/keep"), "original").unwrap();
    for manifest in [
        r#"{"id":"..","entry":"main.js"}"#,
        r#"{"id":"sample","entry":"../outside"}"#,
        r#"{"id":"sample","entry":"/etc/passwd"}"#,
        r#"{"id":"sample","kind":"rust","bin":"../program"}"#,
    ] {
        let zip = package(&root, manifest, &[("main.js", "fixture")]);
        assert!(import_zip(&root, &zip).is_err());
        assert_eq!(std::fs::read_to_string(root.join("sample/keep")).unwrap(), "original");
    }
    for name in ["../escape", "/absolute", "C:\\absolute", "dir/../escape", "file:stream"] {
        let zip = package(&root, r#"{"id":"sample","entry":"main.js"}"#, &[("main.js", "new"), (name, "bad")]);
        assert!(import_zip(&root, &zip).is_err(), "{name}");
        assert_eq!(std::fs::read_to_string(root.join("sample/keep")).unwrap(), "original");
    }
    assert!(!std::fs::read_dir(&root).unwrap().filter_map(Result::ok).any(|file| file.file_name().to_string_lossy().starts_with(".install-")));
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn missing_program_and_ambiguous_js_do_not_replace() {
    let root = root();
    let zip = package(&root, r#"{"id":"sample","kind":"rust","bin":"absent"}"#, &[("a.js", "a")]);
    assert!(import_zip(&root, &zip).is_err());
    assert!(!root.join("sample").exists());
    let zip = package(&root, r#"{"id":"sample"}"#, &[("a.js", "a"), ("b.js", "b")]);
    assert!(import_zip(&root, &zip).is_err());
    assert!(!root.join("sample").exists());
    assert!(install_rust(&root, "..", &root, "package.zip").is_err());
    assert!(install_rust(&root, "sample", &root, "../package.zip").is_err());
    std::fs::remove_dir_all(root).unwrap();
}
#[cfg(unix)]
#[test]
fn symlink_install_target_is_rejected() {
    let root = root();
    let outside = root.join("outside");
    std::fs::create_dir(&outside).unwrap();
    std::fs::write(outside.join("keep"), "safe").unwrap();
    std::os::unix::fs::symlink(&outside, root.join("sample")).unwrap();
    let zip = package(&root, r#"{"id":"sample","entry":"main.js"}"#, &[("main.js", "new")]);
    assert!(import_zip(&root, &zip).is_err());
    assert_eq!(std::fs::read_to_string(outside.join("keep")).unwrap(), "safe");
    std::fs::remove_dir_all(root).unwrap();
}
