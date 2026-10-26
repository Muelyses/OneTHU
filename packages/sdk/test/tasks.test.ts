import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTaskManager, nextRun, validateSchedule, type TaskDraft, type TaskManagerPorts, type TaskOwner, type TaskState, type TaskGrant } from "../src/tasks/index.js";
import { createFileTaskManager, createFileTaskStorage } from "../src/tasks/node.js";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const deferred = <T = void>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const startAt = Date.parse("2026-10-24T04:00:00Z");
const operation = (op = "info.exams"): TaskDraft => ({ name: "Exam updates", schedule: { kind: "interval", everyMinutes: 5 }, template: { kind: "operation", operation: op, args: [], channels: ["wechat:self"] } });
const watch = (): TaskDraft => ({ name: "Course updates", schedule: { kind: "interval", everyMinutes: 5 }, template: { kind: "school-watch", courseIds: ["course-a"], semesterId: "2026-fall", outputDir: "/approved/course", channels: ["wechat:self"], remindBeforeHours: [24, 1] } });
const ref = `learn:${"a".repeat(64)}`;

async function fixture(initial: TaskState | null = null) {
  let now = startAt, current: TaskOwner | null = { id: "account-a", epoch: 1 }, approved = true, state = clone(initial);
  const timers = new Map<object, { fn: () => void; at: number }>();
  const calls: Array<{ op: string; args: unknown[] }> = [], notifications: Array<{ channel: string; message: string; key: string }> = [];
  const handlers = new Map<string, (...args: any[]) => unknown>();
  let notifyHook: undefined | (() => unknown), failSave = false;
  const resource = { resourceRef: ref, resourceId: "f1", courseId: "course-a", kind: "file", filename: "Lecture.pdf", title: "Lecture", size: "1 KB" };
  const homework = { id: "h1", title: "Assignment", deadline: new Date(startAt + 30 * 60_000).toISOString(), submitted: false };
  const data = { coursePage: { rows: [{ id: "course-a", name: "Course A" }], complete: true }, resources: { items: [resource], homework: [homework], notifications: [{ id: "n1", title: "Class notice", publishTime: "2026-10-24" }], complete: true }, homework: { rows: [homework], complete: true } };
  handlers.set("learn.courses", () => data.coursePage); handlers.set("learn.resources", () => data.resources); handlers.set("learn.homework", () => data.homework);
  const ports: TaskManagerPorts = {
    storage: { load: async () => clone(state), save: async value => { if (failSave) throw Error("disk full"); state = clone(value); } },
    clock: { now: () => now, setTimeout: (fn, ms) => { const key = {}; timers.set(key, { fn, at: now + ms }); return key; }, clearTimeout: key => { timers.delete(key as object); } },
    getOwner: () => current ? { ...current } : null,
    authorizeGrant: async () => approved,
    resolveOperation: op => ["info.exams", "learn.download", "cal.remove"].includes(op) ? { mutation: op !== "info.exams", validate(args) { if (!Array.isArray(args)) throw Error("invalid"); if (op === "learn.download" && (args.length !== 2 || typeof args[0] !== "string")) throw Error("invalid download"); } } : undefined,
    dispatch: async (op, args, options) => { await options.confirmationGrant.assertAllowed(op, args); calls.push({ op, args }); return await handlers.get(op)?.(args, options) ?? { value: 1 }; },
    notify: async (channel, message, key, opts) => { await opts.confirmationGrant.assertActive(); assert.ok(opts.confirmationGrant.channels.includes(channel)); notifications.push({ channel, message, key }); await notifyHook?.(); },
  };
  const manager = await createTaskManager(ports);
  return { manager, ports, calls, notifications, handlers, data, timers,
    state: () => clone(state), advance(ms: number) { now += ms; }, setOwner(value: TaskOwner | null) { current = value; }, setApproved(value: boolean) { approved = value; },
    notifyThrows() { notifyHook = () => { throw Error("connection lost after send"); }; }, saveFails() { failSave = true; },
    fireTimers() { for (const [key, value] of [...timers]) if (value.at <= now) { timers.delete(key); value.fn(); } },
  };
}

