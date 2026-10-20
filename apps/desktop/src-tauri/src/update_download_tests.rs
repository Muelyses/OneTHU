use super::*;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
};

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "onethu-updater-test-{}-{}",
            std::process::id(),
            NEXT_DOWNLOAD.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn server(handler: impl FnOnce(TcpStream) + Send + 'static) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/package", listener.local_addr().unwrap());
    let task = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut buf = [0; 4096];
        let n = stream.read(&mut buf).unwrap();
        assert!(!String::from_utf8_lossy(&buf[..n]).contains("Range:"));
        handler(stream);
    });
    (url, task)
}
async fn run(
    url: &str,
    root: &Path,
    size: Option<u64>,
    hash: Option<&str>,
) -> Result<Downloaded, String> {
    let gate = DownloadGate::new();
    let permit = gate.begin()?;
    download_inner(
        root,
        url,
        "OneTHU.apk",
        size,
        hash,
        &permit,
        |_, _, _, _| {},
        true,
    )
    .await
}
fn empty(root: &Path) {
    assert_eq!(std::fs::read_dir(root).unwrap().count(), 0);
}
#[test]
fn input_validation() {
    for name in [
        "../x.apk",
        "..",
        "/tmp/a.apk",
        "a\\b.apk",
        "CON.exe",
        " a.apk",
        "a.apk.",
        "a\0.apk",
    ] {
        assert!(safe_name(name).is_err(), "{name}");
    }
    for hash in ["", "abcd", &"g".repeat(64)] {
        assert!(expected_hash(Some(hash)).is_err());
    }
    assert!(allowed_url(
        &url::Url::parse("https://github.com/a").unwrap(),
        false
    ));
    assert!(!allowed_url(
        &url::Url::parse("http://127.0.0.1/a").unwrap(),
        false
    ));
    assert!(!allowed_url(
        &url::Url::parse("https://user:pass@github.com/a").unwrap(),
        false
    ));
}
#[test]
fn cancel_gate_never_resets_active_ticket() {
    let gate = DownloadGate::new();
    let one = gate.begin().unwrap();
    gate.cancel();
    assert!(gate.begin().is_err());
    assert!(one.check().is_err());
    drop(one);
    let next = gate.begin().unwrap();
    assert!(next.check().is_ok());
}
#[tokio::test]
async fn streams_and_hashes_to_unique_atomic_file() {
    let temp = Temp::new();
    std::fs::write(temp.0.join("old.apk"), b"old").unwrap();
    let (url, task) = server(|mut s| {
        s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nabc")
            .unwrap();
        thread::sleep(Duration::from_millis(60));
        s.write_all(b"def").unwrap();
    });
    let gate = DownloadGate::new();
    let permit = gate.begin().unwrap();
    let progress = Mutex::new(Vec::new());
    let sha = format!("{:x}", Sha256::digest(b"abcdef"));
    let result = download_inner(
        &temp.0,
        &url,
        "OneTHU.apk",
        Some(6),
        Some(&sha),
        &permit,
        |phase, n, _, _| {
            if phase == "download" {
                progress.lock().unwrap().push(n);
            }
        },
        true,
    )
    .await
    .unwrap();
    tokio::task::spawn_blocking(move || task.join().unwrap())
        .await
        .unwrap();
    assert_eq!(std::fs::read(&result.path).unwrap(), b"abcdef");
    assert!(result.verified);
    assert_eq!(result.size, 6);
    assert!(progress.lock().unwrap().contains(&3));
    assert_eq!(std::fs::read(temp.0.join("old.apk")).unwrap(), b"old");
    assert!(installer_path(&temp.0, &result.path).is_ok());
    assert!(!result.path.parent().unwrap().join("download.part").exists());
}
#[tokio::test]
async fn rejects_tamper_truncation_status_and_limit_without_leftovers() {
    for response in [
        b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nbad".as_slice(),
        b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nbad",
        b"HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\n\r\nbad",
        b"HTTP/1.1 200 OK\r\nContent-Length: 1073741825\r\n\r\n",
    ] {
        let temp = Temp::new();
        let raw = response.to_vec();
        let (url, task) = server(move |mut s| {
            s.write_all(&raw).unwrap();
        });
        assert!(run(&url, &temp.0, None, Some(&"0".repeat(64)))
            .await
            .is_err());
        tokio::task::spawn_blocking(move || task.join().unwrap())
            .await
            .unwrap();
        empty(&temp.0);
    }
}
#[tokio::test]
async fn cancel_headers_and_body_drops_real_socket_and_cleans_staging() {
    for body_started in [false, true] {
        let temp = Temp::new();
        let (tx, rx) = tokio::sync::oneshot::channel();
        let (url, task) = server(move |mut s| {
            if body_started {
                s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 99\r\n\r\na")
                    .unwrap();
            }
            tx.send(()).unwrap();
            let mut b = [0];
            assert_eq!(
                s.read(&mut b).unwrap(),
                0,
                "cancellation must close the real connection"
            );
        });
        let gate = DownloadGate::new();
        let permit = gate.begin().unwrap();
        let (result, ()) = tokio::join!(
            download_inner(
                &temp.0,
                &url,
                "x.apk",
                None,
                None,
                &permit,
                |_, _, _, _| {},
                true
            ),
            async {
                rx.await.unwrap();
                tokio::time::sleep(Duration::from_millis(30)).await;
                gate.cancel();
            }
        );
        assert!(result.err().unwrap().contains("已取消"));
        tokio::task::spawn_blocking(move || task.join().unwrap())
            .await
            .unwrap();
        empty(&temp.0);
    }
}
#[tokio::test]
async fn dropped_future_removes_partial_download() {
    let temp = Temp::new();
    let (url, task) = server(|mut s| {
        s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\na")
            .unwrap();
        let mut b = [0];
        assert_eq!(s.read(&mut b).unwrap(), 0);
    });
    let gate = DownloadGate::new();
    let permit = gate.begin().unwrap();
    assert!(tokio::time::timeout(
        Duration::from_millis(100),
        download_inner(
            &temp.0,
            &url,
            "x.apk",
            None,
            None,
            &permit,
            |_, _, _, _| {},
            true
        )
    )
    .await
    .is_err());
    tokio::task::spawn_blocking(move || task.join().unwrap())
        .await
        .unwrap();
    empty(&temp.0);
}
#[tokio::test]
async fn missing_hash_never_claims_signature_or_verification() {
    let temp = Temp::new();
    let (url, task) = server(|mut s| {
        s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabc")
            .unwrap();
    });
    let result = run(&url, &temp.0, Some(3), None).await.unwrap();
    tokio::task::spawn_blocking(move || task.join().unwrap())
        .await
        .unwrap();
    assert!(!result.verified);
    assert!(installer_path(&temp.0, Path::new("/etc/hosts")).is_err());
}
#[tokio::test]
async fn installer_requires_completed_record_and_unchanged_bytes() {
    let temp = Temp::new();
    let registry = CompletedDownloads::new();
    let loose = temp.0.join("loose.apk");
    std::fs::write(&loose, b"abc").unwrap();
    assert!(registry.validate(&temp.0, &loose).is_err());
    let (url, task) = server(|mut s| {
        s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabc")
            .unwrap();
    });
    let result = run(&url, &temp.0, Some(3), None).await.unwrap();
    tokio::task::spawn_blocking(move || task.join().unwrap())
        .await
        .unwrap();
    registry.remember(&result).unwrap();
    assert!(registry.validate(&temp.0, &result.path).is_ok());
    std::fs::write(&result.path, b"xyz").unwrap();
    assert!(registry
        .validate(&temp.0, &result.path)
        .unwrap_err()
        .contains("已改变"));
    std::fs::write(&result.path, b"longer").unwrap();
    assert!(registry.validate(&temp.0, &result.path).is_err());
    assert!(CompletedDownloads::new().validate(&temp.0, &loose).is_err());
}
#[tokio::test]
async fn disk_error_retains_previous_package() {
    let temp = Temp::new();
    let root = temp.0.join("not-a-directory");
    std::fs::write(&root, b"old package").unwrap();
    assert!(run("http://127.0.0.1:1/no-call", &root, None, None)
        .await
        .is_err());
    assert_eq!(std::fs::read(root).unwrap(), b"old package");
}
#[tokio::test]
async fn missing_size_chunked_body_is_bounded_and_validated() {
    let temp = Temp::new();
    let (url, task) = server(|mut s| {
        s.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\n\r\n")
            .unwrap();
    });
    let result = run(&url, &temp.0, None, None).await.unwrap();
    tokio::task::spawn_blocking(move || task.join().unwrap())
        .await
        .unwrap();
    assert_eq!(result.size, 3);
    assert_eq!(std::fs::read(result.path).unwrap(), b"abc");
}
