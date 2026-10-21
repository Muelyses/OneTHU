// ============================================================
// 通用 WebSocket 宿主桥（ws_bridge）
// ------------------------------------------------------------
// 动机：macOS 26.5 上 tauri/wry 的 WebKit WebView 中，页面级
// WebSocket（含 wss://baidu.com:443）一律秒拒，而 HTTPS 全通
// （实测复现；裸 WKWebView 无此问题；wry 已是锁定最新仍无补丁）。
// 因此把长连接通道下沉到宿主：插件经 facade 的 `ws:external` 门禁
// 调 ws_open/ws_send/ws_recv/ws_close，宿主负责连接生命周期。
// 防失控三件套：按 owner（插件 id）配额、空闲 TTL 清扫、操作即刷活跃时间。
// 文本帧直传，二进制帧走 base64。
// ============================================================

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};
use tokio_tungstenite::tungstenite::Message;

const MAX_SESSIONS_PER_OWNER: usize = 8;
const IDLE_TTL: Duration = Duration::from_secs(600);

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WsOpenArgs {
    /// 调用方插件 id（facade 传入）：配额、清扫与日志归因
    pub owner: String,
    pub url: String,
    /// 附加握手请求头（如 Origin；宿主层无跨源限制）
    #[serde(default)]
    pub headers: Option<std::collections::BTreeMap<String, String>>,
    #[serde(default)]
    pub connect_timeout_ms: Option<u64>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WsOpenOut {
    pub session: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WsFrameOut {
    /// "text" | "binary" | "closed"
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub b64: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WsSendArgs {
    pub session: String,
    /// 文本帧
    #[serde(rename = "text")]
    #[serde(default)]
    pub text: Option<String>,
    /// 二进制帧（base64）
    #[serde(rename = "b64")]
    #[serde(default)]
    pub b64: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WsRecvArgs {
    pub session: String,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WsCloseArgs {
    pub session: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WsCloseOwnerArgs {
    pub owner: String,
}

struct Sess {
    owner: String,
    inbound: mpsc::UnboundedReceiver<WsFrameOut>,
    writer: mpsc::UnboundedSender<Message>,
    last_active: AtomicI64,
    opened_at: Instant,
}

static SESS: OnceLock<Mutex<HashMap<String, Sess>>> = OnceLock::new();
fn sess_map() -> &'static Mutex<HashMap<String, Sess>> {
    SESS.get_or_init(|| Mutex::new(HashMap::new()))
}

static SEQ: AtomicU64 = AtomicU64::new(0);

fn new_session_key(owner: &str) -> String {
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{owner}::{nanos}-{n}")
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

static SWEEPER: OnceLock<()> = OnceLock::new();
fn ensure_sweeper() {
    if SWEEPER.set(()).is_err() {
        return;
    }
    let _ = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let stale: Vec<mpsc::UnboundedSender<Message>> = {
                let mut map = sess_map().lock().unwrap_or_else(|e| e.into_inner());
                let now = now_ms();
                let mut stale = Vec::new();
                for (key, sess) in map.iter() {
                    if now - sess.last_active.load(Ordering::Relaxed) > IDLE_TTL.as_millis() as i64 {
                        stale.push((key.clone(), sess.writer.clone()));
                    }
                }
                for (key, _) in &stale {
                    let _ = map.remove(key).map(|s| s.writer);
                }
                stale.into_iter().map(|(_, w)| w).collect()
            };
            for writer in stale {
                let _ = writer.send(Message::Close(None));
            }
        }
    });
}

/// 宿主桥：建立 WebSocket（可选握手头/连接超时），注册并挂收发泵
#[tauri::command]
pub async fn ws_open(args: WsOpenArgs) -> Result<WsOpenOut, String> {
    ensure_sweeper();

    {
        let map = sess_map().lock().unwrap_or_else(|e| e.into_inner());
        let n = map.values().filter(|s| s.owner == args.owner).count();
        if n >= MAX_SESSIONS_PER_OWNER {
            return Err(format!(
                "会话配额（每插件 {} 条 LV）已满：请先 close 闲置会话",
                MAX_SESSIONS_PER_OWNER
            ));
        }
    }

    let mut req = args
        .url
        .as_str()
        .into_client_request()
        .map_err(|e| format!("ws url 非法：{e}"))?;
    if let Some(headers) = &args.headers {
        for (k, v) in headers {
            let name =
                HeaderName::from_bytes(k.as_bytes()).map_err(|_| format!("请求头名非法：{k}"))?;
            let value = HeaderValue::from_str(v).map_err(|_| format!("请求头值非法：{k}"))?;
            req.headers_mut().insert(name, value);
        }
    }

    let timeout = Duration::from_millis(args.connect_timeout_ms.unwrap_or(10_000).max(1_000));
    let (ws, _resp) = tokio::time::timeout(timeout, tokio_tungstenite::connect_async(req))
        .await
        .map_err(|_| format!("连接超时（{}ms）：{}", timeout.as_millis(), args.url))?
        .map_err(|e| format!("连接失败：{e}"))?;

    let (mut sink, mut stream) = ws.split();
    let (writer_tx, mut writer_rx) = mpsc::unbounded_channel::<Message>();
    let (inbound_tx, inbound_rx) = mpsc::unbounded_channel::<WsFrameOut>();
    let (stop_tx, mut stop_rx) = oneshot::channel::<()>();

    let _ = tokio::spawn(async move {
        loop {
            tokio::select! {
                inbound = stream.next() => {
                    match inbound {
                        Some(Ok(Message::Text(text))) => {
                            if inbound_tx.send(WsFrameOut { kind: "text".into(), text: Some(text), b64: None }).is_err() { break; }
                        }
                        Some(Ok(Message::Binary(bin))) => {
                            let b64 = base64::engine::general_purpose::STANDARD.encode(&bin);
                            if inbound_tx.send(WsFrameOut { kind: "binary".into(), text: None, b64: Some(b64) }).is_err() { break; }
                        }
                        Some(Ok(Message::Ping(payload))) => {
                            let _ = sink.send(Message::Pong(payload)).await;
                        }
                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                            let _ = inbound_tx.send(WsFrameOut { kind: "closed".into(), text: None, b64: None });
                            break;
                        }
                        Some(Ok(_)) => {}
                    }
                }
                out = writer_rx.recv() => {
                    match out {
                        Some(msg) => {
                            if sink.send(msg).await.is_err() {
                                let _ = inbound_tx.send(WsFrameOut { kind: "closed".into(), text: None, b64: None });
                                break;
                            }
                        }
                        None => break,
                    }
                }
                _ = &mut stop_rx => {
                    let _ = sink.close().await;
                    break;
                }
            }
        }
    });

    let session = new_session_key(&args.owner);
    sess_map().lock().unwrap_or_else(|e| e.into_inner()).insert(
        session.clone(),
        Sess {
            owner: args.owner,
            inbound: inbound_rx,
            writer: writer_tx,
            last_active: AtomicI64::new(now_ms()),
            opened_at: Instant::now(),
        },
    );
    Ok(WsOpenOut { session })
}

#[tauri::command]
pub async fn ws_send(args: WsSendArgs) -> Result<(), String> {
    let msg = if let Some(text) = &args.text {
        Message::Text(text.clone())
    } else if let Some(b64) = &args.b64 {
        Message::Binary(
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| format!("b64 解码失败：{e}"))?,
        )
    } else {
        return Err("ws_send 需要 text 或 b64 之一".into());
    };
    key_send(args.session, msg)
}

fn key_send(key: String, msg: Message) -> Result<(), String> {
    let mut map = sess_map().lock().unwrap_or_else(|e| e.into_inner());
    let sess = map.get_mut(&key).ok_or("会话不存在（可能已被清扫/关闭）")?;
    sess.writer.send(msg).map_err(|_| "会话已关闭".to_string())?;
    sess.last_active.store(now_ms(), Ordering::Relaxed);
    Ok(())
}

/// 拉一帧（阻塞至超时；超时会把会话放回注册表，避免跨 await 持锁）
#[tauri::command]
pub async fn ws_recv(args: WsRecvArgs) -> Result<WsFrameOut, String> {
    let key = args.session.clone();
    let mut sess = {
        let mut map = sess_map().lock().unwrap_or_else(|e| e.into_inner());
        map.remove(&key).ok_or("会话不存在（可能已被清扫/关闭）")?
    };
    sess.last_active.store(now_ms(), Ordering::Relaxed);
    let timeout = Duration::from_millis(args.timeout_ms.unwrap_or(10_000).max(50));
    let out = match tokio::time::timeout(timeout, sess.inbound.recv()).await {
        Ok(Some(frame)) => frame,
        Ok(None) => WsFrameOut { kind: "closed".into(), text: None, b64: None },
        Err(_) => {
            {
                let mut map = sess_map().lock().unwrap_or_else(|e| e.into_inner());
                map.insert(key, sess);
            }
            return Err("recv 超时".into());
        }
    };
    let closed = out.kind == "closed";
    if closed {
        let _ = sess.writer.send(Message::Close(None));
    } else {
        let mut map = sess_map().lock().unwrap_or_else(|e| e.into_inner());
        map.insert(key, sess);
    }
    Ok(out)
}

#[tauri::command]
pub async fn ws_close(args: WsCloseArgs) -> Result<(), String> {
    let sess = sess_map()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&args.session)
        .ok_or("会话不存在")?;
    let _ = sess.writer.send(Message::Close(None));
    Ok(())
}

/// 插件停用/卸载时批量清场（facade 在 dispose 处调用）
#[tauri::command]
pub async fn ws_close_owner(args: WsCloseOwnerArgs) -> Result<usize, String> {
    let stale: Vec<mpsc::UnboundedSender<Message>> = {
        let mut map = sess_map().lock().unwrap_or_else(|e| e.into_inner());
        let prefix = format!("{}::", args.owner);
        let keys: Vec<String> = map.keys().filter(|k| k.starts_with(&prefix)).cloned().collect();
        keys.iter().filter_map(|k| map.remove(k).map(|s| s.writer)).collect()
    };
    let n = stale.len();
    for writer in stale {
        let _ = writer.send(Message::Close(None));
    }
    Ok(n)
}

// —— 兼容旧调用：本次改造保留的旧接口（douyu_bridge 仍独立存在） ——