test("persistent tasks require trusted consent and an active account", async () => {
  const f = await fixture(); f.setApproved(false);
  await assert.rejects(f.manager.create(operation()), /TASK_CONSENT_REQUIRED/); assert.equal((await f.manager.list()).length, 0);
  f.setOwner(null); await assert.rejects(f.manager.create(operation()), /TASK_ACCOUNT_REQUIRED/);
});
test("unknown operations, arbitrary writes, relative directories and invalid schedules are rejected", async () => {
  const f = await fixture();
  await assert.rejects(f.manager.create(operation("net.fetch")), /TASK_OPERATION_NOT_ALLOWED/);
  await assert.rejects(f.manager.create(operation("cal.remove")), /TASK_MUTATION_NOT_ALLOWED/);
  const draft = watch(); (draft.template as any).outputDir = "../../other";
  await assert.rejects(f.manager.create(draft), /TASK_OUTPUT_DIRECTORY_INVALID/);
  assert.throws(() => validateSchedule({ kind: "interval", everyMinutes: 0 }), /TASK_INTERVAL_INVALID/);
  assert.throws(() => validateSchedule({ kind: "daily", time: "12:00", timezone: "Invalid/Zone" }), /TASK_TIMEZONE_INVALID/);
  assert.throws(() => validateSchedule({ kind: "once", runAt: "2026-10-24 12:00" }), /TASK_RUN_AT_INVALID/);
});
test("task CRUD and history are owner-isolated; rebind needs a new grant", async () => {
  const f = await fixture(), task = await f.manager.create(operation());
  const edited = await f.manager.update(task.id, { ...operation(), name: "Renamed" }); assert.equal(edited.revision, 2);
  await f.manager.pause(task.id); await assert.rejects(f.manager.run(task.id), /TASK_PAUSED/);
  f.setOwner({ id: "account-b", epoch: 2 }); assert.deepEqual(await f.manager.list(), []);
  await assert.rejects(f.manager.get(task.id), /TASK_NOT_FOUND/);
  await assert.rejects(f.manager.resume(task.id), /TASK_NOT_FOUND/);
  f.setApproved(false); await assert.rejects(f.manager.resume(task.id, { rebind: true }), /TASK_CONSENT_REQUIRED/);
  f.setApproved(true); const rebound = await f.manager.resume(task.id, { rebind: true }); assert.equal(rebound.owner, "account-b");
  await f.manager.remove(task.id); assert.deepEqual(await f.manager.list(), []);
});
test("a task never overlaps and pause revokes its late write grant", async () => {
  const f = await fixture(), waiting = deferred(), entered = deferred(); let writes = 0;
  f.handlers.set("learn.download", async (_args, options) => { entered.resolve(); await waiting.promise; await options.confirmationGrant.assertAllowed("learn.download", _args); writes++; });
  const task = await f.manager.create(watch()), running = f.manager.run(task.id); await entered.promise;
  await assert.rejects(f.manager.run(task.id), /TASK_ALREADY_RUNNING/);
  await f.manager.pause(task.id); waiting.resolve(); const result = await running;
  assert.equal(result.status, "cancelled"); assert.equal(writes, 0); assert.equal(f.notifications.length, 0);
});
test("due tasks run serially and other manual runs report busy", async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  let running = 0, peak = 0, visits = 0;
  f.handlers.set("info.exams", async () => {
    running++; peak = Math.max(peak, running); visits++;
    if (visits === 1) { entered.resolve(); await release.promise; }
    running--; return [];
  });
  const first = await f.manager.create(operation()), second = await f.manager.create({ ...operation(), name: "Second task" });
  f.advance(5 * 60_000);
  const tick = f.manager.tick(); await entered.promise;
  await assert.rejects(f.manager.run(second.id), /TASK_RUN_BUSY/);
  await f.manager.tick(); assert.equal(visits, 1);
  release.resolve(); await tick;
  assert.equal(visits, 2); assert.equal(peak, 1);
  assert.equal((await f.manager.history(first.id)).length, 1);
  assert.equal((await f.manager.history(second.id)).length, 1);
});
test("stop cancels the current scheduled run and discards the remaining due queue", async () => {
  const f = await fixture(), entered = deferred<AbortSignal>(), release = deferred();
  f.handlers.set("info.exams", async (_args, options) => { entered.resolve(options.signal); await release.promise; return []; });
  const first = await f.manager.create(operation()), second = await f.manager.create({ ...operation(), name: "Queued task" });
  f.advance(5 * 60_000);
  const tick = f.manager.tick(), signal = await entered.promise;
  const stop = f.manager.stop(); assert.equal(signal.aborted, true);
  release.resolve(); await Promise.all([tick, stop]);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.manager.get(first.id)).lastRun?.status, "cancelled");
  assert.equal((await f.manager.get(second.id)).lastRun, undefined);
});
test("a revision or account change while draining due tasks skips queued work", async () => {
  for (const change of ["pause", "account"] as const) {
    const f = await fixture(), entered = deferred(), release = deferred();
    f.handlers.set("info.exams", async () => { entered.resolve(); await release.promise; return []; });
    await f.manager.create(operation()); const second = await f.manager.create({ ...operation(), name: "Queued task" });
    f.advance(5 * 60_000); const tick = f.manager.tick(); await entered.promise;
    if (change === "pause") await f.manager.pause(second.id);
    else f.setOwner({ id: "account-a", epoch: 2 });
    release.resolve(); await tick; assert.equal(f.calls.length, 1);
    assert.equal((await f.manager.get(second.id)).lastRun, undefined);
  }
});
test("stop during asynchronous manual-run ownership lookup prevents late launch", async () => {
  const f = await fixture(), task = await f.manager.create(operation()), entered = deferred(), release = deferred();
  const getOwner = f.ports.getOwner; let checks = 0;
  f.ports.getOwner = async () => { if (++checks === 2) { entered.resolve(); await release.promise; } return getOwner(); };
  const run = f.manager.run(task.id); await entered.promise;
  await f.manager.stop(); release.resolve();
  await assert.rejects(run, /TASK_CANCELLED/); assert.equal(f.calls.length, 0);
});
test("account epoch changes stop a prefetch from issuing a late write", async () => {
  const f = await fixture(), waiting = deferred(), entered = deferred(); let writes = 0;
  f.handlers.set("learn.download", async (args, options) => { entered.resolve(); await waiting.promise; await options.confirmationGrant.assertAllowed("learn.download", args); writes++; });
  const task = await f.manager.create(watch()), running = f.manager.run(task.id); await entered.promise;
  f.setOwner({ id: "account-a", epoch: 2 }); waiting.resolve(); const result = await running;
  assert.equal(result.status, "cancelled"); assert.equal(writes, 0);
});
test("operation grants restrict the exact arguments and school-watch grants restrict courses/output", async () => {
  const f = await fixture(); const grants: TaskGrant[] = [];
  f.handlers.set("info.exams", (_args, options) => { grants.push(options.confirmationGrant); return []; });
  const task = await f.manager.create(operation()); await f.manager.run(task.id);
  // Completed runs must not be usable as persistent arbitrary grants.
  await assert.rejects(grants[0]!.assertAllowed("mail.send", []), /TASK_OPERATION_OUTSIDE_GRANT|TASK_CANCELLED/);
  await assert.rejects(grants[0]!.assertAllowed("info.exams", ["different"]), /TASK_ARGUMENTS_OUTSIDE_GRANT|TASK_CANCELLED/);
  await assert.rejects(grants[0]!.assertAllowed("info.exams", []), /TASK_CANCELLED/);
  f.handlers.set("learn.download", async (_args, options) => {
    await assert.rejects(options.confirmationGrant.assertAllowed("learn.resources", ["another-course"]), /TASK_ARGUMENTS_OUTSIDE_GRANT/);
    await assert.rejects(options.confirmationGrant.assertAllowed("learn.download", [ref, "/unapproved"]), /TASK_OUTPUT_OUTSIDE_GRANT/);
  });
  await f.manager.run((await f.manager.create(watch())).id);
});
test("school-watch records stable changes, downloads once and batches notifications", async () => {
  const f = await fixture(), task = await f.manager.create(watch());
  const first = await f.manager.run(task.id); assert.equal(first.status, "succeeded"); assert.equal(first.downloaded, 1); assert.equal(first.notified, 1);
  assert.ok(first.changes.some(change => change.kind === "deadline")); assert.equal(f.notifications.length, 1);
  const second = await f.manager.run(task.id); assert.equal(second.downloaded, 0); assert.equal(second.notified, 0); assert.deepEqual(second.changes, []);
  f.data.resources.items[0]!.size = "2 KB";
  const third = await f.manager.run(task.id); assert.equal(third.downloaded, 1); assert.equal(third.notified, 1); assert.equal(third.changes[0]!.kind, "changed");
  assert.equal((await f.manager.history(task.id)).length, 3);
  assert.ok(!JSON.stringify(f.state()).includes("downloadUrl"));
});
test("deadline changes are detected and reminders are deduplicated", async () => {
  const f = await fixture(), draft = watch(); delete (draft.template as any).outputDir;
  const task = await f.manager.create(draft); await f.manager.run(task.id);
  f.data.homework.rows[0]!.deadline = new Date(startAt + 45 * 60_000).toISOString();
  const moved = await f.manager.run(task.id); assert.ok(moved.changes.some(change => change.kind === "deadline")); assert.equal(moved.notified, 1);
  assert.equal((await f.manager.run(task.id)).notified, 0);
});
test("partial enumeration never removes missing records or claims a complete run", async () => {
  const f = await fixture(), task = await f.manager.create(watch()); await f.manager.run(task.id);
  f.data.resources.items = []; f.data.resources.complete = false; f.data.homework.complete = false;
  const run = await f.manager.run(task.id); assert.equal(run.status, "partial"); assert.ok(!run.changes.some(change => change.kind === "removed"));
  assert.ok(Object.keys(f.state()!.tasks[0]!.snapshot).some(key => key.includes(":resource:")));
});
test("ambiguous notification or download results are recorded and never automatically repeated", async () => {
  const f = await fixture(); f.notifyThrows(); let downloads = 0;
  f.handlers.set("learn.download", () => { downloads++; throw Error("connection lost after publication"); });
  const task = await f.manager.create(watch()); const first = await f.manager.run(task.id);
  assert.equal(first.status, "partial"); assert.ok(first.errors.some(error => error.startsWith("TASK_DOWNLOAD_UNKNOWN")));
  assert.ok(first.errors.some(error => error.startsWith("TASK_NOTIFICATION_UNKNOWN")));
  await f.manager.run(task.id); assert.equal(downloads, 1); assert.equal(f.notifications.length, 1);
  const restored = await fixture(f.state()); await restored.manager.run(task.id);
  assert.equal(restored.calls.filter(call => call.op === "learn.download").length, 0); assert.equal(restored.notifications.length, 0);
});
test("transient reads use bounded exponential backoff; writes are not replayed", async () => {
  const f = await fixture(); let attempts = 0;
  f.handlers.set("info.exams", () => { attempts++; if (attempts < 3) throw Error("NETWORK_TIMEOUT"); return []; });
  const task = await f.manager.create(operation()), run = f.manager.run(task.id); await flush();
  assert.equal(attempts, 1); f.advance(1000); f.fireTimers(); await flush(); assert.equal(attempts, 2);
  f.advance(2000); f.fireTimers(); assert.equal((await run).status, "succeeded"); assert.equal(attempts, 3);
});
test("authentication errors do not trigger repeated login/read requests", async () => {
  const f = await fixture(); f.handlers.set("info.exams", () => { throw Error("AUTH_SESSION_CHANGED"); });
  const run = await f.manager.run((await f.manager.create(operation())).id); assert.equal(run.status, "failed");
  assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0);
});
test("missed intervals after restart run once and schedule from current time", async () => {
  const f = await fixture(), task = await f.manager.create(operation());
  const restarted = await fixture(f.state()); restarted.advance(3 * 24 * 3_600_000);
  await restarted.manager.tick(); await restarted.manager.tick();
  assert.equal(restarted.calls.length, 1); assert.equal((await restarted.manager.get(task.id)).nextRunAt, startAt + 3 * 24 * 3_600_000 + 5 * 60_000);
});
test("interrupted runs recover once, preserving unknown side-effect checkpoints", async () => {
  const f = await fixture(), task = await f.manager.create(operation()); const state = f.state()!;
  state.tasks[0]!.lastRun = { id: "interrupted", taskId: task.id, status: "running", startedAt: startAt, downloaded: 0, notified: 0, changes: [], errors: [] };
  state.tasks[0]!.notifications.key = { state: "pending", at: startAt };
  const restarted = await fixture(state); assert.equal(restarted.state()!.tasks[0]!.notifications.key!.state, "unknown");
  await restarted.manager.tick(); await restarted.manager.tick(); assert.equal(restarted.calls.length, 1);
  assert.equal((await restarted.manager.history(task.id))[0]!.status, "interrupted");
});
test("daily schedules honor timezone and skip nonexistent DST time", () => {
  assert.equal(nextRun({ kind: "daily", time: "13:00", timezone: "Asia/Shanghai" }, startAt), Date.parse("2026-10-24T05:00:00Z"));
  assert.equal(nextRun({ kind: "daily", time: "02:30", timezone: "America/New_York" }, Date.parse("2026-03-08T05:00:00Z")), Date.parse("2026-03-09T06:30:00Z"));
});
test("one-time schedule executes only once", async () => {
  const f = await fixture(), draft = operation(); draft.schedule = { kind: "once", runAt: new Date(startAt - 1000).toISOString() };
  const task = await f.manager.create(draft); await f.manager.tick(); await f.manager.tick();
  assert.equal(f.calls.length, 1); assert.equal((await f.manager.get(task.id)).nextRunAt, null);
});
test("failed persistence prevents business dispatch and further grants", async () => {
  const f = await fixture(), task = await f.manager.create(operation()); f.saveFails();
  await assert.rejects(f.manager.run(task.id)); assert.equal(f.calls.length, 0);
  await assert.rejects(f.manager.create(operation()), /TASK_STORAGE_UNAVAILABLE/);
});
test("Node persistence writes privately, survives reopen and rejects a second live scheduler", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onethu-tasks-"));
  try {
    const f = await fixture(); const { storage: _, ...ports } = f.ports;
    const manager = await createFileTaskManager({ ...ports, dataDir: root }); const task = await manager.create(operation());
    await assert.rejects(createFileTaskStorage(root), /TASK_STORAGE_ALREADY_OPEN/);
    if (process.platform !== "win32") assert.equal((await stat(path.join(root, "tasks.json"))).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(path.join(root, "tasks.json"), "utf8")).tasks[0].id, task.id);
    await manager.close(); const reopened = await createFileTaskManager({ ...ports, dataDir: root }); assert.equal((await reopened.list()).length, 1); await reopened.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("Node persistence refuses a symlink state file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onethu-tasks-"));
  try {
    const storage = await createFileTaskStorage(root); await symlink(path.join(root, "outside.json"), path.join(root, "tasks.json"));
    await assert.rejects(storage.load(), /TASK_STATE_INVALID/); await storage.close?.();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("daily schedule runs once across the repeated autumn DST hour", () => {
  const schedule = { kind: "daily", time: "01:30", timezone: "America/New_York" } as const;
  assert.equal(nextRun(schedule, Date.parse("2026-11-01T05:30:00Z")), Date.parse("2026-11-02T06:30:00Z"));
});
test("malformed complete resources never erase the baseline", async () => {
  const f = await fixture(), task = await f.manager.create(watch()); await f.manager.run(task.id);
  const prior = f.state()!.tasks[0]!.snapshot;
  f.handlers.set("learn.resources", () => ({ complete: true }));
  const run = await f.manager.run(task.id); assert.equal(run.status, "failed");
  assert.ok(run.errors.includes("TASK_RESOURCES_RESPONSE_INVALID")); assert.deepEqual(f.state()!.tasks[0]!.snapshot, prior);
});
test("fresh homework state overrides older detail metadata without losing description", async () => {
  const f = await fixture(), task = await f.manager.create(watch());
  f.data.homework.rows = [{ ...f.data.homework.rows[0]!, submitted: true }];
  const run = await f.manager.run(task.id); assert.ok(!run.changes.some(change => change.kind === "deadline"));
});

test('desktop migration keeps task identity, history and delivery ledgers and is idempotent after deletion',async()=>{
  const old=await fixture();const original=await old.manager.create(watch());await old.manager.run(original.id);
  const state=old.state()!;state.tasks[0]!.downloads['uncertain']={state:'pending',at:startAt};
  const next=await fixture();const result=await next.manager.importState('desktop-device',state,{'wechat:self':'wechat:backend'});
  assert.deepEqual(result.imported,[original.id]);const imported=next.state()!.tasks[0]!;
  assert.equal(imported.id,original.id);assert.equal(imported.history.length,1);assert.equal(imported.downloads.uncertain!.state,'unknown');assert.deepEqual(imported.scope.channels,['wechat:backend']);
  assert(Object.keys(imported.notifications).every(key=>key.startsWith('wechat:backend:')));
  assert.deepEqual((await next.manager.importState('desktop-device',state)).skipped,[original.id]);
  await next.manager.remove(original.id);assert.deepEqual((await next.manager.importState('desktop-device',state)).skipped,[original.id]);assert.deepEqual(await next.manager.list(),[]);
  const restart=await fixture(next.state());assert.deepEqual((await restart.manager.importState('desktop-device',state)).skipped,[original.id]);
});
test('desktop migration isolates owners, detects conflicting IDs and rejects broader grants atomically',async()=>{
  const old=await fixture(), task=await old.manager.create(operation());const source=old.state()!;
  const next=await fixture();const wrongOwner=clone(source);wrongOwner.tasks[0]!.owner='account-b';assert.equal((await next.manager.importState('a',wrongOwner)).ignored,1);
  const bad=clone(source);bad.tasks[0]!.scope.operations.push('mail.send');await assert.rejects(next.manager.importState('a',bad),/TASK_SCOPE_CHANGED/);assert.deepEqual(await next.manager.list(),[]);
  await next.manager.importState('a',source);const changed=clone(source);changed.tasks[0]!.name='Conflicting';
  assert.deepEqual((await next.manager.importState('b',changed)).conflicts,[{id:task.id,reason:'id-conflict'}]);assert.equal((await next.manager.get(task.id)).name,task.name);
  const duplicate=clone(source);duplicate.tasks[0]!.id='duplicate';assert.deepEqual((await next.manager.importState('c',duplicate)).skipped,['duplicate']);assert.equal((await next.manager.list()).length,1);
});
