//! Rust 骨干插件宿主（sidecar 进程 + JSON-RPC over stdio）
//!
//! 课程作业 R1：插件的核心业务逻辑（agent 主控循环、LLM API 调用编排、
//! 工具循环、token 统计）必须用 Rust 写。宿主把这类插件作为独立进程拉起：
//!   host → plugin（stdin） ：activate / run / dispose 请求、interrupt 通知
//!   plugin → host（stdout）：onethu.call 请求（经事件转发 webview 门面，权限集中门禁）、
//!                            progress / log 通知、host 请求的应答
//! stderr 逐行作为 log 事件转发（eprintln! 调试直通 UI）。
//!
//! 协议见 docs/OneTHU-插件与接口指南.md「Rust 骨干插件」。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::oneshot;

type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

/// 一个在跑的插件进程：IO 句柄 + host 侧调用应答表
struct ProcIo {
    child: Mutex<Option<Child>>,
    /// tokio Mutex：stdin 写入跨 await（async-aware，Send 无虞）
    stdin: tokio::sync::Mutex<tokio::process::ChildStdin>,
    pending: PendingMap,
}

/// A webview reply belongs to the exact process that emitted the request. A
/// restarted sidecar commonly reuses its JSON-RPC IDs, so plugin_id + id alone
/// cannot route a delayed reply safely.
struct ForwardedRequest {
    plugin_id: String,
    proc: Weak<ProcIo>,
    original_id: Value,
    created: Instant,
}

/// 全部在跑的 Rust 插件进程
#[derive(Default)]
pub struct PluginHost {
    procs: Mutex<HashMap<String, Arc<ProcIo>>>,
    /// Serializes remove/kill/spawn/insert across await points. Otherwise two
    /// concurrent activations can overwrite one entry and leave an orphan.
    lifecycle: tokio::sync::Mutex<()>,
    forwarded: Mutex<HashMap<u64, ForwardedRequest>>,
    next_id: AtomicU64,
}

impl PluginHost {
    fn is_current(&self, plugin_id: &str, proc: &Arc<ProcIo>) -> bool {
        self.procs.lock().ok().is_some_and(|map|
            map.get(plugin_id).is_some_and(|current| Arc::ptr_eq(current, proc)))
    }

    fn forward(&self, plugin_id: &str, proc: &Arc<ProcIo>, original_id: Value) -> Result<u64, String> {
        if !self.is_current(plugin_id, proc) { return Err("插件实例已更换".into()); }
        let mut requests = self.forwarded.lock().map_err(|_| "插件回执锁中毒")?;
        // A reloaded/crashed webview cannot return old replies. Bound their
        // lifetime without retaining a strong reference to an exited child.
        requests.retain(|_, request| request.created.elapsed() < Duration::from_secs(660)
            && request.proc.strong_count() > 0);
        if requests.len() >= 4096 { return Err("插件等待中的请求过多".into()); }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        requests.insert(id, ForwardedRequest {
            plugin_id: plugin_id.into(), proc: Arc::downgrade(proc), original_id, created: Instant::now(),
        });
        Ok(id)
    }

    fn take_reply(&self, plugin_id: &str, id: &Value) -> Result<(Arc<ProcIo>, Value), String> {
        let id = id.as_u64().ok_or("插件回执 ID 无效")?;
        let mut requests = self.forwarded.lock().map_err(|_| "插件回执锁中毒")?;
        if !requests.get(&id).is_some_and(|request| request.plugin_id == plugin_id) {
            return Err("插件回执已过期或不属于此插件".into());
        }
        let request = requests.remove(&id).ok_or("插件回执已过期")?;
        drop(requests);
        let proc = request.proc.upgrade().ok_or("插件实例已退出")?;
        if !self.is_current(plugin_id, &proc) { return Err("插件实例已更换".into()); }
        Ok((proc, request.original_id))
    }

    fn discard_replies(&self, proc: &Arc<ProcIo>) {
        if let Ok(mut requests) = self.forwarded.lock() {
            requests.retain(|_, request| !Weak::ptr_eq(&request.proc, &Arc::downgrade(proc)));
        }
        if let Ok(mut pending) = proc.pending.lock() {
            for (_, reply) in pending.drain() { let _ = reply.send(Err("插件实例已退出".into())); }
        }
    }
}

