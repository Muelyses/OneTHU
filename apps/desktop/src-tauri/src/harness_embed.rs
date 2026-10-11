//! OneTHU Harness 内嵌宿主（移动端形态）：Rust 骨干核心（onethu-harness-core）
//! 直接编进 App 进程，不经 sidecar 进程——Android 无任意路径二进制执行权限。
//!
//! - `Host`（onethu.call 数据面 + 打断标志）：经 Tauri 事件桥转发 webview 门面执行，
//!   权限门禁与 sidecar/js 插件完全同一套（webview 侧 bindRustApi）；
//! - `Emit`（progress/log 通知）：app.emit("plugin-event") 直达 UI，事件契约与
//!   sidecar 泵（plugins.rs）逐字段一致；
//! - 会话/设置存储仍落 webview localStorage（storage.* 走同一桥）。
//!
//! 线程模型：agent 线程串行处理 run 请求（chat 一轮跑完才接下一发）；
//! 桥线程专等 webview 回执；打断是 AtomicBool 快路径（stdio 读线程同款语义）。
//!
//! ## 数据面缓存（2026-10-11 结构性修复：webview 挂起不再打断对话）
//! 内嵌数据面原先**强依赖本体 webview 实时应答**——用户在别的应用里用悬浮层发消息时，
//! 主 webview 已挂起（JS 停摆），连 `settings.get` 都拿不到回执，15s 后整轮 chat 以
//! 「读取设置失败」告终（真机日志 08:32:35 / 08:34:51 两次，都是精确 15.0xx s）。
//! 现在：门面正常应答时顺手把结果写进缓存（内存 + app_data_dir 小 JSON，启动载入）；
//! **可缓存读**（settings.get / storage.get）只等 1.8s，超时立刻用缓存回答（调用仍在后台
//! 继续，回来写穿缓存）；**写**（storage.set）超时先落 pending、门面回来后带**基准比对**
//! 回写（期间被别处改过就丢弃，绝不覆盖新数据）。工具面是真·实时数据，照旧实时调用。

use onethu_harness_core::{activate_commands, dispatch_run, Emit, Host};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// 门面回执等待上限（**非缓存**调用：工具面等真·实时数据，或需要门面在场才敢做的动作）
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(15);
/// **可缓存读**的等待上限：webview 挂起（用户切到别的应用、JS 停摆）时不能干等 15s。
/// 1.8s 无应答 = 按「门面不在场」处理 → 立刻用宿主缓存回答；调用本身仍在后台继续
/// （桥线程照旧等满 BRIDGE_TIMEOUT），应答回来时写穿缓存，下一次更准。
const CACHE_READ_TIMEOUT: Duration = Duration::from_millis(1800);
/// 写操作（storage.set）的等待上限：超时 → 落 pending（门面回来后回写），不阻塞本轮对话
const CACHE_WRITE_TIMEOUT: Duration = Duration::from_millis(1800);
/// 缓存文件（app_data_dir 下的小 JSON）。**只落小对象**：会话 blob 上限 1.2MB，只留内存
/// （进程冷启时 webview 必然在场——就是它拉起 harness 的——读得到实时值）。
const CACHE_FILE: &str = "harness-data-cache.json";
const CACHE_FILE_MAX_ENTRY: usize = 64 * 1024;
/// pending 回写的最大尝试次数（防长期挂着的条目无限累积）
const MAX_FLUSH_ATTEMPTS: u32 = 20;

type PendingMap = Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>;

/// 缓存键：`ns.method|<args 的紧凑 JSON>`（args 参与键，`storage.get(["harness.v1"])`
/// 与别的 key 天然分开）
fn cache_key(ns: &str, method: &str, args: &Value) -> String {
    format!("{ns}.{method}|{}", serde_json::to_string(args).unwrap_or_default())
}

/// 可缓存读：只有「宿主自用配置 / 会话」这类对象能缓存。
/// 工具面（课表/成绩/邮件/座位/空教室…）是**真·实时数据**，缓存等于对模型说谎 → 照旧实时调。
fn is_cache_read(ns: &str, method: &str) -> bool {
    matches!((ns, method), ("settings", "get") | ("storage", "get"))
}

