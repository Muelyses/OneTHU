# OneTHU compatibility patch

Base: official `tauri-plugin-single-instance 2.4.5` crate, compatible with the
project's locked Tauri 2.11.6. Original MIT and Apache 2.0 licenses are included.

- Crate: <https://crates.io/crates/tauri-plugin-single-instance/2.4.5>
- Original crate SHA-256: `db817fe9295e19b7d8357e900af31edb93703dd9fb6de524b007b47b6afc63b0`
- Published source commit: `5baf71a47292d8490f0ba3d53f15224e55c48327`
- Source directory: `plugins/single-instance` in <https://github.com/tauri-apps/plugins-workspace>
- Backport reference, inspected 2026-10-22: <https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/single-instance/src/platform_impl/windows.rs>

## Local changes

1. Windows waits at most 40 × 25 ms for the first instance's IPC window after
   detecting its mutex. The secondary process exits after forwarding or timeout.
   The previous version fell through into normal startup when the window was
   not ready, creating another application/OH instance.
2. Windows activation forwarding uses upstream's `SendMessageTimeoutW` with a
   10-second bound instead of unbounded `SendMessageW`.
3. The retry/termination control flow is extracted into `secondary_launch.rs`.
   Its `Infallible` return type makes continuing ordinary app startup impossible.
   `node tools/desktop-lifecycle-policy-test.mjs` compiles and tests immediate
   ready, delayed ready, and timeout paths, in addition to the app's eight window
   lifecycle cases. Windows GUI/IPC integration is validated separately.

Linux/macOS implementations and the existing activation payload format remain
the 2.4.5 code. Only package metadata, sources, README, security policy, source
provenance and licenses are vendored; the crate's own lockfile/changelog/cache
marker are omitted. The app's Cargo.lock remains authoritative.

When the project moves to Tauri 2.12 or later, review the current official
single-instance plugin's corresponding fixes, then remove this directory and
the application's `[patch.crates-io]` entry. Avoid updating this fork separately
from that compatibility review.