async fn spawn_process(
    state: &PluginHost, plugin_id: &str, path: &std::path::Path, args: Vec<String>,
) -> Result<(Arc<ProcIo>, tokio::process::ChildStdout, tokio::process::ChildStderr), String> {
    let _lifecycle = state.lifecycle.lock().await;
    plugin_kill_inner(state, plugin_id).await;
    let mut cmd = Command::new(path);
    cmd.args(args)
        // Includes cancellation or pipe/setup errors before registry insertion.
        .kill_on_drop(true)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let mut child = cmd.spawn().map_err(|e| format!("插件进程启动失败：{e}"))?;
    let stdin = child.stdin.take().ok_or("无法取得插件 stdin")?;
    let stdout = child.stdout.take().ok_or("无法取得插件 stdout")?;
    let stderr = child.stderr.take().ok_or("无法取得插件 stderr")?;
    let proc = Arc::new(ProcIo {
        child: Mutex::new(Some(child)), stdin: tokio::sync::Mutex::new(stdin),
        pending: Arc::new(Mutex::new(HashMap::new())),
    });
    state.procs.lock().map_err(|_| "宿主状态锁中毒")?.insert(plugin_id.into(), proc.clone());
    Ok((proc, stdout, stderr))
}

#[tauri::command]
pub async fn plugin_spawn(
    window: tauri::WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, PluginHost>,
    plugin_id: String,
    bin_path: String,
    args: Option<Vec<String>>,
) -> Result<(), String> {
    require_plugin_main_window(window.label())?;
    let path = crate::native_security::plugin_binary(&crate::plugins_root(&app)?,
        &plugin_id, &PathBuf::from(&bin_path))?;
    let (proc, stdout, stderr) = spawn_process(&state, &plugin_id, &path, args.unwrap_or_default()).await?;

    // stderr → log 事件（Rust eprintln! 直达 UI）
    {
        let app = app.clone();
        let pid = plugin_id.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    "plugin-event",
                    json!({"pluginId": pid, "method": "log", "params": {"line": line}}),
                );
            }
        });
    }

    // stdout：JSON-RPC 分发
    {
        let app = app.clone();
        let pid = plugin_id.clone();
        let host = app.clone();
        let original_proc = proc.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                let msg: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => {
                        // 非 JSON 行当日志（原型期 println! 直通）
                        let _ = app.emit(
                            "plugin-event",
                            json!({"pluginId": pid, "method": "log", "params": {"line": line}}),
                        );
                        continue;
                    }
                };
                let id = msg.get("id").cloned();
                let method = msg.get("method").and_then(|m| m.as_str()).map(String::from);
                if method.is_none() {
                    // host 发起调用的应答
                    if let Some(tx) = id.as_ref().and_then(|i| i.as_u64()).and_then(|i| {
                        original_proc.pending.lock().ok().and_then(|mut map| map.remove(&i))
                    }) {
                        let outcome = if let Some(e) = msg.get("error") {
                            Err(e.to_string())
                        } else {
                            Ok(msg.get("result").cloned().unwrap_or(Value::Null))
                        };
                        let _ = tx.send(outcome);
                    }
                    continue;
                }
                let method = method.unwrap();
                let params = msg.get("params").cloned().unwrap_or(Value::Null);
                // A replaced process can still have buffered output. It no
                // longer gets to invoke the current webview's services.
                if !host.state::<PluginHost>().is_current(&pid, &original_proc) { continue; }
                if id.is_some() {
                    // R9：storage.* 宿主文件直答——大 payload（整个会话库）会被 webview IPC
                    // 上限静默吞掉（emit/invoke 双侧都吞错），表现为桥调用永远等超时。
                    // 存储是最高频+最大载荷的桥调用，理应由宿主本地文件承接。
                    let ns = params.get("ns").and_then(|v| v.as_str()).unwrap_or("");
                    if method == "onethu.call" && ns == "storage" {
                        let m = params.get("method").and_then(|v| v.as_str()).unwrap_or("");
                        let args = params.get("args").cloned().unwrap_or(Value::Array(vec![]));
                        let result = storage_call(&app, &pid, m, args);
                        let response = match result {
                            Ok(value) => json!({"jsonrpc": "2.0", "id": id, "result": value}),
                            Err(error) => json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32001, "message": error}}),
                        };
                        let _ = write_line(&original_proc, &response).await;
                        continue;
                    }
                    // 其余 onethu.call：转 webview 门面执行后回写
                    let forwarded_id = match host.state::<PluginHost>().forward(
                        &pid, &original_proc, id.clone().unwrap_or(Value::Null),
                    ) {
                        Ok(id) => id,
                        Err(error) => {
                            let _ = write_line(&original_proc, &json!({"jsonrpc": "2.0", "id": id,
                                "error": {"code": -32001, "message": error}})).await;
                            continue;
                        }
                    };
                    let _ = app.emit_to(
                        "main",
                        "plugin-rpc",
                        json!({"pluginId": pid, "id": forwarded_id, "method": method, "params": params}),
                    );
                    let rid_disp = id
                        .as_ref()
                        .and_then(|v| v.as_i64())
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| "?".into());
                    let _ = app.emit(
                        "plugin-event",
                        json!({"pluginId": pid, "method": "log", "params": {"line": format!("[BRIDGE] ->门面 #{rid_disp} {method}")}}),
                    );
                } else {
                    // 通知（progress/log/history 等）→ 直转 UI
                    let _ = app.emit("plugin-event", json!({"pluginId": pid, "method": method, "params": params}));
                }
            }
            // stdout 关闭 = 进程退出：摘表 + 通知 UI
            let removed = host.state::<PluginHost>().procs.lock().ok().and_then(|mut map| {
                if map.get(&pid).is_some_and(|current| Arc::ptr_eq(current, &original_proc)) { map.remove(&pid) }
                else { None }
            });
            host.state::<PluginHost>().discard_replies(&original_proc);
            if removed.is_some() {
                let _ = app.emit("plugin-event", json!({"pluginId": pid, "method": "exit", "params": {}}));
            }
        });
    }

    let _ = app.emit(
        "plugin-event",
        json!({"pluginId": plugin_id, "method": "spawned", "params": {"bin": bin_path}}),
    );
    Ok(())
}

