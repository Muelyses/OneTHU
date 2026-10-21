/** Execute actual inbox + name-card modules with authenticated cloud fixtures; no network. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const inboxCode = transpile('apps/desktop/src/state/friendInbox.ts');
const cardCode = transpile('apps/desktop/src/state/nameCard.ts');
const modeCode = transpile('apps/desktop/src/state/experienceMode.ts');
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
const manifestName = '/onethu-friend-channel.json';
function manifest(overrides = {}) { return { v: 1, kind: 'onethu-friend-channel', id: 'channel-11111111', ownerEmail: 'alice@fixture.invalid', ownerName: 'Alice', recipientEmail: 'bob@fixture.invalid', createdAt: Date.now(), ...overrides }; }
function card(id, email, shared) { return { id, kind: 'personal', name: email, card: { name: email, cloudEmail: email, avatar: '', website: '', social: '', phone: '', bio: '', updatedAt: 1 }, note: 'keep me', addedAt: 1, ...(shared ? { shared } : {}) }; }
function fixture({ email = 'bob@fixture.invalid', contacts = [], mode = 'full' } = {}) {
  const files = new Map(), repos = new Map(), storage = new Map(), calls = [];
  const control = { email, token: email, version: 1, gate: null, fail: null };
  storage.set('onethu.experience.v1', mode);
  storage.set('onethu.cards.v1', JSON.stringify({ v: 1, personal: { name: 'Me', avatar: '', website: '', social: '', phone: '', bio: '', updatedAt: 1 }, contacts, orgs: [] }));
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (control.gate && control.gate.match(command, args)) await control.gate.promise;
    const error = control.fail?.(command, args); if (error) throw Error(error);
    if (command === 'seafile_account') return { email: args.token, name: args.token, usage: 0, total: 1 };
    if (command === 'seafile_repos') return repos.get(args.token) ?? [];
    if (command === 'seafile_repo_owner') return (repos.get(args.token) ?? []).find(r => r.id === args.repoId)?.owner ?? args.token;
    if (command === 'seafile_read_bytes') {
      const text = files.get(args.repoId + args.path); if (text === undefined) throw Error('HTTP 404 file missing');
      return Buffer.from(text).toString('base64');
    }
    if (command === 'seafile_create_repo') {
      const item = { id: 'created-' + calls.filter(c => c.command === command).length, name: args.name, repoType: 'mine', owner: args.token, permission: 'rw', mtime: 1 };
      repos.set(args.token, [...(repos.get(args.token) ?? []), item]); return item;
    }
    if (command === 'seafile_upload_text') { files.set(args.repoId + args.parentDir.replace(/\/$/, '') + '/' + args.name, args.content); return; }
    if (['seafile_set_repo_user_permission', 'seafile_share_folder_to_user', 'seafile_share_delete'].includes(command)) return;
    throw Error('Unexpected command: ' + command);
  };
  const common = { '../i18n/index.js': { t: key => key }, react: { useSyncExternalStore: (_subscribe, snapshot) => snapshot() }, './seafile.js': { ensureSeafileLoaded: async () => {}, getSeafileToken: () => control.token, getSeafileCredentialVersion: () => control.version, getSeafileAccount: () => ({ email: control.email }) }, './data.js': { getCampusSnapshot: () => null }, './cloudCal.js': { getCloudCalEmail: () => '' }, '@tauri-apps/api/core': { invoke } };
  const evaluate = (code, imports) => { const exports = {}; vm.runInNewContext(code, { exports, require: id => { assert.ok(id in imports, id); return imports[id]; }, console, Date, TextDecoder, Uint8Array, atob, crypto: webcrypto, localStorage }, { filename: 'friend-inbox.fixture.cjs' }); return exports; };
  const experience = evaluate(modeCode, common);
  const cards = evaluate(cardCode, common), api = evaluate(inboxCode, { ...common, './nameCard.js': cards, './experienceMode.js': experience });
  function incoming({ id = 'incoming', owner = 'alice@fixture.invalid', recipient = control.email, data = manifest({ ownerEmail: owner, recipientEmail: recipient }), permission = 'rw', virtual = true } = {}) {
    const item = { id, name: 'shared-folder', repoType: 'shared', owner, permission, isVirtual: virtual, mtime: 1, size: 0 };
    repos.set(recipient, [...(repos.get(recipient) ?? []), item]); files.set(id + manifestName, JSON.stringify(data)); return item;
  }
  return { api, cards, control, calls, files, repos, storage, incoming, experience, snapshot: () => api.friendInboxSnapshot(), switchAccount: email => { control.email = email; control.token = email; control.version++; } };
}
let passed = 0, failed = 0;
async function test(name, run) { try { await run(); passed++; console.log('✓ ' + name); } catch (error) { failed++; console.error('✗ ' + name + ': ' + error.message); } }
await test('Accepting a legacy virtual shared folder uses the recipient repo and root, and writes a receipt', async () => {
  const f = fixture(); f.incoming(); await f.api.refreshFriendInvitations(true);
  assert.equal(f.snapshot().invitations.length, 1); const id = await f.api.acceptFriendInvitation('channel-11111111');
  const added = f.cards.cardsSnapshot().contacts.find(c => c.id === id);
  assert.equal(added.shared.repoId, 'incoming'); assert.equal(added.shared.path, '/'); assert.equal(added.shared.accountEmail, 'bob@fixture.invalid');
  assert.equal(f.files.has('incoming/onethu-friend-accepted.json'), true); assert.equal(f.snapshot().invitations.length, 0);
});
await test('The server owner and current recipient must match; forged manifests do not produce invitations', async () => {
  const f = fixture(); f.incoming({ data: manifest({ ownerEmail: 'attacker@fixture.invalid' }) }); f.incoming({ id: 'wrong-recipient', data: manifest({ recipientEmail: 'other@fixture.invalid' }) });
  await f.api.refreshFriendInvitations(true); assert.equal(f.snapshot().invitations.length, 0);
});
await test('Acceptance revalidates permissions and fails if the share becomes read-only', async () => {
  const f = fixture(); const repo = f.incoming(); await f.api.refreshFriendInvitations(true); repo.permission = 'r';
  await assert.rejects(f.api.acceptFriendInvitation('channel-11111111')); assert.equal(f.cards.cardsSnapshot().contacts.length, 0);
  assert.equal(f.calls.filter(c => c.command === 'seafile_upload_text').length, 0);
});
await test('A failed receipt write does not mark a channel accepted locally', async () => {
  const f = fixture(); f.incoming(); await f.api.refreshFriendInvitations(true); f.control.fail = cmd => cmd === 'seafile_upload_text' ? '503 receipt unavailable' : null;
  await assert.rejects(f.api.acceptFriendInvitation('channel-11111111')); assert.equal(f.cards.cardsSnapshot().contacts.length, 0); assert.equal(f.snapshot().invitations.length, 1);
});
await test('Ignore is local to the account and survives a forced refresh', async () => {
  const f = fixture(); f.incoming(); await f.api.refreshFriendInvitations(true); f.api.ignoreFriendInvitation('channel-11111111');
  await f.api.refreshFriendInvitations(true); assert.equal(f.snapshot().invitations.length, 0);
  f.switchAccount('other@fixture.invalid'); f.incoming(); await f.api.refreshFriendInvitations(true); assert.equal(f.snapshot().invitations.length, 1);
});
await test('Missing manifests are negatively cached, and force refresh bypasses the cache', async () => {
  const f = fixture(); f.incoming(); f.files.clear(); await f.api.refreshFriendInvitations();
  const first = f.calls.filter(c => c.command === 'seafile_read_bytes').length; await f.api.refreshFriendInvitations();
  assert.equal(f.calls.filter(c => c.command === 'seafile_read_bytes').length, first);
  await f.api.refreshFriendInvitations(true); assert.equal(f.calls.filter(c => c.command === 'seafile_read_bytes').length, first + 1);
});
await test('A transient error in an unrelated share does not hide valid invitations', async () => {
  const f = fixture(); f.incoming(); f.incoming({ id: 'broken', data: manifest({ id: 'channel-22222222' }) });
  f.control.fail = (cmd, args) => cmd === 'seafile_read_bytes' && args.repoId === 'broken' ? 'HTTP 503 temporarily unavailable' : null;
  await f.api.refreshFriendInvitations(true); assert.equal(f.snapshot().invitations.length, 1); assert.ok(f.snapshot().error);
});
await test('Clearing an inbox invalidates an in-flight refresh instead of repopulating an unmounted monitor', async () => {
  const f = fixture(), gate = defer(); f.incoming(); f.control.gate = { ...gate, match: cmd => cmd === 'seafile_read_bytes' };
  const checking = f.api.refreshFriendInvitations(true); await tick(); f.api.clearFriendInbox(); gate.resolve(); await checking;
  assert.equal(f.snapshot().invitations.length, 0); assert.equal(f.snapshot().email, '');
});
await test('A new-account refresh runs immediately without waiting for an old-account request', async () => {
  const f = fixture(), gate = defer(); f.incoming(); f.control.gate = { ...gate, match: (cmd, args) => cmd === 'seafile_repos' && args.token === 'bob@fixture.invalid' };
  const checking = f.api.refreshFriendInvitations(true); await tick(); f.switchAccount('other@fixture.invalid'); f.api.clearFriendInbox(); f.incoming({ data: manifest({ id: 'channel-22222222', recipientEmail: 'other@fixture.invalid' }) });
  const other = f.api.refreshFriendInvitations(true); await tick();
  const checkedNew = f.calls.some(c => c.command === 'seafile_repos' && c.args.token === 'other@fixture.invalid');
  gate.resolve(); await Promise.all([checking, other]); assert.equal(checkedNew, true); assert.equal(f.snapshot().email, 'other@fixture.invalid'); assert.equal(f.snapshot().invitations[0].id, 'channel-22222222');
});
await test('Accepting a channel for a new account preserves the old account contact channel', async () => {
  const old = card('old-contact', 'alice@fixture.invalid', { repoId: 'old-repo', path: '/', channelId: 'old-channel', accountEmail: 'old@fixture.invalid' });
  const f = fixture({ contacts: [old] }); f.incoming(); await f.api.refreshFriendInvitations(true); const id = await f.api.acceptFriendInvitation('channel-11111111');
  assert.notEqual(id, 'old-contact'); assert.equal(f.cards.cardsSnapshot().contacts.find(c => c.id === 'old-contact').shared.repoId, 'old-repo');
});
await test('Editing a peer email cannot silently reuse a channel already shared to another person', async () => {
  const old = card('friend', 'new-peer@fixture.invalid', { repoId: 'own', path: '/', channelId: 'channel-11111111', accountEmail: 'alice@fixture.invalid', ownerEmail: 'alice@fixture.invalid', peerEmail: 'old-peer@fixture.invalid', createdAt: 1, acceptedAt: 2, sharedWith: { email: 'old-peer@fixture.invalid', permission: 'rw', at: 1 } });
  const f = fixture({ email: 'alice@fixture.invalid', contacts: [old] });
  await assert.rejects(f.api.publishFriendInvitation('friend'));
  assert.equal(f.calls.some(c => c.command === 'seafile_set_repo_user_permission'), false);
});
await test('A publish retry reuses the created repository after a later network failure', async () => {
  const f = fixture({ email: 'alice@fixture.invalid', contacts: [card('friend', 'bob@fixture.invalid')] });
  f.control.fail = cmd => cmd === 'seafile_upload_text' ? '503 transient failure' : null; await assert.rejects(f.api.publishFriendInvitation('friend'));
  f.control.fail = null; await f.api.publishFriendInvitation('friend'); assert.equal(f.calls.filter(c => c.command === 'seafile_create_repo').length, 1);
  assert.ok(f.cards.cardsSnapshot().contacts[0].shared.invitationPublishedAt);
});
await test('A legacy public link is revoked before private account metadata is uploaded', async () => {
  const old = card('friend', 'bob@fixture.invalid', { repoId: 'own', path: '/Friends/friend', shareUrl: 'https://cloud.tsinghua.edu.cn/d/oldtoken/', shareToken: 'oldtoken', createdAt: 1 });
  const f = fixture({ email: 'alice@fixture.invalid', contacts: [old] }); await f.api.publishFriendInvitation('friend');
  const revoke = f.calls.findIndex(c => c.command === 'seafile_share_delete'), upload = f.calls.findIndex(c => c.command === 'seafile_upload_text'); assert.ok(revoke >= 0 && revoke < upload);
  assert.equal(f.calls.find(c => c.command === 'seafile_share_folder_to_user').args.path, '/Friends/friend');
});
await test('Concurrent acceptance of the same invitation writes one receipt and creates one contact', async () => {
  const f = fixture(); f.incoming(); await f.api.refreshFriendInvitations(true);
  const first = f.api.acceptFriendInvitation('channel-11111111'), second = f.api.acceptFriendInvitation('channel-11111111');
  assert.equal(first, second); const ids = await Promise.all([first, second]); assert.equal(ids[0], ids[1]);
  assert.equal(f.cards.cardsSnapshot().contacts.length, 1); assert.equal(f.calls.filter(c => c.command === 'seafile_upload_text').length, 1);
});
await test('Revoking the account share between discovery and acceptance blocks connection', async () => {
  const f = fixture(); f.incoming(); await f.api.refreshFriendInvitations(true); f.repos.set(f.control.email, []);
  await assert.rejects(f.api.acceptFriendInvitation('channel-11111111')); assert.equal(f.cards.cardsSnapshot().contacts.length, 0);
});
await test('Changing account while an acceptance receipt is uploading cannot attach the old channel', async () => {
  const f = fixture(), gate = defer(); f.incoming(); await f.api.refreshFriendInvitations(true);
  f.control.gate = { ...gate, match: cmd => cmd === 'seafile_upload_text' }; const accepting = f.api.acceptFriendInvitation('channel-11111111');
  await tick(); f.switchAccount('other@fixture.invalid'); gate.resolve(); await assert.rejects(accepting); assert.equal(f.cards.cardsSnapshot().contacts.length, 0);
});
await test('Changing the contact channel during ownership validation cancels publication', async () => {
  const old = card('friend', 'bob@fixture.invalid', { repoId: 'own', path: '/', channelId: 'channel-11111111', accountEmail: 'alice@fixture.invalid', peerEmail: 'bob@fixture.invalid', createdAt: 1 });
  const f = fixture({ email: 'alice@fixture.invalid', contacts: [old] }), gate = defer();
  f.control.gate = { ...gate, match: cmd => cmd === 'seafile_repo_owner' }; const publishing = f.api.publishFriendInvitation('friend');
  await tick(); f.cards.setContactShare('friend', { ...old.shared, repoId: 'new-channel' }); gate.resolve(); await assert.rejects(publishing);
  assert.equal(f.cards.cardsSnapshot().contacts[0].shared.repoId, 'new-channel'); assert.equal(f.calls.some(c => c.command === 'seafile_upload_text'), false);
});
await test('Owner receipt checks use the original subfolder path and require the correct recipient', async () => {
  const old = card('friend', 'bob@fixture.invalid', { repoId: 'own', path: '/Friends/friend', channelId: 'channel-11111111', accountEmail: 'alice@fixture.invalid', ownerEmail: 'alice@fixture.invalid', peerEmail: 'bob@fixture.invalid', createdAt: 1 });
  const f = fixture({ email: 'alice@fixture.invalid', contacts: [old] });
  const receipt = { v: 1, channelId: 'channel-11111111', recipientEmail: 'stranger@fixture.invalid', acceptedAt: 123 };
  f.files.set('own/Friends/friend/onethu-friend-accepted.json', JSON.stringify(receipt)); await f.api.refreshFriendInvitations(true);
  assert.equal(f.cards.cardsSnapshot().contacts[0].shared.acceptedAt, undefined);
  f.files.set('own/Friends/friend/onethu-friend-accepted.json', JSON.stringify({ ...receipt, recipientEmail: 'bob@fixture.invalid' })); await f.api.refreshFriendInvitations(true);
  assert.equal(f.cards.cardsSnapshot().contacts[0].shared.acceptedAt, 123);
});
await test('Ignoring one delivery does not suppress a later resend with the same channel ID', async () => {
  const f = fixture(); f.incoming({ data: manifest({ sentAt: 1000 }) }); await f.api.refreshFriendInvitations(true);
  f.api.ignoreFriendInvitation('channel-11111111'); await f.api.refreshFriendInvitations(true); assert.equal(f.snapshot().invitations.length, 0);
  f.files.set('incoming' + manifestName, JSON.stringify(manifest({ sentAt: 1001 })));
  await f.api.refreshFriendInvitations(true); assert.equal(f.snapshot().invitations.length, 1); assert.equal(f.snapshot().invitations[0].sentAt, 1001);
});
await test('Conflicting channels require explicit replacement and preserve the former mapping and files', async () => {
  const original = { repoId: 'original', path: '/legacy', channelId: 'old-channel', accountEmail: 'bob@fixture.invalid', ownerEmail: 'bob@fixture.invalid', peerEmail: 'alice@fixture.invalid', createdAt: 1 };
  const f = fixture({ contacts: [card('friend', 'alice@fixture.invalid', original)] }); f.files.set('original/legacy/notes.txt', 'preserved original bytes');
  f.incoming(); await f.api.refreshFriendInvitations(true); assert.equal(f.api.conflictingFriendChannel(f.snapshot().invitations[0]), 'friend');
  await assert.rejects(f.api.acceptFriendInvitation('channel-11111111')); assert.equal(f.calls.filter(c => c.command === 'seafile_upload_text').length, 0);
  const id = await f.api.acceptFriendInvitation('channel-11111111', true); assert.equal(id, 'friend');
  const contact = f.cards.cardsSnapshot().contacts.find(c => c.id === id); assert.equal(contact.shared.repoId, 'incoming');
  assert.equal(contact.previousShares.length, 1); assert.equal(contact.previousShares[0].repoId, 'original'); assert.equal(contact.previousShares[0].path, '/legacy');
  assert.equal(contact.note, 'keep me'); assert.equal(f.files.get('original/legacy/notes.txt'), 'preserved original bytes');
  assert.equal(f.calls.some(c => c.command.includes('delete')), false);
});
await test('A refresh cannot resurrect an invitation accepted while another library was still loading', async () => {
  const f = fixture(), gate = defer(); f.incoming(); await f.api.refreshFriendInvitations(true);
  f.incoming({ id: 'slow-library', data: manifest({ id: 'channel-22222222', ownerEmail: 'another@fixture.invalid' }), owner: 'another@fixture.invalid' });
  f.control.gate = { ...gate, match: (cmd, args) => cmd === 'seafile_read_bytes' && args.repoId === 'slow-library' };
  const checking = f.api.refreshFriendInvitations(true); await tick(); await f.api.acceptFriendInvitation('channel-11111111');
  gate.resolve(); await checking; assert.equal(f.snapshot().invitations.some(i => i.id === 'channel-11111111'), false);
  assert.equal(f.snapshot().invitations.some(i => i.id === 'channel-22222222'), true);
});
await test('Explicit replacement does not overwrite a different channel selected during the receipt upload', async () => {
  const original = { repoId: 'original', path: '/', channelId: 'old-channel', accountEmail: 'bob@fixture.invalid', createdAt: 1 };
  const f = fixture({ contacts: [card('friend', 'alice@fixture.invalid', original)] }), gate = defer(); f.incoming(); await f.api.refreshFriendInvitations(true);
  f.control.gate = { ...gate, match: cmd => cmd === 'seafile_upload_text' };
  const accepting = f.api.acceptFriendInvitation('channel-11111111', true); await tick();
  f.cards.setContactShare('friend', { ...original, repoId: 'newer-selection', channelId: 'newer-channel' }); gate.resolve(); await assert.rejects(accepting);
  assert.equal(f.cards.cardsSnapshot().contacts[0].shared.repoId, 'newer-selection');
});
for (const mode of ['simple', 'practical']) {
  await test(`${mode}: cold start and forced refresh do not contact the cloud or accept invitations`, async () => {
    const f = fixture({ mode }); f.incoming();
    const before = f.storage.get('onethu.cards.v1');
    await f.api.refreshFriendInvitations(true);
    await assert.rejects(f.api.acceptFriendInvitation('channel-11111111'), /friends.modeChanged/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.snapshot().invitations.length, 0);
    assert.equal(f.storage.get('onethu.cards.v1'), before);
    f.experience.setExperienceMode('full'); await f.api.refreshFriendInvitations(true);
    assert.equal(f.snapshot().invitations.length, 1);
  });
  await test(`${mode}: switching during account lookup stops before listing shared libraries`, async () => {
    const f = fixture(), gate = defer(); f.incoming();
    f.control.gate = { ...gate, match: cmd => cmd === 'seafile_account' };
    const checking = f.api.refreshFriendInvitations(true); await tick();
    f.experience.setExperienceMode(mode); gate.resolve(); await checking;
    assert.equal(f.calls.some(c => c.command === 'seafile_repos'), false);
    assert.equal(f.snapshot().error, null);
    assert.equal(f.snapshot().busy, false);
  });
  await test(`${mode}: late manifests stay discarded even after immediately returning to full mode`, async () => {
    const f = fixture(), gate = defer(); f.incoming();
    f.control.gate = { ...gate, match: cmd => cmd === 'seafile_read_bytes' };
    const checking = f.api.refreshFriendInvitations(true); await tick();
    f.experience.setExperienceMode(mode); f.experience.setExperienceMode('full');
    gate.resolve(); await checking;
    assert.equal(f.snapshot().invitations.length, 0);
    assert.equal(f.snapshot().error, null);
    await f.api.refreshFriendInvitations(true);
    assert.equal(f.snapshot().invitations.length, 1);
  });
  await test(`${mode}: switching during accept validation prevents a receipt and local friend creation`, async () => {
    const f = fixture(), gate = defer(); f.incoming(); await f.api.refreshFriendInvitations(true);
    f.control.gate = { ...gate, match: cmd => cmd === 'seafile_read_bytes' };
    const accepting = f.api.acceptFriendInvitation('channel-11111111'); await tick();
    f.experience.setExperienceMode(mode); f.experience.setExperienceMode('full');
    gate.resolve(); await assert.rejects(accepting, /friends.modeChanged/);
    assert.equal(f.calls.some(c => c.command === 'seafile_upload_text'), false);
    assert.equal(f.cards.cardsSnapshot().contacts.length, 0);
    await f.api.refreshFriendInvitations(true);
    await f.api.acceptFriendInvitation('channel-11111111');
    assert.equal(f.cards.cardsSnapshot().contacts.length, 1);
  });
}
console.log(`Friend inbox state: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
