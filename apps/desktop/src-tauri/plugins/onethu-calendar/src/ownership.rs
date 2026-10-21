//! App-private binding: display names never confer ownership of a user's calendar.
use std::path::Path;
use serde::{Deserialize, Serialize};
use crate::{SyncPayload, CALENDAR_TITLE};

#[derive(Default, Debug, Serialize, Deserialize)]
pub(crate) struct CalendarBinding {
    pub id: Option<String>,
    pub window_start_ms: Option<i64>,
    pub window_end_ms: Option<i64>,
}

impl CalendarBinding {
    pub fn read(path: &Path) -> Result<Self, String> {
        match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("系统日历绑定文件损坏：{e}")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(format!("读取系统日历绑定失败：{e}")),
        }
    }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec(self).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        std::fs::rename(tmp, path).map_err(|e| format!("保存系统日历绑定失败：{e}"))
    }
    /// Record the union before committing. A failed sync then remains safely retryable.
    pub fn include_window(&mut self, start: i64, end: i64) -> (i64, i64) {
        let start = self.window_start_ms.map_or(start, |v| v.min(start));
        let end = self.window_end_ms.map_or(end, |v| v.max(end));
        self.window_start_ms = Some(start);
        self.window_end_ms = Some(end);
        (start, end)
    }
}

pub(crate) fn validate_payload(p: &SyncPayload) -> Result<(), String> {
    if p.calendar_title != CALENDAR_TITLE { return Err("只能同步 OneTHU 专属日历".into()); }
    if p.window_start_ms >= p.window_end_ms || p.events.len() > 4000 { return Err("系统日历范围或事件数无效".into()); }
    for e in &p.events {
        if e.start_ms >= e.end_ms || e.start_ms < p.window_start_ms || e.end_ms > p.window_end_ms {
            return Err("系统日历事件时间无效，未修改已有事件".into());
        }
        if e.alarm_minutes.is_some_and(|v| !(0..=43_200).contains(&v)) { return Err("系统日历提醒时间无效".into()); }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SysCalEvent;
    fn payload() -> SyncPayload {
        SyncPayload { calendar_title: CALENDAR_TITLE.into(), window_start_ms: 0, window_end_ms: 1000,
            events: vec![SysCalEvent { title: "fixture".into(), start_ms: 200, end_ms: 300, all_day: false,
                location: None, notes: None, alarm_minutes: Some(0) }] }
    }
    #[test]
    fn validate_before_native_mutation() {
        assert!(validate_payload(&payload()).is_ok());
        let mut p = payload(); p.calendar_title = "Private".into(); assert!(validate_payload(&p).is_err());
        let mut p = payload(); p.events[0].end_ms = 1001; assert!(validate_payload(&p).is_err());
        let mut p = payload(); p.events[0].end_ms = 200; assert!(validate_payload(&p).is_err());
        let mut p = payload(); p.events[0].alarm_minutes = Some(-1); assert!(validate_payload(&p).is_err());
    }
    #[test]
    fn ownership_and_old_window_survive_restart_and_failure() {
        let path = std::env::temp_dir().join(format!("onethu-calendar-binding-test-{}.json", std::process::id()));
        let mut b = CalendarBinding::default(); b.id = Some("fixture-calendar-id".into());
        assert_eq!(b.include_window(20, 100), (20, 100)); b.save(&path).unwrap();
        let mut reloaded = CalendarBinding::read(&path).unwrap();
        assert_eq!(reloaded.id.as_deref(), Some("fixture-calendar-id"));
        assert_eq!(reloaded.include_window(50, 80), (20, 100));
        assert_eq!(reloaded.include_window(10, 120), (10, 120));
        std::fs::write(&path, b"broken").unwrap(); assert!(CalendarBinding::read(&path).is_err());
        std::fs::remove_file(path).unwrap();
    }
}
