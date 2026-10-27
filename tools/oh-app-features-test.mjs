/** Execute the real app feature adapter with isolated account/network ports. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

function load(file, imports, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, module: { exports }, require: name => {
    if (!(name in imports)) throw Error(`Unexpected import ${name}`);
    return imports[name];
  }, console, URL, crypto: webcrypto, AbortController, TextEncoder, TextDecoder, atob, setTimeout, clearTimeout, setInterval, clearInterval, ...globals }, { filename: file });
  return exports;
}
const projection = load('apps/desktop/src/cli/publicResult.ts', {});
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  let mode = 'full', revision = 0, epoch = 1, version = 1, profileOwner = 'a@example.test';
  const session = { username: 'account-a', state: 'ready' };
  const calls = [];
  const contacts = [{ id: 'friend', name: 'Friend A', kind: 'personal', note: 'classmate', addedAt: 1,
    card: { name: 'Friend A', phone: '123', bio: 'hello', cloudEmail: 'friend@example.test', avatar: 'SECRET_IMAGE', cover: { src: 'SECRET_COVER' } },
    shared: { channelId: 'channel', shareToken: 'SECRET_SHARE', shareUrl: 'SECRET_LINK' }, previousShares: [{ shareToken: 'SECRET_OLD' }] },
    { id: 'org-card', name: 'Organization card', kind: 'organization', note: '', card: { name: 'Org', brief: 'team', joinUrl: 'SECRET_INVITE' }, addedAt: 2 }];
  const org = { id: 'org-a', name: 'Organization A', brief: 'description', joinUrl: '', members: [{ id: 'm', name: 'Member', email: 'a@example.test', role: 'owner' }],
    projects: [{ id: 'p', name: 'Project', description: 'Details', status: 'active', owner: 'Member', updatedAt: 1 }],
    announcements: [{ id: 'a', title: 'Notice', body: 'Body', pinned: true, updatedAt: 1 }],
    libraries: [{ repoId: 'repo', name: 'Files', sharedWith: ['private@example.test'] }], gitlabRepos: [{ id: 12, name: 'Repo', path: 'org/repo' }],
    updatedAt: 2, invite: { code: 'SECRET_INVITE' }, lastInviteCode: 'SECRET_INVITE', shared: { shareToken: 'SECRET_TOKEN' } };
  const orgStorage = new Map([['onethu.orgs.v1', JSON.stringify({ v: 1, orgs: [org] })]]);
  const orgModule = load('apps/desktop/src/state/org.ts', {
    '../i18n/index.js': { t: key => key }, react: {}, './vaultShare.js': {}, '../lib/fullModeReceive.js': {},
  }, { localStorage: { getItem: key => orgStorage.get(key), setItem: (key, value) => orgStorage.set(key, value) } });
  let remote = async (id, check) => { check(); calls.push(['remote', id]); return orgModule.orgSnapshot().orgs[0]; };
  let skills = { listSkills: async () => [{ id: 's', name: 'Skill', enabled: false, compatibility: 'external-agent', requirements: ['Python'], files: ['SKILL.md'], sha256: 'digest' }],
    importSkill: async item => { calls.push(['import', item.id]); return { id: item.id, enabled: false }; },
    setSkillEnabled: async (id, enabled) => { calls.push(['enable', id, enabled]); return { id, enabled }; } };
  const client = { builtinGroups: async () => [{ uniqueId: 'group', name: 'Group', members: [{ uniqueId: 'agent', name: 'Assistant' }] }],
    skillSearch: async (...args) => { calls.push(['search', ...args]); return { page: { totalPage: 3, currentPage: args[1] }, dataList: [{ id: 'skill', name: 'School skill' }] }; },
    skillList: async (...args) => { calls.push(['plaza', ...args]); return { page: { totalPage: 2 }, dataList: [] }; },
    skillDetail: async id => ({ id, name: 'Real school item', cookie: 'SECRET_COOKIE' }),
    createConversation: async () => { calls.push(['createConversation']); return 'conversation'; },
    chatNative: async opts => { calls.push(['chat', opts.agentId, opts.query, opts.convId]); opts.onDelta('Hello'); return { content: 'Actual answer', convId: opts.convId }; },
  };
  const vaultData = { v: 1, activeId: 'box', boxes: [{ id: 'box', name: 'Box', lastShareCode: 'SECRET_CODE', updatedAt: 1,
    items: [{ id: 'i', type: 'text', title: 'Text', text: 'Actual text', payload: { cookie: 'SECRET_PAYLOAD' }, file: { name: 'file', stagedPath: 'SECRET_PATH', shareUrl: 'SECRET_URL' } }] }] };
  const vaultStorage = new Map([['onethu.vaults.v1', JSON.stringify(vaultData)]]);
  const vault = load('apps/desktop/src/state/vault.ts', { '../i18n/index.js': { t: key => key } }, {
    localStorage: { getItem: key => vaultStorage.get(key), setItem: (key, value) => vaultStorage.set(key, value) },
  });
  const permissions = new Set(['contacts:read', 'org:read', 'org:write', 'gitlab:read', 'gitlab:write', 'xiaoda:read', 'xiaoda:manage', 'xiaoda:chat', 'vault:read', 'vault:write', 'cloud:read']);
  const imports = {
    './types.js': { PluginPermissionError: class extends Error { constructor(perm) { super(`PERMISSION_REQUIRED: ${perm}`); } } },
    '../lib/clients.js': { session }, '../lib/transport.js': {
      nativeSessionEpoch: async () => epoch,
      assertNativeSessionEpoch: async expected => { if (expected !== epoch) throw Error('NATIVE_SESSION_CHANGED'); },
    }, '../state/experienceMode.js': { experienceMode: () => mode, experienceRevision: () => revision },
    '../state/nameCard.js': { cardsSnapshot: () => ({ contacts, personal: { name: 'Account A' } }) }, '../state/org.js': orgModule,
    '../state/seafile.js': { ensureSeafileLoaded: async () => {}, getSeafileAccount: () => ({ email: 'a@example.test' }), getSeafileToken: () => 'private', getSeafileCredentialVersion: () => version, refreshSeafileAccount: async () => {},
      openDir: async (_repoId, path) => [{ name: 'file.txt', kind: 'file', size: 12 }], },
    '../cli/publicResult.js': projection,
    '../lib/shortCode.js': { isShortCode: code => code.startsWith('ON-') },
    '@tauri-apps/api/core': { invoke: async () => { throw Error('No native file read expected in this fixture'); } },
    '../state/orgSync.js': { refreshRemoteOrg: (...args) => remote(...args), saveRemoteContent: async (_id, _collection, _before, _after, guard) => { await guard.beforeWrite(); calls.push(['remote-write']); } },
    '../lib/xiaoda.js': { xiaodaClient: client, xiaodaEnsureLogin: async () => ({ zjh: session.username }) },
    '../lib/skills.js': { listSkills: (...args) => skills.listSkills(...args), importSkill: (...args) => skills.importSkill(...args), setSkillEnabled: (...args) => skills.setSkillEnabled(...args) },
    '../state/vault.js': vault,
  };
  const api = load('apps/desktop/src/plugins/appFeatures.ts', imports, { localStorage: { getItem: () => profileOwner } });
  return { api: api.buildAppFeatures(permissions), guarded: fn => api.buildAppFeatures(permissions, fn), permissions, calls, contacts, get org() { return orgModule.orgSnapshot().orgs[0]; }, client, vault,
    changeAccount: () => { session.username = 'account-b'; epoch++; version++; },
    changeMode: () => { mode = 'practical'; revision++; }, changeEpoch: () => epoch++,
    setProfileOwner: value => { profileOwner = value; }, setRemote: fn => { remote = fn; }, setSkills: value => { skills = value; } };
}
let passed = 0;
async function test(name, work) { await work(); passed++; console.log(`PASS ${name}`); }
await test('friend list uses the real contact index, excludes organization cards, and has no silent result limit', async () => {
  const f = fixture();
  assert.equal((await f.api.contacts.list()).rows[0].name, 'Friend A');
  for (let i = 0; i < 80; i++) f.contacts.push({ ...f.contacts[0], id: `f-${i}` });
  assert.equal((await f.api.contacts.list()).total, 81);
  assert.equal((await f.api.contacts.list('', 'all')).total, 82);
  assert.equal((await f.api.contacts.list('classmate')).total, 81);
  assert.equal((await f.api.contacts.list('not found')).total, 0);
});
await test('contact details and organization projections exclude images, invitation/share credentials and previous channels', async () => {
  const f = fixture();
  const detail = await f.api.contacts.get('friend'); assert.equal(detail.card.phone, '123');
  const org = await f.api.organizations.get('org-a');
  assert.equal(org.members[0].name, 'Member'); assert.equal(org.projects[0].name, 'Project'); assert.equal(org.announcements[0].body, 'Body');
  assert.equal(org.libraries[0].repoId, 'repo');
  assert.ok(!JSON.stringify([detail, org, await f.api.contacts.get('org-card')]).includes('SECRET'));
});
await test('permission and mode denial happen before profile, network or skill reads', async () => {
  const f = fixture(); f.permissions.clear();
  await assert.rejects(f.api.contacts.list(), /contacts:read/);
  await assert.rejects(f.api.organizations.list(), /org:read/);
  await assert.rejects(f.api.xiaoda.agents(), /xiaoda:read/);
  await assert.rejects(f.api.vault.list(), /vault:read/);
  assert.equal(f.calls.length, 0);
  const g = fixture(); g.changeMode(); await assert.rejects(g.api.contacts.list(), /FULL_MODE_REQUIRED/);
});
await test('profile mismatch cannot expose another account index', async () => {
  const f = fixture(); f.setProfileOwner('other@example.test');
  await assert.rejects(f.api.contacts.list(), /PROFILE_ACCOUNT_PENDING/);
  await assert.rejects(f.api.organizations.list(), /PROFILE_ACCOUNT_PENDING/);
});
await test('remote organization details require live membership and never fall back to cached private data', async () => {
  const f = fixture(); f.org.collaboration = { status: 'ready' };
  f.permissions.delete('gitlab:read'); await assert.rejects(f.api.organizations.get('org-a'), /gitlab:read/);
  f.permissions.add('gitlab:read'); f.setRemote(async () => { throw Error('HTTP 403'); });
  await assert.rejects(f.api.organizations.get('org-a'), /HTTP 403/);
  f.setRemote(async (_, check) => { f.changeAccount(); check(); return f.org; });
  await assert.rejects(f.api.organizations.get('org-a'), /AUTH_SESSION_CHANGED/);
});
await test('skill plaza is distinct from installed skills and retains official pagination', async () => {
  const f = fixture(); const result = await f.api.xiaoda.skills('calendar', 2);
  assert.equal(result.page.currentPage, 2); assert.equal(result.page.totalPage, 3);
  assert.deepEqual(f.calls[0], ['search', 'calendar', 2, 20]);
  assert.equal((await f.api.xiaoda.installed())[0].compatibility, 'external-agent');
  assert.ok(!JSON.stringify(await f.api.xiaoda.skill('real-id')).includes('SECRET'));
});
await test('skill mutations honor final guard and stop across account/mode changes before touching native storage', async () => {
  const f = fixture();
  await assert.rejects(f.guarded(async () => { throw Error('CONFIRMATION_CANCELLED'); }).xiaoda.importSkill('skill'), /CONFIRMATION_CANCELLED/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.guarded(async () => { f.changeMode(); }).xiaoda.enableSkill('skill', true), /FULL_MODE_REQUIRED/);
  assert.equal(f.calls.length, 0);
  const g = fixture(); await g.guarded(async () => {}).xiaoda.importSkill('skill');
  assert.deepEqual(g.calls, [['import', 'skill']]);
});
await test('vault reads expose real text and references without share codes, payload internals or staged paths', async () => {
  const f = fixture(); const result = await f.api.vault.items('box');
  assert.equal(result.rows[0].text, 'Actual text');
  assert.ok(!JSON.stringify([await f.api.vault.list(), result]).includes('SECRET'));
});
await test('native account epoch changes invalidate an in-flight read', async () => {
  const f = fixture(), gate = deferred();
  f.client.skillSearch = async () => { await gate.promise; return { dataList: [] }; };
  const p = f.api.xiaoda.skills('q'); await new Promise(r => setTimeout(r, 0));
  f.changeEpoch(); gate.resolve(); await assert.rejects(p, /NATIVE_SESSION_CHANGED/);
});
await test('vault writes use the real state module, preserve originals on cancellation and invalidate old share codes', async () => {
  const f = fixture();
  await assert.rejects(f.guarded(async () => { throw Error('CANCELLED'); }).vault.addText('box', 'Note', 'new text'), /CANCELLED/);
  assert.equal((await f.api.vault.items('box')).total, 1);
  const box = await f.guarded(async () => {}).vault.create('Work');
  await f.api.vault.rename(box.id, 'Renamed');
  const stored = await f.api.vault.addText('box', 'Note', 'Complete user text');
  assert.equal(stored.ok, true);
  assert.equal(f.vault.vaultSnapshot().boxes.find(b => b.id === 'box').lastShareCode, undefined);
  assert.equal((await f.api.vault.item('box', stored.item.id)).text, 'Complete user text');
  await f.api.vault.removeItem('box', stored.item.id);
  assert.equal((await f.api.vault.items('box')).total, 1);
  assert.equal((await f.api.vault.list()).rows.find(b => b.id === box.id).name, 'Renamed');
});
await test('vault text ranges explicitly cover all Unicode characters without silent truncation', async () => {
  const f = fixture(), value = '中文🙂' + 'x'.repeat(10000);
  const item = await f.api.vault.addText('box', 'Long note', value);
  let offset = 0, output = '';
  for (;;) {
    const page = await f.api.vault.readText('box', item.item.id, offset, 1234);
    assert.equal(page.totalChars, Array.from(value).length);
    output += page.text; offset = page.nextOffset;
    if (page.complete) break;
  }
  assert.equal(output, value);
  f.permissions.delete('vault:write'); await assert.rejects(f.api.vault.removeItem('box', item.item.id), /vault:write/);
});
await test('organization content writes use real state, preserve revisions, and stop without verified ownership', async () => {
  const f = fixture();
  const project = await f.api.organizations.saveProject('org-a', 'New project', 'Description', 'active', 'Member');
  assert.equal((await f.api.organizations.get('org-a')).projects.some(p => p.id === project.item.id), true);
  await f.api.organizations.removeProject('org-a', project.item.id);
  const notice = await f.api.organizations.saveAnnouncement('org-a', 'Notice', 'Actual body', true);
  assert.equal((await f.api.organizations.get('org-a')).announcements[0].body, 'Actual body');
  await f.api.organizations.removeAnnouncement('org-a', notice.item.id);
  f.org.members[0].role = 'guest';
  await assert.rejects(f.api.organizations.saveAnnouncement('org-a', 'Denied', 'body'), /OWNER_UNVERIFIED/);
  f.org.members[0].role = 'owner';
  await assert.rejects(f.guarded(async () => { f.org.members[0].role = 'guest'; }).organizations.saveAnnouncement('org-a', 'Denied', 'body'), /OWNER_UNVERIFIED/);
  f.org.members[0].role = 'owner';
  await assert.rejects(f.guarded(async () => { f.changeAccount(); }).organizations.update('org-a', { name: 'Denied' }), /AUTH_SESSION_CHANGED/);
});
await test('delegation uses a real agent id and confirmation before creating or sending anything', async () => {
  const f = fixture();
  await assert.rejects(f.api.xiaoda.ask('invented', 'question'), /XIAODA_AGENT_NOT_FOUND/);
  await assert.rejects(f.guarded(async () => { throw Error('CANCELLED'); }).xiaoda.ask('agent', 'question'), /CANCELLED/);
  assert.equal(f.calls.length, 0);
  const answer = await f.guarded(async () => {}).xiaoda.ask('agent', 'question');
  assert.equal(answer.content, 'Actual answer'); assert.deepEqual(f.calls, [['createConversation'], ['chat', 'agent', 'question', 'conversation']]);
});
await test('cloud file storage uses a verified file reference and rejects traversal or nonexistent files', async () => {
  const f = fixture();
  await assert.rejects(f.api.vault.addFile('box', 'repo', '/folder/../file.txt'), /INVALID_ARGUMENTS/);
  await assert.rejects(f.api.vault.addFile('box', 'repo', '/missing.txt'), /CLOUD_FILE_NOT_FOUND/);
  const result = await f.api.vault.addFile('box', 'repo', '/folder/file.txt');
  assert.equal(result.item.file.cloudRepoId, 'repo'); assert.equal(result.item.file.cloudPath, '/folder/file.txt');
});
console.log(`${passed} app feature groups passed`);
const catalog = JSON.parse(fs.readFileSync('apps/desktop/src/cli/catalog.json', 'utf8'));
const source = ts.createSourceFile('types.ts', fs.readFileSync('apps/desktop/src/plugins/types.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const iface = source.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'OnethuApi');
for (const namespace of ['contacts', 'organizations', 'xiaoda', 'vault']) {
  const group = iface.members.find(node => node.name?.getText(source) === namespace);
  for (const method of group.type.members) assert.ok(catalog.some(op => op.name === `${namespace}.${method.name.getText(source)}`), `Missing reviewed capability: ${namespace}.${method.name.getText(source)}`);
}
console.log('New app namespaces are completely registered in the reviewed catalog');
