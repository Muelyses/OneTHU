# Plugin development

[中文](../plugin-development.md) · English

Plugins extend OneTHU through the host facade; use the [generated type surface](api-surface.md) and the [developer setup](developers.md). Delivery formats are JavaScript plugins, native Rust sidecars on desktop and embedded native plugins on Android. These formats do not imply identical platform capabilities.

Define only the permissions the plugin needs. Host checks are authoritative; a visible button or successful import is not authorization. Use OneGUI components and central theme tokens. Register integrated content through the existing atom, navigation, widget and staging adapters instead of inventing parallel stores.

OneTHU Harness is a separate agent submodule and can expose authorized tools to OH. Xiaoda plaza skills are content packages with runtime requirements; importing one does not install a Python or Node environment. QuickJS is restricted to synchronous JavaScript without network, files or processes. See [execution boundaries](oh-and-xiaoda.md).

Use fictional fixtures, validate cleanup and account isolation, and inspect mobile UI behavior. Do not log credentials or upload private campus responses. The [detailed plugin reference](../plugin-development.md) retains extensive examples in Chinese; method names and signatures are shared across languages. The generated reference currently lists 36 namespaces and 255 method entries.
