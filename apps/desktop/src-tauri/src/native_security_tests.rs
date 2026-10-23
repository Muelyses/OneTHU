use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

#[test]
fn java_path_sessions_are_removed_from_logs() {
    for path in ["/timeout.jsp;jsessionid=fixture-private", "/a%3Bjsessionid%3Dfixture-private/b;token=fixture-private"] {
        let url = reqwest::Url::parse(&format!("https://school.example{path}?ticket=fixture-private")).unwrap();
        let safe = safe_url_log(&url);
        assert!(!safe.contains("fixture-private"));
        assert!(!redact_log(&format!("GET {url}")).contains("fixture-private"));
    }
}

pub(crate) fn temp() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("onethu-native-security-{}-{}", std::process::id(),
        NEXT_FILE.fetch_add(1, Ordering::Relaxed)));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn plugin_names_and_cross_platform_paths() {
    for id in ["", ".", "..", "a/b", "a\\b", "a:", "a.", "CON", "LPT1.log"] {
        assert!(plugin_id(id).is_err(), "{id}");
    }
    for id in ["onethu.harness", "test-plugin_2", "我的插件"] { plugin_id(id).unwrap(); }
    for path in ["/etc/passwd", "../a", "a/../b", "C:/a", "C:\\a", "a:b", "a/./b", "a//b", "NUL", "a.", "a/\n"] {
        assert!(relative_path(path).is_err(), "{path:?}");
    }
    assert_eq!(relative_path("bin/我的程序").unwrap(), Path::new("bin/我的程序"));
}

#[test]
fn private_write_replaces_atomically_and_preserves_on_error() {
    let dir = temp();
    let path = dir.join("state.json");
    private_atomic_write(&path, b"before").unwrap();
    private_atomic_write(&path, b"after").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"after");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let block = dir.join("directory");
    std::fs::create_dir(&block).unwrap();
    assert!(private_atomic_write(&block, b"bad").is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"after");
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 2);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn executable_stays_in_own_plugin_directory() {
    let root = temp();
    std::fs::create_dir(root.join("own")).unwrap();
    std::fs::create_dir(root.join("other")).unwrap();
    std::fs::write(root.join("own/run"), b"test").unwrap();
    std::fs::write(root.join("other/run"), b"test").unwrap();
    plugin_binary(&root, "own", &root.join("own/run")).unwrap();
    assert!(plugin_binary(&root, "own", &root.join("other/run")).is_err());
    assert!(plugin_binary(&root, "own", &root.join("own/../other/run")).is_err());
    assert!(plugin_binary(&root, "..", &root.join("own/run")).is_err());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.join("other/run"), root.join("own/link")).unwrap();
        assert!(plugin_binary(&root, "own", &root.join("own/link")).is_err());
        std::os::unix::fs::symlink(root.join("other"), root.join("own/dir")).unwrap();
        assert!(confined_path(&root, Path::new("own/dir/run")).is_err());
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn redirect_policy_and_safe_logs() {
    let origin = reqwest::Url::parse("https://school.example/a").unwrap();
    let mut method = reqwest::Method::POST;
    let mut body = Some(b"credential".to_vec());
    let mut headers = std::collections::HashMap::from([("Authorization".into(), "secret".into())]);
    assert!(redirect_request(&origin, &reqwest::Url::parse("http://school.example/b").unwrap(),
        302, &mut method, &mut body, &mut headers).is_err());
    assert!(http_url(&reqwest::Url::parse("https://user:secret@example.com").unwrap()).is_err());
    assert!(http_url(&reqwest::Url::parse("file:///etc/passwd").unwrap()).is_err());
    assert_eq!(safe_url_log(&reqwest::Url::parse("https://user:secret@example.com/path?token=secret#secret").unwrap()),
        "https://example.com/path");
    let mut head = reqwest::Method::HEAD;
    redirect_request(&origin, &origin.join("b").unwrap(), 303, &mut head, &mut None, &mut headers).unwrap();
    assert_eq!(head, reqwest::Method::HEAD);
}

