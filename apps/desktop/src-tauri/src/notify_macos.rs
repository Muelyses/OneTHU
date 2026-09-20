//! macOS 系统通知：UNUserNotificationCenter（objc2 绑定）。
//!
//! 为什么用它而不是自建定时器：请求交给系统守护进程持久化，**App 未运行时也会送达**
//! ——这正是「关掉应用还能收到 DDL 提醒」的唯一实现路径。
//!
//! 两个已知边界：
//!   · 待投递上限 64 条（系统硬限制）。计划上限 56 条由 JS 侧 `notifyPlan.maxItems`
//!     保证，这里如实回报投递失败，不静默丢弃。
//!   · 通知点击的深链落点未接（macOS 需要在 App delegate 里处理
//!     `userNotificationCenter:didReceiveNotificationResponse:`，Tauri 侧尚无挂钩）。
//!     当前点击行为是系统默认「把应用带到前台」，落点字段照常随载荷传入，接上即可用。
//!
//! 未打包进程（无 .app 外壳、无 bundle id）调用通知中心会拿到 nil 甚至崩，
//! 故入口先查 bundle id 并回报 `not-bundled`——dev-launch.sh 走 .app wrapper，
//! 正常开发路径不受影响。

use std::ptr::NonNull;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2_foundation::{NSArray, NSBundle, NSError, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
    UNNotificationRequest, UNNotificationSettings, UNTimeIntervalNotificationTrigger,
    UNUserNotificationCenter,
};

/// 授权弹窗等待上限（首次 TCC 框需要用户操作）
const PERMISSION_TIMEOUT: Duration = Duration::from_secs(120);
/// 单次通知中心调用的等待上限
const CALL_TIMEOUT: Duration = Duration::from_secs(20);

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn center() -> Result<Retained<UNUserNotificationCenter>, String> {
    let main_bundle = unsafe { NSBundle::mainBundle() };
    if unsafe { main_bundle.bundleIdentifier() }.is_none() {
        return Err("not-bundled".into());
    }
    Ok(unsafe { UNUserNotificationCenter::currentNotificationCenter() })
}

/// 查询授权状态；`request = true` 时先发起授权请求（首次会弹系统框）。
pub fn status(request: bool) -> Result<bool, String> {
    let center = center()?;

    if request {
        let (tx, rx) = mpsc::channel::<bool>();
        let block = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });
        let options = UNAuthorizationOptions::Alert
            | UNAuthorizationOptions::Sound
            | UNAuthorizationOptions::Badge;
        center.requestAuthorizationWithOptions_completionHandler(options, &block);
        // 用户没点（或系统未回调）也要能继续：超时后按当前状态判断
        let _ = rx.recv_timeout(PERMISSION_TIMEOUT);
    }

    let (tx, rx) = mpsc::channel::<isize>();
    let block = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
        // SAFETY: 回调期间 settings 由系统保证有效
        let status = unsafe { settings.as_ref().authorizationStatus() };
        let _ = tx.send(status.0);
    });
    center.getNotificationSettingsWithCompletionHandler(&block);
    let code = rx
        .recv_timeout(CALL_TIMEOUT)
        .map_err(|_| "查询通知授权状态超时".to_string())?;
    Ok(code == UNAuthorizationStatus::Authorized.0 || code == UNAuthorizationStatus::Provisional.0)   // NSInteger = isize
}

/// 排一条定时通知；`at_ms` 为绝对时刻（本地时区语义由调用方保证）。
pub fn add(id: &str, at_ms: i64, title: &str, body: &str) -> Result<(), String> {
    let center = center()?;
    let secs = (at_ms - now_ms()) as f64 / 1000.0;
    if secs <= 0.5 {
        return Err("in-past".into());
    }

    let content = unsafe { UNMutableNotificationContent::new() };
    unsafe {
        content.setTitle(&NSString::from_str(title));
        content.setBody(&NSString::from_str(body));
    }
    // 相对触发：本应用在任何数据变化与启动时都会重排（见 state/notifyScheduler.ts），
    // 故「相对当前时刻的秒数」等价于按绝对时刻投递，且不必构造 NSDateComponents。
    let trigger = unsafe { UNTimeIntervalNotificationTrigger::triggerWithTimeInterval_repeats(secs, false) };
    let request = unsafe {
        UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(id),
            &content,
            Some(&trigger),
        )
    };

    let (tx, rx) = mpsc::channel::<Option<String>>();
    let block = RcBlock::new(move |err: *mut NSError| {
        let msg = if err.is_null() {
            None
        } else {
            // SAFETY: 回调期间 error 由系统保证有效
            Some(unsafe { (*err).localizedDescription() }.to_string())
        };
        let _ = tx.send(msg);
    });
    center.addNotificationRequest_withCompletionHandler(&request, Some(&block));
    match rx.recv_timeout(CALL_TIMEOUT) {
        Ok(None) => Ok(()),
        Ok(Some(msg)) => Err(msg),
        Err(_) => Err("投递请求超时".into()),
    }
}

/// 撤销待投递通知（按 id 覆盖/撤销是系统通知层唯一的去重手段）
pub fn cancel(ids: &[String]) {
    if ids.is_empty() {
        return;
    }
    let Ok(center) = center() else { return };
    let arr: Vec<Retained<NSString>> = ids.iter().map(|s| NSString::from_str(s)).collect();
    let ns = NSArray::from_retained_slice(&arr);
    unsafe { center.removePendingNotificationRequestsWithIdentifiers(&ns) };
}

/// 系统侧当前待投递的 id 列表（与 JS 侧指纹表对账用）
pub fn pending_ids() -> Result<Vec<String>, String> {
    let center = center()?;
    let (tx, rx) = mpsc::channel::<Vec<String>>();
    let block = RcBlock::new(move |arr: NonNull<NSArray<UNNotificationRequest>>| {
        let list = unsafe { arr.as_ref() };
        let mut out = Vec::new();
        for i in 0..list.len() {
            let req = unsafe { list.objectAtIndex(i) };
            out.push(req.identifier().to_string());
        }
        let _ = tx.send(out);
    });
    center.getPendingNotificationRequestsWithCompletionHandler(&block);
    rx.recv_timeout(CALL_TIMEOUT)
        .map_err(|_| "查询待投递通知超时".to_string())
}

/// 立即投递一条测试通知（设置页「试一下」）
pub fn test() -> Result<(), String> {
    let id = format!("onethu-test-{}", now_ms());
    add(&id, now_ms() + 1500, "OneTHU 提醒测试", "看到这条说明 macOS 通知渠道已就绪。")
}
