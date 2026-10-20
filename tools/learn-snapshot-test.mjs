/** Runs the actual LearnClient and state/data.ts with an isolated HTTP boundary.
 * No school request, real session, credentials, or production cache is accessed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile = (path) => ts.transpileModule(fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function module(code, imports, extra = {}) {
  const exports = {};
  vm.runInNewContext(code, { exports, module: { exports }, require: (name) => {
    if (!(name in imports)) throw new Error('Unexpected fixture import: ' + name);
    return imports[name];
  }, Error, Date, URL, URLSearchParams, queueMicrotask, setTimeout, clearTimeout, setInterval, clearInterval,
  window: { dispatchEvent() {} }, Event, ...extra });
  return exports;
}
const urls = module(compile('packages/core/src/learn/urls.ts'), {});
const time = module(compile('packages/core/src/learn/time.ts'), {});
class AuthRequiredError extends Error { constructor(message) { super(message); this.name = 'AuthRequiredError'; } }
const { LearnClient } = module(compile('packages/core/src/learn/client.ts'), {
  '../http.js': { AuthRequiredError, HttpClient: class {} }, '../crypto/sm2.js': { encryptPassword() { throw Error('Encryption must not run in fixture'); } },
  './urls.js': urls, '../info/htmltext.js': { decodeHtmlEntities: (text) => text }, './time.js': time,
});
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const hw = (id) => ({ id, courseId: 'fixture-course', title: 'Fixture homework', deadline: '2026-10-20 23:59', submitted: false });
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('✓ ' + name); }
function client(handler) {
  const calls = [];
  const c = new LearnClient({ json: async (url, args) => { calls.push(url); return handler(url, args); }, debug() {} });
  c.applyCsrf('fixture-only');
  return { c, calls };
}
await test('all homework HTTP failures reject rather than become successful empty data', async () => {
  const f = client(() => { throw new Error('fixture HTTP 429'); });
  await assert.rejects(f.c.getAllHomework(['fixture-course']), /429/);
  assert.equal(f.calls.length, 3);
});
await test('one failed status bucket rejects the incomplete snapshot', async () => {
  const f = client((url) => {
    if (url.startsWith(urls.LEARN_HOMEWORK_LIST.submitted)) throw new Error('fixture timeout');
    return { object: [{ zyid: 'fixture-id', xszyid: 'fixture-student-id', bt: 'Fixture', jzsj: '2026-10-20 23:59' }] };
  });
  await assert.rejects(f.c.getAllHomework(['fixture-course']), /timeout/);
});
await test('genuine empty homework and zero courses remain valid', async () => {
  const f = client(() => ({ object: [] }));
  assert.equal((await f.c.getAllHomework(['fixture-course'])).length, 0);
  assert.equal((await f.c.getAllHomework([])).length, 0);
  assert.equal(f.calls.length, 3);
});
await test('complete homework keeps endpoint submission semantics and exact deadline', async () => {
  const f = client((url) => ({ object: [{ zyid: url.split('?')[0], bt: 'Fixture', jzsj: '2026-10-20 23:59' }] }));
  const rows = await f.c.getAllHomework(['fixture-course']);
  assert.equal(rows.length, 3); assert.equal(rows.filter(h => !h.submitted).length, 1);
  assert.equal(rows.filter(h => h.graded).length, 1); assert.ok(rows.every(h => h.deadline === '2026-10-20 23:59'));
});
const stateCode = compile('apps/desktop/src/state/data.ts');
function stateFixture(patch = {}) {
  const values = [], effects = [], logs = [], calls = [];
  const learn = {
    getCurrentSemester: async () => ({ id: 'current-fixture' }),
    getCourseList: async (semester) => { calls.push(semester); return [{ id: semester, name: 'Fixture course' }]; },
    getAllHomework: async (ids) => [hw(ids[0])], getAllNotifications: async () => [], getFileList: async () => [], ...patch,
  };
  const empty = {};
  const api = module(stateCode, {
    react: { useState: (initial) => { const i = values.length; values.push(typeof initial === 'function' ? initial() : initial); return [values[i], (v) => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
      useCallback: (f) => f, useEffect: (f) => effects.push(f), useMemo: (f) => f(), useRef: (v) => ({ current: v }) },
    '../lib/confirm.js': empty,
    '@onethu/core': { xkParseDebug: {}, isAuthError: () => false },
    '../lib/transport.js': { explainNetworkError: (e) => String(e.message ?? e) },
    '../lib/clients.js': { learn, info: {}, session: {}, http: {}, logLine: async (line) => logs.push(line) },
    '../lib/infoLib.js': { helper: {} }, '../lib/reload.js': {}, '../lib/xklogic.js': {},
    './context.js': { useApp: () => ({ status: 'ready', backToLogin() { throw Error('Unexpected logout'); } }) },
    './cache.js': { cacheGet: () => null, isPreviewMode: () => false, purgeXkCaches() {} }, './cardWarn.js': {},
  });
  return { api, values, effects, learn, calls, logs };
}
await test('failed refresh retains last complete snapshot without notifying deletion', async () => {
  const f = stateFixture(); let changes = 0; f.api.subscribeLearnData(() => changes++);
  await f.api.refreshLearnDataSilently(); const original = f.api.getLearnSnapshot();
  f.learn.getAllHomework = async () => { throw Error('fixture partial failure'); };
  assert.equal(await f.api.refreshLearnDataSilently(), null);
  assert.equal(f.api.getLearnSnapshot(), original); assert.equal(changes, 1);
});
await test('real HTTP partial failure cannot replace existing state snapshot', async () => {
  const f = stateFixture(); await f.api.refreshLearnDataSilently(); const original = f.api.getLearnSnapshot();
  const upstream = client((url) => {
    if (url.startsWith(urls.LEARN_HOMEWORK_LIST.new)) throw Error('fixture HTTP 429');
    return { object: [] };
  });
  f.learn.getAllHomework = (ids) => upstream.c.getAllHomework(ids);
  assert.equal(await f.api.refreshLearnDataSilently(), null);
  assert.equal(upstream.calls.length, 3); assert.equal(f.api.getLearnSnapshot(), original);
});
await test('foreground invalidation retains snapshot and reports real failure', async () => {
  const f = stateFixture(); await f.api.refreshLearnDataSilently(); const original = f.api.getLearnSnapshot();
  f.api.invalidateLearnCache(); const hook = f.api.useLearnData();
  f.learn.getAllHomework = async () => { throw Error('fixture list failed'); };
  await hook.reload(); assert.equal(f.api.getLearnSnapshot(), original);
  assert.equal(f.values[0], original); assert.equal(f.values[1], 'error'); assert.match(f.values[2], /fixture list failed/);
});
await test('selected semester change starts a separate refresh and old response is discarded', async () => {
  const gate = deferred(); const f = stateFixture({ getAllHomework: async (ids) => ids[0] === 'old' ? gate.promise : [hw('new')] });
  f.api.setSelectedSemester('old'); const old = f.api.refreshLearnDataSilently(); await flush();
  f.api.setSelectedSemester('new'); const next = await f.api.refreshLearnDataSilently(); assert.equal(next.semester.id, 'new');
  gate.resolve([hw('old')]); assert.equal(await old, null);
  assert.equal(f.api.getLearnSnapshot().semester.id, 'new'); assert.equal(f.api.getLearnSnapshot().homework[0].id, 'new');
});
await test('A→B→A cannot accept a stale first A refresh', async () => {
  const gate = deferred(); let n = 0; const f = stateFixture({ getAllHomework: async () => ++n === 1 ? gate.promise : [hw('latest-A')] });
  f.api.setSelectedSemester('A'); const old = f.api.refreshLearnDataSilently(); await flush();
  f.api.setSelectedSemester('B'); f.api.setSelectedSemester('A'); await f.api.refreshLearnDataSilently();
  gate.resolve([hw('old-A')]); assert.equal(await old, null); assert.equal(f.api.getLearnSnapshot().homework[0].id, 'latest-A');
});
await test('foreground old semester cannot overwrite the new background snapshot', async () => {
  const gate = deferred(); const f = stateFixture({ getAllHomework: async (ids) => ids[0] === 'old' ? gate.promise : [hw('new')] });
  f.api.setSelectedSemester('old'); const hook = f.api.useLearnData(); const old = hook.reload(); await flush();
  f.api.setSelectedSemester('new'); await f.api.refreshLearnDataSilently(); gate.resolve([hw('old')]); await old;
  assert.equal(f.api.getLearnSnapshot().homework[0].id, 'new'); assert.notEqual(f.values[0]?.homework?.[0]?.id, 'old');
});
await test('same-semester invalidation rejects an older in-flight refresh', async () => {
  const gate = deferred(); let n = 0;
  const f = stateFixture({ getAllHomework: async () => ++n === 1 ? gate.promise : [hw('post-submit')] });
  const old = f.api.refreshLearnDataSilently(); await flush();
  f.api.invalidateLearnCache(); await f.api.refreshLearnDataSilently();
  gate.resolve([hw('before-submit')]); assert.equal(await old, null);
  assert.equal(f.api.getLearnSnapshot().homework[0].id, 'post-submit');
});
await test('slow supplementary file fetch holds bundle but cannot fabricate empty success', async () => {
  const gate = deferred(); const f = stateFixture({ getFileList: () => gate.promise });
  let settled = false; const p = f.api.refreshLearnDataSilently().then(() => { settled = true; }); await flush();
  assert.equal(settled, false); assert.equal(f.api.getLearnSnapshot(), null);
  gate.resolve([]); await p; assert.equal(f.api.getLearnSnapshot().homework.length, 1);
});

console.log(`Learn source: ${passed} actual-client/state fixtures passed; no network.`);
