/** Exercise real vault exchange and upload modules with local synthetic ports. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

const b64 = value => Buffer.from(value).toString('base64');
const common = { console, URL, TextEncoder, TextDecoder, Uint8Array, atob, btoa, crypto: webcrypto };
function load(file, modules, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { ...common, ...globals, exports, module: { exports }, require: name => {
    if (!Object.hasOwn(modules, name)) throw Error(`Unexpected import: ${name}`);
    return modules[name];
  } }, { filename: file });
  return exports;
}
const i18n = { t: key => key };
const storage = new Map();
const localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
const vault = load('apps/desktop/src/state/vault.ts', { '../i18n/index.js': i18n }, { localStorage });
const initial = vault.vaultSnapshot().boxes[0];
vault.addToVault({ type: 'text', title: 'Original', text: 'Preserve this text' }, initial.id);
let records = 0;
const share = load('apps/desktop/src/state/vaultShare.ts', {
  '../i18n/index.js': i18n, '../lib/shortCode.js': { isShortCode: code => code.startsWith('ON-'), shortCodeForLink: () => 'ON-TEST-CODE' },
  './vault.js': vault, '../lib/fullModeReceive.js': { fullModeReceiveSession: () => ({ isCurrent: () => true }) },
  './vaultShareLog.js': { recordIssuedShare: () => records++ },
}, { localStorage });
const payload = { v: 1, kind: 'vault-share', name: 'Received', items: [{ type: 'text', title: 'New', text: 'Full text' }] };
const code = share.encodeShare(payload);
await assert.rejects(share.importShareCodeAsCurrent(code, 'new', async () => { throw Error('REVOKED'); }), /REVOKED/);
assert.equal(vault.vaultSnapshot().boxes.length, 1);
assert.equal(vault.vaultSnapshot().boxes[0].items[0].text, 'Preserve this text');
const received = await share.importShareCodeAsCurrent(code, 'new', async () => {});
assert.equal(received.ok, true); assert.equal(vault.vaultSnapshot().boxes.length, 2);
let current = true;
share.registerVaultCloudAdapter({ upload: async () => { current = false; return { provider: 'seafile', path: '/test', shareUrl: 'https://example.invalid/d/test/' }; } });
await assert.rejects(share.mintShareCode(initial, undefined, undefined, async () => { if (!current) throw Error('ACCOUNT_CHANGED'); }), /ACCOUNT_CHANGED/);
assert.equal(records, 0, 'post-upload account changes cannot write a share record to a different account');

let adapter, connected = 'synthetic-token', allowed = true, revokeAfterRead = true, ambiguousShare = false;
const calls = [];
// installVaultCloudAdapter is the only supported entry to register the adapter.
const cloud = load('apps/desktop/src/state/vaultCloud.ts', {
  '../i18n/index.js': i18n,
  '@tauri-apps/api/core': { invoke: async (name, args) => {
    calls.push(name);
    if (name === 'read_file_base64') { if (revokeAfterRead) allowed = false; return b64('file'); }
    if (name === 'write_temp_file') return '/synthetic/manifest.json';
    if (name === 'seafile_share') {
      if (ambiguousShare) throw Error('HTTP 502 after upstream commit');
      return { link: 'https://example.invalid/d/share/', token: 'synthetic-share' };
    }
    return null;
  } },
  '../lib/ownedCloudRepo.js': { ensureOwnedCloudRepo: async (_token, _name, _preferred, guard) => { await guard?.(); return { id: 'owned-repo' }; } },
  './seafile.js': { ensureSeafileLoaded: async () => {}, getSeafileToken: () => connected },
  './sealedShare.js': {}, '../lib/imageSave.js': { bytesToBase64: value => b64(value) },
  './vaultShare.js': { registerVaultCloudAdapter: value => { adapter = value; } },
  './shareRefs.js': { rememberShare: () => calls.push('remember') },
});
await cloud.installVaultCloudAdapter({ cleanup: false });
const guard = async () => { if (!allowed) throw Error('REVOKED'); };
await assert.rejects(adapter.upload({ ...payload, items: [{ type: 'file', title: 'File', file: { name: 'file.txt', stagedPath: '/synthetic/source' } }] }, guard), /REVOKED/);
assert.ok(!calls.includes('seafile_upload') && !calls.includes('seafile_share'));
allowed = true; revokeAfterRead = false; calls.length = 0;
const uploaded = await adapter.upload(payload, guard);
assert.ok(uploaded.shareUrl); assert.equal(calls.filter(x => x === 'seafile_share').length, 1);
assert.equal(calls.at(-1), 'remember');
ambiguousShare = true; calls.length = 0;
await assert.rejects(adapter.upload(payload, guard), /HTTP 502/);
assert.equal(calls.filter(x => x === 'seafile_share').length, 1, 'an ambiguous share outcome must not create a second link');
const createCalls = [];
const owned = load('apps/desktop/src/lib/ownedCloudRepo.ts', {
  '../i18n/index.js': i18n,
  '@tauri-apps/api/core': { invoke: async name => { createCalls.push(name); return name === 'seafile_account' ? { email: 'owner@example.test' } : []; } },
}, { localStorage });
await assert.rejects(owned.ensureOwnedCloudRepo('token', 'Test', undefined, async () => { throw Error('CREATE_REVOKED'); }), /CREATE_REVOKED/);
assert.ok(!createCalls.includes('seafile_create_repo'));
console.log('6 vault exchange/upload authorization groups passed');
