//! Private main-window session handoff. Cookie bytes never enter diagnostics,
//! public CLI/MCP results or plugin interfaces.
use crate::{native_security, SharedNativeJar, NATIVE_JAR_ARC};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::Ordering;
#[cfg(desktop)]
use tauri::Manager;

const INVALID: &str = "AUTH_HANDOFF_COOKIE_INVALID";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CookieRecord {
    name: String,
    value: String,
    domain: String,
    path: String,
    secure: bool,
    host_only: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expires_at: Option<i64>,
    #[serde(default)]
    http_only: bool,
}
#[derive(Serialize)]
pub struct Snapshot { revision: u64, cookies: Vec<CookieRecord> }
#[derive(Serialize)]
pub struct Revision { revision: u64 }

fn main_only(label: &str) -> Result<(), String> {
    if label == "main" { Ok(()) } else { Err("CLI_SESSION_MAIN_WINDOW_REQUIRED".into()) }
}
fn school_domain(domain: &str) -> bool {
    (domain == "tsinghua.edu.cn" || domain.ends_with(".tsinghua.edu.cn"))
        && domain.len() <= 253
        && domain.split('.').all(|label| !label.is_empty() && label.len() <= 63
            && !label.starts_with('-') && !label.ends_with('-')
            && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
}
fn snapshot(jar: &SharedNativeJar) -> Result<Snapshot, String> {
    let cookies = jar.0.read().map_err(|_| "AUTH_COOKIE_STORE_UNAVAILABLE")?;
    let revision = jar.epoch();
    let mut cookies: Vec<CookieRecord> = cookies.iter_unexpired().filter_map(|cookie| {
        let (domain, host_only) = match &cookie.domain {
            cookie_store::CookieDomain::HostOnly(domain) => (domain, true),
            cookie_store::CookieDomain::Suffix(domain) => (domain, false),
            _ => return None,
        };
        if !school_domain(domain) { return None; }
        Some(CookieRecord {
            name: cookie.name().into(), value: cookie.value().into(), domain: domain.clone(),
            path: String::from(&cookie.path), host_only, secure: cookie.secure().unwrap_or(false),
            http_only: cookie.http_only().unwrap_or(false),
            expires_at: match &cookie.expires {
                cookie_store::CookieExpiration::SessionEnd => None,
                cookie_store::CookieExpiration::AtUtc(date) => Some((date.unix_timestamp_nanos() / 1_000_000) as i64),
            },
        })
    }).collect();
    cookies.sort_by(|a, b| (&a.domain, &a.path, &a.name).cmp(&(&b.domain, &b.path, &b.name)));
    Ok(Snapshot { revision, cookies })
}
fn candidate(records: Vec<CookieRecord>) -> Result<cookie_store::CookieStore, String> {
    if records.len() > 10_000 { return Err(INVALID.into()); }
    let mut size = 0usize;
    let mut result = cookie_store::CookieStore::default();
    for record in records {
        size = size.saturating_add(record.name.len() + record.value.len() + record.domain.len() + record.path.len());
        let domain = record.domain.trim_start_matches('.').to_ascii_lowercase();
        if size > 4_000_000 || !school_domain(&domain) || record.name.is_empty() || record.name.len() > 1024
            || !record.name.bytes().all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
            || record.value.len() > 65_536 || record.value.bytes().any(|b| b < 0x20 || b == 0x7f || b == b';')
            || !record.path.starts_with('/') || record.path.len() > 16_384
            || record.path.bytes().any(|b| b < 0x20 || b == 0x7f || b == b';') {
            return Err(INVALID.into());
        }
        let origin = reqwest::Url::parse(&format!("https://{domain}/")).map_err(|_| INVALID)?;
        let mut raw = cookie_store::RawCookie::new(record.name, record.value);
        raw.set_path(record.path);
        raw.set_secure(record.secure);
        raw.set_http_only(record.http_only);
        if !record.host_only { raw.set_domain(domain); }
        if let Some(ms) = record.expires_at {
            if !(0..=253_402_300_799_999).contains(&ms) { return Err(INVALID.into()); }
            let expiry = time::OffsetDateTime::from_unix_timestamp_nanos(i128::from(ms) * 1_000_000).map_err(|_| INVALID)?;
            if expiry <= time::OffsetDateTime::now_utc() { continue; }
            raw.set_expires(expiry);
        }
        // These records are a complete, identity-verified native/daemon jar.
        // wrdvpn1- also occurs in valid authenticated HTTP cookies; the separate
        // JS body-seed guard must never be applied to this trusted handoff.
        result.insert_raw(&raw, &origin).map_err(|_| INVALID)?;
    }
    Ok(result)
}
fn replace(jar: &SharedNativeJar, records: Vec<CookieRecord>, expected_revision: u64, path: &Path) -> Result<Revision, String> {
    let next = candidate(records)?;
    let mut current = jar.0.write().map_err(|_| "AUTH_COOKIE_STORE_UNAVAILABLE")?;
    jar.ensure_epoch(expected_revision)?;
    let bytes = serde_json::to_vec(&next.iter_unexpired().collect::<Vec<_>>()).map_err(|_| INVALID)?;
    // Persist first, under the same lock as the account-generation change. A
    // failed disk write leaves the current account's live jar untouched.
    native_security::private_atomic_write(path, &bytes).map_err(|_| "AUTH_HANDOFF_PERSIST_FAILED")?;
    let revision = jar.2.fetch_add(1, Ordering::AcqRel) + 1;
    *current = next;
    jar.1.store(false, Ordering::Relaxed);
    Ok(Revision { revision })
}

#[tauri::command]
pub async fn cli_session_cookies_export(window: tauri::WebviewWindow) -> Result<Snapshot, String> {
    main_only(window.label())?;
    tauri::async_runtime::spawn_blocking(|| snapshot(&NATIVE_JAR_ARC))
        .await.map_err(|_| "AUTH_COOKIE_STORE_UNAVAILABLE")?
}
#[tauri::command]
pub async fn cli_session_cookies_import(app: tauri::AppHandle, window: tauri::WebviewWindow, cookies: Vec<CookieRecord>, expected_revision: u64) -> Result<Revision, String> {
    main_only(window.label())?;
    NATIVE_JAR_ARC.ensure_epoch(expected_revision)?;
    // The token-acquisition webview has its own cookie store. Its old account
    // must not survive a runtime account handoff; callbacks also carry epoch.
    #[cfg(desktop)]
    if let Some(cloud) = app.get_webview_window("cloudtoken") {
        cloud.close().map_err(|_| "AUTH_HANDOFF_WEBVIEW_CLOSE_FAILED")?;
    }
    let path = crate::jar_store_path(&app);
    tauri::async_runtime::spawn_blocking(move || replace(&NATIVE_JAR_ARC, cookies, expected_revision, &path))
        .await.map_err(|_| "AUTH_COOKIE_STORE_UNAVAILABLE")?
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::cookie::CookieStore as _;
    use std::sync::{Arc, RwLock};
    use std::sync::atomic::{AtomicBool, AtomicU64};
    fn jar() -> Arc<SharedNativeJar> { Arc::new(SharedNativeJar(RwLock::new(cookie_store::CookieStore::default()), AtomicBool::new(false), AtomicU64::new(0))) }
    fn file() -> std::path::PathBuf { std::env::temp_dir().join(format!("onethu-cookie-handoff-{}-{}.json", std::process::id(), time::OffsetDateTime::now_utc().unix_timestamp_nanos())) }
    fn record(name: &str, value: &str) -> CookieRecord {
        CookieRecord { name: name.into(), value: value.into(), domain: "webvpn.tsinghua.edu.cn".into(), path: "/".into(), secure: true, host_only: true, http_only: true, expires_at: None }
    }
    #[test]
    fn full_cookie_attributes_and_gateway_ticket_survive_native_handoff() {
        let source = jar();
        source.seed_line("https://webvpn.tsinghua.edu.cn/", "wengine_vpn_ticket=wrdvpn1-verified-fixture; Path=/; Secure; HttpOnly");
        source.seed_line("https://webvpn.tsinghua.edu.cn/https/fixture/course/", "JSESSIONID=campus; Path=/https/fixture/; Secure; Expires=Fri, 01 Jan 2099 00:00:00 GMT");
        source.seed_line("https://id.tsinghua.edu.cn/", "trust=fixture; Domain=tsinghua.edu.cn; Path=/auth; Secure");
        source.seed_line("https://example.com/", "external=excluded; Path=/");
        let exported = snapshot(&source).unwrap(); assert_eq!(exported.cookies.len(), 3);
        let encoded = serde_json::to_value(&exported.cookies).unwrap();
        let destination = jar(); let path = file();
        assert_eq!(replace(&destination, exported.cookies, 0, &path).unwrap().revision, 1);
        assert_eq!(serde_json::to_value(snapshot(&destination).unwrap().cookies).unwrap(), encoded);
        let cookie = destination.cookies(&reqwest::Url::parse("https://webvpn.tsinghua.edu.cn/https/fixture/course/").unwrap()).unwrap();
        assert!(cookie.to_str().unwrap().contains("wengine_vpn_ticket=wrdvpn1-verified-fixture"));
        assert!(cookie.to_str().unwrap().contains("JSESSIONID=campus"));
        assert!(!destination.cookies(&reqwest::Url::parse("https://unrelated.webvpn.tsinghua.edu.cn/").unwrap()).is_some());
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn handoff_replaces_accounts_and_fences_old_request_cookie_writes() {
        let current = jar(); current.seed_line("https://webvpn.tsinghua.edu.cn/", "old-account=old; Path=/");
        let old = crate::EpochNativeJar { jar: Arc::clone(&current), epoch: 0 };
        let path = file();
        replace(&current, vec![record("account", "new")], 0, &path).unwrap();
        let origin = reqwest::Url::parse("https://webvpn.tsinghua.edu.cn/").unwrap();
        let header = reqwest::header::HeaderValue::from_static("account=old-response; Path=/");
        old.set_cookies(&mut [&header].into_iter(), &origin);
        assert!(old.cookies(&origin).is_none());
        let live = current.cookies(&origin).unwrap();
        assert_eq!(live.to_str().unwrap(), "account=new");
        assert!(replace(&current, vec![record("account", "stale")], 0, &path).is_err());
        assert_eq!(current.cookies(&origin).unwrap(), live);
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn invalid_or_unpersistable_snapshot_preserves_the_live_account() {
        let current = jar(); current.seed_line("https://webvpn.tsinghua.edu.cn/", "account=kept; Path=/");
        let path = file();
        let mut external = record("account", "other"); external.domain = "tsinghua.edu.cn.attacker.test".into();
        assert!(replace(&current, vec![external], 0, &path).is_err());
        let mut injected = record("account", "other; Domain=example.com");
        assert!(replace(&current, vec![injected.clone()], 0, &path).is_err());
        injected.value = "other".into(); injected.path = "/\r\nInjected".into();
        assert!(replace(&current, vec![injected], 0, &path).is_err());
        std::fs::write(&path, "fixture parent is a file").unwrap();
        assert!(replace(&current, vec![record("account", "new")], 0, &path.join("child")).is_err());
        assert_eq!(snapshot(&current).unwrap().revision, 0);
        assert_eq!(snapshot(&current).unwrap().cookies[0].value, "kept");
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn private_snapshot_commands_are_main_window_only() {
        assert!(main_only("main").is_ok());
        for label in ["oh-overlay", "cloudtoken", "plugin", ""] { assert!(main_only(label).is_err()); }
    }
}
