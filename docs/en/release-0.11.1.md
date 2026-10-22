# OneTHU 0.11.1 · Revolution maintenance update

[中文](../release-0.11.1.md) · [English](release-0.11.1.md)

This update restores secondary-registration courses and their synchronization on macOS, Windows and Android.

- Secondary timetables accept both Chinese and English week labels, including the school portal’s `week 4` format.
- The weekly timeline automatically adds secondary courses once the academic calendar is ready.
- The monthly agenda includes the same secondary courses, dates, session times and details.
- A retry message appears when the secondary timetable refresh fails, while other courses remain visible.
- System-calendar sync uses a new complete-semester cache validated against both course sources, preserving existing content on failure.
- Android uses version 0.11.1 and versionCode 11008, with the existing production signing certificate and stacked logo.

After upgrading, refresh in Schedule settings to reload courses. Update detection, GitHub downloads and the Tsinghua cloud mirror are updated with this release.

## Phone controls and layout

- Full and Practical offer bottom shortcuts or side navigation in onboarding and settings, with separate saved choices. Minimal keeps its fixed navigation.
- Board editing retains the current zoom and layout, with clearer controls, Undo and confirmed Restore defaults.
- Drag the vault toward an edge to dock and half-hide it. Tap once to open it, or drag inward for free placement. Transfers expand the target.
- Android OH has a more prominent Collapse control.
- Organization management and editing open above the settings overlay.
- Update checks keep their loading text and spinner, use bounded source fallback, and support Cancel and Retry in all three modes.
