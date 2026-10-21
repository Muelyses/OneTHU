# Mobile shell and widget refinement implementation plan

**Goal:** Fix mobile safe-area ownership, compact controls and fully usable widget sheets; replace Android 0.11 download channels after verification.

**Architecture:** Native Android continues to pad system/IME insets. CSS consumes the shared OneGUI safe-area roles only when native padding is absent. A single mobile dock geometry aligns the OH capsule and OneShot across all three modes. Widget sheets cover navigation and keep headers/actions outside their scrollable content.

**Tech Stack:** React, OneGUI CSS tokens/recipes, Tauri Android/Kotlin, Chromium touch fixtures, signed Gradle release.

## 1. Reproduce and refine shell
- Inspect `apps/desktop/src/App.tsx`, `packages/gui/src/tokens/structure.css`, `packages/gui/src/recipes/workbench.css` and host styles.
- Capture mobile geometry before changes; check both browser safe areas and native-owned insets.
- Compact mobile control heights/padding while retaining accessible hit areas. Preserve desktop density and board editing gate.

## 2. Repair widget selection and presentation
- Remove obsolete dock-island clearance from `BoardAddDrawer.tsx`; clamp sheet drag height to available viewport.
- Give shared home modal masks OneGUI overlay priority, nested pickers higher priority, stable headers and independent scrolling.
- Refine component preview cards and Android widget settings; reuse translated copy.

## 3. Verify and publish
- Add focused browser regressions covering full/practical/minimal modes, 360/390px portrait and short landscape, safe areas, sheet scrolling, reachable last item/confirm and compact controls.
- Run insets guard, CSS/token checks, desktop typecheck and widget/board regressions. Inspect screenshots. No connected Android device: state this limitation explicitly.
- Commit/push source, build signed Android versionCode 11005 with logo verification, replace APK/checksums/manifests in GitHub Release and existing cloud folder; preserve macOS/Windows bytes.
- Refresh website download metadata, verify public hashes and record final results.

## Implementation and verification (2026-10-21)

- Native insets retain system-bar/keyboard padding; shared OneGUI safe roles become zero only after an `{ok:true}` acknowledgement. Browser safe areas remain active.
- Phone dock 60px + effective safe area, OH capsule 44px, OneShot 36px with expanded touch area and 8px dock gap. Secondary/default/large phone controls 36/40/44px; floating controls 44px.
- Widget drawer uses available dynamic viewport, 72% portrait / nearly full short landscape; stale dock clearance removed. Persistent navigation cannot cover the picker or confirm button.
- Shared binding/collection modals now use modal priority and scroll independently. Back dismisses the active picker. Binding close animation resets on reopening; child scrim clicks do not close the parent.
- Widget titles, actual assignment names, course names/times and balances use a clear primary/secondary hierarchy. Native widget rows 15sp, secondary text 12sp, larger values 20sp; sizing measurement and XML match. Source colours remain in side bars; text retains readable ink on light/dark surfaces.
- Browser test exercises all three modes, 360/390px portrait, 844px landscape, browser/native safe-area ownership, actual touch scrolling, final picker row and confirmation, nested Android binding and repeated close/reopen. Board edit gate regression remains unchanged.
- No physical Android device is attached. Browser interaction, Kotlin compile/JVM tests and signed APK validation do not constitute physical-device acceptance.
- Publishing target: Android 0.11.0 versionCode 11005, same production signing certificate and canonical stacked logo. macOS/Windows assets remain unchanged.

### Validation evidence

- `tools/mobile-shell-widgets-browser-test.mjs`: 73 interaction/layout assertions passed; synthetic safe-area values exercise ownership, not a claim of native WebView execution.
- `tools/board-mobile-edit-browser-test.mjs`: lock, edit, touch scroll, drag, resize and Home/OnePage independence passed; desktop remains directly editable.
- `tools/widget-native-kotlin-test.mjs`: actual renderer compiles against Android API 36, 14 JVM checks passed. Native launcher screenshots still require a physical device.
- Desktop TypeScript and i18n check passed, 7,552/7,552 bilingual catalog entries and 62 native fallback templates.
- CSS parse, token, inset, modal/platform, density, control and native-widget guards passed.
- Full `pnpm guard` stops at existing `ui-copy-lint` findings in legacy Visit/library error text (unmodified in this change). This is not reported as an all-green full guard.

### Published Android replacement

- Source: `4957bc9cb20187fee7f6e4743e41c8031cfe01e8` (main, production code).
- Android: 0.11.0 / versionCode **11005**, ARM64, 31,814,517 bytes, existing release certificate.
- SHA256: `e4cba247b3d89474f650f9ff8957ab644bfa2e458a2996a20344d026648b2887`.
- Canonical stacked Logo: 15 compiled PNGs checked pixel-for-pixel; standard, round and adaptive manifest bindings verified.
- GitHub `v0.11.0` APK, SHA256SUMS and latest.json replaced; existing cloud `/Android` APK plus root manifests/checksums replaced. macOS and Windows installer digests unchanged.
- Public mirror verifier downloaded the actual installers anonymously from each system folder and matched GitHub digests; both latest.json manifests and runtime GitHub-to-cloud fallback passed.
- Website snapshot and bilingual download hashes updated in `OneTHU/onethu.github.io` commit `47f388ec9f3521cc5df29d13a9838e0798bb5921`; Pages run `39625717180`.
- Small button visual bounds 36px retain 44px hit areas via transparent extensions, checked with actual hit testing.
