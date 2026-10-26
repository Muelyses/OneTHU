# Headless plugin host

This module operates inside the independently logged-in SDK. It neither requires
the desktop app nor connects to its loopback service. The owner of the SDK data
directory must hold its exclusive lock for the host's lifetime.

```js
import { createPluginHost } from './plugins/index.mjs';

const plugins = createPluginHost({
  rootDir: '/absolute/sdk-data/plugins',
  getSession: () => ({ status: 'ready', username: 'current-user' }),
  resolveOperation: name => sdkCatalog.get(name),
  dispatch: (name, args, context) => sdk.call(name, args, context),
});
await plugins.inspect('/absolute/local-plugin');
await plugins.install('/absolute/local-plugin', { confirm: true });
await plugins.enable('example.plugin', { confirm: true });
await plugins.commands('example.plugin');
await plugins.call('example.plugin', 'courses', 'input');
await plugins.disable('example.plugin');
await plugins.uninstall('example.plugin', { confirm: true });
await plugins.close();
```

`resolveOperation` returns `{ permission, mutation?, supported?, guiOnly? }`.
Unknown operations fail closed. Dispatch receives `{ pluginId, permissions,
signal, confirm, beforeWrite }`; the shared SDK router still validates arguments, session
generation and final-write authorization. A mutation needs a confirmed `call`.
Activation has no school-write approval. `getSession` may be asynchronous.
`call` and `enable` accept the initiating request's `signal` and `beforeWrite`.
Carry that guard from the reverse dispatch into the SDK's final submission;
an asynchronous plugin must retain its original account and policy generation.
Aborting the initiating request stops the child and aborts its active SDK calls.

Installation accepts an existing local directory or ZIP containing
`manifest.json`. It never downloads, evaluates or launches a package. `inspect`
returns the manifest, package digest, per-file hashes and capability report.
Installed plugins start disabled. Installation, enabling and uninstalling need
explicit `confirm: true`. Enabled status persists; calling an enabled plugin in
a later SDK process starts it again. Listing plugins or commands never starts
code. Call and activation deadlines default to 30 seconds, maximum 150 seconds;
timeout or disabling kills the direct child and aborts its SDK call signal.

JS plugins use the existing single-file ES module contract: exported `manifest`
plus `default(ctx)`, `ctx.registerCommand`, `ctx.onethu.*`. The worker preserves
synchronous `storage`, `settings` and session snapshot APIs. It flushes storage
writes before reporting command completion. JS relative imports and browser/DOM
globals are outside this single-file contract; bundle such modules into the
entry file. A legacy JS-only plugin needs a JSON sidecar copied from its literal
manifest and an `entry` field, for example `"entry": "plugin.js"`. Source is never
evaluated to discover a manifest.

Rust/native plugins use the existing newline JSON-RPC protocol:
`activate({settings,permissions})`, `run({command,input})`, and reverse
`onethu.call({ns,method,args})`. The executable must match the host OS and CPU.
`OH_MCP_PORT=0` prevents the existing Harness sidecar from independently opening
its local MCP listener. Protocol compatibility does not imply all Harness GUI,
model-provider or transport features are supplied by this SDK; each requested
host operation must appear in the shared router's capability catalog.

GUI registration, themes, clipboard, native notifications, widgets and WebViews
return an explicit unavailable capability. No existing OneTHU WASM plugin ABI is
defined, so WASM manifests are inspectable/installable but cannot be enabled.

JS and native plugins are **trusted local code**. A child process is not an OS
sandbox: it can use the user's filesystem and network outside the SDK bridge.
Manifest permissions govern SDK API access, not OS access. Inspect and approve
code before enabling it. Session credentials are not forwarded to child
environment variables. Opt-in `onEvent` diagnostic sinks can contain plugin or
user data and should handle them accordingly.

Archives reject traversal, absolute/Windows-special paths, symlinks, case-folded
duplicates, conflicting files/directories, invalid CRCs, encrypted entries and
ZIP64. Limits: 4096 entries, 64 MiB per file/archive, 256 MiB total expanded data.
Installed files are hashed again before a stopped plugin starts. Existing
installations require explicit uninstall before replacement. Plugin storage is
separate, capped at 4 MiB and written with private file permissions. Uninstall
removes that plugin's storage. Supplied setting values remain in memory for the
host's lifetime; secret defaults should not be embedded in manifests.

Build requirement: bundle/copy `worker.mjs` beside the resulting runtime bundle.
When `index.mjs` and `runtime.mjs` are bundled into `dist/index.mjs`, put the worker
at `dist/worker.mjs`. The factory also accepts `workerUrl` for an explicit URL.
The worker's imports use Node built-ins only.

Tests use self-authored fixture modules, adversarial local ZIPs and a native
Rust fixture compiled with `rustc` and the standard library. They never fetch
third-party code, submit school mutations or start model conversations.
Windows process/installation behavior and real-account IM integration have not
been tested on actual Windows devices or real Feishu/WeChat accounts. Local fixture
results establish the tested protocol behavior; they do not establish those live
environment results.