#[test]
fn unstructured_log_sink_redacts_headers_fields_and_urls() {
    // Synthetic fixtures only: deliberately include quoted values, cookies
    // with spaces, folded lines, custom token names and mixed-language logs.
    for raw in [
        "[HOP] Cookie: session=fixture-private; other=fixture-other",
        "reply Set-Cookie: sid=fixture-private; HttpOnly",
        "Authorization: Bearer fixture-private\n continuation-private",
        r#"payload {"password":"fixture-private","rest":"fixture-other"}"#,
        r#"payload {\"api_key\":\"fixture-private\"}"#,
        "x-auth-token=fixture-private status=200",
        "accessToken: 'fixture-private'",
        "refresh_token = fixture-private",
        "Bearer fixture-private",
        "Basic Zml4dHVyZS1wcml2YXRl",
        "登录 pwd=fixture-private",
        "sessionId=fixture-private",
        "-----BEGIN PRIVATE KEY-----\nfixture-private",
    ] {
        let safe = redact_log(raw);
        for secret in ["fixture-private", "fixture-other", "continuation-private", "Zml4dHVyZS1wcml2YXRl"] {
            assert!(!safe.contains(secret), "{safe}");
        }
        assert!(safe.contains("[redacted"), "{safe}");
    }
    assert_eq!(
        redact_log("GET https://user:fixture-private@school.example/path?ticket=fixture-private#fixture-other → 302"),
        "GET https://school.example/path → 302"
    );
    assert_eq!(
        redact_log("GET https://school.example/a?x=private next http://example.test/b#private 200"),
        "GET https://school.example/a next http://example.test/b 200"
    );
    assert_eq!(redact_log("请求 200 12ms\nforged\r\0"), "请求 200 12ms\\nforged\\r\\u{0}");
    assert_eq!(redact_log("POST /normal status=200 bytes=23"), "POST /normal status=200 bytes=23");
    assert!(redact_log(&"界".repeat(20_000)).chars().count() <= 8192);
}

type Server = (String, Arc<Mutex<Vec<String>>>, std::thread::JoinHandle<()>);
fn server(count: usize, reply: impl Fn(usize, &str) -> String + Send + 'static) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let capture = seen.clone();
    let thread = std::thread::spawn(move || {
        for i in 0..count {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap();
                if n == 0 { break; }
                bytes.extend_from_slice(&buf[..n]);
                if let Some(head) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..head]).to_ascii_lowercase();
                    let length = headers.lines().find_map(|line| line.strip_prefix("content-length:")
                        .and_then(|v| v.trim().parse::<usize>().ok())).unwrap_or(0);
                    if bytes.len() >= head + 4 + length { break; }
                }
            }
            let text = String::from_utf8(bytes).unwrap();
            capture.lock().unwrap().push(text.clone());
            stream.write_all(reply(i, &text).as_bytes()).unwrap();
        }
    });
    (address, seen, thread)
}
fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).build().unwrap()
}
fn input(url: String, method: &str) -> crate::HttpInput {
    crate::HttpInput { url, method: method.into(), headers: std::collections::HashMap::from([
        ("Authorization".into(), "Bearer fixture-secret".into()),
        ("X-Api-Key".into(), "fixture-key".into()), ("Token".into(), "fixture-ticket".into()),
        ("Referer".into(), "https://origin.example/?token=fixture".into()),
        ("Accept".into(), "application/json".into()),
    ]), body: Some("fixture-private-body".into()), body_b64: None, timeout_ms: Some(3000) }
}

