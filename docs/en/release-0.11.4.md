# OneTHU 0.11.4 · Revolution

[中文](../release-0.11.4.md) · [Downloads](https://github.com/smartThise/OneTHU/releases/tag/v0.11.4)

This release connects the CLI, resident tasks and OH to more application services, alongside recent sign-in, cloud, attachment and interface fixes.

- **OneTHU CLI and SDK:** install independently, or use the Node runtime bundled with macOS and Windows. Share sign-in, tasks and execution history; approved background tasks can continue after the app closes. Query and archive course resources, schedule checks, send notifications and connect through MCP. Use the current command catalog for supported operations.
- **OH tools:** discover and call application services for OneTHU contacts, organization members and resources, projects and announcements, Xiaoda skills and agents, and staging-box content and sharing. Role grants remain in the management page.
- **Rain Classroom:** query through OH and CLI, with a separate session, pagination, partial-result reporting and explicit handling of assignments without a deadline.
- **Reliability:** isolate IM configuration from conversation context; improve request cancellation, run ownership, desktop/CLI session handoff, cloud reconnection and account boundaries.
- **Learning and interface:** correct notice attachment names and file extensions; include glass, wallpaper archive, tab and OH interaction improvements.

Android keeps the embedded OH runtime; the resident Node backend is a desktop capability. App-owned contacts, organizations, boards and staging boxes require the app to be running. The independent CLI exposes its own implemented catalog. Heavy skills remain available for external agents.

Automatic execution follows local authorization settings. Writes, sharing and outgoing messages retain permission and account checks. Model responses depend on the selected provider; provider errors are reported separately from successful tool calls.

All three platforms use **0.11.4**. Android ARM64 keeps the existing production signing certificate and logo, with versionCode **11013**.

[CLI guide](onethu-cli.md) · [OH services and permissions](oh-app-services.md)
