//! 桌面全局悬浮球窗口（需求 5 桌面侧；macOS 优先，Windows/Linux 兼容）
//! —— ball-overlay-desktop 写域，模块注册与命令挂载由 Lead 在 src/lib.rs 做（清单见交付报告）。
//!
//! 分工：本文件只做「窗口生命周期 + 几何 + 手势事件回传」；视觉层 100% 由前端
//! `components/GlobalOrb.tsx`（Lead 独占）渲染——窗口装载 `index.html?window=overlay`，
//! `App.tsx` 在该 query 下只渲染 GlobalOrb。前端适配器是同写域的 `src/lib/overlayDesktop.ts`。
//!
//! 命令面（与 `lib/overlay.ts` 契约同名）：
//!   overlay_supported / overlay_show / overlay_hide / overlay_set_mode / overlay_move
//!   + overlay_drag_start（原生拖窗）/ overlay_nudge（JS 逐帧拖动兜底，逻辑 px 增量）
//!   + overlay_focus（**唯一**允许抢焦点的入口：用户点面板输入框）
//! 事件：`onethu-overlay://event`，负载 `{ "type": "drag" | "closed" | ..., "x"?, "y"? }`。
//!
//! ## 红线：绝不抢焦点、绝不拉起主窗口（逐条对照 tao 0.35.3 源码得出的做法）
//! 1. 建窗即 `focused(false)` + `set_focusable(false)`：tao 的 macOS `set_visible(true)`
//!    走的是 `makeKeyAndOrderFront`（**不** activate app），而 `canBecomeKeyWindow` 由
//!    focusable ivar 决定 → 置 false 后窗口只能「置前」、永远不会成为 key window，
//!    用户的键盘焦点留在原来那个 app 里 ⇒ `show()` 不抢焦点。
//! 2. `accept_first_mouse(true)`：点击悬浮窗不再触发「点击激活窗口」的默认行为，
//!    单击就能直接进 DOM（「单击出面板、长按说话」全靠这个）。
//! 3. 全文件**不出现** `set_focus()`（tao 的实现 = makeKeyAndOrderFront +
//!    `activateIgnoringOtherApps:YES`，会真的把 OneTHU 激活到前台），也不出现
//!    `unminimize()`，更不按 label 去碰 "main" 窗口。
//! 4. 唯一例外：`overlay_focus(on)`，仅由前端在**用户点面板输入框**时调用（失焦即退回
//!    focusable(false)）。打了这个补丁，才可能出现「输入时 OneTHU 被激活」——见报告风险项。
//!
//! ## 形态（窗口 = 形态本身，球窗口像素框 64×64 / 条全宽 176 / 面板 560×560 贴底）
//! 所有「逻辑 px」常量都按所在屏 scale_factor 换算成物理像素后落位（Retina 不缩水）。

#![cfg_attr(not(desktop), allow(dead_code))]
use std::sync::{Mutex, MutexGuard};
use std::time::Instant;