/// 宿主侧插件存储：app_data/plugin-storage/<pluginId>.json 单文件 KV。
/// 只服务 stdio 插件的 storage.* 桥调用（读循环内直答，毫秒级、无 IPC 上限）。
fn storage_call(app: &tauri::AppHandle, pid: &str, method: &str, args: Value) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("plugin-storage");
    storage_call_at(&dir, pid, method, args)
}

fn storage_call_at(dir: &std::path::Path, pid: &str, method: &str, args: Value) -> Result<Value, String> {
    use std::collections::BTreeMap;
    crate::native_security::plugin_id(pid)?;
    crate::native_security::confined_path(dir, std::path::Path::new(""))?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let file = crate::native_security::confined_path(dir, std::path::Path::new(&format!("{pid}.json")))?;
    let mut map: BTreeMap<String, Value> = match std::fs::read_to_string(&file) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("插件存储损坏，未覆盖：{e}"))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
        Err(error) => return Err(format!("读取插件存储失败：{error}")),
    };
    match method {
        "get" => Ok(map.get(args.get(0).and_then(Value::as_str).ok_or("storage.get 缺少 key")?)
            .cloned().unwrap_or(Value::Null)),
        "set" | "remove" => {
            let key = args.get(0).and_then(Value::as_str).ok_or("storage 缺少 key")?;
            if method == "set" { map.insert(key.to_string(), args.get(1).cloned().unwrap_or(Value::Null)); }
            else { map.remove(key); }
            let body = serde_json::to_vec(&map).map_err(|e| e.to_string())?;
            crate::native_security::private_atomic_write(&file, &body)?;
            Ok(Value::Null)
        }
        "keys" => Ok(json!(map.keys().cloned().collect::<Vec<String>>())),
        _ => Err("未知插件存储方法".into()),
    }
}