/// 缓存的写条目：值已是最新（同键多次覆盖自动合并），但仍欠门面一次真实写入
struct PendingWrite {
    ns: String,
    method: String,
    /// 完整入参（storage.set 形如 `[key, value]`）
    args: Value,
    /// **我们覆盖之前的该键值**（提交时刻的基准；重试不许刷新它）——
    /// 回写前拿它跟实时值比对：不等于实时值 = 期间被别处改过 → 丢弃，不覆盖新数据。
    before: Option<Value>,
    /// 回写时用来实时读一眼现状的缓存键（`storage.get|["harness.v1"]`）
    read_key: String,
    attempts: u32,
}

/// 数据面缓存（见文件头）。所有方法都容忍锁中毒（`into_inner`），不 panic。
struct DataCache {
    /// 缓存键 → 最近一次门面成功应答
    entries: Mutex<HashMap<String, Value>>,
    /// 待回写的写操作（键 = cache_key，同键合并且以最新入参为准）
    pending: Mutex<HashMap<String, PendingWrite>>,
    path: Option<PathBuf>,
    /// 回写线程去重（同一时刻只跑一个 flush）
    flushing: AtomicBool,
    /// 门面连续无响应次数 / 累计成功次数——只用于诊断文案
    misses: AtomicU64,
    oks: AtomicU64,
    /// UI 日志通道（可后置注入）：缓存命中/降级/回写都往「插件日志」写一行——
    /// stderr 只在 logcat 里，用户导出的日志拿不到；真机取证全靠这个通道。
    emit: Mutex<Option<Arc<AgentEmit>>>,
}

impl DataCache {
    /// 启动时载入（文件不存在/坏了都只是空缓存，绝不拦路）
    fn load(app: &AppHandle) -> Arc<DataCache> {
        let path = app.path().app_data_dir().ok().map(|d| d.join(CACHE_FILE));
        let mut entries: HashMap<String, Value> = HashMap::new();
        if let Some(p) = &path {
            if let Ok(raw) = std::fs::read_to_string(p) {
                match serde_json::from_str::<Value>(&raw) {
                    Ok(v) => {
                        if let Some(obj) = v.get("entries").and_then(|e| e.as_object()) {
                            for (k, val) in obj {
                                entries.insert(k.clone(), val.clone());
                            }
                        }
                    }
                    Err(e) => eprintln!("[harness:embedded] 数据面缓存文件解析失败（按空缓存继续）：{e}"),
                }
            }
        }
        eprintln!(
            "[harness:embedded] 数据面缓存载入：{} 条 · {:?}",
            entries.len(),
            path
        );
        Arc::new(DataCache {
            entries: Mutex::new(entries),
            pending: Mutex::new(HashMap::new()),
            path,
            flushing: AtomicBool::new(false),
            misses: AtomicU64::new(0),
            oks: AtomicU64::new(0),
            emit: Mutex::new(None),
        })
    }

