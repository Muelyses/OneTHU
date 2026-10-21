# Search, OH, Harness and Xiaoda

[中文](../oh-and-xiaoda.md) · English

## Different entry points

Search finds integrated features, settings and content and opens the matching destination. It is available in every experience mode and does not require a language-model response.

OH is the conversational entry. In full mode, OneTHU Harness can use authorized host tools and plugins. Minimal and practical modes retain your own API configuration and WeChat/Feishu connections while hiding full-mode advanced management. A guide action opens actual search, OH or the applicable plugin/mode settings.

Xiaoda is the university service with models, agents and a skill plaza. Its availability, login and quotas differ from an external model provider. Repeated 429 or timeouts should be diagnosed rather than multiplied by concurrent automatic retries. Check model, account, request lifecycle and the real error; do not assume a reply was delivered before completion.

## Skills

Search plaza skills, inspect their files and compatibility, then import them locally. Imported skills are disabled until enabled, and local records are separated by account. A skill is not automatically a runnable application.

The built-in QuickJS runtime runs pure synchronous JavaScript on desktop and Android. Limits are 2 seconds, 32 MiB memory, 256 KiB stack, and 64 KiB code and I/O bounds. It provides no filesystem, network, process, package manager, modules or async execution. Python/Node dependencies, native tools, browsers and persistent services are incompatible with this runtime.

Export heavier skills to a folder on desktop or a ZIP on Android, then configure an external desktop agent and its dependencies. Export is not execution, installation of every dependency or a mobile sandbox escape.

## Plugins, MCP and privacy

The host’s [generated plugin surface](api-surface.md) lists 36 namespaces and 255 method entries. Platform, capability and permission checks still apply. A Rust desktop sidecar is not an Android executable.

Publishing OH as an MCP server and connecting OH to another MCP server are opposite directions with different configuration. Review the actual setting rather than treating either as an unconditional connection. WeChat/Feishu integrations require their own setup.

A provider receives prompts and any content deliberately supplied to the request. Review attached files, tool permissions and remote service policy. [Privacy and diagnostics](privacy-and-troubleshooting.md) describes reporting and account boundaries.
