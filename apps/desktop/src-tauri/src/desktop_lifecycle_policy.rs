//! Close/reopen policy, shared by the native adapter and offline behavior tests.
use std::sync::atomic::{AtomicBool, Ordering};

pub trait Windows {
    fn overlay_visible(&self) -> bool;
    fn hide_main(&self) -> Result<(), String>;
    fn show_main(&self) -> Result<(), String>;
    fn focus_main(&self) -> Result<(), String>;
    fn exit(&self);
}

#[derive(Default)]
pub struct Lifecycle {
    main_closed: AtomicBool,
}

impl Lifecycle {
    /// OH may continue in the background; retain main so an explicit reopen can
    /// use the same WebView/session. With no OH, close the whole application,
    /// including any previously hidden overlay WebView.
    pub fn close_main(&self, windows: &impl Windows) -> Result<(), String> {
        if windows.overlay_visible() {
            windows.hide_main()?;
            self.main_closed.store(true, Ordering::SeqCst);
            // OH can finish closing between the first visibility check and
            // main.hide(). Do not leave both windows hidden in that case.
            self.overlay_hidden(windows);
        } else {
            windows.exit();
        }
        Ok(())
    }

    pub fn activate_main(&self, windows: &impl Windows) -> Result<(), String> {
        windows.show_main()?;
        self.main_closed.store(false, Ordering::SeqCst);
        // Windows may deny foreground activation after successfully showing
        // main. The visible window still owns the app; focus is best effort.
        let _ = windows.focus_main();
        Ok(())
    }

    pub fn overlay_hidden(&self, windows: &impl Windows) {
        if !windows.overlay_visible() && self.main_closed.swap(false, Ordering::SeqCst) {
            windows.exit();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[derive(Default)]
    struct FakeWindows {
        main_visible: Cell<bool>,
        overlay_visible: Cell<bool>,
        activations: Cell<usize>,
        exits: Cell<usize>,
        hide_fails: Cell<bool>,
        activate_fails: Cell<bool>,
        focus_fails: Cell<bool>,
        overlay_closes_during_hide: Cell<bool>,
    }

    impl Windows for FakeWindows {
        fn overlay_visible(&self) -> bool {
            self.overlay_visible.get()
        }
        fn hide_main(&self) -> Result<(), String> {
            if self.hide_fails.get() {
                return Err("hide failed".into());
            }
            self.main_visible.set(false);
            if self.overlay_closes_during_hide.get() {
                self.overlay_visible.set(false);
            }
            Ok(())
        }
        fn show_main(&self) -> Result<(), String> {
            if self.activate_fails.get() {
                return Err("activate failed".into());
            }
            self.main_visible.set(true);
            self.activations.set(self.activations.get() + 1);
            Ok(())
        }
        fn focus_main(&self) -> Result<(), String> {
            if self.focus_fails.get() {
                Err("focus denied".into())
            } else {
                Ok(())
            }
        }
        fn exit(&self) {
            self.exits.set(self.exits.get() + 1);
        }
    }

    fn open_windows() -> FakeWindows {
        let windows = FakeWindows::default();
        windows.main_visible.set(true);
        windows.overlay_visible.set(true);
        windows
    }

    #[test]
    fn close_then_repeated_launch_reuses_the_main_window_and_keeps_oh() {
        let lifecycle = Lifecycle::default();
        let windows = open_windows();
        lifecycle.close_main(&windows).unwrap();
        assert!(!windows.main_visible.get());
        assert!(windows.overlay_visible.get());
        assert_eq!(windows.exits.get(), 0);
        for _ in 0..5 {
            lifecycle.activate_main(&windows).unwrap();
        }
        assert!(windows.main_visible.get());
        assert_eq!(windows.activations.get(), 5);
        windows.overlay_visible.set(false);
        lifecycle.overlay_hidden(&windows);
        assert_eq!(windows.exits.get(), 0, "reopened main still owns the app");
    }

    #[test]
    fn closing_oh_after_main_exits_once_without_a_stranded_hidden_process() {
        let lifecycle = Lifecycle::default();
        let windows = open_windows();
        lifecycle.close_main(&windows).unwrap();
        windows.overlay_visible.set(false);
        lifecycle.overlay_hidden(&windows);
        lifecycle.overlay_hidden(&windows);
        assert_eq!(windows.exits.get(), 1);
    }

    #[test]
    fn closing_main_with_no_visible_oh_exits_including_a_hidden_overlay() {
        let lifecycle = Lifecycle::default();
        let windows = open_windows();
        windows.overlay_visible.set(false);
        lifecycle.close_main(&windows).unwrap();
        assert_eq!(windows.exits.get(), 1);
    }

    #[test]
    fn hiding_oh_with_main_open_or_minimized_keeps_the_app() {
        let lifecycle = Lifecycle::default();
        let windows = open_windows();
        windows.main_visible.set(false); // minimizing is not an explicit close
        windows.overlay_visible.set(false);
        lifecycle.overlay_hidden(&windows);
        assert_eq!(windows.exits.get(), 0);
    }

    #[test]
    fn failed_hide_retains_main_and_never_marks_it_closed() {
        let lifecycle = Lifecycle::default();
        let windows = open_windows();
        windows.hide_fails.set(true);
        assert!(lifecycle.close_main(&windows).is_err());
        assert!(windows.main_visible.get());
        windows.overlay_visible.set(false);
        lifecycle.overlay_hidden(&windows);
        assert_eq!(windows.exits.get(), 0);
    }

    #[test]
    fn failed_reopen_does_not_leave_a_hidden_process_when_oh_closes() {
        let lifecycle = Lifecycle::default();
        let windows = open_windows();
        lifecycle.close_main(&windows).unwrap();
        windows.activate_fails.set(true);
        assert!(lifecycle.activate_main(&windows).is_err());
        windows.overlay_visible.set(false);
        lifecycle.overlay_hidden(&windows);
        assert_eq!(windows.exits.get(), 1);
    }

    #[test]
    fn denied_focus_after_successful_show_keeps_the_reopened_app() {
        let lifecycle = Lifecycle::default();
        let windows = open_windows();
        lifecycle.close_main(&windows).unwrap();
        windows.focus_fails.set(true);
        lifecycle.activate_main(&windows).unwrap();
        assert!(windows.main_visible.get());
        windows.overlay_visible.set(false);
        lifecycle.overlay_hidden(&windows);
        assert_eq!(windows.exits.get(), 0);
    }

    #[test]
    fn oh_closing_during_main_hide_does_not_strand_an_invisible_process() {
        let lifecycle = Lifecycle::default();
        let windows = open_windows();
        windows.overlay_closes_during_hide.set(true);
        lifecycle.close_main(&windows).unwrap();
        assert!(!windows.main_visible.get());
        assert!(!windows.overlay_visible.get());
        assert_eq!(windows.exits.get(), 1);
    }
}
