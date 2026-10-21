# Architecture (0.11)

[中文](../architecture.md) · English

The `dev3` source is authoritative. [Historical records](documentation-catalog.md) describe earlier decisions and are not evidence that a feature shipped.

```text
React pages / three experience shells / OH capsule
    ├── OneGUI components, tokens, themes and motion
    ├── Explorer state, whiteboards, atoms, staging box and organizations
    ├── Permission facade → host APIs and campus clients
    └── Tauri IPC → Rust networking, credentials, files and bounded skill runtime
                         └── OneTHU Harness (Rust submodule)
```

`apps/desktop` serves desktop and Android. A browser preview lacks some native capabilities. `packages/core` implements campus clients; `packages/gui` owns the visual and interaction system.

## Identity and shared data

Campus clients reuse university sessions when possible. Cloud storage, GitLab, mail, calendars and model services may need separate configuration or authorization. Expired sessions and second-factor challenges are not generic retryable failures: preserve the challenge context and avoid new fingerprints, repeated verification and unbounded replays. An excessive number of trusted factors is an account-side condition.

Shared service state feeds lists, schedules and home widgets. Mode switching changes visibility without deleting full-mode configuration. Assignment deadlines belong in all modes and should use the same available assignment data. Application-owned errors are localized at render time; external service details can remain in their original language.

## Extensions and execution

`types.ts` defines the plugin surface and `facade.ts` injects host APIs and checks permissions. The [generated API reference](api-surface.md) currently lists 36 namespaces and 255 method entries; these are a source snapshot, not a permanent compatibility guarantee. Hiding a UI control is not a security boundary.

OH communicates with its Harness submodule and authorized host tools. Minimal and practical modes retain search, your own API configuration and WeChat/Feishu links. Full plugin and advanced-tool access follows mode and permission policy. Xiaoda, its skill plaza and the local QuickJS runtime have separate trust and execution boundaries; see [OH and Xiaoda](oh-and-xiaoda.md).

## Staging and synchronization

A drag session distinguishes clicks, long-press pickup, free movement and a committed drop. Only explicitly integrated sources can be staged; see the [support list](sharing-and-organizations.md). Short sharing codes require online retrieval. NFC is currently unreliable; prefer short codes.

Cards, friends, organizations and files depend on confirmed account ownership and remote synchronization. Merge compatible changes automatically and require a choice for genuinely incompatible conflicts. Ownership failures must not create duplicate empty libraries. Organization permissions must agree across remote state, UI checks and operation results. Two-account live acceptance remains distinct from fixture tests.

## Operational limits

Vite development hot reload is separate from updates to an installed production app. The current product does not promise dynamic native-code or production-patch delivery. Platform differences, campus outages and model quotas must remain visible. See [privacy and troubleshooting](privacy-and-troubleshooting.md) and [public capture provenance](screenshots.md).
