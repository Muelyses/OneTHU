# OneTHU 0.11.1 · Revolution maintenance update

[中文](../release-0.11.1.md) · [English](release-0.11.1.md)

This update restores secondary-registration courses and their synchronization on macOS, Windows and Android.

- Secondary timetables accept both Chinese and English week labels, including the school portal’s `week 4` format.
- The weekly timeline automatically adds secondary courses once the academic calendar is ready.
- The monthly agenda includes the same secondary courses, dates, session times and details.
- A retry message appears when the secondary timetable refresh fails, while other courses remain visible.
- System-calendar sync uses a new complete-semester cache validated against both course sources, preserving existing content on failure.
- Android uses version 0.11.1 and versionCode 11009, with the existing production signing certificate and stacked logo.

After upgrading, refresh in Schedule settings to reload courses. Update detection, GitHub downloads and the Tsinghua cloud mirror are updated with this release.

## Phone controls and layout

- Phone navigation offers bottom OneShot shortcuts or a top-left button opening a vertical feature overlay: five entries in Minimal, all primary features in Full and Practical. Each mode saves its own setting; Full and Practical include the choice in onboarding.
- Board editing retains the current zoom and layout, with clearer controls, Undo and confirmed Restore defaults.
- Drag the vault toward an edge to dock and half-hide it. Tap once to open it, or drag inward for free placement. Transfers expand the target.
- Android OH has a more prominent Collapse control.
- Organization management and editing open above the settings overlay.
- Update checks keep their loading text and spinner, use bounded source fallback, and support Cancel and Retry in all three modes.

## Revised installers · October 22

Widget previews now use isolated, read-only data scopes. Sample courses, assignments and files remain within the preview while live searches and background refreshes use account data. All three installers include this fix.

If you already installed 0.11.1, download it again and install over your current version to retain data. Older clients compare version numbers and do not notify about same-version revisions. Android versionCode is now 11009.
