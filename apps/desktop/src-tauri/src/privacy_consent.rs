//! Device-local consent; independent of cloud/profile state. Missing/corrupt = denied.
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
static CLOUD: AtomicBool = AtomicBool::new(false);
static OH: AtomicBool = AtomicBool::new(false);
#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Consent { pub acknowledged: bool, pub cloud: bool, pub oh: bool }
fn normalize(mut value: Consent) -> Consent {
    value.cloud &= value.acknowledged;
    value.oh &= value.acknowledged;
    value
}
fn publish(value: &Consent) { CLOUD.store(value.cloud, Ordering::SeqCst); OH.store(value.oh, Ordering::SeqCst); }
fn path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("privacy-consent-v1.json"))
}
pub fn init<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Consent {
    let value = path(app).ok().and_then(|p| std::fs::read(p).ok())
        .and_then(|raw| serde_json::from_slice::<Consent>(&raw).ok()).map(normalize).unwrap_or_default();
    publish(&value); value
}
#[tauri::command]
pub fn privacy_consent_read<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Consent { init(&app) }
#[tauri::command]
pub fn privacy_consent_write<R: tauri::Runtime>(app: tauri::AppHandle<R>, window: tauri::WebviewWindow<R>, consent: Consent) -> Result<(), String> {
    if window.label() != "main" { return Err("Consent can only be changed in the main window".into()); }
    let consent = normalize(consent);
    // Fail closed even if persisting a revocation fails.
    if !consent.cloud { CLOUD.store(false, Ordering::SeqCst); }
    if !consent.oh { OH.store(false, Ordering::SeqCst); }
    let p = path(&app)?;
    if let Some(parent) = p.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    crate::native_security::private_atomic_write(&p, &serde_json::to_vec(&consent).map_err(|e| e.to_string())?)?;
    publish(&consent);
    Ok(())
}
pub fn require_cloud() -> Result<(), String> {
    if CLOUD.load(Ordering::SeqCst) { Ok(()) } else { Err("Cloud access is disabled. Review Permissions & privacy in the guide. / 云盘未授权，请在导览的权限须知中修改。".into()) }
}
pub fn require_oh() -> Result<(), String> {
    if OH.load(Ordering::SeqCst) { Ok(()) } else { Err("OH is disabled. Review Permissions & privacy in the guide. / OH 未授权，请在导览的权限须知中修改。".into()) }
}
/// Covers generic HTTP paths as well as the dedicated Seafile API. Public release
/// downloads remain usable without authorizing access to a personal cloud account.
pub fn check_url(url: &url::Url) -> Result<(), String> {
    let vpn_cloud = url.host_str() == Some("webvpn.tsinghua.edu.cn") && url.path().split('/').any(|part| part == "77726476706e69737468656265737421f3fb4e89237e7c4377068ea48d546d3081cded7756");
    if vpn_cloud { require_cloud()?; }
    if url.host_str().map(|h| h == "cloud.tsinghua.edu.cn" || h.ends_with(".cloud.tsinghua.edu.cn")).unwrap_or(false) {
        if !is_public_release(url) { require_cloud()?; }
    }
    Ok(())
}
pub fn is_public_release(url: &url::Url) -> bool {
    const RELEASE: &str = "56f78a2a0b144a6ab737";
    url.scheme() == "https" && url.host_str() == Some("cloud.tsinghua.edu.cn")
        && (url.path().starts_with(&format!("/d/{RELEASE}/")) || url.path().starts_with(&format!("/api/v2.1/share-links/{RELEASE}/")))
}
pub fn public_release_destination(url: &url::Url) -> bool {
    is_public_release(url) || url.scheme() == "https" && url.host_str() == Some("cloud.tsinghua.edu.cn") && url.path().starts_with("/seafhttp/files/")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn unacknowledged_grants_are_rejected() {
        let c = normalize(Consent { acknowledged:false,cloud:true,oh:true }); assert!(!c.cloud && !c.oh);
    }
    #[test] fn missing_fields_are_denied() {
        let c: Consent=serde_json::from_str("{}").unwrap(); assert!(!c.acknowledged && !c.cloud && !c.oh);
    }
    #[test] fn denial_blocks_private_but_not_release() {
        CLOUD.store(false, Ordering::SeqCst);
        assert!(check_url(&"https://cloud.tsinghua.edu.cn/api2/repos/".parse().unwrap()).is_err());
        assert!(check_url(&"https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/files/".parse().unwrap()).is_ok());
        assert!(check_url(&"https://webvpn.tsinghua.edu.cn/https/77726476706e69737468656265737421f3fb4e89237e7c4377068ea48d546d3081cded7756/profile/".parse().unwrap()).is_err());
        assert!(check_url(&"https://learn.tsinghua.edu.cn/".parse().unwrap()).is_ok());
    }
}