#[cfg(test)]
mod storage_security_tests {
    use super::*;
    #[test]
    fn errors_are_reported_and_corrupt_content_is_preserved() {
        let root = std::env::temp_dir().join(format!("onethu-storage-security-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        storage_call_at(&root, "sample", "set", json!(["key", {"value": 1}])).unwrap();
        assert_eq!(storage_call_at(&root, "sample", "get", json!(["key"])).unwrap(), json!({"value": 1}));
        assert!(storage_call_at(&root, "../escape", "set", json!(["key", 1])).is_err());
        std::fs::write(root.join("sample.json"), "{corrupt").unwrap();
        assert!(storage_call_at(&root, "sample", "set", json!(["key", 2])).is_err());
        assert_eq!(std::fs::read_to_string(root.join("sample.json")).unwrap(), "{corrupt");
        assert!(storage_call_at(&root.join("sample.json"), "other", "set", json!(["key", 1])).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}

async fn write_line(proc: &Arc<ProcIo>, line: &Value) -> Result<(), String> {
    let mut s = serde_json::to_string(line).map_err(|e| e.to_string())?;
    s.push('\n');
    let mut stdin = proc.stdin.lock().await;
    stdin
        .write_all(s.as_bytes())
        .await
        .map_err(|e| format!("插件 stdin 写入失败：{e}"))
}

#[tauri::command]
pub async fn plugin_call(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, PluginHost>,
    plugin_id: String,
    method: String,
    params: Value,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    require_plugin_client_window(window.label(), &plugin_id, &method, false)?;
    if plugin_id == "onethu.harness" && method == "run" { crate::privacy_consent::require_oh()?; }
    let proc = state
        .procs
        .lock()
        .map_err(|_| "宿主状态锁中毒")?
        .get(&plugin_id)
        .cloned()
        .ok_or(format!("插件进程未运行：{plugin_id}"))?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    proc.pending
        .lock()
        .map_err(|_| "应答表锁中毒")?
        .insert(id, tx);
    if let Err(error) = write_line(
        &proc,
        &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}),
    )
    .await {
        proc.pending.lock().ok().and_then(|mut map| map.remove(&id));
        return Err(error);
    }
    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(600_000));
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(res)) => res,
        Ok(Err(_)) => Err("插件应答通道关闭（进程退出？）".into()),
        Err(_) => {
            proc.pending.lock().ok().and_then(|mut m| m.remove(&id));
            Err(format!("插件调用超时（{method}）"))
        }
    }
}

#[tauri::command]
pub async fn plugin_notify(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, PluginHost>,
    plugin_id: String,
    method: String,
    params: Value,
) -> Result<(), String> {
    require_plugin_client_window(window.label(), &plugin_id, &method, true)?;
    let proc = state
        .procs
        .lock()
        .map_err(|_| "宿主状态锁中毒")?
        .get(&plugin_id)
        .cloned()
        .ok_or(format!("插件进程未运行：{plugin_id}"))?;
    write_line(&proc, &json!({"jsonrpc": "2.0", "method": method, "params": params})).await
}

/// webview 门面执行完 onethu.call 后回写结果给插件
#[tauri::command]
pub async fn plugin_rpc_reply(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, PluginHost>,
    app: tauri::AppHandle,
    plugin_id: String,
    id: Value,
    ok: bool,
    result: Value,
) -> Result<(), String> {
    require_plugin_main_window(window.label())?;
    let _ = app.emit(
        "plugin-event",
        json!({"pluginId": plugin_id, "method": "log", "params": {"line": format!("[BRIDGE] <-门面 #{id} ok={ok}")}}),
    );
    let (proc, original_id) = state.take_reply(&plugin_id, &id)?;
    if ok {
        write_line(&proc, &json!({"jsonrpc": "2.0", "id": original_id, "result": result})).await
    } else {
        write_line(&proc, &json!({"jsonrpc": "2.0", "id": original_id, "error": {"code": -32000, "message": result}})).await
    }
}

/// Caller holds lifecycle for the entire replacement, including this await.
async fn plugin_kill_inner(state: &PluginHost, plugin_id: &str) {
    let proc = state
        .procs
        .lock()
        .ok()
        .and_then(|mut m| m.remove(plugin_id));
    if let Some(proc) = proc {
        state.discard_replies(&proc);
        let child = proc.child.lock().ok().and_then(|mut child| child.take());
        if let Some(mut child) = child { let _ = child.kill().await; }
    }
}

#[tauri::command]
pub async fn plugin_kill(window: tauri::WebviewWindow, state: tauri::State<'_, PluginHost>, plugin_id: String) -> Result<(), String> {
    require_plugin_main_window(window.label())?;
    let _lifecycle = state.lifecycle.lock().await;
    plugin_kill_inner(&state, &plugin_id).await;
    Ok(())
}

/// The main webview owns lifecycle and host callbacks. The OH orb can submit a
/// run/interrupt to that shared process without taking ownership of its facade.
pub(crate) fn require_plugin_main_window(label: &str) -> Result<(), String> {
    if label == "main" { Ok(()) } else { Err("PLUGIN_MAIN_WINDOW_REQUIRED".into()) }
}

