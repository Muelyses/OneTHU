/** Offline tests of final-write guards and temporary facade isolation.
 * Run: node --import ./tools/ts-resolve-register.mjs tools/cli-mutation-guard-test.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { LearnClient } from '../packages/core/src/learn/client.ts';

let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log(`✓ ${name}`); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const http = () => {
  const writes = [];
  return { writes, debug() {}, webVPNEncoder: undefined,
    lastFinalUrl: 'https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/',
    text: async () => '<html><form><input type="hidden" name="_csrf" value="fixture"></form></html>',
    request: async (url, init) => { writes.push({ url, init }); return new Response('{"result":"success"}'); },
  };
};
await test('learn post/reply check after preparation and isolate concurrent UI requests', async () => {
  const transport = http(), client = new LearnClient(transport); await client.resume();
  const rejected = async () => { throw Error('CLI_DISABLED'); };
  await assert.rejects(client.postBbsReply('course','thread','body',undefined,undefined,rejected), /CLI_DISABLED/);
  await assert.rejects(client.postBbsThread('course',{bqid:'board',title:'title',html:'body'},rejected), /CLI_DISABLED/);
  assert.equal(transport.writes.length,0);
  const results = await Promise.allSettled([
    client.postBbsThread('course',{bqid:'board',title:'CLI',html:'body'},rejected),
    client.postBbsThread('course',{bqid:'board',title:'UI',html:'body'}),
  ]);
  assert.equal(results[0].status,'rejected'); assert.equal(results[1].status,'fulfilled'); assert.equal(transport.writes.length,1);
});
await test('revocation during learn authentication recovery prevents the eventual POST', async () => {
  const transport = http(), client = new LearnClient(transport); let allowed = true, recovered = 0;
  client.reloginHook = async () => { recovered++; allowed=false; return true; };
  await assert.rejects(client.postBbsReply('course','thread','body',undefined,undefined,async()=>{if(!allowed)throw Error('CLI_DISABLED');}),/CLI_DISABLED/);
  assert.equal(recovered,1); assert.equal(transport.writes.length,0);
});

const source = fs.readFileSync('apps/desktop/src/plugins/facade.ts','utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function facadeFixture() {
  const calls = [], gate = deferred(); let token = 'fixture-token', version = 0;
  const modules = {
    '../state/seafile.js': { ensureSeafileLoaded:()=>gate.promise, getSeafileToken:()=>token, getSeafileCredentialVersion:()=>version },
    '../state/privacyConsent.js': { requireCloudConsent:()=>calls.push('consent'), ohAuthorized:()=>true },
    '@tauri-apps/api/core': { invoke:async(name,args)=>{calls.push({name,args});return {link:'https://example.invalid/share'};} },
    '../state/theme.js': { startUserThemeWatch:()=>calls.push('theme') },
    '../state/userext.js': { startUserThemeWatch:()=>calls.push('theme'), registerFlowExecutor:()=>calls.push('flow'), startScheduler:()=>calls.push('scheduler') },
    './types.js': { PluginPermissionError:class extends Error{} },
    '../i18n/index.js': {t:key=>key,msg:key=>key},
  };
  const fallback = new Proxy({}, {get:()=>()=>undefined});
  const exports = {};
  vm.runInNewContext(compiled,{exports,module:{exports},require:id=>modules[id]??fallback,console,URL,URLSearchParams,FormData,Headers,Response,Map,Set,Promise}, {filename:'facade.fixture.cjs'});
  return {api:exports,calls,gate,setToken:value=>{token=value;version++;}};
}
await test('temporary CLI facade does not replace global OH executors or start watchers', async()=>{
  const f=facadeFixture();
  const api=f.api.buildApi('onethu.harness',new Set(['cloud:write']),{beforeWrite:async()=>{}});
  assert.ok(api.cloud.share); assert.deepEqual(f.calls,[]);
  f.api.buildApi('onethu.harness',new Set());
  assert.deepEqual(f.calls,['theme','flow','scheduler']);
});
await test('cloud share guard runs after token loading, before invoking the native mutation',async()=>{
  const f=facadeFixture();let allowed=true,checked=0;
  const api=f.api.buildApi('onethu.harness',new Set(['cloud:write']),{beforeWrite:async()=>{checked++;if(!allowed)throw Error('CLI_DISABLED');}});
  const pending=api.cloud.share('repo','/file',1), rejected=assert.rejects(pending,/CLI_DISABLED/);
  allowed=false;f.gate.resolve();await rejected;
  assert.equal(checked,1);assert.equal(f.calls.filter(call=>typeof call==='object').length,0);
});
await test('cloud share allowed path rechecks consent and reaches exactly one native call',async()=>{
  const f=facadeFixture();let checked=0;
  const api=f.api.buildApi('onethu.harness',new Set(['cloud:write']),{beforeWrite:async()=>{checked++;}});
  f.gate.resolve();await api.cloud.share('repo','/file',1);
  assert.equal(checked,1);assert.equal(f.calls.filter(call=>call==='consent').length,2);
  assert.equal(f.calls.filter(call=>typeof call==='object'&&call.name==='seafile_share').length,1);
  assert.equal(f.api.CLI_GUARDED_MUTATIONS.size,37);
});
await test('cloud credential changes during the guard cannot share from the previous account',async()=>{
  const f=facadeFixture();
  const api=f.api.buildApi('onethu.harness',new Set(['cloud:write']),{beforeWrite:async()=>{f.setToken('fixture-other');}});
  f.gate.resolve();await assert.rejects(api.cloud.share('repo','/file',1),error=>error.code==='CLOUD_ACCOUNT_CHANGED');
  assert.equal(f.calls.filter(call=>typeof call==='object').length,0);
});
console.log(`cli-mutation-guard-test: ${checks} groups passed`);
