// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0 OR MIT
// OneTHU: bounded startup wait, backported from upstream Windows implementation.
use std::{convert::Infallible, time::Duration};

/// A second process must terminate even when the first process has acquired its
/// mutex but has not published the IPC window yet. Infallible prevents falling
/// through into ordinary application startup after the bounded probe.
pub fn finish_secondary<T>(
    mut find: impl FnMut() -> Option<T>,
    mut wait: impl FnMut(Duration),
    forward: impl FnOnce(T),
    exit: impl FnOnce() -> Infallible,
) -> Infallible {
    let mut target = None;
    for _ in 0..40 {
        target = find();
        if target.is_some() {
            break;
        }
        wait(Duration::from_millis(25));
    }
    if let Some(target) = target {
        forward(target);
    }
    exit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::Cell,
        panic::{catch_unwind, panic_any, AssertUnwindSafe},
    };

    #[derive(Debug, PartialEq)]
    struct SecondaryExited;

    fn scenario(ready_after: Option<usize>, expected_probes: usize, expected_waits: usize) {
        let probes = Cell::new(0);
        let waits = Cell::new(0);
        let forwards = Cell::new(0);
        let result = catch_unwind(AssertUnwindSafe(|| {
            let _never = finish_secondary(
                || {
                    probes.set(probes.get() + 1);
                    ready_after.filter(|n| probes.get() >= *n)
                },
                |delay| {
                    assert_eq!(delay, Duration::from_millis(25));
                    waits.set(waits.get() + 1);
                },
                |_| forwards.set(forwards.get() + 1),
                || panic_any(SecondaryExited),
            );
        }));
        assert_eq!(
            result.unwrap_err().downcast_ref::<SecondaryExited>(),
            Some(&SecondaryExited)
        );
        assert_eq!(probes.get(), expected_probes);
        assert_eq!(waits.get(), expected_waits);
        assert_eq!(forwards.get(), usize::from(ready_after.is_some()));
    }

    #[test]
    fn ready_instance_is_forwarded_then_secondary_exits() {
        scenario(Some(1), 1, 0);
    }

    #[test]
    fn startup_race_waits_until_ipc_is_ready_then_secondary_exits() {
        scenario(Some(3), 3, 2);
    }

    #[test]
    fn missing_ipc_times_out_and_secondary_exits_without_starting_an_app() {
        scenario(None, 40, 40);
    }
}
