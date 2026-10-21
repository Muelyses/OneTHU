# Privacy and troubleshooting

[中文](../privacy-and-troubleshooting.md) · English

Account sessions, locally stored preferences, campus responses, cloud files and model requests have different storage and transmission paths. A unified interface does not imply a universal shared account or that every service is offline/local. Model providers receive the request content and attachments supplied to them.

Public screenshots use isolated fictional fixtures. Never share passwords, cookies, tokens, QR codes, full authentication redirects or private campus records in an issue. Export diagnostics only after reviewing and redacting them.

## Login problems

Use the exact app version and platform when comparing failures. Public-key retrieval can fail because the authentication response is not the expected key, a session/challenge changed, the service is unavailable, or account trust factors require attention. Do not classify every such failure as a proxy issue. Preserve second-factor context and avoid repeated refreshes, resends or new fingerprint creation. An account-side trust-factor limit requires the appropriate account flow.

Windows interaction freezes are different from a pending network request: check whether buttons, input, refresh and second-factor fields respond. Proxy/TUN state is useful diagnostic context but not a sufficient explanation. Avoid including credential values in logs.

## Cloud ownership and conflicts

An unknown library owner pauses automatic creation, deletion and synchronization. Confirm the correct account and current native/client behavior before resuming; do not create duplicate empty libraries. A delete control is destructive and should identify the actual target. Compatible changes merge; genuinely incompatible records require an understandable explicit choice.

Organization permissions and cross-device membership need real remote verification. Fixture tests and a single account do not prove two-account propagation. Follow the separately retained live-test entry.

## Updates and recovery

In-page refresh reloads service data; the floating force-refresh path has broader recovery behavior. Repeatedly forcing reload is not an authentication strategy. Vite development hot reload is not production hot update; this project does not promise dynamic native-code or production-patch delivery.

For a report include version, OS, experience mode, steps, observed/expected result and redacted diagnostics. Schools, model providers, notification permissions and background restrictions can independently affect availability.
