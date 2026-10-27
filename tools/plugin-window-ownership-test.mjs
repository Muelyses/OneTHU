/** Isolated main/orb webviews share a mock native host; no school/network calls. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = path => readFileSync(new URL('../apps/desktop/src/' + path, import.meta.url), 'utf8');
const compiled = path => ts.transpileModule(source(path), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const ownerCode = compiled('plugins/windowOwner.ts'), rustCode = compiled('plugins/rust.ts'), loaderCode = compiled('plugins/loader.ts');
function fixture({label='main',search='',native=true,holdChat=null}={}) {
  const calls=[],listeners=new Map(),windowEvents=new Map();let invalidations=0,preflights=0,pumps=0,confirmations=0;
  const window={addEventListener:(name,fn)=>windowEvents.set(name,fn),location:{search},...(native?{__TAURI_INTERNALS__:{}}:{})};
  const rec={manifest:{id:'onethu.harness',kind:'rust',permissions:['learn:read','storage']},settings:{},enabled:true,binPath:'/fixture/harness',code:'export {}'};
  const env={window,URLSearchParams,console,crypto:{randomUUID:()=>`fixture-${label}`},setTimeout,clearTimeout};
  const evaluate=(code,imports)=>{const exports={};vm.runInNewContext(code,{...env,exports,module:{exports},require:id=>{assert.ok(imports[id],`missing import ${id}`);return imports[id];}});return exports;};
  const owner=evaluate(ownerCode,{'@tauri-apps/api/window':{getCurrentWindow:()=>({label})}});
  const invoke=async(name,args)=>{calls.push({label,name,args});if(name==='plugin_call'&&args.method==='run'&&args.params?.command==='chat'&&holdChat)return holdChat;if(name==='harness_bridge_take')return new Promise(()=>{});if(name==='plugin_call'&&args.method==='activate')return{commands:[]};return{name,fixture:true};};
  const rust=evaluate(rustCode,{
    '../i18n/index.js':{t:key=>key},'./windowOwner.js':owner,
    '../cli/service.js':{invalidateCliRequests:()=>{invalidations++;},createCliService:()=>({list:()=>({session:{status:label==='main'?'ready':'unknown'}}),call:async()=>{confirmations++;return{confirmedIn:label};}})},
    '../state/cliRuntime.js':{setCliRuntimeActive:active=>calls.push({label,name:'runtime',active})},
    './facade.js':{CLI_GUARDED_MUTATIONS:new Set(),buildApi:()=>({})},
    './registry.js':{getPlugin:()=>rec},'../lib/clients.js':{logLine:async()=>{}},
    './runLifecycle.js':{runCancellable:async opts=>(await opts.prepare())??opts.run()},
    '../state/privacyConsent.js':{requireOhConsent:()=>{}},
    '@tauri-apps/api/core':{invoke},'@tauri-apps/api/event':{listen:async(name,fn)=>{listeners.set(name,fn);return()=>listeners.delete(name);}},
    './events.js':{ensurePluginEventListener:async()=>{}},
    '../state/madmodel.js':{preflightMadModel:async()=>{preflights++;return null;}},
  });
  const loaderImports={
    '../state/cliRuntime.js':{setCliRuntimeActive:()=>{}},'./windowOwner.js':owner,'../i18n/index.js':{t:key=>key},
    './facade.js':{buildApi:()=>({})},'../lib/androidHost.js':{isAndroidNavigator:()=>false},
    '../state/theme.js':{},'../lib/market.js':{},'./pluginWidgets.js':{},'./rust.js':rust,
    '../state/madmodel.js':{startMadModelPump:()=>{pumps++;},refreshMadModelRoute:async()=>{}},
    '../state/privacyConsent.js':{ohAuthorized:()=>true},
    './registry.js':{getPlugin:()=>rec,snapshot:()=>[rec],subscribe:()=>()=>{}},
    './tabs.js':{},'./pluginAtoms.js':{},'../lib/clients.js':{logLine:async()=>{}},
  };
  const loader=evaluate(loaderCode,loaderImports);
  return{owner,rust,loader,calls,listeners,windowEvents,get invalidations(){return invalidations;},get preflights(){return preflights;},get pumps(){return pumps;},get confirmations(){return confirmations;}};
}
let count=0;async function test(name,fn){await fn();console.log('✓ '+name);count++;}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
await test('only native main and active phone-frame document own the runtime',()=>{
  assert.equal(fixture().owner.isPluginRuntimeOwner(),true);
  assert.equal(fixture({label:'main',search:'?phone=1'}).owner.isPluginRuntimeOwner(),true);
  for(const options of [{label:'oh-orb',search:'?window=overlay'},{label:'oh-orb'},{label:'other'},{label:'main',search:'?phone-frame=1'}]){
    const f=fixture(options);assert.equal(f.owner.isPluginRuntimeOwner(),false);assert.equal(f.pumps,0);
  }
  assert.equal(fixture({native:false}).owner.isPluginRuntimeOwner(),true);
});
await test('orb boot cannot seed, activate, restart, bind, listen, poll, or kill the shared host',async()=>{
  const f=fixture({label:'oh-orb',search:'?window=overlay'});
  await f.loader.seedBuiltinHarness();await f.loader.activateInstalledPlugins();await f.loader.refreshHarnessConsent();
  assert.throws(()=>f.rust.bindRustApi('onethu.harness',new Set()),/MAIN_WINDOW_REQUIRED/);
  for(const action of [()=>f.rust.spawnRustPlugin('onethu.harness','/fixture'),()=>f.rust.startHarnessEmbedded('onethu.harness'),()=>f.rust.killRust('onethu.harness'),()=>f.rust.disposeRust('onethu.harness')])await assert.rejects(action(),/MAIN_WINDOW_REQUIRED/);
  f.rust.unbindRustApi('onethu.harness');assert.equal(f.calls.length,0);assert.equal(f.listeners.size,0);assert.equal(f.invalidations,0);
});
await test('broadcast callbacks execute once in main and write confirmation belongs to main',async()=>{
  const main=fixture(),orb=fixture({label:'oh-orb',search:'?window=overlay'});
  main.rust.bindRustApi('onethu.harness',new Set(['learn:read']));await main.rust.spawnRustPlugin('onethu.harness','/fixture');
  const emit=async payload=>{for(const f of [main,orb])f.listeners.get('plugin-rpc')?.({payload});await flush();};
  await emit({pluginId:'onethu.harness',id:1,method:'onethu.call',params:{ns:'cli',method:'list',args:[]}});
  const replies=main.calls.filter(c=>c.name==='plugin_rpc_reply');assert.equal(replies.length,1);assert.equal(replies[0].args.result.session.status,'ready');
  await emit({pluginId:'onethu.harness',id:2,method:'onethu.call',params:{ns:'cli',method:'call',args:[{operation:'learn.downloadMany',confirm:true}]}});
  assert.equal(main.confirmations,1);assert.equal(orb.confirmations,0);assert.equal(main.calls.filter(c=>c.name==='plugin_rpc_reply')[1].args.result.confirmedIn,'main');
  assert.equal(orb.calls.length,0);
});
await test('orb can run and interrupt shared OH without owning a facade or model refresh loop',async()=>{
  const f=fixture({label:'oh-orb',search:'?window=overlay'});
  await f.rust.callRust('onethu.harness','run',{command:'chat',input:'fixture'});
  await f.rust.notifyRust('onethu.harness','interrupt',{runId:'fixture'});
  assert.deepEqual(f.calls.map(c=>c.name),['plugin_call','plugin_notify']);assert.equal(f.preflights,0);assert.equal(f.listeners.size,0);
});
await test('closing a window cancels only its still-running chat and forgets completed runs',async()=>{
 let release;const holdChat=new Promise(resolve=>{release=resolve});
 const f=fixture({label:'oh-orb',holdChat});
 const running=f.rust.callRust('onethu.harness','run',{command:'chat',input:'fixture',runId:'owned-window-run'});
 await flush();assert.equal(f.calls.filter(c=>c.name==='plugin_call').length,1);
 f.windowEvents.get('pagehide')();await flush();
 const stops=f.calls.filter(c=>c.name==='plugin_notify');
 assert.equal(stops.length,1);assert.equal(stops[0].args.params.runId,'owned-window-run');
 release({answer:'done'});await running;f.windowEvents.get('pagehide')();await flush();
 assert.equal(f.calls.filter(c=>c.name==='plugin_notify').length,1);
});
await test('disposing main invalidates pending approvals before its first native await',async()=>{
  const f=fixture();f.rust.bindRustApi('onethu.harness',new Set());const pending=f.rust.disposeRust('onethu.harness');
  assert.equal(f.invalidations,1);await pending;assert.equal(f.invalidations,2);
});
await test('orb branches before account provider and main startup actions use owner guards',()=>{
  const app=source('App.tsx').slice(source('App.tsx').indexOf('export function App()'));
  assert.ok(app.indexOf('if (IS_OVERLAY_WINDOW) return <GlobalOrb />')<app.indexOf('<AppProvider>'));
  const main=source('main.tsx');assert.match(main,/if \(isPluginRuntimeOwner\(\)\) void syncOverlayPreference/);
  assert.match(main,/if \(isPluginRuntimeOwner\(\)\) \{\s*installAuthWatchdog/);
  assert.match(main,/if \(!isPluginRuntimeOwner\(\)\) return;\s*await privacyReady;\s*const \{ initYuketangRuntimeSync \} = await import\([^;]+;\s*initYuketangRuntimeSync\(\);\s*await seedBuiltinHarness/);
});
console.log(`plugin-window-ownership-test: ${count} groups passed`);
