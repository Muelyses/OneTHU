//! 桌面端通知投递入口（macOS 已实现；Windows 待接）。
//!
//! 与 Android 的关系：Android 走 onethu-mobile 插件落到 AlarmManager，桌面走本模块。
//! 三端共用同一份「计划」（JS 侧 notifyPlan.ts）与同一套「对齐口径」
//! （JS 侧 notifyScheduler.ts：内容变或原生丢了就排、计划没有就撤、一致则不动），
//! 这里只负责把单条通知真正交给系统，并如实回报失败原因。
//!
//! 渠道概念是 Android 特有的（NotificationChannel）；macOS 没有等价物，
//! 故 `channel` 字段在桌面端被忽略，不影响 JS 侧共用一份载荷。

use serde_json::{json, Value};

/// 单条待排通知（JS 侧载荷的子集；桌面端用不到 channel/target）
struct Item {
    id: String,
    at: i64,
    title: String,
    body: String,
}

fn parse_items(items_json: &str) -> Result<Vec<Item>, String> {
    let raw: Value = serde_json::from_str(items_json).map_err(|e| format!("载荷解析失败：{e}"))?;
    let arr = raw.as_array().ok_or_else(|| "载荷应为数组".to_string())?;
    let mut out = Vec::with_capacity(arr.len());
    for v in arr {
        let id = v.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
        let at = v.get("at").and_then(Value::as_i64).unwrap_or(0);
        if id.is_empty() || at <= 0 {
            continue;
        }
        out.push(Item {
            id,
            at,
            title: v.get("title").and_then(Value::as_str).unwrap_or("OneTHU").to_string(),
            body: v.get("body").and_then(Value::as_str).unwrap_or_default().to_string(),
        });
    }
    Ok(out)
}

fn parse_ids(ids_json: &str) -> Vec<String> {
    serde_json::from_str::<Value>(ids_json)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

/// 本机后端类型：macOS 已接（其余桌面平台待接 WinRT toast）
#[cfg(target_os = "macos")]
pub fn backend() -> String {
    "macos".into()
}

#[cfg(not(target_os = "macos"))]
pub fn backend() -> String {
    "none".into()
}

/* ── macOS ── */

#[cfg(target_os = "macos")]
pub fn permission(request: bool) -> Value {
    match crate::notify_macos::status(request) {
        Ok(granted) => json!({ "ok": true, "granted": granted, "exact": true, "platform": "macos" }),
        Err(e) => json!({ "ok": false, "granted": false, "exact": false, "reason": e }),
    }
}

#[cfg(target_os = "macos")]
pub fn schedule(items_json: &str) -> Value {
    let items = match parse_items(items_json) {
        Ok(v) => v,
        Err(e) => return json!({ "ok": false, "scheduled": 0, "reason": e }),
    };
    let mut scheduled = 0usize;
    let mut last_err: Option<String> = None;
    for it in &items {
        match crate::notify_macos::add(&it.id, it.at, &it.title, &it.body) {
            Ok(()) => scheduled += 1,
            Err(e) => last_err = Some(e),
        }
    }
    let failed = items.len() - scheduled;
    json!({
        "ok": failed == 0,
        "scheduled": scheduled,
        "failed": failed,
        "exact": true,
        "reason": last_err.unwrap_or_default()
    })
}

#[cfg(target_os = "macos")]
pub fn cancel(ids_json: &str) -> Value {
    let ids = parse_ids(ids_json);
    let n = ids.len();
    crate::notify_macos::cancel(&ids);
    json!({ "ok": true, "cancelled": n })
}

#[cfg(target_os = "macos")]
pub fn pending() -> Value {
    match crate::notify_macos::pending_ids() {
        Ok(ids) => json!({ "ok": true, "ids": ids }),
        Err(e) => json!({ "ok": false, "ids": [], "reason": e }),
    }
}

#[cfg(target_os = "macos")]
pub fn test() -> Value {
    match crate::notify_macos::test() {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "reason": e }),
    }
}

/* ── Windows / 其他桌面（下一轮接入 WinRT toast） ── */

#[cfg(not(target_os = "macos"))]
pub fn permission(_request: bool) -> Value {
    json!({ "ok": false, "granted": false, "exact": false, "reason": "not-implemented-desktop" })
}

#[cfg(not(target_os = "macos"))]
pub fn schedule(_items_json: &str) -> Value {
    json!({ "ok": false, "scheduled": 0, "reason": "not-implemented-desktop" })
}

#[cfg(not(target_os = "macos"))]
pub fn cancel(_ids_json: &str) -> Value {
    json!({ "ok": false, "cancelled": 0, "reason": "not-implemented-desktop" })
}

#[cfg(not(target_os = "macos"))]
pub fn pending() -> Value {
    json!({ "ok": false, "ids": [], "reason": "not-implemented-desktop" })
}

#[cfg(not(target_os = "macos"))]
pub fn test() -> Value {
    json!({ "ok": false, "reason": "not-implemented-desktop" })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn backend_is_known_value() {
        let b = backend();
        // 前端按这个值决定是否启动调度链，返回空串或未约定值会让 macOS 静默不工作
        assert!(matches!(b.as_str(), "macos" | "windows" | "none"), "未知后端：{b}");
    }

    #[test]
    fn parse_items_keeps_valid_and_drops_broken() {
        let payload = json!([
            { "id": "ddl:h1:120", "at": 1_760_000_000_000i64, "title": "DDL · 高数", "body": "第三章习题" },
            { "id": "", "at": 1_760_000_000_000i64 },                 // 缺 id
            { "id": "x", "at": 0 },                                    // 时刻非法
            { "at": 1_760_000_000_000i64 }                             // 缺 id
        ])
        .to_string();
        let items = parse_items(&payload).expect("载荷应可解析");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "ddl:h1:120");
        assert_eq!(items[0].title, "DDL · 高数");
    }

    #[test]
    fn parse_items_tolerates_missing_optional_fields() {
        let payload = json!([{ "id": "class:a", "at": 1_760_000_000_000i64 }]).to_string();
        let items = parse_items(&payload).expect("载荷应可解析");
        assert_eq!(items[0].title, "OneTHU");   // 缺标题时的兜底，不该是空串
        assert_eq!(items[0].body, "");
    }

    #[test]
    fn bad_payload_reports_reason_instead_of_panicking() {
        let v = schedule("{ 不是 JSON");
        assert_eq!(v["ok"], json!(false));
        assert_eq!(v["scheduled"], json!(0));
        assert!(v["reason"].as_str().unwrap_or("").contains("解析失败"));
    }

    #[test]
    fn payload_must_be_array() {
        let v = schedule("{\"id\":\"a\"}");
        assert_eq!(v["ok"], json!(false));
        assert!(v["reason"].as_str().unwrap_or("").contains("数组"));
    }

    #[test]
    fn parse_ids_ignores_non_strings() {
        let ids = parse_ids("[\"a\", 1, null, \"b\"]");
        assert_eq!(ids, vec!["a".to_string(), "b".to_string()]);
        assert!(parse_ids("不是数组").is_empty());
    }

    #[test]
    fn cancel_with_empty_ids_is_ok() {
        let v = cancel("[]");
        assert_eq!(v["ok"], json!(true));
        assert_eq!(v["cancelled"], json!(0));
    }
}
