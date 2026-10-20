import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { runCancellable, isLlmRateLimit } from "../apps/desktop/src/plugins/runLifecycle.ts";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const cancelled = () => ({ interrupted: true });
let assertions = 0;
const check = (value, expected, message) => { assert.deepEqual(value, expected, message); assertions++; };

// Stop during an in-flight authentication check. Its eventual resolution must
// never dispatch the chat that the user has already cancelled.
{
  const preparation = deferred();
  const controller = new AbortController();
  let requests = 0;
  const task = runCancellable({
    signal: controller.signal, prepare: () => preparation.promise,
    run: async () => { requests++; return "unexpected"; },
    interrupt: async () => assert.fail("no host run exists yet"), cancelled,
  });
  controller.abort();
  check(await task, { interrupted: true }, "cancel preflight immediately");
  preparation.resolve(null);
  await tick();
  check(requests, 0, "late preflight cannot send a cancelled request");
}

// Once dispatched, the UI must stay busy until the real host run exits.
{
  const response = deferred();
  const controller = new AbortController();
  let interrupts = 0, settled = false;
  const task = runCancellable({
    signal: controller.signal, prepare: async () => null,
    run: () => response.promise, interrupt: async () => { interrupts++; }, cancelled,
  }).then((value) => { settled = true; return value; });
  await tick();
  controller.abort();
  controller.abort();
  await tick();
  check(interrupts, 1, "send one interrupt to the active run");
  check(settled, false, "cancel is not a fake completion");
  response.resolve({ interrupted: true });
  check(await task, { interrupted: true }, "release only after host confirms exit");
}

// A completed run removes its listener: a later abort must not cancel another run.
{
  const controller = new AbortController();
  let interrupts = 0;
  check(await runCancellable({
    signal: controller.signal, prepare: async () => null, run: async () => "done",
    interrupt: async () => { interrupts++; }, cancelled,
  }), "done", "normal completion preserved");
  controller.abort();
  await tick();
  check(interrupts, 0, "stale cancellation listener removed");
}

{
  const controller = new AbortController();
  controller.abort();
  check(await runCancellable({
    signal: controller.signal, prepare: async () => assert.fail("already cancelled"),
    run: async () => assert.fail("already cancelled"), interrupt: async () => {}, cancelled,
  }), { interrupted: true }, "already cancelled never starts preparation");
  check(await runCancellable({
    prepare: async () => ({ error: "login required" }),
    run: async () => assert.fail("preflight denied"), interrupt: async () => {}, cancelled,
  }), { error: "login required" }, "preflight error preserved without dispatch");
}

for (const message of ["LLM HTTP 429：slow down", "rate_limit_exceeded", "Too many requests"]) {
  check(isLlmRateLimit(message), true, `classify actual rate limit: ${message}`);
}
for (const message of ["LLM HTTP 401：unauthorized", "token 需要重新签发", "余额或额度不足", "HTTP 500", "timeout 42900ms"]) {
  check(isLlmRateLimit(message), false, `do not invent a 429: ${message}`);
}