    /// 注入 UI 日志通道（harness_start 里有 app/plugin_id，才建得出来）
    fn set_emit(&self, e: AgentEmit) {
        *self.emit.lock().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(e));
        let n = self.entries.lock().unwrap_or_else(|e| e.into_inner()).len();
        let p = if self.pending_is_empty() { "" } else { "，有待回写的写操作" };
        self.log(&format!("数据面缓存就绪：{n} 条{p}（webview 挂起时读路径由它兜底）"));
    }

    /// 缓存相关的诊断：stderr（logcat）+ 插件日志（用户能导出）双写
    fn log(&self, text: &str) {
        eprintln!("[harness:embedded] {text}");
        let e = self.emit.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if let Some(e) = e {
            e.notify("progress", json!({ "text": format!("⚙ {text}"), "kind": "log" }));
        }
    }

    fn get(&self, key: &str) -> Option<Value> {
        let m = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        m.get(key).cloned()
    }

    /// 写穿缓存（门面应答成功时）。内容没变就不落盘（chat 每轮都会读一次 settings）。
    fn put(&self, key: &str, value: &Value) {
        {
            let mut m = self.entries.lock().unwrap_or_else(|e| e.into_inner());
            if m.get(key).map(|old| old == value).unwrap_or(false) {
                return;
            }
            m.insert(key.to_string(), value.clone());
        }
        self.persist();
    }

    /// 落盘：只写「设置」类小对象。会话 blob（harness.v1，最大 1.2MB）**只留内存**——
    /// 每次写穿都把它序列化一遍只为量体积太亏，而它冷启时本来就该读门面里的实时值。
    fn persist(&self) {
        let Some(path) = &self.path else { return };
        let entries = {
            let m = self.entries.lock().unwrap_or_else(|e| e.into_inner());
            m.iter()
                .filter(|(k, _)| k.starts_with("settings."))
                .filter(|(_, v)| serde_json::to_string(v).map(|s| s.len() <= CACHE_FILE_MAX_ENTRY).unwrap_or(false))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect::<serde_json::Map<String, Value>>()
        };
        let payload = json!({ "v": 1, "at": now_ms(), "entries": entries });
        let tmp = path.with_extension("json.tmp");
        if std::fs::write(&tmp, payload.to_string()).is_err() {
            return;
        }
        chmod_user_only(&tmp); // 设置类数据含 API Key / token：权限收到本人可读
        let _ = std::fs::remove_file(path);
        let _ = std::fs::rename(&tmp, path);
    }

    fn note_ok(&self) {
        let prev = self.misses.swap(0, Ordering::Relaxed);
        self.oks.fetch_add(1, Ordering::Relaxed);
        if prev > 0 {
            self.log(&format!("门面已恢复应答（此前连续 {prev} 次无响应），暂存写将回写"));
        }
    }

    /// 记一次「门面无响应」，返回**连续**次数（错误文案与日志据此说人话）
    fn note_miss(&self) -> u64 {
        self.misses.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn defer_write(&self, key: &str, mut w: PendingWrite) {
        let mut m = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        // 同键合并：入参取最新（w 已是新的），但 before 保留**最初**基准——重试/覆盖都不得刷新它
        if let Some(old) = m.get(key) {
            w.before = old.before.clone();
        }
        m.insert(key.to_string(), w);
    }

    fn clear_pending(&self, key: &str) {
        let mut m = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        m.remove(key);
    }

    fn pending_is_empty(&self) -> bool {
        self.pending.lock().unwrap_or_else(|e| e.into_inner()).is_empty()
    }

    fn snapshot_pending(&self) -> Vec<(String, PendingWrite)> {
        let m = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        m.iter().map(|(k, w)| (k.clone(), PendingWrite { ns: w.ns.clone(), method: w.method.clone(), args: w.args.clone(), before: w.before.clone(), read_key: w.read_key.clone(), attempts: w.attempts })).collect()
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 缓存文件权限收到「本人可读」（unix）；其余平台靠 app_data_dir 自身的目录权限
#[cfg(unix)]
fn chmod_user_only(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn chmod_user_only(_path: &std::path::Path) {}

/// 桥共享态：自增 id + 回执表
struct BridgeState {
    next_id: AtomicU64,
    pending: PendingMap,
}

/// agent → 桥的一次 onethu.call
struct CallReq {
    ns: String,
    method: String,
    args: Value,
    reply: mpsc::Sender<Result<Value, String>>,
    /// Some(键) = 这次调用值得写穿缓存（可缓存读 / 写目标）；None = 一次性实时数据（工具面）
    cache_key: Option<String>,
}

/// 内嵌 agent 的宿主句柄（Host 实现：数据面走桥，打断是本进程原子量）
struct AgentCtx {
    call_tx: mpsc::Sender<CallReq>,
    interrupt: Arc<AtomicBool>,
    cache: Arc<DataCache>,
}

impl AgentCtx {
    fn send(&self, ns: &str, method: &str, args: Value, cache_key: Option<String>) -> Result<mpsc::Receiver<Result<Value, String>>, String> {
        let (tx, rx) = mpsc::channel();
        self.call_tx
            .send(CallReq { ns: ns.to_string(), method: method.to_string(), args, reply: tx, cache_key })
            .map_err(|_| "内嵌桥已关闭（插件已停止）".to_string())?;
        Ok(rx)
    }

    /// 写路径（storage.set）：门面在场 → 正常写并把结果写穿缓存；
    /// 不在场 → **先记 pending**（值不动缓存：让同进程后续读到的仍是门面里那份真值，
    /// 免得以「我们自己刚写的、其实没落地的」值去回答），回 Ok 不阻塞本轮对话。
    fn write_path(&self, ns: &str, method: &str, key: &str, args: Value) -> Result<Value, String> {
        let target = args.get(0).and_then(|k| k.as_str()).unwrap_or("").to_string();
        let value = args.get(1).cloned().unwrap_or(Value::Null);
        let read_key = cache_key(ns, "get", &json!([target]));
        let rx = self.send(ns, method, args.clone(), Some(key.to_string()))?;
        match rx.recv_timeout(CACHE_WRITE_TIMEOUT) {
            Ok(Ok(v)) => {
                self.cache.clear_pending(key);
                self.cache.put(&read_key, &value); // 真写成功 → 读缓存同步到最新
                Ok(v)
            }
            Ok(Err(e)) => Err(e),
            Err(_) => {
                let before = self.cache.get(&read_key);
                self.cache.defer_write(
                    key,
                    PendingWrite {
                        ns: ns.to_string(),
                        method: method.to_string(),
                        args,
                        before,
                        read_key,
                        attempts: 0,
                    },
                );
                let n = self.cache.note_miss();
                self.cache.log(&format!("写操作暂存待回写（门面连续 {n} 次无响应）：{key}"));
                Ok(Value::Null)
            }
        }
    }
}

impl Host for AgentCtx {
    fn call(&mut self, ns: &str, method: &str, args: Value) -> Result<Value, String> {
        let cacheable = is_cache_read(ns, method);
        let key = cache_key(ns, method, &args);
        if ns == "storage" && method == "set" {
            return self.write_path(ns, method, &key, args);
        }
        let rx = self.send(ns, method, args, if cacheable { Some(key.clone()) } else { None })?;
        let wait = if cacheable { CACHE_READ_TIMEOUT } else { BRIDGE_TIMEOUT };
        match rx.recv_timeout(wait) {
            Ok(Ok(v)) => Ok(v), // 桥线程已写穿缓存
            Ok(Err(e)) => Err(e), // 门面明确报错（权限/未知方法…）：如实返回，不拿缓存掩盖
            Err(_) if cacheable => match self.cache.get(&key) {
                Some(v) => {
                    let n = self.cache.note_miss();
                    self.cache.log(&format!(
                        "门面 {}ms 未响应（连续 {n} 次）→ 用缓存回答 {key}",
                        wait.as_millis()
                    ));
                    Ok(v)
                }
                None => {
                    let n = self.cache.note_miss();
                    Err(format!(
                        "本体不在前台（门面连续 {n} 次无响应）且没有可用的缓存副本：这条要读实时数据，请回到 OneTHU 前台后再试。"
                    ))
                }
            },
            Err(_) => {
                let n = self.cache.note_miss();
                Err(format!(
                    "门面应答通道关闭（桥线程退出？）· 门面连续 {n} 次无响应：这一步需要本体在前台。"
                ))
            }
        }
    }

    fn interrupted(&self) -> bool {
        self.interrupt.load(Ordering::SeqCst)
    }

    fn reset_interrupt(&self) {
        self.interrupt.store(false, Ordering::SeqCst);
    }
}

/// 内部探针调用：直接向桥发一次并等回执（不走缓存降级）——预热与回写用
fn bridge_call_direct(
    call_tx: &mpsc::Sender<CallReq>,
    ns: &str,
    method: &str,
    args: Value,
    wait: Duration,
    cache_key: Option<String>,
) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel();
    call_tx
        .send(CallReq { ns: ns.to_string(), method: method.to_string(), args, reply: tx, cache_key })
        .map_err(|_| "内嵌桥已关闭".to_string())?;
    rx.recv_timeout(wait).unwrap_or_else(|_| Err("门面未响应".to_string()))
}

/// 预热：webview 此刻一定在场（它是拉起 harness 的人），先把「宿主自用数据面」缓存一份。
/// 之后即使用户切到别的应用（webview 挂起），settings/storage 读也能由缓存回答。
/// 桥泵可能还没建好（harness_start 返回后 JS 才起泵）→ 失败隔 1.5s 重试，最多 3 轮。
fn warm_cache(cache: &Arc<DataCache>, call_tx: &mpsc::Sender<CallReq>) {
    for attempt in 1..=3u32 {
        let mut failed = 0u32;
        for (ns, method, args) in [
            ("settings", "get", json!([])),
            ("storage", "get", json!(["harness.v1"])),
        ] {
            let key = cache_key(ns, method, &args);
            match bridge_call_direct(call_tx, ns, method, args, Duration::from_secs(6), Some(key.clone())) {
                Ok(v) => {
                    cache.note_ok();
                    cache.put(&key, &v);
                }
                Err(e) => {
                    failed += 1;
                    cache.log(&format!("缓存预热失败（第 {attempt} 轮）{key}：{e}"));
                }
            }
        }
        if failed == 0 {
            return;
        }
        std::thread::sleep(Duration::from_millis(1500));
    }
    cache.log("缓存预热未完成（桥泵可能还没起）——首次成功调用时会自动补上");
}

/// 门面刚证明自己在场（某次调用成功）→ 把之前暂存的写回补上。
/// 独立线程 + flushing 去重：绝不占桥线程，也不会并发回写。
fn spawn_flush(cache: &Arc<DataCache>, call_tx: &mpsc::Sender<CallReq>) {
    if cache.pending_is_empty() || cache.flushing.swap(true, Ordering::SeqCst) {
        return;
    }
    let cache = cache.clone();
    let tx = call_tx.clone();
    std::thread::spawn(move || {
        flush_pending(&cache, &tx);
        cache.flushing.store(false, Ordering::SeqCst);
    });
}

/// 回写策略（数据安全优先）：
/// 对每个 pending 条目，先**实时读一眼该键的现状**，与提交时刻的基准比对——
/// - 相等 → 门面这份数据在我们离开期间没被动过 → 安全写回；
/// - 不等 → 期间被别处改过（用户回本体操作 / 另一个窗口写了）→ **丢弃**并留日志（绝不覆盖新数据）；
/// - 基准缺失（None，冷启动没读到过真值）→ 同样丢弃（无从证明安全）；
/// - 读不到现状（门面又不在场了）→ 留着，下次再说（attempts 到上限则丢弃）。
fn flush_pending(cache: &Arc<DataCache>, call_tx: &mpsc::Sender<CallReq>) {
    for (pkey, w) in cache.snapshot_pending() {
        let target = w.args.get(0).and_then(|k| k.as_str()).unwrap_or("").to_string();
        let live = bridge_call_direct(call_tx, &w.ns, "get", json!([target]), Duration::from_millis(1500), Some(w.read_key.clone()));
        let Some(cur) = live.ok() else {
            cache.log(&format!("暂存写暂不回写（读不到现状）：{pkey}"));
            if w.attempts + 1 >= MAX_FLUSH_ATTEMPTS {
                cache.clear_pending(&pkey);
                cache.log(&format!("暂存写放弃（尝试 {MAX_FLUSH_ATTEMPTS} 次仍读不到现状）：{pkey}"));
            } else {
                cache.defer_write(&pkey, PendingWrite { attempts: w.attempts + 1, ..w });
            }
            continue;
        };
        let safe = matches!(&w.before, Some(b) if *b == cur);
        if !safe {
            cache.clear_pending(&pkey);
            cache.log(&format!(
                "暂存写被丢弃（期间已被别处改过，拒绝覆盖）：{pkey} · 基准{}",
                if w.before.is_none() { "缺失" } else { "不等" }
            ));
            continue;
        }
        match bridge_call_direct(call_tx, &w.ns, &w.method, w.args.clone(), Duration::from_secs(5), None) {
            Ok(_) => {
                cache.clear_pending(&pkey);
                // 回写成功 = 门面里已是我们这份值 → 读缓存放心的同步（下次读缓存不落空）
                if let Some(v) = w.args.get(1) {
                    cache.put(&w.read_key, v);
                }
                cache.log(&format!("暂存写已回写：{pkey}"));
            }
            Err(e) => cache.log(&format!("暂存写回写失败（继续挂着）：{pkey} · {e}")),
        }
    }
}

/// 通知面：独立小对象——dispatch(h, emit) 两参借用互不冲突
struct AgentEmit {
    app: AppHandle,
    plugin_id: String,
}

impl Emit for AgentEmit {
    fn notify(&self, method: &str, params: Value) {
        let _ = self.app.emit(
            "plugin-event",
            json!({ "pluginId": self.plugin_id, "method": method, "params": params }),
        );
    }
}

enum AgentMsg {
    Run { method: String, params: Value, reply: mpsc::Sender<Result<Value, String>> },
    Dispose,
}

struct HarnessLive {
    tx: mpsc::Sender<AgentMsg>,
    interrupt: Arc<AtomicBool>,
    bridge: Arc<BridgeState>,
    /// 控制命令快速路用：调用线程以独立 AgentCtx 直发桥（不经 agent 串行队列）
    call_tx: mpsc::Sender<CallReq>,
    /// 数据面缓存（见文件头）：即使用户切到别的应用、webview 挂起，读路径仍有答案
    cache: Arc<DataCache>,
}

/// 全部在跑的内嵌 harness 实例。
/// 桥队列：tokio 无界 mpsc——桥线程 push 即唤醒挂起的 take（亚毫秒），
/// JS 泵 take 是 async 挂起（不占任何线程）；此前的 std Condvar 版 take 是
/// 同步命令、在主线程上空等 25s——安卓实录「全操作 ≥10s、卡成一坨」真凶
/// （Tauri v2 同步命令在主线程执行，主线程被泵独占 = 其余命令全部排队）。
static BRIDGE_TX: std::sync::OnceLock<tokio::sync::mpsc::UnboundedSender<Value>> =
    std::sync::OnceLock::new();
static BRIDGE_RX: std::sync::OnceLock<tokio::sync::Mutex<Option<tokio::sync::mpsc::UnboundedReceiver<Value>>>> =
    std::sync::OnceLock::new();

/// 惰性建道（桥线程 push / JS 泵 take 首次触达时）
fn bridge_init() -> &'static tokio::sync::mpsc::UnboundedSender<Value> {
    BRIDGE_TX.get_or_init(|| {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let _ = BRIDGE_RX.set(tokio::sync::Mutex::new(Some(rx)));
        tx
    })
}

/// 桥线程入队（push 即唤醒挂起的 take，亚毫秒级）
fn bridge_push(payload: Value) {
    let _ = bridge_init().send(payload);
}

/// JS 侧长轮询：异步挂起直到队列有待处理调用（最多 25s），一次取走整批。
/// async 命令跑在 tokio 池——主线程零占用，绝不阻塞其他命令/事件派发。
///
/// 顺带一条**门面在场**的信事实：这个泵在轮询 = 本体 webview 活着（挂起时泵也停）。
/// 所以每次进来都试着把暂存的写回补上——用户切回本体后不必再等下一次对话。
#[tauri::command]
pub async fn harness_bridge_take(
    state: tauri::State<'_, HarnessHost>,
    plugin_id: String,
) -> Result<Vec<Value>, String> {
    // 说明：带 `&State` 引用的 async 命令必须返回 `Result`（Tauri 的宏约束），否则
    // `__tauri_message__` 生命周期 + AsyncCommandMustReturnResult 两个错一起报。
    bridge_init(); // 惰性建道（桌面端泵也会走到这）
    {
        // `pluginId` 传的是 JS 侧共享泵的哨兵 `__any__`（rust.ts 只起一条泵，服务所有
        // rust 插件）——按哨兵/具体 id 两种口径取实例。只读一眼锁即放（绝不跨 await 持锁）；
        // spawn_flush 自带「pending 空 / 正在回写」去重，空跑代价可忽略。
        let targets: Vec<Arc<HarnessLive>> = state
            .live
            .lock()
            .ok()
            .map(|m| {
                if plugin_id == "__any__" || plugin_id.is_empty() {
                    m.values().cloned().collect()
                } else {
                    m.get(&plugin_id).cloned().into_iter().collect()
                }
            })
            .unwrap_or_default();
        for l in targets {
            spawn_flush(&l.cache, &l.call_tx);
        }
    }
    let mut guard = BRIDGE_RX.get().expect("桥队列已建").lock().await;
    let Some(rx) = guard.as_mut() else {
        // 尚无内嵌实例（桌面端也会起泵）：歇 500ms 防 JS 空转
        tokio::time::sleep(Duration::from_millis(500)).await;
        return Ok(Vec::new());
    };
    let first = tokio::time::timeout(Duration::from_secs(25), rx.recv()).await;
    Ok(match first {
        Ok(Some(payload)) => {
            let mut out = vec![payload];
            while let Ok(p) = rx.try_recv() {
                out.push(p);
            }
            out
        }
        _ => Vec::new(),
    })
}

#[derive(Default)]
pub struct HarnessHost {
    live: Mutex<HashMap<String, Arc<HarnessLive>>>,
}

/// 启动内嵌 agent：起 agent 线程 + 门面桥线程，返回 activate 应答（commands 清单）。
#[tauri::command]
pub async fn harness_start(
    app: AppHandle,
    state: tauri::State<'_, HarnessHost>,
    plugin_id: String,
) -> Result<Value, String> {
    // 幂等：已存活先摘（旧线程随通道关闭自行退场）
    harness_stop_inner(&state, &plugin_id);

    let interrupt = Arc::new(AtomicBool::new(false));
    let bridge = Arc::new(BridgeState {
        next_id: AtomicU64::new(1),
        pending: Arc::new(Mutex::new(HashMap::new())),
    });
    // 数据面缓存：启动即载入（app_data_dir 小 JSON）；预热放在桥线程起步之后（见下）
    let cache = DataCache::load(&app);
    // 诊断通道接到「插件日志」：用户导出的日志里能看到缓存命中/降级/回写
    cache.set_emit(AgentEmit { app: app.clone(), plugin_id: plugin_id.clone() });

    // 门面桥线程：onethu.call → "plugin-rpc" 事件 → webview 执行 → harness_rpc_reply 回写
    let (call_tx, call_rx) = mpsc::channel::<CallReq>();
    {
        let pid = plugin_id.clone();
        let b = bridge.clone();
        let cache = cache.clone();
        let call_tx = call_tx.clone();
        std::thread::spawn(move || {
            while let Ok(req) = call_rx.recv() {
                let id = b.next_id.fetch_add(1, Ordering::Relaxed);
                let (rtx, rrx) = mpsc::channel::<Result<Value, String>>();
                if let Ok(mut m) = b.pending.lock() {
                    m.insert(id, rtx);
                }
                // 长轮询批量泵：入全局队列即唤醒挂起的 take，替代每次调用一次事件往返
                bridge_push(json!({
                    "pluginId": pid, "id": id, "method": "onethu.call",
                    "params": { "ns": req.ns, "method": req.method, "args": req.args }
                }));
                // 照旧等满 BRIDGE_TIMEOUT：调用方可能已用缓存提前收口（1.8s），
                // 但这条调用**继续在后台跑完**——应答回来正好写穿缓存（含 flush 回写）。
                let res = rrx
                    .recv_timeout(BRIDGE_TIMEOUT)
                    .unwrap_or_else(|_| Err("webview 门面应答超时（15s）".into()));
                if let Ok(mut m) = b.pending.lock() {
                    m.remove(&id);
                }
                match (&res, &req.cache_key) {
                    (Ok(v), Some(key)) => {
                        cache.put(key, v);
                        cache.note_ok();
                        spawn_flush(&cache, &call_tx); // 门面在场 → 把暂存的写补上
                    }
                    (Ok(_), None) => cache.note_ok(),
                    (Err(_), _) => {
                        cache.note_miss();
                    }
                }
                let _ = req.reply.send(res);
            }
        });
    }

    // 预热：webview 此刻一定在场（它是拉起 harness 的人）——先把「宿主自用数据面」
    // （settings / 会话存储）缓存一份，之后即使用户切到别的应用、webview 挂起，
    // 这些读也有缓存可答。延后一拍：harness_start 返回后 JS 侧才建好桥泵。
    {
        let cache = cache.clone();
        let tx = call_tx.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1200));
            warm_cache(&cache, &tx);
        });
    }

    // agent 线程：串行 Run；Dispose 收尾退出
    let (msg_tx, msg_rx) = mpsc::channel::<AgentMsg>();
    {
        let app = app.clone();
        let pid = plugin_id.clone();
        let flag = interrupt.clone();
        let tx = call_tx.clone();
        let cache = cache.clone();
        std::thread::spawn(move || {
            let emit = AgentEmit { app, plugin_id: pid };
            let mut ctx = AgentCtx { call_tx: tx, interrupt: flag, cache };
            eprintln!("[harness:embedded] agent 线程就绪");
            while let Ok(msg) = msg_rx.recv() {
                match msg {
                    AgentMsg::Run { method, params, reply } => match method.as_str() {
                        "run" => {
                            ctx.reset_interrupt();
                            // command/input/attachments（可选多模态附件）的解析统一在
                            // core::dispatch_run——两个宿主共用同一份参数解析
                            let out = dispatch_run(&mut ctx, &emit, &params);
                            let _ = reply.send(Ok(out));
                        }
                        "activate" => {
                            let _ = reply.send(Ok(activate_commands()));
                        }
                        other => {
                            let _ = reply.send(Err(format!("内嵌 harness 未知方法：{other}")));
                        }
                    },
                    AgentMsg::Dispose => break,
                }
            }
            eprintln!("[harness:embedded] agent 线程退出");
        });
    }

    state
        .live
        .lock()
        .map_err(|_| "状态锁中毒".to_string())?
        .insert(
            plugin_id.clone(),
            Arc::new(HarnessLive { tx: msg_tx, interrupt, bridge, call_tx: call_tx.clone(), cache }),
        );
    let _ = app.emit(
        "plugin-event",
        json!({ "pluginId": plugin_id, "method": "spawned", "params": { "mode": "embedded" } }),
    );
    Ok(activate_commands())
}

