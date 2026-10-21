/** Execute the receiving stores and hooks with delayed I/O; no native calls or school accounts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

const base = path.resolve('apps/desktop/src');
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
const person = { name: 'Received person', avatar: '', website: '', social: '', phone: '', bio: '', updatedAt: 1 };
const orgRef = { groupId: 10, projectId: 20, adminBranch: 'onethu-admin', contentBranch: 'onethu-content' };
function fixture() {
  const storage = new Map(), modules = new Map(), calls = [], contacts = [], updates = [], toasts = [];
  const boxes = [{ id: 'original', name: 'Keep original', items: [] }];
  const control = { gate: null, resolved: null };
  const io = async (name, value) => {
    calls.push(name);
    if (control.gate?.name === name) await control.gate.promise;
    return value;
  };
  const api = {
    me: () => io('git-me', { id: 1 }), group: async () => ({ id: 10, name: 'Remote', full_path: 'remote', visibility: 'private' }),
    project: async () => ({ visibility: 'private', namespace: { id: 10 } }),
    members: async kind => kind === 'groups' ? [{ id: 1, access_level: 50, name: 'Owner' }] : [],
    protections: async () => [
      { name: 'onethu-admin', allow_force_push: false, push_access_levels: [{ access_level: 40 }], merge_access_levels: [{ access_level: 40 }] },
      { name: 'onethu-content', allow_force_push: false, push_access_levels: [{ access_level: 30 }], merge_access_levels: [{ access_level: 30 }] },
    ],
    file: async (_id, branch) => ({ revision: 'r1', value: branch === 'onethu-admin'
      ? { name: 'Remote', brief: '', joinUrl: '', bindings: [], libraries: [], gitlabRepos: [], permissionsVerified: 1 }
      : { projects: [], announcements: [] } }),
  };
  const mocks = {
    'react': {
      useSyncExternalStore: (_subscribe, get) => get(), useState: value => [value, next => updates.push(next)],
      useRef: value => ({ current: value }), useEffect: callback => callback(), useCallback: callback => callback,
    },
    'react/jsx-runtime': { jsx: () => null },
    'i18n/index.js': { t: key => key, msg: key => key, getLocale: () => 'en' },
    'state/vault.js': {
      createVault: name => { const box = { id: 'box' + boxes.length, name, items: [] }; boxes.push(box); return box; },
      replaceVaultItems: (id, items) => { boxes.find(b => b.id === id).items = items; },
      vaultSnapshot: () => ({ boxes, activeId: 'original' }), activeVault: () => boxes[0], markVaultShared: () => {},
    },
    'state/nameCard.js': {
      cardsSnapshot: () => ({ personal: person, contacts }), addContact: (kind, card) => { contacts.push({ kind, card }); return { ok: true }; },
    },
    'state/cloudExchange.js': { resolveExchangeCode: code => io('resolve', control.resolved ?? code), publishExchangeCode: async code => code },
    'state/vaultShareLog.js': { recordIssuedShare: () => {} },
    'state/vaultCloud.js': { installVaultCloudAdapter: () => io('adapter', undefined) },
    'lib/shortCode.js': { isShortCode: code => code.startsWith('ON-'), shortCodeForLink: () => 'ON-TEST' },
    'state/seafile.js': {
      ensureSeafileLoaded: () => io('identity', undefined), getSeafileAccount: () => ({ email: 'reader@fixture.invalid' }),
      refreshSeafileAccount: async () => {},
    },
    'state/gitlab.js': { gitlabOrganizationApi: async () => api },
    'state/orgSyncCore.js': { decodeOrgFile: file => file, errorText: e => e.message, levelRole: () => 'owner' },
    'lib/attach.js': { fileToBytes: () => io('bytes', new Uint8Array()), pickFile: () => io('pick', { name: 'qr.png', mime: 'image/png', file: {} }) },
    'lib/qrScan.js': { qrScanSupported: () => true, decodeQrFile: () => io('qr', control.resolved) },
    'lib/nfc.js': { nfcStatus: async () => ({ available: true, enabled: true }), nfcReadText: () => io('nfc', control.resolved), nfcShareText: async () => {} },
    'components/ExchangeFeedback.js': { ExchangeFeedback: () => null },
    'lib/formModal.js': { openFormModal: () => io('form', { code: control.resolved }) },
    'state/toast.js': { showToast: text => toasts.push(text) },
  };
  function load(name) {
    if (mocks[name]) return mocks[name];
    if (modules.has(name)) return modules.get(name);
    const exports = {}; modules.set(name, exports);
    const file = fs.existsSync(path.join(base, name.replace(/\.js$/, '.ts'))) ? name.replace(/\.js$/, '.ts') : name.replace(/\.js$/, '.tsx');
    const code = ts.transpileModule(fs.readFileSync(path.join(base, file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(code, {
      exports, require: id => load(id.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(name), id)) : id),
      TextEncoder, TextDecoder, Uint8Array, btoa, atob, crypto: webcrypto, console,
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
      window: { addEventListener() {}, removeEventListener() {} },
    }, { filename: file });
    return exports;
  }
  const mode = load('state/experienceMode.js');
  return { load, mode, control, calls, contacts, boxes, updates, toasts, storage };
}
const touchCode = f => f.load('state/touch.js').encodeTouch({ v: 1, kind: 'onethu-touch', issuedAt: 1, personal: person });
const orgCode = (f, remote = false) => {
  const payload = { v: 1, kind: 'org-invite', orgId: 'incoming', name: 'Group', brief: '', joinUrl: '', inviter: 'Owner', issuedAt: 1, ...(remote ? { collaboration: orgRef } : {}) };
  const json = JSON.stringify(payload);
  return 'ONORG1.' + Buffer.from(json).toString('base64url') + '.' + f.load('state/vaultShare.js').checksum(json);
};
const vaultPayload = { v: 1, kind: 'vault-share', issuedAt: 1, name: 'Incoming', items: [{ kind: 'text', title: 'Saved', text: 'Do not lose data' }] };
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('✓ ' + name); }

for (const compact of ['simple', 'practical']) {
  await test(`${compact}: direct receive entry points do not read I/O or mutate saved data`, async () => {
    const f = fixture(), code = touchCode(f), org = orgCode(f), share = await f.load('state/vaultShare.js').encodeShareV2(vaultPayload);
    f.mode.setExperienceMode(compact);
    await assert.rejects(f.load('lib/contentExchange.js').receiveExchangeCode(code), /friends.modeChanged/);
    await assert.rejects(f.load('lib/contentExchange.js').pickAndReceiveQr(), /friends.modeChanged/);
    assert.equal((await f.load('state/touch.js').importTouchCode(code)).ok, false);
    assert.equal((await f.load('state/org.js').acceptOrgInvite(org)).ok, false);
    assert.equal((await f.load('state/vaultShare.js').importShareCodeAsCurrent(share, 'new')).ok, false);
    await assert.rejects(f.load('state/orgSync.js').joinRemoteOrg(orgRef), /friends.modeChanged/);
    assert.equal(f.calls.length, 0); assert.equal(f.contacts.length, 0); assert.equal(f.boxes.length, 1);
    assert.equal(f.load('state/org.js').orgSnapshot().orgs.length, 0);
  });
  await test(`${compact}: late short-code result and full-mode round trip are discarded; fresh receiving recovers`, async () => {
    const f = fixture(), gate = defer(), code = touchCode(f);
    f.control.gate = { name: 'resolve', ...gate };
    const receive = f.load('lib/contentExchange.js').receiveExchangeCode(code);
    const rejected = assert.rejects(receive, /friends.modeChanged/);
    await tick(); f.mode.setExperienceMode(compact); f.mode.setExperienceMode('full'); gate.resolve(); await rejected;
    assert.equal(f.contacts.length, 0);
    f.control.gate = null; await f.load('lib/contentExchange.js').receiveExchangeCode(code);
    assert.equal(f.contacts.length, 1);
  });
  await test(`${compact}: late vault download does not create or overwrite a box`, async () => {
    const f = fixture(), gate = defer(), share = f.load('state/vaultShare.js');
    share.registerVaultCloudAdapter({ resolve: async () => { await gate.promise; return vaultPayload; } });
    const code = await share.encodeShareV2({ ...vaultPayload, items: undefined, cloud: { provider: 'seafile', path: '/incoming' } });
    const pending = share.importShareCodeAsCurrent(code, 'new');
    await tick(); f.mode.setExperienceMode(compact); f.mode.setExperienceMode('full'); gate.resolve();
    assert.equal((await pending).ok, false); assert.equal(f.boxes.length, 1); assert.equal(f.boxes[0].items.length, 0);
  });
  await test(`${compact}: late organization identity response cannot create a local organization`, async () => {
    const f = fixture(), gate = defer(); f.control.gate = { name: 'identity', ...gate };
    const pending = f.load('state/org.js').acceptOrgInvite(orgCode(f));
    await tick(); f.mode.setExperienceMode(compact); gate.resolve();
    assert.equal((await pending).ok, false); assert.equal(f.load('state/org.js').orgSnapshot().orgs.length, 0);
  });
  await test(`${compact}: late remote organization join/read cannot alter or mark saved organization as broken`, async () => {
    const f = fixture(), remote = f.load('state/orgSync.js'), id = await remote.joinRemoteOrg(orgRef);
    const before = JSON.stringify(f.load('state/org.js').orgSnapshot()), gate = defer();
    f.control.gate = { name: 'git-me', ...gate };
    const refresh = assert.rejects(remote.refreshRemoteOrg(id), /friends.modeChanged/);
    const join = assert.rejects(remote.joinRemoteOrg({ ...orgRef, projectId: 21 }), /friends.modeChanged/);
    await tick(); f.mode.setExperienceMode(compact); f.mode.setExperienceMode('full'); gate.resolve(); await Promise.all([refresh, join]);
    assert.equal(JSON.stringify(f.load('state/org.js').orgSnapshot()), before);
  });
  for (const stage of ['pick', 'qr']) await test(`${compact}: switching while ${stage} is pending discards the QR image`, async () => {
    const f = fixture(), gate = defer(); f.control.resolved = touchCode(f); f.control.gate = { name: stage, ...gate };
    const pending = assert.rejects(f.load('lib/contentExchange.js').pickAndReceiveQr(), /friends.modeChanged/);
    await tick(); f.mode.setExperienceMode(compact); f.mode.setExperienceMode('full'); gate.resolve(); await pending;
    assert.equal(f.contacts.length, 0);
  });
  await test(`${compact}: late NFC tag read produces no import, success animation or error overlay`, async () => {
    const f = fixture(), gate = defer(); f.control.resolved = touchCode(f); f.control.gate = { name: 'nfc', ...gate };
    const hook = f.load('lib/useNfcExchange.js').useNfcExchange();
    const pending = hook.receive(); await tick();
    f.mode.setExperienceMode(compact); f.mode.setExperienceMode('full'); gate.resolve(); await pending;
    assert.equal(f.contacts.length, 0); assert.equal(f.updates.some(s => s?.phase === 'success' || s?.phase === 'error'), false);
  });
  await test(`${compact}: submitting an old paste dialog after switching cannot receive or toast`, async () => {
    const f = fixture(), gate = defer(); f.control.resolved = touchCode(f); f.control.gate = { name: 'form', ...gate };
    const hook = f.load('lib/useVaultReceive.js').useVaultReceive();
    const pending = hook.paste(); await tick(); f.mode.setExperienceMode(compact); f.mode.setExperienceMode('full'); gate.resolve(); await pending;
    assert.equal(f.contacts.length, 0); assert.equal(f.toasts.length, 0);
  });
}
console.log(`Compact transfer isolation: ${passed} passed`);