#[cfg(desktop)]
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
#[cfg(desktop)]
use tauri::{
    Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

// ── 对外常量（lib.rs 注册用） ────────────────────────────────────────────────
/// 悬浮窗 label：capabilities/overlay.json 的 windows 必须与之完全一致
pub const OVERLAY_LABEL: &str = "oh-orb";
/// 事件名（前端 `listen("onethu-overlay://event")`）
pub const OVERLAY_EVENT: &str = "onethu-overlay://event";
/// 窗口装载的前端路由：App.tsx 见到 `window=overlay` 只渲染 GlobalOrb
pub const OVERLAY_URL: &str = "index.html?window=overlay";

// ── 几何常量（逻辑 px） ─────────────────────────────────────────────────────
/// 球窗体边长。GlobalOrb 画的是 54×54 的球，窗外各留 5px 余量（雾的羽化不切边）
const BALL_BOX: f64 = 64.0;
/// 球视觉边长（= GlobalOrb.tsx 里球 div 的 width/height；改球尺寸要同步改这两处）
const BALL_VISUAL: f64 = 54.0;
/// 球在窗内的内缩（= (BALL_BOX - BALL_VISUAL) / 2，由初始化脚本用 CSS 钉住）
const BALL_INSET: f64 = (BALL_BOX - BALL_VISUAL) / 2.0;
/// 默认落点：所在屏 work area 右下角再让出 right 12 / bottom 128（与 GlobalOrb 设计稿同口径）
const EDGE_RIGHT: f64 = 12.0;
const EDGE_BOTTOM: f64 = 128.0;
/// 语音条：全宽 × 176 —— GlobalOrb 的条内容总高 = 转写雾(73) + 10 + 条(54) + 18 = 155，
/// 余量留给第二行转写（Lead 口头给的 96 会把转写雾切掉一半）
const BAR_H: f64 = 176.0;
/// 面板：560 宽（窄屏自动收）× 560 高（矮屏自动收），贴 work area 底边、水平居中
const PANEL_W: f64 = 560.0;
const PANEL_H: f64 = 560.0;
/// 面板左右各留一点，避免在 4K/宽屏上糊成「一堵墙」
const PANEL_SIDE_GAP: f64 = 12.0;
/// 面板顶部至少给身后应用留出的可见高度
const PANEL_TOP_KEEP: f64 = 96.0;
/// WindowEvent::Moved 的 drag 事件节流 / 落盘节流
const DRAG_EMIT_MS: u128 = 50;
const PERSIST_MS: u128 = 400;

/// 初始化脚本：悬浮窗必须**真透明**（GlobalOrb 自己不带页面底色），并把球钉在窗内
/// 左上角的 BALL_INSET 处——GlobalOrb 的球按「全屏窗口」写成 right:12/bottom:128，
/// 而悬浮窗本身就是球的像素框，故此处用 CSS 覆盖回 (inset, inset)。
/// 只注入给 overlay 窗口（主窗口不加载本脚本），且选择器只认球自身，视觉层零改动。
const OVERLAY_INIT_JS: &str = r#"(function () {
  var css = [
    'html,body,#root{background:transparent !important;background-color:transparent !important;}',
    'html,body{margin:0 !important;padding:0 !important;overflow:hidden !important;}',
    "[aria-label^='OH 悬浮球']{right:auto !important;bottom:auto !important;left:5px !important;top:5px !important;}"
  ].join('\n');
  function inject() {
    if (document.querySelector('style[data-onethu-overlay]')) return;
    var el = document.createElement('style');
    el.setAttribute('data-onethu-overlay', '1');
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();"#;

// ── 形态 ────────────────────────────────────────────────────────────────────
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Mode {
    Hidden,
    Ball,
    Bar,
    Panel,
}

impl Mode {
    fn parse(raw: &str) -> Result<Mode, String> {
        match raw {
            "hidden" => Ok(Mode::Hidden),
            "ball" => Ok(Mode::Ball),
            "bar" => Ok(Mode::Bar),
            "panel" => Ok(Mode::Panel),
            other => Err(format!("未知悬浮球形态：{other}（只认 hidden/ball/bar/panel）")),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Mode::Hidden => "hidden",
            Mode::Ball => "ball",
            Mode::Bar => "bar",
            Mode::Panel => "panel",
        }
    }
}

/// 一块屏（work area + 缩放），全部取自 tauri 的 Monitor（物理像素，与窗口物理坐标同一坐标系）
#[derive(Clone, Copy, Debug)]
struct Mon {
    wx: i32,
    wy: i32,
    ww: u32,
    wh: u32,
    scale: f64,
}

/// 一次落位：位置用物理像素（多屏拼合空间），尺寸用逻辑像素（= CSS px，Retina 不缩水）
#[derive(Clone, Copy, Debug)]
struct Geo {
    x: i32,
    y: i32,
    lw: f64,
    lh: f64,
}

struct State {
    mode: Mode,
    /// 球的落点（物理像素，窗口左上角）——松手位置就是这么记住的
    ball: Option<(i32, i32)>,
    /// Rust 侧可见性（IPC 失败时 `is_visible()` 不可靠，故自己记账）
    visible: bool,
    /// 隐藏过 → 下次 show 前把 overlay 页刷回球态
    /// （页面自己停在 React 的 hidden 分支上，不会随窗口 show 自动回来）
    reload_pending: bool,
    last_persist: Option<Instant>,
    last_drag_emit: Option<Instant>,
}

static STATE: Mutex<State> = Mutex::new(State {
    mode: Mode::Hidden,
    ball: None,
    visible: false,
    reload_pending: false,
    last_persist: None,
    last_drag_emit: None,
});

fn st() -> MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(desktop)]
fn log(line: &str) {
    crate::debug_log_line(&format!("[OVERLAY] {line}"));
}

// ── 位置落盘（appData/state/overlay-pos.json；与 lib.rs 的 state_* 同目录同风格） ──
// 选 Rust 文件而不是 localStorage：① 首次建窗就要定位置，等前端加载完再挪会看到跳一下；
// ② 本仓注释已记录「WKWebView 的 localStorage 会被系统驱逐」，落盘才跨重启可靠。
#[cfg(desktop)]
#[derive(Serialize, Deserialize)]
struct SavedPos {
    x: i32,
    y: i32,
    #[serde(default)]
    scale: f64,
}

#[cfg(desktop)]
fn pos_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("state");
    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }
    Some(dir.join("overlay-pos.json"))
}