#[tokio::test]
async fn real_cross_origin_302_strips_credentials_and_body() {
    let (target, received, end) = server(1, |_, _| "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".into());
    let (start, first, begin) = server(1, move |_, _| format!("HTTP/1.1 302 Found\r\nLocation: {target}/next\r\nSet-Cookie: fixture=one; Path=/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
    let output = crate::http_native_with_client(input(start, "POST"), client()).await.unwrap();
    assert_eq!(output.body, "ok");
    assert_eq!(output.set_cookie_hops.unwrap().len(), 1);
    assert!(first.lock().unwrap()[0].contains("fixture-secret"));
    let text = received.lock().unwrap()[0].to_lowercase();
    assert!(text.starts_with("get /next"));
    for forbidden in ["authorization:", "x-api-key:", "token:", "referer:", "fixture-private-body"] {
        assert!(!text.contains(forbidden), "{forbidden}");
    }
    assert!(text.contains("accept: application/json"));
    begin.join().unwrap(); end.join().unwrap();
}

#[tokio::test]
async fn real_same_origin_307_keeps_body_and_authorization() {
    let (start, seen, worker) = server(2, |i, _| if i == 0 {
        "HTTP/1.1 307 Temporary Redirect\r\nLocation: /next\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()
    } else { "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into() });
    crate::http_native_with_client(input(start, "POST"), client()).await.unwrap();
    let text = seen.lock().unwrap()[1].to_lowercase();
    assert!(text.starts_with("post /next"));
    assert!(text.contains("authorization: bearer fixture-secret"));
    assert!(text.ends_with("fixture-private-body"));
    worker.join().unwrap();
}

#[tokio::test]
async fn real_cross_origin_307_does_not_send_private_body() {
    let target = TcpListener::bind("127.0.0.1:0").unwrap();
    target.set_nonblocking(true).unwrap();
    let address = target.local_addr().unwrap();
    let (start, _, worker) = server(1, move |_, _| format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: http://{address}/next\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
    let error = crate::http_native_with_client(input(start, "POST"), client()).await.err().unwrap();
    assert!(error.contains("跨站"));
    assert_eq!(target.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
    worker.join().unwrap();
}

#[tokio::test]
async fn real_redirect_loop_returns_error_instead_of_empty_success() {
    let (start, seen, worker) = server(26, |_, _| "HTTP/1.1 302 Found\r\nLocation: /loop\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into());
    assert!(crate::http_native_with_client(input(start, "GET"), client()).await.err().unwrap().contains("上限"));
    assert_eq!(seen.lock().unwrap().len(), 26);
    worker.join().unwrap();
}

#[test]
fn cookie_roundtrip_preserves_secure_host_only_expiry_and_legacy() {
    use reqwest::cookie::CookieStore;
    let root = temp();
    let path = root.join("native-jar.tsv");
    let jar = crate::SharedNativeJar(std::sync::RwLock::new(cookie_store::CookieStore::default()), std::sync::atomic::AtomicBool::new(false), std::sync::atomic::AtomicU64::new(0));
    jar.seed_line("https://school.example/path", "host=fixture; Secure; HttpOnly; Path=/");
    jar.seed_line("https://school.example/path", "wide=fixture; Secure; Domain=school.example; Path=/");
    jar.save_to_file(&path);
    let next = crate::SharedNativeJar(std::sync::RwLock::new(cookie_store::CookieStore::default()), std::sync::atomic::AtomicBool::new(false), std::sync::atomic::AtomicU64::new(0));
    next.load_from_file(&path);
    assert!(next.cookies(&reqwest::Url::parse("http://school.example/").unwrap()).is_none());
    let child = next.cookies(&reqwest::Url::parse("https://sub.school.example/").unwrap()).unwrap();
    assert!(child.to_str().unwrap().contains("wide="));
    assert!(!child.to_str().unwrap().contains("host="));
    assert!(next.0.read().unwrap().iter_unexpired().any(|cookie| cookie.name() == "host" && cookie.http_only() == Some(true)));
    std::fs::write(&path, "school.example\t/\t1\tlegacy=fixture\n").unwrap();
    next.clear(); next.load_from_file(&path);
    assert!(next.cookies(&reqwest::Url::parse("http://school.example/").unwrap()).is_none());
    assert!(next.cookies(&reqwest::Url::parse("https://school.example/").unwrap()).is_some());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn cookie_account_clear_survives_immediate_restart_and_reports_write_failure() {
    use reqwest::cookie::CookieStore;
    let root = temp();
    let path = root.join("native-jar.tsv");
    let url = reqwest::Url::parse("https://school.example/").unwrap();
    let jar = crate::SharedNativeJar(std::sync::RwLock::new(cookie_store::CookieStore::default()), std::sync::atomic::AtomicBool::new(false), std::sync::atomic::AtomicU64::new(0));
    jar.seed_line(url.as_str(), "old_account=fixture; Secure; HttpOnly; Path=/");
    jar.save_to_file(&path);
    jar.clear_and_save_to_file(&path).unwrap();
    let restarted = crate::SharedNativeJar(std::sync::RwLock::new(cookie_store::CookieStore::default()), std::sync::atomic::AtomicBool::new(false), std::sync::atomic::AtomicU64::new(0));
    restarted.load_from_file(&path);
    assert!(restarted.cookies(&url).is_none());
    jar.seed_line(url.as_str(), "another_account=fixture; Secure; Path=/");
    assert!(jar.clear_and_save_to_file(&root.join("missing-parent/jar.json")).is_err());
    assert!(jar.cookies(&url).is_none());
    assert!(jar.1.load(std::sync::atomic::Ordering::Relaxed));
    std::fs::remove_dir_all(root).unwrap();
}


fn epoch_test_jar() -> Arc<crate::SharedNativeJar> {
    Arc::new(crate::SharedNativeJar(
        std::sync::RwLock::new(cookie_store::CookieStore::default()),
        std::sync::atomic::AtomicBool::new(false),
        std::sync::atomic::AtomicU64::new(0),
    ))
}

#[tokio::test]
async fn cookie_epoch_rejects_late_native_response_before_provider_mutates_jar() {
    use reqwest::cookie::CookieStore;
    let jar = epoch_test_jar();
    let epoch = jar.epoch();
    let provider = Arc::new(crate::EpochNativeJar { jar: jar.clone(), epoch });
    let client = reqwest::Client::builder().no_proxy().cookie_provider(provider.clone())
        .redirect(reqwest::redirect::Policy::none()).build().unwrap();
    let (arrived_tx, arrived_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let arrived_tx = Mutex::new(Some(arrived_tx));
    let (start, _, worker) = server(1, move |_, _| {
        arrived_tx.lock().unwrap().take().unwrap().send(()).unwrap();
        release_rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        "HTTP/1.1 200 OK\r\nSet-Cookie: account=stale; Path=/\r\nContent-Type: text/plain\r\nContent-Length: 3\r\nConnection: close\r\n\r\nold".into()
    });
    let origin = reqwest::Url::parse(&start).unwrap();
    let request_jar = jar.clone();
    let request = tokio::spawn(async move {
        crate::http_native_in_session(input(start, "GET"), client, Some((&request_jar, epoch))).await
    });
    arrived_rx.await.unwrap();
    jar.clear();
    jar.seed_lines_at_epoch(origin.as_str(), &["account=current; Path=/".into()], jar.epoch()).unwrap();
    assert!(provider.cookies(&origin).is_none(), "old client must never read new account cookies");
    release_tx.send(()).unwrap();
    let error = request.await.unwrap().err().unwrap();
    assert_eq!(error, crate::COOKIE_SESSION_CHANGED);
    assert_eq!(jar.cookies(&origin).unwrap().to_str().unwrap(), "account=current");
    worker.join().unwrap();
}

#[test]
fn cookie_epoch_rejects_delayed_seed_and_accepts_current_account() {
    use reqwest::cookie::CookieStore;
    let jar = epoch_test_jar();
    let old_epoch = jar.epoch();
    jar.clear();
    let url = reqwest::Url::parse("https://cloud.tsinghua.edu.cn/").unwrap();
    assert!(jar.seed_lines_at_epoch(url.as_str(), &["sessionid=old; Secure; Path=/".into()], old_epoch).is_err());
    assert!(jar.cookies(&url).is_none());
    jar.seed_lines_at_epoch(url.as_str(), &["sessionid=new; Secure; Path=/".into()], jar.epoch()).unwrap();
    let current = crate::EpochNativeJar { jar: jar.clone(), epoch: jar.epoch() };
    let value = reqwest::header::HeaderValue::from_static("renewed=valid; Secure; Path=/");
    current.set_cookies(&mut std::iter::once(&value), &url);
    let header = current.cookies(&url).unwrap();
    assert!(header.to_str().unwrap().contains("sessionid=new"));
    assert!(header.to_str().unwrap().contains("renewed=valid"));
}