pub(crate) fn require_plugin_client_window(label: &str, plugin_id: &str, method: &str, notification: bool) -> Result<(), String> {
    if label == "main" || (label == "oh-orb" && plugin_id == "onethu.harness"
        && ((!notification && method == "run") || (notification && method == "interrupt"))) {
        Ok(())
    } else {
        Err("PLUGIN_MAIN_WINDOW_REQUIRED".into())
    }
}

#[cfg(test)]
mod window_ownership_tests {
    use super::*;
    #[test]
    fn only_main_owns_plugin_lifecycle_and_replies() {
        assert!(require_plugin_main_window("main").is_ok());
        for label in ["oh-orb", "overlay", "main-2", ""] {
            assert!(require_plugin_main_window(label).is_err());
        }
    }
    #[test]
    fn orb_can_call_shared_oh_without_replacing_its_host() {
        assert!(require_plugin_client_window("oh-orb", "onethu.harness", "run", false).is_ok());
        assert!(require_plugin_client_window("oh-orb", "onethu.harness", "interrupt", true).is_ok());
        for method in ["activate", "dispose", "mcp_sync", "settings", "run"] {
            assert!(require_plugin_client_window("oh-orb", "onethu.harness", method, true).is_err());
        }
        for (label, plugin, method) in [("other", "onethu.harness", "run"), ("oh-orb", "third.party", "run"), ("oh-orb", "onethu.harness", "dispose")] {
            assert!(require_plugin_client_window(label, plugin, method, false).is_err());
        }
        assert!(require_plugin_client_window("main", "third.party", "activate", false).is_ok());
    }
}

#[cfg(all(test, unix))]
mod process_lifecycle_tests {
    use super::*;

    async fn start(host: &PluginHost) -> Arc<ProcIo> {
        spawn_process(host, "test.echo", std::path::Path::new("/bin/cat"), vec![]).await.unwrap().0
    }

    async fn stop(host: &PluginHost) {
        let _guard = host.lifecycle.lock().await;
        plugin_kill_inner(host, "test.echo").await;
    }

    #[tokio::test]
    async fn concurrent_replacement_keeps_exactly_one_owned_process() {
        let host = Arc::new(PluginHost::default());
        let initial = start(&host).await;
        let mut tasks = Vec::new();
        for _ in 0..12 {
            let host = host.clone();
            tasks.push(tokio::spawn(async move { start(&host).await }));
        }
        let mut processes = vec![initial];
        for task in tasks { processes.push(task.await.unwrap()); }
        assert_eq!(host.procs.lock().unwrap().len(), 1);
        assert_eq!(processes.iter().filter(|proc| proc.child.lock().unwrap().is_some()).count(), 1,
            "every replaced process must be killed/reaped, not just overwritten in the registry");
        stop(&host).await;
        assert!(processes.iter().all(|proc| proc.child.lock().unwrap().is_none()));
    }

    #[tokio::test]
    async fn late_replies_cannot_reach_a_new_process_with_reused_rpc_id() {
        let host = PluginHost::default();
        let old = start(&host).await;
        let old_id = host.forward("test.echo", &old, json!(1)).unwrap();
        let current = start(&host).await;
        let new_id = host.forward("test.echo", &current, json!(1)).unwrap();
        assert_ne!(old_id, new_id);
        assert!(host.take_reply("test.echo", &json!(old_id)).is_err());
        assert!(host.forward("test.echo", &old, json!(2)).is_err());
        assert!(host.take_reply("other.plugin", &json!(new_id)).is_err());
        let (target, original_id) = host.take_reply("test.echo", &json!(new_id)).unwrap();
        assert!(Arc::ptr_eq(&target, &current));
        assert_eq!(original_id, json!(1));
        assert!(host.take_reply("test.echo", &json!(new_id)).is_err());
        stop(&host).await;
    }

    #[tokio::test]
    async fn replacing_process_settles_host_calls_and_discards_webview_replies() {
        let host = PluginHost::default();
        let old = start(&host).await;
        let (sender, response) = oneshot::channel();
        old.pending.lock().unwrap().insert(10, sender);
        host.forward("test.echo", &old, json!(2)).unwrap();
        let _current = start(&host).await;
        assert!(response.await.unwrap().is_err());
        assert!(old.pending.lock().unwrap().is_empty());
        assert!(host.forwarded.lock().unwrap().is_empty());
        stop(&host).await;
    }
}
