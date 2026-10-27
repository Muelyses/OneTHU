/** Executes the real mailbox state against isolated config/disk/IPC fixtures.
 * No native invocation, campus request, real message or credential is used. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { readDataFile } from './i18n/dictionary.mjs';
const messages = readDataFile('apps/desktop/src/i18n/locales/zh-CN.ts').messages;
const compiled = ts.transpileModule(readFileSync(new URL('../apps/desktop/src/state/mail.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const A = { email: 'a@example.invalid', authCode: 'fixture-a' };
const B = { email: 'b@example.invalid', authCode: 'fixture-b' };
const head = (uid, subject = `fixture-${uid}`) => ({ uid, subject, from: 'sender@example.invalid', dateMs: 1800000000000, seen: false });
const body = (subject) => ({ subject, from: 'sender@example.invalid', to: 'receiver@example.invalid', dateMs: 1800000000000, text: 'Fixture body', html: null });
const list = (heads = [head(1)], total = heads.length, minSeq = 1) => ({ heads, total, minSeq });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture(options = {}) {
  let config = options.config === undefined ? A : options.config;
  let disk = options.disk ?? null, reads = 0;
  let load = options.load ?? (() => Promise.resolve());
  let handler = options.invoke ?? ((cmd) => cmd === 'mail_list' ? list() : cmd === 'mail_read' ? body('fixture') : undefined);
  const calls = [], writes = [], configListeners = new Set(), effects = [];
  const exports = {};
  const imports = {
    '../i18n/index.js': { t: (key, params = {}) => {
      assert.equal(typeof messages[key], 'string', `Registered mail message ${key}`);
      return messages[key].replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (slot, name) => Object.hasOwn(params, name) ? String(params[name]) : slot);
    } },
    react: { useState: (value) => [typeof value === 'function' ? value() : value, () => {}], useEffect: (fn) => effects.push(fn), useCallback: (fn) => fn },
    '@tauri-apps/api/core': { invoke: (cmd, args) => { calls.push({ cmd, args }); return handler(cmd, args); } },
    '../lib/clients.js': {
      fileRead: async () => { reads++; return options.read ? options.read() : disk; },
      fileWrite: async (_path, raw) => { writes.push(raw); if (options.write) await options.write(raw); disk = raw; },
    },
    './cloudCal.js': { getCloudCalConfig: () => config, ensureCloudCalCredentialsLoaded: () => load(), onCloudCalConfigChange: (fn) => { configListeners.add(fn); return () => configListeners.delete(fn); } },
  };
  vm.runInNewContext(compiled, { exports, module: { exports }, require: (id) => { assert.ok(imports[id], id); return imports[id]; }, console }, { filename: 'mail.fixture.cjs' });
  return { api: exports, calls, writes, effects, configListeners, get disk() { return disk; }, get reads() { return reads; },
    setConfig: (next) => { config = next; for (const fn of configListeners) fn(); },
    setLoad: (fn) => { load = fn; }, setHandler: (fn) => { handler = fn; },
    count: (cmd) => calls.filter((call) => call.cmd === cmd).length,
  };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`✓ ${name}`); }
const cache = (owner, heads) => JSON.stringify({ version: 2, account: owner, headsByFolder: { INBOX: heads }, totalsByFolder: { INBOX: heads.length }, minSeqsByFolder: { INBOX: 1 } });

await test('parallel initialization reads owner cache once and refreshes each folder independently', async () => {
  const gate = deferred(); const f = fixture({ read: () => gate.promise });
  const p = f.api.refreshMail('INBOX'), q = f.api.refreshMail('Sent Items');
  await flush(); assert.equal(f.reads, 1); assert.equal(f.calls.length, 0);
  gate.resolve(cache(A.email, [head(9)])); await Promise.all([p, q]); assert.equal(f.count('mail_list'), 2);
});
await test('matching owner cache is visible while refresh is pending', async () => {
  const gate = deferred(); const f = fixture({ disk: cache(A.email, [head(9)]), invoke: () => gate.promise });
  const p = f.api.refreshMail('INBOX'); await flush(); assert.equal(f.api.getMailHead('INBOX', 9)?.uid, 9);
  gate.resolve(list()); await p; assert.equal(f.api.getMailHead('INBOX', 9), null);
});
for (const [label, disk] of [['legacy', JSON.stringify({ headsByFolder: { INBOX: [head(9)] } })], ['other owner', cache(B.email, [head(9)])], ['malformed', '{bad']]) {
  await test(`${label} cache never displays headers`, async () => {
    const gate = deferred(); const f = fixture({ disk, invoke: () => gate.promise });
    const p = f.api.refreshMail('INBOX'); await flush(); assert.equal(f.api.getMailHead('INBOX', 9), null);
    gate.resolve(list()); await p;
  });
}
await test('account change clears headers/counts and same UID reads the new account', async () => {
  const f = fixture({ invoke: async (cmd, args) => cmd === 'mail_read' ? body(args.email) : cmd === 'mail_list' ? list() : undefined });
  await f.api.refreshMail('INBOX'); assert.equal((await f.api.readMail('INBOX', 1)).subject, A.email);
  f.setConfig(B); assert.equal(f.api.getMailHead('INBOX', 1), null); assert.equal(f.api.mailFolderTotal('INBOX'), 0);
  assert.equal((await f.api.readMail('INBOX', 1)).subject, B.email); assert.equal(f.count('mail_read'), 2);
});
await test('late old-account list cannot overwrite headers or persist old cache', async () => {
  const gate = deferred(); const f = fixture({ invoke: async (_cmd, args) => args.email === A.email ? gate.promise : list([head(2)]) });
  const p = f.api.refreshMail('INBOX'); const rejected = assert.rejects(p, /账号已改变/); await flush();
  f.setConfig(B); await f.api.refreshMail('INBOX'); gate.resolve(list([head(1)])); await rejected;
  assert.equal(f.api.getMailHead('INBOX', 1), null); assert.equal(f.api.getMailHead('INBOX', 2)?.uid, 2);
  assert.equal(JSON.parse(f.disk).account, B.email);
});
await test('late old-account body is rejected and does not mark it seen', async () => {
  const gate = deferred(); const f = fixture({ invoke: async () => gate.promise });
  const p = f.api.readMail('INBOX', 1); const rejected = assert.rejects(p, /账号已改变/); await flush();
  f.setConfig(B); gate.resolve(body('old')); await rejected; assert.equal(f.count('mail_mark_seen'), 0);
});
await test('A→B→A rejects the original epoch rather than accepting equal email', async () => {
  const gate = deferred(); const f = fixture({ invoke: async () => gate.promise });
  const p = f.api.readMail('INBOX', 1); const rejected = assert.rejects(p, /账号已改变/); await flush();
  f.setConfig(B); f.setConfig(A); gate.resolve(body('old')); await rejected;
});
await test('rotating auth for same email invalidates cached body and list', async () => {
  const f = fixture({ invoke: async (cmd) => cmd === 'mail_read' ? body('fixture') : cmd === 'mail_list' ? list() : undefined });
  await f.api.refreshMail('INBOX'); await f.api.readMail('INBOX', 1);
  f.setConfig({ ...A, authCode: 'fixture-rotated' }); assert.equal(f.api.getMailHead('INBOX', 1), null);
  await f.api.readMail('INBOX', 1); assert.equal(f.count('mail_read'), 2);
});
await test('late seen completion never mutates the new account same UID', async () => {
  const seen = deferred(); const f = fixture({ invoke: async (cmd) => cmd === 'mail_mark_seen' ? seen.promise : cmd === 'mail_read' ? body('fixture') : list() });
  await f.api.refreshMail('INBOX'); await f.api.readMail('INBOX', 1); f.setConfig(B); await f.api.refreshMail('INBOX');
  seen.resolve(); await flush(); assert.equal(f.api.getMailHead('INBOX', 1).seen, false);
});
await test('parallel reads deduplicate and failed reads allow retry', async () => {
  const gate = deferred(); const f = fixture({ invoke: () => gate.promise });
  const p = f.api.readMail('INBOX', 1), q = f.api.readMail('INBOX', 1);
  const results = Promise.allSettled([p, q]); await flush(); assert.equal(f.count('mail_read'), 1);
  gate.reject(new Error('fixture failure')); assert.ok((await results).every((item) => item.status === 'rejected'));
  f.setHandler(async () => body('retry')); assert.equal((await f.api.readMail('INBOX', 1)).subject, 'retry');
});
await test('same-folder refresh is singleflight', async () => {
  const gate = deferred(); const f = fixture({ invoke: () => gate.promise });
  const p = f.api.refreshMail('INBOX'), q = f.api.refreshMail('INBOX'); await flush(); assert.equal(f.count('mail_list'), 1);
  gate.resolve(list()); await Promise.all([p, q]);
});
await test('folder loading and error do not clobber a separate folder', async () => {
  const gate = deferred(); const f = fixture({ invoke: async (_cmd, args) => args.folder === 'INBOX' ? gate.promise : list() });
  const p = f.api.refreshMail('INBOX'); const rejected = assert.rejects(p, /fixture failure/); await flush();
  await f.api.refreshMail('Sent Items'); assert.equal(f.api.useMail('INBOX').loading, true); assert.equal(f.api.useMail('Sent Items').loading, false);
  gate.reject(new Error('fixture failure')); await rejected; assert.equal(f.api.useMail('Sent Items').error, null);
});
await test('pagination waits for refresh and deduplicates repeated UID', async () => {
  const gate = deferred(); const f = fixture({ invoke: async (_cmd, args) => args.beforeSeq ? list([head(2), head(1)], 3, 1) : gate.promise });
  const p = f.api.refreshMail('INBOX'); await flush(); const q = f.api.loadMoreMail('INBOX'); await flush(); assert.equal(f.count('mail_list'), 1);
  gate.resolve(list([head(3), head(2)], 3, 2)); await Promise.all([p, q]);
  assert.equal(f.api.useMail('INBOX').heads.map((h) => h.uid).join(','), '3,2,1');
  assert.equal(f.calls[1].args.beforeSeq, 2); assert.equal(f.api.useMail('INBOX').canMore, false);
});
await test('synchronous IPC throw does not leave refresh permanently busy', async () => {
  const f = fixture({ invoke: () => { throw new Error('bridge unavailable'); } });
  await assert.rejects(f.api.refreshMail('INBOX'), /bridge/); assert.equal(f.api.useMail('INBOX').loading, false);
  f.setHandler(async () => list()); await f.api.refreshMail('INBOX'); assert.equal(f.count('mail_list'), 2);
});
await test('blank search uses no IPC; old-account search cannot surface', async () => {
  const gate = deferred(); const f = fixture({ invoke: () => gate.promise });
  assert.equal((await f.api.mailSearch('INBOX', ' ')).length, 0); assert.equal(f.calls.length, 0);
  const p = f.api.mailSearch('INBOX', ' fixture '); const rejected = assert.rejects(p, /账号已改变/); await flush();
  assert.equal(f.calls[0].args.query, 'fixture'); f.setConfig(B); gate.resolve([head(1)]); await rejected;
});
await test('unconfigured mailbox sends no IPC and empty recipient rejected', async () => {
  const f = fixture({ config: null });
  await assert.rejects(f.api.sendMail('', '', '', ''), /收件人不能为空/);
  await assert.rejects(f.api.sendMail('to@example.invalid', '', '', ''), /请先绑定/); assert.equal(f.calls.length, 0);
});
await test('send captures account once, separates recipients, and never retries failure', async () => {
  const gate = deferred(); const f = fixture({ invoke: () => gate.promise });
  const p = f.api.sendMail('one@example.invalid; two@example.invalid', 'cc@example.invalid', 'fixture', 'fixture');
  const rejected = assert.rejects(p, /fixture send failure/); await flush(); f.setConfig(B);
  gate.reject(new Error('fixture send failure')); await rejected;
  assert.equal(f.calls[0].args.args.email, A.email); assert.equal(f.calls[0].args.args.to.length, 2); assert.equal(f.count('mail_send'), 1);
});
await test('slow old disk write completes before new-account cache, never after', async () => {
  const gate = deferred(); let writes = 0;
  const f = fixture({ write: async () => { if (++writes === 1) await gate.promise; } });
  const p = f.api.refreshMail('INBOX'); const rejected = assert.rejects(p, /账号已改变/); await flush();
  f.setConfig(B); const q = f.api.refreshMail('INBOX'); await flush(); gate.resolve(); await Promise.all([rejected, q]);
  assert.equal(JSON.parse(f.disk).account, B.email); assert.equal(f.disk.includes('fixture-b'), false);
});
await test('cache failure retains fetched messages and exposes actionable error', async () => {
  const f = fixture({ write: async () => { throw new Error('fixture disk full'); } }); await f.api.refreshMail('INBOX');
  assert.equal(f.api.getMailHead('INBOX', 1)?.uid, 1); assert.match(f.api.useMail('INBOX').error, /缓存未能保存/);
});
await test('configuration I/O failure remains visible, then a retry can recover', async () => {
  const f = fixture({ load: async () => { throw new Error('fixture IO'); } });
  await assert.rejects(f.api.refreshMail('INBOX'), /读取失败/); assert.match(f.api.useMail('INBOX').error, /读取失败/); assert.equal(f.calls.length, 0);
  f.setLoad(async () => {}); await f.api.refreshMail('INBOX'); assert.equal(f.api.useMail('INBOX').error, null);
});
await test('all mounted hooks share one configuration subscription', async () => {
  const f = fixture(); f.api.useMail('INBOX'); f.api.useMailCounts(); f.api.useMailBody('INBOX', null);
  const cleanups = f.effects.map((effect) => effect()); await flush();
  assert.equal(f.configListeners.size, 1); cleanups.forEach((cleanup) => cleanup?.()); assert.equal(f.configListeners.size, 1);
});
await test('CLI send guard runs after credential loading and blocks revoked calls before SMTP', async () => {
  const gate = deferred(); let allowed = true, checked = 0;
  const f = fixture({ load: () => gate.promise });
  const pending = f.api.sendMail('to@example.invalid', '', 'fixture', 'fixture', async () => { checked++; if (!allowed) throw Error('CLI_DISABLED'); });
  const rejected = assert.rejects(pending, /CLI_DISABLED/);
  await flush(); allowed = false; gate.resolve(); await rejected;
  assert.equal(checked, 1); assert.equal(f.count('mail_send'), 0);
});
await test('mail credentials changing during the asynchronous guard block SMTP', async () => {
  const guard = deferred(), entered = deferred();
  const f = fixture();
  const pending = f.api.sendMail('to@example.invalid', '', 'fixture', 'fixture', async () => { entered.resolve(); await guard.promise; });
  const rejected = assert.rejects(pending, /账号已改变/);
  await entered.promise; f.setConfig(B); guard.resolve(); await rejected;
  assert.equal(f.count('mail_send'), 0);
});
await test('CLI read never marks mail seen; a later explicit UI read still does', async () => {
  const f = fixture({ invoke: async cmd => cmd === 'mail_read' ? body('fixture') : undefined });
  await f.api.readMail('INBOX', 1, { markSeen: false });
  assert.equal(f.count('mail_mark_seen'), 0);
  await f.api.readMail('INBOX', 1); await flush();
  assert.equal(f.count('mail_read'), 1); assert.equal(f.count('mail_mark_seen'), 1);
});
console.log(`\nMailbox state: ${passed} isolated cases passed; no network or real mailbox used.`);
