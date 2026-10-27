# OneTHU 0.11.4-fix-1 · Revolution

[中文](../release-0.11.4-fix-1.md) · [Installers](https://github.com/smartThise/OneTHU/releases/tag/v0.11.4-fix-1) · [Tsinghua Cloud](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/)

This repair retains the CLI, SDK, OH and interface features from 0.11.4.

- Windows: repair resident startup and private session permissions. Desktop university sign-in and owned local-session recovery remain available when the background runtime is unavailable. Account ownership, explicit logout and 2FA continue to protect later handoffs.
- Home courses: whiteboards and compact modes share the primary and secondary timetable source. Loading, failure with retry, and successful empty results have separate states.
- Tablets: restore scrolling to the end of practical-mode settings. Touch whiteboards start in reading mode and require explicit editing before moving or resizing items.
- Phones: bound inherited desktop card heights in reading mode while preserving stored geometry and free-canvas sizes.

All three installed versions are **0.11.4-fix-1**. Android ARM64 uses versionCode **11014**, the existing release signing certificate and the canonical logo. Windows provides a NSIS EXE; macOS provides an Apple Silicon DMG. Standalone CLI and SDK archives are included.

The original 0.11.4 updater compares only three numeric components and may show compatibility number **0.11.5**. The installed release is **0.11.4-fix-1**. Updated clients compare the actual version and avoid repeated reminders.

Application source: `ec2b8b341aeeeba0bcb3e0870399211f02785dc9`. The Windows packaging-workflow correction still builds this frozen tag. See the [technical repair record](../reviews/2026-10-27-release-fix1.md) for validation and device-coverage limits.