/// 调用内嵌 agent（activate/run/dispose 同一通道）。async + spawn_blocking：
/// 长跑 chat 的等待（最长 600s）与非 chat 的就地 dispatch 全部落在线程池，
/// 主线程零占用——同步版会把整个 App 按死（安卓实录主线程阻塞=全 UI 冻结）。
/// 超时与 sidecar 的 plugin_call 同款默认 600s。
#[tauri::command]
pub async fn harness_call(
    app: AppHandle,
    state: tauri::State<'_, HarnessHost>,
    plugin_id: String,
    method: String,
    params: Value,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let live = state
        .live
        .lock()
        .map_err(|_| "状态锁中毒".to_string())?
        .get(&plugin_id)
        .cloned()
        .ok_or(format!("内嵌插件未运行：{plugin_id}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        // 控制命令快速路：chat 之外的 run 直接分发——不被在跑的长任务卡住，
        // 否则新会话/历史/导入导出在 chat 进行中形同死键（与 sidecar 旁路线程同语义）。
        // 绝不 reset_interrupt：会清掉在跑 chat 的打断标志。
        if method == "run" {
            let command = params.get("command").and_then(|v| v.as_str()).unwrap_or("");
            if command != "chat" && !command.is_empty() {
                let mut ctx = AgentCtx {
                    call_tx: live.call_tx.clone(),
                    interrupt: live.interrupt.clone(),
                    cache: live.cache.clone(),
                };
                let emit = AgentEmit { app, plugin_id: plugin_id.clone() };
                return Ok(dispatch_run(&mut ctx, &emit, &params));
            }
        }
        let (tx, rx) = mpsc::channel::<Result<Value, String>>();
        live.tx
            .send(AgentMsg::Run { method, params, reply: tx })
            .map_err(|_| "内嵌 agent 已退出".to_string())?;
        match rx.recv_timeout(Duration::from_millis(timeout_ms.unwrap_or(600_000))) {
            Ok(res) => res,
            Err(_) => Err("内嵌 harness 调用超时（run）".to_string()),
        }
    })
    .await
    .map_err(|e| format!("harness_call 线程故障：{e}"))?
}

