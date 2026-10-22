# 0.11.2 maintenance update

[中文](../release-0.11.2.md) · [English](release-0.11.2.md)

This update improves Web Learning sessions, portable wallpaper backups, tablet editing, glass surfaces and desktop windows on macOS, Windows and Android. Upgrade directly from 0.11.1 while keeping existing data and settings.

## Web Learning sessions

Responses are classified as expired sessions, gateway failures, permission failures or rate limits. Concurrent requests share one recovery attempt. Assignment viewing and submission pages are read as a unit, with a retry message on failure and the last complete data retained. Diagnostics continue to omit passwords, tokens, cookies and page bodies.

## Wallpaper backup and restore

New backups include image or video bytes, wallpaper-library metadata and built-in wallpaper references. Update both devices, upload from the source device, then restore on the other. Media is saved in the current device’s wallpaper directory; settings are applied after validation and saving complete.

An old backup containing only source-device paths needs a fresh upload from the updated device that still holds the originals. Limits are 12 MiB per media item and 24 MiB per backup. Missing backups, permission failures and size limits have distinct messages, with the current wallpaper retained. Backup and restore use their existing manual controls and cloud authorization.

## Tablets and glass surfaces

Landscape tablets retain their wide layout and the editing toggle used on touch devices. Browsing supports scrolling and opening content; moving or resizing widgets requires Edit mode. Switching boards, orientation or mode resets editing access.

Course filters, notification strips, assignment cards and detail headings share consistent glass surfaces. Theme, glass strength and automatic text contrast settings continue to apply.

## Desktop windows and update reminders

Launching the desktop release again brings back its existing main window. Closing the main window while OH is visible hides it so OH can reopen it; closing both exits the app. Development previews run independently. On Windows, allow the installer to close old OneTHU processes during installation to clear lingering windows from older builds.

Minimal, Practical and Full modes share an update prompt with release details and a choice of reminder delay. Manual update checks remain available. Android retains its production signing certificate and canonical logo, with versionCode 11011.

[Download](https://onethu.github.io/en/download.html) · [0.11.1 release notes](release-0.11.1.md) · [Technical review (Chinese)](../reviews/2026-10-22-android-session-wallpaper-tablet.md)

## Additional interaction fixes

Update reminders support 1 hour, 1 day and 7 days, persist across restarts, and apply to a specific release. Go to update opens the shared software-update section in all three modes. Existing dialogs and onboarding finish before a reminder opens. News units use the portal’s Chinese or English names with separate caches. The phone widget confirmation button handles small touch movements and closes without rebuilding the widget catalog. Redundant slogans have been removed from the simple home screen.