#[cfg(desktop)]
fn load_pos(app: &AppHandle) -> Option<(i32, i32)> {
    let raw = std::fs::read_to_string(pos_path(app)?).ok()?;
    let v: SavedPos = serde_json::from_str(&raw).ok()?;
    Some((v.x, v.y))
}

#[cfg(desktop)]
fn save_pos(app: &AppHandle, x: i32, y: i32, scale: f64, force: bool) {
    {
        let mut s = st();
        if !force {
            let now = Instant::now();
            if let Some(t) = s.last_persist {
                if now.duration_since(t).as_millis() < PERSIST_MS {
                    return;
                }
            }
            s.last_persist = Some(now);
        } else {
            s.last_persist = Some(Instant::now());
        }
    }
    if let Some(p) = pos_path(app) {
        let body = serde_json::to_string(&SavedPos { x, y, scale }).unwrap_or_default();
        if let Err(e) = std::fs::write(&p, body) {
            log(&format!("位置落盘失败：{e}"));
        }
    }
}

// ── 显示器与几何 ────────────────────────────────────────────────────────────
#[cfg(desktop)]
fn mon_of(m: &tauri::Monitor) -> Mon {
    let scale = if m.scale_factor() > 0.0 { m.scale_factor() } else { 1.0 };
    let full = m.size();
    let wa = m.work_area();
    // 防御：个别驱动/work_area 缺失时 tauri 会给 0 或与屏尺寸差一个量级（坐标空间不一致），
    // 这种情况直接退回整屏矩形——宁可贴着 Dock/任务栏，也不要落到屏幕外。
    let sane = wa.size.width > 0
        && wa.size.height > 0
        && (wa.size.width as f64) < (full.width as f64) * 1.05
        && (wa.size.width as f64) > (full.width as f64) * 0.6
        && (wa.size.height as f64) > (full.height as f64) * 0.4;
    if sane {
        Mon {
            wx: wa.position.x,
            wy: wa.position.y,
            ww: wa.size.width,
            wh: wa.size.height,
            scale,
        }
    } else {
        Mon {
            wx: m.position().x,
            wy: m.position().y,
            ww: full.width,
            wh: full.height,
            scale,
        }
    }
}

#[cfg(desktop)]
fn point_in(m: Mon, x: i32, y: i32) -> bool {
    x >= m.wx && x < m.wx + m.ww as i32 && y >= m.wy && y < m.wy + m.wh as i32
}

/// 选屏：① 球当前所在屏 → ② 鼠标所在屏（多显示器取鼠标那块）→ ③ 主屏 → ④ 兜底
#[cfg(desktop)]
fn pick_monitor(win: &WebviewWindow, hint: Option<(i32, i32)>) -> Mon {
    let all: Vec<Mon> = win
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(mon_of)
        .collect();
    if let Some((x, y)) = hint {
        if let Some(m) = all.iter().copied().find(|m| point_in(*m, x, y)) {
            return m;
        }
    }
    if let Ok(c) = win.cursor_position() {
        let (cx, cy) = (c.x as i32, c.y as i32);
        if let Some(m) = all.iter().copied().find(|m| point_in(*m, cx, cy)) {
            return m;
        }
    }
    if let Ok(Some(p)) = win.primary_monitor() {
        return mon_of(&p);
    }
    all.first().copied().unwrap_or(Mon {
        wx: 0,
        wy: 0,
        ww: 1280,
        wh: 800,
        scale: 1.0,
    })
}

#[cfg(desktop)]
fn clamp_i(v: i32, lo: i32, hi: i32) -> i32 {
    if hi < lo {
        lo
    } else {
        v.max(lo).min(hi)
    }
}

