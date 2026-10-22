/** Actual automatic cloud target selection must reject received and virtual libraries. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const modules = {
  folder: 'apps/desktop/src/lib/cloudFolder.ts', vault: 'apps/desktop/src/state/vaultCloud.ts',
  wallpaper: 'apps/desktop/src/state/wallpsync.ts', memory: 'apps/desktop/src/memory/sync.ts',
};
const code = Object.fromEntries(Object.entries(modules).map(([name, path]) => [name, ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText]));
const helperCode = ts.transpileModule(fs.readFileSync('apps/desktop/src/lib/ownedCloudRepo.ts', 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const archiveCode = ts.transpileModule(fs.readFileSync('apps/desktop/src/state/wallpArchive.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const repo = (id, name, overrides = {}) => ({ id, name, repoType: 'mine', owner:'owner@fixture.invalid', isVirtual: false, mtime: 1, size: 0, ...overrides });
function fixture(name, entries, { cached = null, createOwned = true, token = 'owner-token', createThrows = false, listFails = false, storage = new Map() } = {}) {
  const calls = [], state = { entries: [...entries], token };
  if (cached) { storage.set('onethu.memory.repo.v1', cached); storage.set('onethu.wallpaper.repo.v1', cached); }
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (command === 'seafile_repos') { if(listFails)throw Error('listing unavailable');return state.entries; }
    if (command === 'seafile_account') return {email:'owner@fixture.invalid'};
    if (command === 'seafile_create_repo') { const made = repo('created-own', args.name); if (createOwned) state.entries.push(made); if(createThrows)throw Error('POST response timed out');return made; }
    if (command === 'write_temp_file') return '/fixture-temp/' + args.name;
    if (command === 'seafile_mkdir') return;
    if (command === 'seafile_upload' || command === 'seafile_upload_wallpaper') return 1;
    if (command === 'seafile_share') return { link: 'https://fixture.invalid/d/test/', token: 'test' };
    if (command === 'seafile_read_bytes') return Buffer.from('{}').toString('base64');
    throw Error('Unexpected command: ' + command);
  };
  const cloud = { ensureSeafileLoaded: async () => {}, getSeafileToken: () => state.token, getSeafileCredentialVersion: () => 1, assertRepoOwner: async () => {} };
  const imports = {
    '../i18n/index.js': { t: key => key }, '@tauri-apps/api/core': { invoke },
    '../state/seafile.js': cloud, './seafile.js': cloud,
    '../lib/clients.js': { logLine: async () => {} },
    '../lib/imageSave.js': { bytesToBase64: bytes => Buffer.from(bytes).toString('base64') },
    './sealedShare.js': {}, './vaultShare.js': { registerVaultCloudAdapter: () => {} },
    './shareRefs.js': { rememberShare: () => {} },
    './wallpaper.js': { wallpaperSnapshot: () => ({ v: 2, global: 'builtin:ink', library: [] }), replaceWallpaperDoc: () => true },
    './mirror.js': { ledgerLoad: async () => ({}), ledgerPut: async () => {}, listAllNotes: async () => ['private.md'], mRead: async () => 'private fixture memory', mAbspath: async () => '/fixture-memory/private.md' },
    './format.js': { sha1Hex: async () => 'fixture-sha' },
  };
  const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  const helperExports={};vm.runInNewContext(helperCode,{exports:helperExports,require:id=>{assert.ok(id in imports,id);return imports[id]},localStorage});
  imports['./ownedCloudRepo.js']=helperExports;imports['../lib/ownedCloudRepo.js']=helperExports;
  const archiveExports = {};vm.runInNewContext(archiveCode,{exports:archiveExports,TextEncoder});imports['./wallpArchive.js']=archiveExports;
  const loaded = new Map();
  const load = (target) => {
    if (loaded.has(target)) return loaded.get(target);
    const exports = {};
    vm.runInNewContext(code[target], { exports, require: id => { assert.ok(id in imports, id); return imports[id]; }, console, Date, TextEncoder, TextDecoder, Uint8Array, btoa, atob, localStorage }, { filename: target + '.fixture.cjs' });
    loaded.set(target,exports);return exports;
  };
  const exports=load(name);
  const write = async (target=name) => {
    const api=load(target);
    if (target === 'folder') return api.prepareAndShareFolder('/Friends/friend', 'fixture');
    if (target === 'vault') return api.uploadExchangeManifest('fixture private content');
    if (target === 'wallpaper') { const result = await api.syncWallpaperToCloud(); if (!result.ok) throw Error(result.msg); return result; }
    return api.memoryPush();
  };
  return { api: exports, calls, write, state, storage };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('✓ ' + name); }
for (const name of Object.keys(modules)) {
  const wanted = name === 'memory' ? 'OH-Memory' : 'OneTHU';
  await test(`${name}: same-name incoming library is never selected over an owned library`, async () => {
    const f = fixture(name, [repo('received', wanted, { repoType: 'shared', isVirtual: true }), repo('own', wanted)]);
    await f.write(); const writes = f.calls.filter(c => ['seafile_upload','seafile_upload_wallpaper'].includes(c.command));
    assert.ok(writes.length > 0); assert.equal(writes.every(c => c.args.repoId === 'own'), true); assert.equal(f.calls.some(c => c.command === 'seafile_create_repo'), false);
  });
  await test(`${name}: known shared and virtual matches may create a separate owned library`, async () => {
    const f = fixture(name, [repo('received', wanted, { repoType: 'shared', isVirtual: false }), repo('virtual', wanted, { isVirtual: true })]);
    await f.write(); assert.equal(f.calls.filter(c => c.command === 'seafile_create_repo').length, 1);
    assert.equal(f.calls.filter(c => ['seafile_upload','seafile_upload_wallpaper'].includes(c.command)).every(c => c.args.repoId === 'created-own'), true);
  });
  await test(`${name}: a same-name organization library neither blocks creation nor becomes a personal target`, async () => {
    const f = fixture(name, [repo('organization', wanted, {repoType:'org',owner:'organization@fixture.invalid',size:19177})]);
    await f.write();
    assert.equal(f.calls.filter(c=>c.command==='seafile_create_repo').length,1);
    const uploads=f.calls.filter(c=>['seafile_upload','seafile_upload_wallpaper'].includes(c.command));
    assert.ok(uploads.length>0);
    assert.equal(uploads.every(c=>c.args.repoId==='created-own'),true);
  });
  await test(`${name}: missing ownership metadata fails before creation or uploading private data`, async () => {
    const f = fixture(name, [{ id: 'not-authoritative', name: wanted }], { createOwned: false });
    await assert.rejects(f.write()); assert.equal(f.calls.some(c => ['seafile_upload','seafile_upload_wallpaper'].includes(c.command)), false);assert.equal(f.calls.some(c=>c.command==='seafile_create_repo'),false);
  });
  await test(`${name}: raw server repo/grepo types cannot be mistaken for absence`,async()=>{
    const f=fixture(name,[repo('raw',wanted,{repoType:'repo'}),repo('raw-group',wanted,{repoType:'grepo'})]);await assert.rejects(f.write());assert.equal(f.calls.filter(c=>c.command==='seafile_create_repo').length,0);
  });
  await test(`${name}: concurrent callers create exactly one owned library`,async()=>{
    const f=fixture(name,[]);await Promise.all([f.write(),f.write(),f.write()]);assert.equal(f.calls.filter(c=>c.command==='seafile_create_repo').length,1);
  });
  await test(`${name}: an uncertain create result never triggers another blind POST`,async()=>{
    const f=fixture(name,[],{createOwned:false,createThrows:true});await assert.rejects(f.write());await assert.rejects(f.write());assert.equal(f.calls.filter(c=>c.command==='seafile_create_repo').length,1);assert.equal(f.calls.filter(c=>['seafile_upload','seafile_upload_wallpaper'].includes(c.command)).length,0);
  });
  await test(`${name}: a lost create response is recovered by an authoritative relist`,async()=>{
    const f=fixture(name,[],{createThrows:true});await f.write();assert.equal(f.calls.filter(c=>c.command==='seafile_create_repo').length,1);assert.ok(f.calls.some(c=>['seafile_upload','seafile_upload_wallpaper'].includes(c.command)&&c.args.repoId==='created-own'));
  });
  await test(`${name}: lookup failures cannot become a create`,async()=>{
    const f=fixture(name,[],{listFails:true});await assert.rejects(f.write());assert.equal(f.calls.filter(c=>c.command==='seafile_create_repo').length,0);
  });
  await test(`${name}: original populated library wins over cached empty duplicates`,async()=>{
    const f=fixture(name,[repo('empty-copy',wanted,{mtime:200}),repo('original',wanted,{mtime:10,size:19177})],{cached:'empty-copy'});await f.write();assert.ok(f.calls.filter(c=>['seafile_upload','seafile_upload_wallpaper'].includes(c.command)).every(c=>c.args.repoId==='original'));assert.equal(f.calls.filter(c=>c.command==='seafile_create_repo').length,0);
  });
  await test(`${name}: multiple populated libraries require an existing trusted choice`,async()=>{
    const f=fixture(name,[repo('first',wanted,{size:500}),repo('second',wanted,{size:100})]);await assert.rejects(f.write());assert.equal(f.calls.filter(c=>c.command==='seafile_create_repo').length,0);assert.equal(f.calls.filter(c=>['seafile_upload','seafile_upload_wallpaper'].includes(c.command)).length,0);
  });

}
for (const name of ['memory', 'wallpaper']) {
  const wanted = name === 'memory' ? 'OH-Memory' : 'OneTHU';
  await test(`${name}: cached received repo IDs are revalidated and cannot bypass ownership checks`, async () => {
    const f = fixture(name, [repo('old-account-library', wanted, { repoType: 'shared', isVirtual: true }), repo('current-owned', wanted)], { cached: 'old-account-library' });
    await f.write(); assert.equal(f.calls.filter(c => ['seafile_upload','seafile_upload_wallpaper'].includes(c.command)).every(c => c.args.repoId === 'current-owned'), true);
    assert.equal(f.storage.get(name === 'memory' ? 'onethu.memory.repo.v1' : 'onethu.wallpaper.repo.v1'), 'current-owned');
  });
}
await test('memory: a cached ID is not usable while the cloud account is disconnected', async () => {
  const f = fixture('memory', [], { cached: 'previous-account-library', token: '' });
  assert.equal(await f.api.ensureMemoryRepo(), null); assert.equal(f.calls.length, 0);
});
await test('folder, vault and wallpaper share one creation flight for OneTHU',async()=>{
 const f=fixture('folder',[]);await Promise.all([f.write('folder'),f.write('vault'),f.write('wallpaper')]);assert.equal(f.calls.filter(c=>c.command==='seafile_create_repo').length,1);
});
await test('an ambiguous creation stays blocked after a full module reload',async()=>{
 const storage=new Map();const first=fixture('memory',[],{createOwned:false,createThrows:true,storage});await assert.rejects(first.write());assert.equal(first.calls.filter(c=>c.command==='seafile_create_repo').length,1);
 const rebooted=fixture('memory',[],{storage});await assert.rejects(rebooted.write());assert.equal(rebooted.calls.filter(c=>c.command==='seafile_create_repo').length,0);
 rebooted.state.entries.push(repo('found-after-reboot','OH-Memory'));await rebooted.write();assert.equal(rebooted.calls.filter(c=>['seafile_upload','seafile_upload_wallpaper'].includes(c.command)).every(c=>c.args.repoId==='found-after-reboot'),true);
});
await test('a populated memory cache resolves multiple populated libraries',async()=>{
 const f=fixture('memory',[repo('first','OH-Memory',{size:500}),repo('second','OH-Memory',{size:100})],{cached:'first'});await f.write();assert.equal(f.calls.filter(c=>['seafile_upload','seafile_upload_wallpaper'].includes(c.command)).every(c=>c.args.repoId==='first'),true);
});
console.log(`Personal cloud target state: ${passed} checks passed`);
