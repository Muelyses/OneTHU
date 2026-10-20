/** Real friend-channel state with two isolated accounts sharing a fixture folder. No network. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
const source = fs.readFileSync('apps/desktop/src/state/friendChannel.ts', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
function cloudFixture() { return { files: new Map(), dirs: new Set(), sequence: 0 }; }
function fixture(cloud = cloudFixture(), { email = 'alice@fixture.invalid', root = '/Friend/Bob' } = {}) {
  const storage = new Map(), calls = [], control = { email, token: email, version: 1, mode: 'full', modeRevision: 0, credentialGate: null, gate: null, reject: null, readFailures: new Set() };
  const contact = { id: 'friend', card: { cloudEmail: 'wrong-profile@fixture.invalid' }, shared: { repoId: email, path: root, peerEmail: email === 'alice@fixture.invalid' ? 'bob@fixture.invalid' : 'alice@fixture.invalid' } };
  const cards = { contacts: [contact], personal: { cloudEmail: 'spoofed-profile@fixture.invalid' } };
  const canonical = (path) => { assert.ok(path === root || path.startsWith(root === '/' ? '/' : root + '/'), path); return root === '/' ? path : path.slice(root.length) || '/'; };
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (control.gate?.command === command) await control.gate.promise;
    if (control.reject === command) throw Error('fixture network failure');
    if (command === 'seafile_mkdir') { cloud.dirs.add(canonical(args.path)); return; }
    if (command === 'seafile_upload_text') { const path = canonical(`${args.parentDir}/${args.name}`); cloud.files.set(path, { content: args.content, mtime: ++cloud.sequence }); return; }
    if (command === 'seafile_upload') {
      const name = args.localPath.split(/[\\/]/).pop(), path = canonical(`${args.parentDir}/${name}`);
      if (!args.replace && cloud.files.has(path)) throw Error('file already exists');
      cloud.files.set(path, { content: 'file bytes', mtime: ++cloud.sequence }); return;
    }
    if (command === 'seafile_dir') {
      const path = canonical(args.path).replace(/\/$/, ''), prefix = path + '/', result = new Map();
      for (const dir of cloud.dirs) if (dir.startsWith(prefix) && dir.slice(prefix.length) && !dir.slice(prefix.length).includes('/')) result.set(dir, { kind: 'dir', name: dir.slice(prefix.length), size: 0, mtime: 0 });
      for (const [file, value] of cloud.files) if (file.startsWith(prefix) && !file.slice(prefix.length).includes('/')) result.set(file, { kind: 'file', name: file.slice(prefix.length), size: Buffer.byteLength(value.content), mtime: value.mtime });
      return [...result.values()];
    }
    if (command === 'seafile_read_bytes') {
      const path = canonical(args.path);
      if (control.readFailures.has(path)) throw Error('fixture read failure');
      const file = cloud.files.get(path); assert.ok(file, path); return Buffer.from(file.content).toString('base64');
    }
    throw Error('Unexpected command: ' + command);
  };
  const imports = {
    '../i18n/index.js': { t: key => key },
    react: { useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
    '@tauri-apps/api/core': { invoke },
    './experienceMode.js': {
      experienceMode: () => control.mode, experienceRevision: () => control.modeRevision,
      useExperienceMode: () => control.mode,
    },
    './seafile.js': {
      ensureSeafileLoaded: async () => { if (control.credentialGate) await control.credentialGate.promise; }, getSeafileToken: () => control.token, getSeafileCredentialVersion: () => control.version,
      getSeafileAccount: () => control.token ? { email: control.email } : null, refreshSeafileAccount: async () => {},
      seafileShareFolderToUser: async () => {}, useSeafile: () => ({ configured: !!control.token, account: control.token ? { email: control.email } : null }),
    },
    './friendInbox.js': { publishFriendInvitation: async id => ({ ok: id === 'friend' }) },
    './nameCard.js': { subscribeCards: () => () => {}, cardsSnapshot: () => cards, setContactShare: (_id, shared) => { contact.shared = shared; } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => { assert.ok(id in imports, id); return imports[id]; }, console, Date, TextDecoder, TextEncoder, Uint8Array, atob, crypto: webcrypto, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } }, { filename: 'friend-channel.fixture.cjs' });
  return { api: exports, cloud, control, contact, cards, storage, calls, messages: () => exports.friendChannelSnapshot().messages,
    switchMode: mode => { if (mode !== control.mode) { control.mode = mode; control.modeRevision++; } },
    switchAccount: (email, token = email) => { control.email = email; control.token = token; control.version++; } };
}
function wire(id, overrides = {}) {
  return JSON.stringify({ format: 'onethu.friend-message', v: 1, id, authorEmail: 'bob@fixture.invalid', at: Date.now(), kind: 'text', text: 'hello', ...overrides });
}
function put(cloud, name, content) { cloud.dirs.add('/messages'); cloud.files.set('/messages/' + name, { content, mtime: ++cloud.sequence }); }
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('✓ ' + name); }
await test('Both isolated accounts receive text, use actual cloud identity, and resolve virtual share roots', async () => {
  const cloud = cloudFixture(), a = fixture(cloud), b = fixture(cloud, { email: 'bob@fixture.invalid', root: '/' });
  assert.equal((await a.api.sendFriendText('friend', '来自甲')).ok, true);
  const stored = [...cloud.files.values()][0]; assert.equal(JSON.parse(stored.content).authorEmail, 'alice@fixture.invalid');
  assert.equal((await b.api.refreshFriendMessages('friend')).added, 1);
  assert.equal(b.messages()[0].mine, false); assert.equal(b.messages()[0].text, '来自甲'); assert.match(b.messages()[0].cloudPath, /^\/messages\//);
  assert.equal((await b.api.sendFriendText('friend', '来自乙')).ok, true);
  assert.equal((await a.api.refreshFriendMessages('friend')).added, 1);
  assert.equal(a.messages().length, 2); assert.equal(a.messages().filter(m => m.mine).length, 1);
  assert.equal(a.messages().find(m => !m.mine).text, '来自乙');
});
await test('Concurrent refresh and repeated polls do not duplicate or redownload unchanged messages', async () => {
  const f = fixture(); put(f.cloud, 'fm.aaaaaaaa.json', wire('fm.aaaaaaaa'));
  const results = await Promise.all([f.api.refreshFriendMessages('friend'), f.api.refreshFriendMessages('friend')]);
  assert.equal(results.every(r => r.ok), true); assert.equal(f.messages().length, 1);
  assert.equal(f.calls.filter(c => c.command === 'seafile_read_bytes').length, 1);
  assert.equal((await f.api.refreshFriendMessages('friend')).added, 0);
  assert.equal(f.calls.filter(c => c.command === 'seafile_read_bytes').length, 1);
});
await test('Concurrent sends have unique IDs and never overwrite each other', async () => {
  const f = fixture(); const results = await Promise.all(Array.from({ length: 12 }, (_, i) => f.api.sendFriendText('friend', 'message ' + i)));
  assert.equal(results.every(r => r.ok), true); assert.equal(f.cloud.files.size, 12); assert.equal(new Set(f.messages().map(m => m.id)).size, 12);
});
await test('Files use actual staged basename and unique directories, and recipient sees download path', async () => {
  const cloud = cloudFixture(), a = fixture(cloud), b = fixture(cloud, { email: 'bob@fixture.invalid', root: '/' });
  const first = await a.api.sendFriendFile('friend', { name: '显示名称.pdf', localPath: '/tmp/staged-original.pdf' });
  const second = await a.api.sendFriendFile('friend', { name: '显示名称.pdf', localPath: '/tmp/staged-original.pdf' });
  assert.equal(first.ok && second.ok, true); assert.notEqual(first.cloudPath, second.cloudPath); assert.match(first.cloudPath, /staged-original\.pdf$/);
  assert.equal((await b.api.refreshFriendMessages('friend')).added, 2);
  assert.equal(b.messages().every(m => m.kind === 'file' && m.text === '显示名称.pdf' && m.cloudPath.startsWith('/messages/attachments/')), true);
  assert.equal(a.calls.filter(c => c.command === 'seafile_upload').every(c => c.args.replace === false), true);
});
await test('Legacy msg-timestamp.txt is imported and never duplicated by the next refresh', async () => {
  const f = fixture(); const at = Date.now(); put(f.cloud, `msg-${at}.txt`, '旧版留言');
  assert.equal((await f.api.refreshFriendMessages('friend')).added, 1); assert.equal(f.messages()[0].text, '旧版留言'); assert.equal(f.messages()[0].at, at);
  await f.api.refreshFriendMessages('friend'); assert.equal(f.messages().length, 1);
});
await test('No messages directory is an empty successful channel, but folder errors are failures', async () => {
  const f = fixture(); assert.equal((await f.api.refreshFriendMessages('friend')).ok, true);
  f.control.reject = 'seafile_dir'; assert.equal((await f.api.refreshFriendMessages('friend')).ok, false);
});
await test('Offline text stays local with explicit failure; failed file uploads are not shown as sent', async () => {
  const f = fixture(); f.switchAccount('', '');
  assert.equal((await f.api.sendFriendText('friend', '离线草稿')).ok, false); assert.equal(f.messages()[0].cloudPath, undefined); assert.equal(f.api.useFriendMessages('friend').length, 1);
  assert.equal((await f.api.sendFriendFile('friend', { name: 'a', localPath: '/tmp/a' })).ok, false); assert.equal(f.messages().length, 1);
});
await test('Account-owned local failures are hidden after switching accounts or logging out', async () => {
  const f = fixture(); f.control.reject = 'seafile_upload_text';
  assert.equal((await f.api.sendFriendText('friend', '本机保留')).ok, false); assert.equal(f.api.useFriendMessages('friend').length, 1);
  f.switchAccount('other@fixture.invalid'); assert.equal(f.api.useFriendMessages('friend').length, 0);
  f.switchAccount('', ''); assert.equal(f.api.useFriendMessages('friend').length, 0);
  f.switchAccount('alice@fixture.invalid'); assert.equal(f.api.useFriendMessages('friend').length, 1);
});
await test('Changing account during upload drops the old asynchronous result', async () => {
  const f = fixture(), gate = defer(); f.control.gate = { command: 'seafile_upload_text', ...gate };
  const sending = f.api.sendFriendText('friend', '旧账号待发'); await tick(); f.switchAccount('other@fixture.invalid'); gate.resolve();
  assert.equal((await sending).ok, false); assert.equal(f.messages().length, 0);
});
await test('Logout and reconnect with the same token still invalidates in-flight uploads', async () => {
  const f = fixture(), gate = defer(); f.control.gate = { command: 'seafile_upload_text', ...gate };
  const sending = f.api.sendFriendText('friend', '旧会话待发'); await tick(); f.switchAccount('', ''); f.switchAccount('alice@fixture.invalid'); gate.resolve();
  assert.equal((await sending).ok, false); assert.equal(f.messages().length, 0);
});
await test('Changing the shared folder during read cannot write results into a new channel', async () => {
  const f = fixture(), gate = defer(); put(f.cloud, 'fm.aaaaaaaa.json', wire('fm.aaaaaaaa')); f.control.gate = { command: 'seafile_read_bytes', ...gate };
  const loading = f.api.refreshFriendMessages('friend'); await tick(); f.contact.shared = { ...f.contact.shared, path: '/Other' }; gate.resolve();
  assert.equal((await loading).ok, false); assert.equal(f.messages().length, 0);
});
await test('Malformed, oversized, ID-mismatched and traversal manifests are not exposed', async () => {
  const f = fixture();
  put(f.cloud, 'fm.aaaaaaaa.json', 'not json'); put(f.cloud, 'fm.bbbbbbbb.json', wire('fm.cccccccc'));
  put(f.cloud, 'fm.dddddddd.json', wire('fm.dddddddd', { kind: 'file', attachment: 'attachments/fm.dddddddd/../../secret' }));
  put(f.cloud, 'fm.eeeeeeee.json', wire('fm.eeeeeeee', { text: 'x'.repeat(17000) }));
  put(f.cloud, 'fm.ffffffff.json', wire('fm.ffffffff', { kind: 'file', attachment: '/absolute/path' }));
  assert.equal((await f.api.refreshFriendMessages('friend')).ok, true); assert.equal(f.messages().length, 0);
  assert.equal(f.calls.filter(c => c.command === 'seafile_read_bytes').length, 4);
});
await test('A partial read failure retains successful messages and retries failed files later', async () => {
  const f = fixture(); put(f.cloud, 'fm.aaaaaaaa.json', wire('fm.aaaaaaaa')); put(f.cloud, 'fm.bbbbbbbb.json', wire('fm.bbbbbbbb'));
  f.control.readFailures.add('/messages/fm.aaaaaaaa.json'); const first = await f.api.refreshFriendMessages('friend');
  assert.equal(first.ok, false); assert.equal(first.added, 1); assert.equal(f.messages().length, 1);
  f.control.readFailures.clear(); const second = await f.api.refreshFriendMessages('friend');
  assert.equal(second.ok, true); assert.equal(second.added, 1); assert.equal(f.messages().length, 2);
});
await test('Channels bound to a different account reject reads and sends without local writeback', async () => {
  const f = fixture(); f.contact.shared.accountEmail = 'other@fixture.invalid';
  assert.equal((await f.api.refreshFriendMessages('friend')).ok, false);
  assert.equal((await f.api.sendFriendText('friend', 'must not enter other account')).ok, false);
  assert.equal((await f.api.sendFriendFile('friend', { name: 'a', localPath: '/tmp/a' })).ok, false);
  assert.equal(f.messages().length, 0); assert.equal(f.calls.length, 0);
});
await test('Legacy file attachments remain visible and downloadable without reading their bytes', async () => {
  const f = fixture(); put(f.cloud, 'old.pdf', 'legacy bytes');
  assert.equal((await f.api.refreshFriendMessages('friend')).added, 1);
  assert.equal(f.messages()[0].kind, 'file'); assert.equal(f.messages()[0].cloudPath, '/Friend/Bob/messages/old.pdf');
  assert.equal(f.calls.filter(c => c.command === 'seafile_read_bytes').length, 0);
  assert.equal((await f.api.refreshFriendMessages('friend')).added, 0); assert.equal(f.messages().length, 1);
});
await test('The old share entry point delegates to publishing an invitation manifest', async () => {
  const f = fixture(); assert.equal((await f.api.openBidirectionalShare('friend')).ok, true);
});
await test('Manifests claiming a third-party author are ignored; both channel peers remain accepted', async () => {
  const f = fixture();
  put(f.cloud, 'fm.aaaaaaaa.json', wire('fm.aaaaaaaa', { authorEmail: 'stranger@fixture.invalid' }));
  put(f.cloud, 'fm.bbbbbbbb.json', wire('fm.bbbbbbbb', { authorEmail: ' BOB@fixture.invalid ' }));
  assert.equal((await f.api.refreshFriendMessages('friend')).added, 1);
  assert.equal(f.messages()[0].authorEmail, 'bob@fixture.invalid');
});
await test('Legacy channels without peer metadata use the contact cloud email', async () => {
  const f = fixture(); delete f.contact.shared.peerEmail; f.contact.card.cloudEmail = 'bob@fixture.invalid';
  put(f.cloud, 'fm.aaaaaaaa.json', wire('fm.aaaaaaaa'));
  assert.equal((await f.api.refreshFriendMessages('friend')).added, 1);
});
await test('Switching a contact to another channel hides the old history and restores it when switched back', async () => {
  const f = fixture(); f.contact.shared.channelId = 'channel-first';
  assert.equal((await f.api.sendFriendText('friend', 'first channel')).ok, true);
  assert.equal(f.api.useFriendMessages('friend').length, 1);
  f.contact.shared = { ...f.contact.shared, channelId: 'channel-second' };
  assert.equal(f.api.useFriendMessages('friend').length, 0);
  assert.equal((await f.api.sendFriendText('friend', 'second channel')).ok, true);
  assert.equal(f.api.useFriendMessages('friend').length, 1); assert.equal(f.api.useFriendMessages('friend')[0].text, 'second channel');
  f.contact.shared = { ...f.contact.shared, channelId: 'channel-first' };
  assert.equal(f.api.useFriendMessages('friend').length, 1); assert.equal(f.api.useFriendMessages('friend')[0].text, 'first channel');
  assert.equal(f.messages().length, 2);
});
await test('Legacy unassigned history is hidden in a newly bound channel until the cloud copy is reread', async () => {
  const f = fixture(); put(f.cloud, `msg-${Date.now()}.txt`, 'legacy history');
  await f.api.refreshFriendMessages('friend'); assert.equal(f.api.useFriendMessages('friend').length, 1);
  f.contact.shared.channelId = 'new-bound-channel'; assert.equal(f.api.useFriendMessages('friend').length, 0);
  await f.api.refreshFriendMessages('friend'); assert.equal(f.api.useFriendMessages('friend').length, 1);
  assert.equal(f.api.useFriendMessages('friend')[0].channelId, 'new-bound-channel');
});
await test('Simple and practical modes make no friend reads or sends and preserve existing history', async () => {
  for (const mode of ['simple', 'practical']) {
    const f = fixture(); put(f.cloud, 'fm.aaaaaaaa.json', wire('fm.aaaaaaaa'));
    await f.api.refreshFriendMessages('friend');
    const saved = f.storage.get('onethu.friendMsgs.v1');
    f.switchMode(mode); f.calls.length = 0;
    assert.equal((await f.api.refreshFriendMessages('friend')).ok, false);
    assert.equal((await f.api.sendFriendText('friend', 'hidden send')).ok, false);
    assert.equal((await f.api.sendFriendFile('friend', { name: 'a', localPath: '/tmp/a' })).ok, false);
    assert.equal(f.calls.length, 0);
    assert.equal(f.api.useFriendMessages('friend').length, 0);
    assert.equal(f.storage.get('onethu.friendMsgs.v1'), saved);
    assert.equal(f.messages().length, 1);
    f.switchMode('full'); assert.equal(f.api.useFriendMessages('friend').length, 1);
  }
});
await test('Switching to a compact mode while downloading discards late messages without touching storage', async () => {
  for (const mode of ['simple', 'practical']) {
    const f = fixture(), gate = defer(); put(f.cloud, 'fm.aaaaaaaa.json', wire('fm.aaaaaaaa'));
    f.control.gate = { command: 'seafile_read_bytes', ...gate };
    const loading = f.api.refreshFriendMessages('friend'); await tick();
    f.switchMode(mode); gate.resolve();
    assert.equal((await loading).ok, false); assert.equal(f.messages().length, 0);
    assert.equal(f.storage.has('onethu.friendMsgs.v1'), false);
    f.control.gate = null; f.switchMode('full');
    assert.equal((await f.api.refreshFriendMessages('friend')).added, 1);
  }
});
await test('Returning to full mode starts a new read without reusing the still-pending old read', async () => {
  const f = fixture(), gate = defer(); put(f.cloud, 'fm.aaaaaaaa.json', wire('fm.aaaaaaaa'));
  f.control.gate = { command: 'seafile_read_bytes', ...gate };
  const oldRead = f.api.refreshFriendMessages('friend'); await tick();
  f.switchMode('simple'); f.switchMode('full');
  f.control.gate = null;
  assert.equal((await f.api.refreshFriendMessages('friend')).added, 1);
  const saved = f.storage.get('onethu.friendMsgs.v1');
  gate.resolve();
  assert.equal((await oldRead).ok, false);
  assert.equal(f.storage.get('onethu.friendMsgs.v1'), saved);
  assert.equal(f.messages().length, 1);
});
await test('A full to compact to full switch during credential loading prevents all network requests', async () => {
  const f = fixture(), gate = defer(); f.control.credentialGate = gate;
  const loading = f.api.refreshFriendMessages('friend'); await tick();
  f.switchMode('practical'); f.switchMode('full'); gate.resolve();
  assert.equal((await loading).ok, false);
  assert.equal(f.calls.length, 0); assert.equal(f.messages().length, 0);
});
await test('Mode changes during sending cannot append late success or offline fallback drafts', async () => {
  const f = fixture(), gate = defer(); f.control.gate = { command: 'seafile_upload_text', ...gate };
  const sending = f.api.sendFriendText('friend', 'old mode'); await tick();
  f.switchMode('simple'); f.switchMode('full'); gate.resolve();
  assert.equal((await sending).ok, false);
  assert.equal(f.messages().length, 0); assert.equal(f.storage.has('onethu.friendMsgs.v1'), false);
});
console.log(`Friend channel state: ${passed} checks passed`);
