# 0.11.3 sign-in and update fixes

[中文](../release-0.11.3.md) · [English](release-0.11.3.md)

OneTHU 0.11.3 · Revolution is available for macOS, Windows and Android. This update focuses on session recovery, device identity and access to updates from the sign-in screen. Existing production installations can upgrade in place and retain local data and preferences.

## Updates from the sign-in screen

The sign-in screen can show release announcements. “Go to update” opens an independent dialog for reviewing the package, downloading it and confirming installation, without a university session. A manual “Check for updates” entry remains available on both sign-in and verification screens.

This works in all three experience modes and in Chinese and English. Automatic prompts wait while sign-in or verification is underway. Manually reviewing an update preserves entered credentials and verification codes. Announcements scroll independently; reminders can be postponed for one hour, one day or seven days.

## Recovery during university service disruptions

Session checks distinguish confirmed sign-out from gateway pages, rate limits, server failures and network errors. A saved account can retain its local view during a temporary service failure. Only confirmed sign-out starts authentication. A slow probe remains observable after the initial timeout, avoiding a parallel password sign-in.

A short gateway page during login preparation now produces a specific retry message. Diagnostics include the failure category and stage while omitting passwords, verification codes, cookies and page bodies. Sign-in can be retried after university services recover.

## Device identity and account ownership

The installation fingerprint remains stable across concurrent calls, refreshes and recovery from local storage. A known account can reuse its session. Account changes, unknown ownership and sign-out enforce isolation. The university's session single-sign-on checkbox requires explicit consent; the existing trusted-device choice during verification remains available.

These changes reduce authentication requests caused by repeated recovery and changing device identities. Existing trusted-device records remain managed by the university. If the limit has been reached, use the university's official account-management page.

## Installers

Android retains its production signing certificate and canonical logo, with versionCode 11012. GitHub Releases and the Tsinghua Cloud mirror provide platform installers and SHA-256 checksums.

[Download](https://onethu.github.io/download.html?lang=en) · [0.11.2 release notes](release-0.11.2.md)