#[cfg(desktop)]
fn default_ball(mon: Mon) -> (i32, i32) {
    let d = (BALL_BOX * mon.scale).round() as i32;
    let right = (EDGE_RIGHT * mon.scale).round() as i32;
    let bottom = (EDGE_BOTTOM * mon.scale).round() as i32;
    (
        mon.wx + mon.ww as i32 - d - right,
        mon.wy + mon.wh as i32 - d - bottom,
    )
}

#[cfg(desktop)]
fn geo_for(mode: Mode, mon: Mon, ball: Option<(i32, i32)>) -> Geo {
    let s = mon.scale;
    match mode {
        Mode::Hidden | Mode::Ball => {
            let d = (BALL_BOX * s).round().max(1.0) as i32;
            let (x, y) = ball.unwrap_or_else(|| default_ball(mon));
            Geo {
                x: clamp_i(x, mon.wx, mon.wx + mon.ww as i32 - d),
                y: clamp_i(y, mon.wy, mon.wy + mon.wh as i32 - d),
                lw: BALL_BOX,
                lh: BALL_BOX,
            }
        }
        Mode::Bar => {
            let h = (BAR_H * s).round().max(1.0) as i32;
            Geo {
                x: mon.wx,
                y: mon.wy + mon.wh as i32 - h,
                lw: (mon.ww as f64) / s,
                lh: BAR_H,
            }
        }
        Mode::Panel => {
            let side = (PANEL_SIDE_GAP * s).round() as i32;
            let top_keep = (PANEL_TOP_KEEP * s).round() as i32;
            let w = ((PANEL_W * s).round() as i32)
                .min((mon.ww as i32 - side * 2).max(160))
                .max(1);
            let h = ((PANEL_H * s).round() as i32)
                .min((mon.wh as i32 - top_keep).max(120))
                .max(1);
            Geo {
                x: mon.wx + (mon.ww as i32 - w) / 2,
                y: mon.wy + mon.wh as i32 - h,
                lw: (w as f64) / s,
                lh: (h as f64) / s,
            }
        }
    }
}

#[cfg(desktop)]
fn apply_geo(win: &WebviewWindow, g: Geo) -> Result<(), String> {
    // 尺寸用逻辑像素、位置用物理像素：tauri 的 Size/Position 两套类型别混
    win.set_size(LogicalSize::new(g.lw, g.lh))
        .map_err(|e| format!("设置悬浮窗尺寸失败：{e}"))?;
    win.set_position(PhysicalPosition::new(g.x, g.y))
        .map_err(|e| format!("设置悬浮窗位置失败：{e}"))?;
    Ok(())
}

// ── 建窗（懒创建、复用；label 固定 oh-orb，与 capabilities 对齐） ─────────────
#[cfg(desktop)]
fn ensure_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
        return Ok(w);
    }
    let win = WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App(OVERLAY_URL.into()))
        .title("OH")
        .inner_size(BALL_BOX, BALL_BOX)
        .position(0.0, 0.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .decorations(false)
        .transparent(true)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        // macOS：非 key 窗口也把第一次点击直接交给 webview（不激活 app）——不抢焦点的关键
        .accept_first_mouse(true)
        .focused(false)
        .visible(false)
        .initialization_script(OVERLAY_INIT_JS)
        .build()
        .map_err(|e| format!("创建悬浮窗失败：{e}"))?;
    // canBecomeKeyWindow/canBecomeMainWindow → false：窗口只置前、不当 key（tao 的 focusable ivar）
    if let Err(e) = win.set_focusable(false) {
        log(&format!("set_focusable 失败（不影响显示）：{e}"));
    }
    let ev_win = win.clone();
    let ev_app = app.clone();
    win.on_window_event(move |ev| match ev {
        tauri::WindowEvent::Moved(pos) => {
            let emit = {
                let mut s = st();
                if s.mode != Mode::Ball {
                    // 形态切换时的程序落位也会走这里，别把它当成「用户拖过球」
                    return;
                }
                s.ball = Some((pos.x, pos.y));
                let now = Instant::now();
                let due = match s.last_drag_emit {
                    Some(t) => now.duration_since(t).as_millis() >= DRAG_EMIT_MS,
                    None => true,
                };
                if due {
                    s.last_drag_emit = Some(now);
                }
                due
            };
            if emit {
                let _ = ev_win.emit(
                    OVERLAY_EVENT,
                    serde_json::json!({ "type": "drag", "x": pos.x, "y": pos.y }),
                );
            }
            let scale = ev_win.scale_factor().unwrap_or(1.0);
            save_pos(&ev_app, pos.x, pos.y, scale, false);
        }
        tauri::WindowEvent::Destroyed => {
            let mut s = st();
            s.mode = Mode::Hidden;
            s.visible = false;
            s.ball = None;
            log("悬浮窗已销毁（下次 overlay_show 会重建）");
        }
        _ => {}
    });
    log(&format!(
        "悬浮窗已创建：label={OVERLAY_LABEL} url={OVERLAY_URL} 初始 {BALL_BOX}x{BALL_BOX} 逻辑 px，球内缩 {BALL_INSET}px"
    ));
    Ok(win)
}

