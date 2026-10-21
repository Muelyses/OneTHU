# OneGUI theme, material and editable home canvas

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


Goal: repair theme injection, segment contrast and glass, then bring all home content into one persistent canvas.

## Decisions / ADR

- Theme definitions are the source of palette values. The app converts legacy theme roles to OneGUI surface/content/line/font roles; the director applies and clears those roles together with the accent. Never sample the bridge's own CSS output for installed themes. Keep the historical ivory ID, rename its display name to 石墨.
- Material is independent of palette. Blur/translucency belongs on shell chrome, standalone cards and overlay surfaces. Inputs, action buttons, segments and sticky notes retain readable opaque fills. Avoid nested blur and solid ancestor layers concealing wallpaper.
- Segment selection paints the background and foreground on the same element. The animated legacy pill cannot determine text contrast.
- The home canvas owns clock, large title, service area and four information widgets. Fresh/reset layouts use the requested composition. Existing layouts receive a one-time addition of former fixed chrome, preserving authored content; deleting a widget after migration never resurrects it.
- Browsing and editing are separate interaction states. Inner carousel gestures work while browsing; moving/resizing requires editing and explicit handles. The zoom and edit/add tools live in a viewport toolbar above content but below dialogs and navigation overlays.

## Implementation

1. Extend the director's theme input with controlled palette roles and full cleanup; map the current effective scheduled theme; repair settings/theme picker swatch layout.
2. Apply material roles to visible surfaces and remove competing solid layers; bind every segment's active ink/fill atomically.
3. Extract the tasks carousel for shared use and register today tasks, service area, clock and editable title.
4. Seed the requested seven-item home layout and add idempotent preservation migration for existing boards.
5. Add explicit edit mode, reliable drag handles, keyboard movement/resizing, practical size limits and viewport zoom/edit/add toolbar.
6. Verify theme/scheme/material combinations, old-layout migration, note persistence, carousel interaction, drag/resize, toolbar scrolling and narrow screens. Run typecheck, build, relevant board and OneGUI checks. Capture desktop/mobile artifacts.

## Risks and validation

Palette switch must remove all previous overrides; partial/custom palettes must retain contrast. Keep stable action roles separate from theme accents. Existing data must not reset, duplicate or resurrect deleted chrome components. Multiple kept-alive tabs must not produce competing fixed toolbars. Zoom must preserve a useful visible anchor and not move while typing. Mobile browsing must scroll naturally; editing must remain reachable.

## Completion

All six implementation stages completed. Validation and screenshots are in `docs/onegui/theme-home/README.md`. Preserved user-authored layouts use the one-time version migration; users can explicitly apply the default-home template. Browser regressions include 80 current-task assertions, 223 viewport/overflow assertions and 34 previous-feedback assertions; pure model tests include 79 theme/home assertions. Native WebView material rendering remains to be checked on device.