// Exercise the actual event ring through its Tauri listener. After capacity is
// reached, length stops increasing; the consumer must still receive each event.
{
  let listener;
  globalThis.__ohEventListener = (callback) => { listener = callback; };
  const eventMock = "data:text/javascript," + encodeURIComponent(
    "export async function listen(name, callback) { globalThis.__ohEventListener(callback); return () => {}; }",
  );
  const source = fs.readFileSync(new URL("../apps/desktop/src/plugins/events.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace('"@tauri-apps/api/event"', JSON.stringify(eventMock));
  const events = await import("data:text/javascript," + encodeURIComponent(compiled));
  await events.ensurePluginEventListener();
  let cursor = 0;
  const received = [];
  for (let n = 1; n <= 450; n++) {
    listener({ payload: { pluginId: "local-test", method: "progress", params: {
      kind: "delta", text: String(n), runId: n % 2 ? "fixture-dock" : "fixture-im",
    } } });
    const ring = events.pluginEvents("local-test");
    received.push(...ring.filter((event) => event.sequence > cursor).map((event) => event.text));
    cursor = ring.at(-1).sequence;
  }
  check(events.pluginEvents("local-test").length, 300, "event ring remains bounded");
  check(received, Array.from({ length: 450 }, (_, index) => String(index + 1)), "stream continues after 300 events");
  check(events.pluginEvents("local-test").map((event) => event.runId),
    Array.from({ length: 300 }, (_, index) => (index + 151) % 2 ? "fixture-dock" : "fixture-im"),
    "Tauri payload runId survives ring rollover without assigning foreign events to the dock");
  events.clearPluginEvents("local-test");
  listener({ payload: { pluginId: "local-test", method: "progress", params: { kind: "delta", text: "after-clear" } } });
  check(events.pluginEvents("local-test")[0].sequence > cursor, true, "clear does not reuse an old event sequence");
  check(events.pluginEvents("local-test")[0].runId, undefined, "untagged legacy event does not inherit the previous runId");
  delete globalThis.__ohEventListener;
}

// Execute the actual ChatDock event-consumer body with local/foreign event
// fixtures. In particular, UI busy during authentication is not proof that an
// arriving event belongs to the local run.
{
  const source = fs.readFileSync(new URL("../apps/desktop/src/plugins/ChatDock.tsx", import.meta.url), "utf8");
  const start = source.indexOf("const fresh = events.filter");
  const end = source.indexOf("    stickBottom();", start);
  assert.ok(start >= 0 && end > start, "locate actual ChatDock event consumer");
  const consume = ts.transpileModule(`(() => { ${source.slice(start, end)} })()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  function state(pid = "onethu.harness") {
    return {
      pid, seenEv: { current: 0 }, events: [],
      busyRef: { current: true }, activeRunId: { current: "fixture-dock" },
      finalizedFor: { current: 0 }, runSeq: { current: 7 },
      deltaBuf: { current: "" }, deltaTimer: { current: null },
      thinkRef: { current: "" }, traceRef: { current: [] },
      hydratedFor: { current: pid }, foreignTicks: 0,
      setForeignTick(fn) { this.foreignTicks = fn(this.foreignTicks); },
      setThinkOpen() {}, window: { setTimeout: () => 1 }, flushDelta() {},
      hardStop() { assert.fail("no process exit in this fixture"); },
      setThink() {}, setTrace() {}, setStatus() {}, setUsage() {},
    };
  }
  const local = state();
  local.events = [
    { sequence: 1, kind: "delta", text: "foreign-before-admission", runId: "fixture-im" },
    { sequence: 2, kind: "think", text: "foreign-thought", runId: "fixture-im" },
    { sequence: 3, kind: "delta", text: "untagged" },
    { sequence: 4, kind: "delta", text: "own-answer", runId: "fixture-dock" },
  ];
  vm.runInNewContext(consume, local);
  check(local.deltaBuf.current, "own-answer", "preflight busy cannot admit foreign or untagged OH deltas");
  check(local.thinkRef.current, "", "foreign reasoning cannot appear under the local question");
  check(local.seenEv.current, 4, "rejected foreign events still advance the ring cursor");
  local.busyRef.current = false;
  local.events = [{ sequence: 5, kind: "delta", text: "late-answer", runId: "fixture-dock" }];
  vm.runInNewContext(consume, local);
  check(local.deltaBuf.current, "own-answer", "completed local run ignores late deltas");
  const legacy = state("third-party-fixture");
  legacy.events = [{ sequence: 6, kind: "delta", text: "legacy-answer" }];
  vm.runInNewContext(consume, legacy);
  check(legacy.deltaBuf.current, "legacy-answer", "third-party plugins retain their legacy event protocol");
}
console.log(`✓ OH frontend request lifecycle: ${assertions} assertions passed`);