/// 宿主通知：interrupt 置快路径标志（llm 流逐块检查，毫秒级生效）
#[tauri::command]
pub async fn harness_notify(
    state: tauri::State<'_, HarnessHost>,
    plugin_id: String,
    method: String,
    params: Value,
) -> Result<(), String> {
    let _ = params;
    let live = state
        .live
        .lock()
        .map_err(|_| "状态锁中毒".to_string())?
        .get(&plugin_id)
        .cloned()
        .ok_or(format!("内嵌插件未运行：{plugin_id}"))?;
    if method == "interrupt" {
        live.interrupt.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// webview 门面执行完 onethu.call 后回写结果（桥线程据此唤醒 agent）
#[tauri::command]
pub async fn harness_rpc_reply(
    state: tauri::State<'_, HarnessHost>,
    plugin_id: String,
    id: u64,
    ok: bool,
    result: Value,
) -> Result<(), String> {
    let live = state
        .live
        .lock()
        .map_err(|_| "状态锁中毒".to_string())?
        .get(&plugin_id)
        .cloned()
        .ok_or(format!("内嵌插件未运行：{plugin_id}"))?;
    if let Some(tx) = live.bridge.pending.lock().ok().and_then(|mut m| m.remove(&id)) {
        let outcome = if ok {
            Ok(result)
        } else {
            Err(match result {
                Value::String(s) => s,
                other => other.to_string(),
            })
        };
        let _ = tx.send(outcome);
    }
    Ok(())
}

/// 停止：摘表 + 置打断（在跑的一轮尽快收）+ 发 Dispose（agent 线程回完当前消息即退）
/// 并补发 exit 事件——与 sidecar 泵（plugins.rs stdout 关闭）事件契约一致，
/// 对话面板据此强制解锁（打断死人开关之外的确定性收尾）。
#[tauri::command]
pub async fn harness_stop(
    app: AppHandle,
    state: tauri::State<'_, HarnessHost>,
    plugin_id: String,
) -> Result<(), String> {
    if harness_stop_inner(&state, &plugin_id) {
        let _ = app.emit(
            "plugin-event",
            json!({ "pluginId": plugin_id, "method": "exit", "params": { "mode": "embedded" } }),
        );
    }
    Ok(())
}

fn harness_stop_inner(state: &tauri::State<'_, HarnessHost>, plugin_id: &str) -> bool {
    state
        .live
        .lock()
        .ok()
        .and_then(|mut m| m.remove(plugin_id))
        .map(|live| {
            live.interrupt.store(true, Ordering::SeqCst);
            let _ = live.tx.send(AgentMsg::Dispose);
        })
        .is_some()
}