// ── 命令 ────────────────────────────────────────────────────────────────────

/// 该平台是否支持系统级悬浮球（桌面 = true；Android/iOS = false，安卓走 onethu-overlay 插件）
#[tauri::command]
pub fn overlay_supported() -> bool {
    cfg!(desktop)
}

/// 显示球（用户在本体 OH 对话界面点「打开悬浮球」时调；不激活主窗口、不抢焦点）
#[tauri::command]
pub fn overlay_show(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let win = ensure_window(&app)?;
        let reload = {
            let mut s = st();
            let r = s.reload_pending;
            s.reload_pending = false;
            r
        };
        if reload {
            // 页面停在 React 的 hidden 分支（需求 5「本次关闭悬浮球」）→ 先刷回球态再显形；
            // 窗口是透明的，刷页面期间看不见任何残影。
            let _ = win.eval("location.reload()");
        }
        let ball = { st().ball }.or_else(|| load_pos(&app));
        let mon = pick_monitor(&win, ball);
        let geo = geo_for(Mode::Ball, mon, ball);
        {
            let mut s = st();
            s.mode = Mode::Ball;
            s.visible = true;
        }
        apply_geo(&win, geo)?;
        let _ = win.set_always_on_top(true);
        win.show().map_err(|e| format!("显示悬浮窗失败：{e}"))?;
        log(&format!(
            "show ball @({},{}) {}x{} 逻辑 scale={} reload={}",
            geo.x, geo.y, geo.lw, geo.lh, mon.scale, reload
        ));
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Err("桌面悬浮球仅桌面端支持（安卓走 onethu-overlay 插件）".into())
    }
}

/// 本次关闭：隐藏窗口 + 发 `closed`（与 lib/overlay.ts 的「本次关闭」标记语义一致）。
/// 幂等——已隐藏时直接返回，避免 closed → hide → closed 自激。
#[tauri::command]
pub fn overlay_hide(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let Some(win) = app.get_webview_window(OVERLAY_LABEL) else {
            return Ok(());
        };
        let was_visible = {
            let mut s = st();
            let v = s.visible || win.is_visible().unwrap_or(false);
            s.visible = false;
            s.mode = Mode::Hidden;
            s.reload_pending = true;
            v
        };
        if !was_visible {
            return Ok(());
        }
        let ball = { st().ball };
        if let Some((x, y)) = ball {
            let scale = win.scale_factor().unwrap_or(1.0);
            save_pos(&app, x, y, scale, true);
        }
        win.hide().map_err(|e| format!("隐藏悬浮窗失败：{e}"))?;
        let _ = win.emit(OVERLAY_EVENT, serde_json::json!({ "type": "closed" }));
        log("hide（本次关闭）");
        // 隐藏态下把页面刷回球态：下次 overlay_show 立刻可用（否则页面卡在 hidden 分支，
        // 窗口虽显示但什么都不渲染）。若期间又被 show 回来就放弃这次刷新。
        let w2 = win.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(180)).await;
            let still_hidden = { !st().visible };
            if still_hidden {
                let _ = w2.eval("location.reload()");
            }
        });
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Err("桌面悬浮球仅桌面端支持".into())
    }
}

/// 切形态：ball（球）/ bar（语音条）/ panel（半屏对话面）/ hidden（= 本次关闭）
#[tauri::command]
pub fn overlay_set_mode(app: AppHandle, mode: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let m = Mode::parse(&mode)?;
        if m == Mode::Hidden {
            return overlay_hide(app);
        }
        let win = ensure_window(&app)?;
        let ball = { st().ball }.or_else(|| load_pos(&app));
        let mon = pick_monitor(&win, ball);
        let geo = geo_for(m, mon, ball);
        {
            let mut s = st();
            s.mode = m;
            s.visible = true;
            s.reload_pending = false;
        }
        apply_geo(&win, geo)?;
        let _ = win.set_always_on_top(true);
        if let Some((x, y)) = ball {
            let scale = win.scale_factor().unwrap_or(1.0);
            save_pos(&app, x, y, scale, true);
        }
        if !win.is_visible().unwrap_or(false) {
            win.show().map_err(|e| format!("显示悬浮窗失败：{e}"))?;
        }
        log(&format!(
            "set_mode {} @({},{}) {}x{} 逻辑",
            m.as_str(),
            geo.x,
            geo.y,
            geo.lw,
            geo.lh
        ));
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = (&app, &mode);
        Err("桌面悬浮球仅桌面端支持".into())
    }
}

/// 把悬浮窗移到屏幕绝对位置（物理像素，与 OverlayEvent.x/y 同一坐标系）——JS 拖动兜底通道
#[tauri::command]
pub fn overlay_move(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let win = ensure_window(&app)?;
        let pos = PhysicalPosition::new(x.round() as i32, y.round() as i32);
        win.set_position(pos)
            .map_err(|e| format!("移动悬浮窗失败：{e}"))?;
        note_ball(&app, &win, pos);
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = (&app, x, y);
        Err("桌面悬浮球仅桌面端支持".into())
    }
}

/// 相对移动（逻辑 px 增量）——JS 拖动兜底用，避免把 CSS 屏幕坐标硬换算成物理像素
#[tauri::command]
pub fn overlay_nudge(app: AppHandle, dx: f64, dy: f64) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let win = ensure_window(&app)?;
        let cur = win
            .outer_position()
            .map_err(|e| format!("读取悬浮窗位置失败：{e}"))?;
        let scale = win.scale_factor().unwrap_or(1.0);
        let pos = PhysicalPosition::new(
            cur.x + (dx * scale).round() as i32,
            cur.y + (dy * scale).round() as i32,
        );
        win.set_position(pos)
            .map_err(|e| format!("移动悬浮窗失败：{e}"))?;
        note_ball(&app, &win, pos);
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = (&app, dx, dy);
        Err("桌面悬浮球仅桌面端支持".into())
    }
}

/// 记球位 + 落盘（ball 态才记；形态切换的程序移动不算）
#[cfg(desktop)]
fn note_ball(app: &AppHandle, win: &WebviewWindow, pos: PhysicalPosition<i32>) {
    let recording = {
        let mut s = st();
        if s.mode != Mode::Ball {
            false
        } else {
            s.ball = Some((pos.x, pos.y));
            true
        }
    };
    if !recording {
        return;
    }
    let scale = win.scale_factor().unwrap_or(1.0);
    save_pos(app, pos.x, pos.y, scale, false);
}

/// 原生窗口拖动（macOS = performWindowDragWithEvent，必须在主线程、且紧跟用户鼠标事件）。
/// **必须是同步命令**：Tauri v2 的同步命令跑主线程，异步命令跑线程池——放异步里会读到
/// 错误的 currentEvent，拖不起来。
#[tauri::command]
pub fn overlay_drag_start(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let win = ensure_window(&app)?;
        win.start_dragging()
            .map_err(|e| format!("启动窗口拖动失败：{e}"))
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Err("桌面悬浮球仅桌面端支持".into())
    }
}

/// **唯一允许抢焦点的入口**：用户点面板输入框 → `on=true`；输入框失焦 → `on=false`。
/// 前端（overlayDesktop.ts）只在悬浮窗里监听 input/textarea 的 focusin/focusout 时调用，
/// 任何其他路径（show/hide/set_mode/拖动）都不碰 focus。
#[tauri::command]
pub fn overlay_focus(app: AppHandle, on: bool) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let Some(win) = app.get_webview_window(OVERLAY_LABEL) else {
            return Ok(());
        };
        if on {
            let _ = win.set_focusable(true);
            win.set_focus()
                .map_err(|e| format!("聚焦悬浮窗失败：{e}"))?;
            log("focus(on)：用户点了面板输入框（这是唯一会激活本体的路径）");
        } else {
            let _ = win.set_focusable(false);
        }
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = (&app, on);
        Err("桌面悬浮球仅桌面端支持".into())
    }
}
