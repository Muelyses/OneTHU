/** Two isolated browser devices, real profile/card/org modules and an in-memory
 * authenticated cloud. No school requests, credentials or real cloud writes. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
// A fresh module graph avoids duplicate stores from stale development HMR URLs.
const requireDesktop=createRequire(new URL('../apps/desktop/package.json',import.meta.url));
const {createServer}=await import(pathToFileURL(join(dirname(requireDesktop.resolve('vite/package.json')),'dist/node/index.js')).href);
const cache=mkdtempSync(join(tmpdir(),'onethu-profile-vite-'));
const server=await createServer({root:resolve('apps/desktop'),configFile:resolve('apps/desktop/vite.config.ts'),cacheDir:cache,logLevel:'error',server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});
await server.listen();
const base='http://127.0.0.1:'+server.httpServer.address().port;
const out=process.env.ONETHU_TEST_ARTIFACTS??join(tmpdir(),'onethu-profile-sync');
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const repos=new Map(),checks=[],errors=[],diagnostics=[];
const ok=(condition,label)=>{assert.ok(condition,label);checks.push(label);console.log('✓ '+label)};
let shared=false;
let readGate;
async function device(platform){
 const context=await browser.newContext({viewport:{width:1280,height:850}}),page=await context.newPage(),files=new Map();
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().isNavigationRequest()&&r.request().url().includes('profile-fixture=1')
  ?r.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>t=>t; window.__vite_plugin_react_preamble_installed__=true;</script></body></html>'})
  :new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await page.routeWebSocket(/.*/,()=>{});
 await page.exposeFunction('__profileInvoke',async(cmd,a={})=>{
  const owner=String(a.token??'owner')+'@fixture.invalid';
  const getRepo=()=>{const r=repos.get(a.repoId);if(!r||r.owner!==owner)throw Error('403 forbidden');return r};
  switch(cmd){
   case 'log_debug':if(String(a.line).includes('[PROFILE]'))diagnostics.push(a.line);return null;
   case 'state_read':return files.get(a.name)??null;
   case 'state_write':files.set(a.name,a.content);return null;
   case 'state_delete':files.delete(a.name);return null;
   case 'seafile_account':return {name:'Fixture',email:owner,usage:0,total:100000};
   case 'seafile_repos':return [...repos.values()].filter(r=>r.owner===owner).map(r=>({...r,files:undefined})).concat([{id:'group',name:'Shared resources',repoType:'group',owner:'group',mtime:0,size:0}]);
   case 'seafile_create_repo':{const r={id:randomUUID(),name:a.name,owner,repoType:'mine',isVirtual:false,mtime:1,size:0,files:new Map()};repos.set(r.id,r);return {id:r.id};}
   case 'seafile_assert_account_acl':getRepo();if(shared)throw Error('public share');return null;
   case 'seafile_repo_user_shares':getRepo();return [];
   case 'seafile_dir':return [...getRepo().files].map(([name,text])=>({name,kind:'file',size:Buffer.byteLength(text),mtime:1}));
   case 'seafile_read_bytes':{const text=getRepo().files.get(a.path.slice(1));if(text===undefined)throw Error('404');const gate=readGate;if(gate){readGate=undefined;gate.enter();await gate.promise;}return Buffer.from(text).toString('base64');}
   case 'seafile_upload_profile':{const r=getRepo();if(shared||r.name!=='OneTHU-Profile')throw Error('private profile required');r.files.set(a.name,a.content);r.size=[...r.files.values()].reduce((n,s)=>n+Buffer.byteLength(s),0);return a.content.length;}
   case 'http_native':return {status:200,status_text:'OK',headers:{'content-type':'application/json'},set_cookies:[],url:a.input.url,body:'{}'};
   default:return null;
  }
 });
 await page.addInitScript(platform=>{
  Object.defineProperty(navigator,'platform',{value:platform});
  window.__TAURI_INTERNALS__={invoke:(c,a)=>window.__profileInvoke(c,a),transformCallback:()=>1,metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}}};
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
 },platform);
 await page.goto(base+'?profile-fixture=1');
 await page.evaluate(async()=>{
  window.profileTest={cards:await import('/src/state/nameCard.ts'),org:await import('/src/state/org.ts'),cloud:await import('/src/state/seafile.ts'),sync:await import('/src/state/profileSync.ts'),mode:await import('/src/state/experienceMode.ts')};
  await window.profileTest.cloud.setSeafileToken('owner');
  window.profileTest.stop=window.profileTest.sync.startProfileSync();
 });
 return page;
}
const synced=page=>page.waitForFunction(()=>window.profileTest.sync.profileSyncStatus()==='synced',null,{timeout:20000});
const flush=async page=>{await page.evaluate(()=>window.profileTest.sync.requestProfileSync());await synced(page)};
let passed=false;
try{
 const mac=await device('MacIntel');await synced(mac);
 await mac.evaluate(()=>{
  const p=window.profileTest;
  p.cards.savePersonalCard({name:'张同学',bio:'清华大学 · 本科生'});
  p.cards.addContact('personal',{name:'李同学',avatar:'',website:'',social:'',phone:'fixture-phone',bio:'',updatedAt:100});
  p.org.createOrg({name:'学习小组',ownerName:'张同学',ownerEmail:'owner@fixture.invalid'});
 });
 await flush(mac);
 const win=await device('Win32');await synced(win);
 let snap=await win.evaluate(()=>({cards:window.profileTest.cards.cardsSnapshot(),orgs:window.profileTest.org.orgSnapshot()}));
 if(!(snap.cards.personal.name==='张同学'&&snap.cards.contacts.length===1&&snap.orgs.orgs.length===1))console.error('Fixture state mismatch',JSON.stringify({snap,replicas:[...repos.values()].filter(r=>r.name==='OneTHU-Profile').map(r=>({owner:r.owner,files:[...r.files.values()].map(s=>JSON.parse(s))}))}));
 ok(snap.cards.personal.name==='张同学'&&snap.cards.contacts.length===1&&snap.orgs.orgs.length===1,'Fresh Windows device restores the actual Mac card, friend and organization index');
 await mac.evaluate(()=>window.profileTest.cards.removeContact(window.profileTest.cards.cardsSnapshot().contacts[0].id));await flush(mac);await flush(win);
 ok(await win.evaluate(()=>window.profileTest.cards.cardsSnapshot().contacts.length===0),'Friend deletion propagates and stale copies do not resurrect it');
 await win.evaluate(()=>window.profileTest.mode.setExperienceMode('practical'));
 await mac.evaluate(()=>window.profileTest.cards.addContact('personal',{name:'王同学',avatar:'',website:'',social:'',phone:'second-fixture',bio:'',updatedAt:200}));await flush(mac);
 await win.evaluate(()=>window.profileTest.sync.requestProfileSync());
 ok(await win.evaluate(()=>window.profileTest.cards.cardsSnapshot().contacts.length===0),'Practical mode does not import full-mode contacts');
 await win.evaluate(()=>window.profileTest.mode.setExperienceMode('full'));await synced(win);
 ok(await win.evaluate(()=>window.profileTest.cards.cardsSnapshot().contacts.length===1),'Returning to full mode resumes synchronization');
 let enter,release;const entered=new Promise(r=>enter=r),promise=new Promise(r=>release=r);
 readGate={enter,promise};await win.evaluate(()=>window.profileTest.sync.requestProfileSync());await entered;
 await win.evaluate(()=>window.profileTest.cloud.setSeafileToken('other'));release();await synced(win);
 ok(await win.evaluate(()=>window.profileTest.cards.cardsSnapshot().personal.name===''&&window.profileTest.org.orgSnapshot().orgs.length===0),'Changing cloud accounts clears the previous account index');
 const other=[...repos.values()].find(r=>r.owner==='other@fixture.invalid'&&r.name==='OneTHU-Profile');
 ok(other&&[...other.files.values()].every(s=>!s.includes('张同学')&&!s.includes('王同学')),'The new account never receives the old account data');
 await win.evaluate(()=>window.profileTest.cloud.setSeafileToken('owner'));await synced(win);
 ok(await win.evaluate(()=>window.profileTest.cards.cardsSnapshot().personal.name==='张同学'),'Returning to the original account restores its checkpoint without erasing it');
 shared=true;await win.evaluate(()=>window.profileTest.sync.requestProfileSync());
 await win.waitForFunction(()=>window.profileTest.sync.profileSyncStatus()==='paused');
 ok(true,'Public/shared profile library pauses replication before reading or writing personal data');
 shared=false;
 ok([...repos.values()].filter(r=>r.name==='OneTHU-Profile'&&r.owner==='owner@fixture.invalid').length===1,'Normal group metadata without virtual flag does not block or duplicate the profile library');
 await flush(mac);await flush(win);
 await mac.evaluate(()=>{window.profileTest.stop();window.profileTest.cards.savePersonalCard({bio:'喜欢编程，也喜欢探索校园'})});
 await win.evaluate(()=>{window.profileTest.stop();window.profileTest.cards.savePersonalCard({website:'https://example.com'})});
 await mac.evaluate(()=>{window.profileTest.stop=window.profileTest.sync.startProfileSync()});await flush(mac);
 await win.evaluate(()=>{window.profileTest.stop=window.profileTest.sync.startProfileSync()});await flush(win);
 ok(await win.evaluate(()=>{const c=window.profileTest.cards.cardsSnapshot().personal;return c.bio==='喜欢编程，也喜欢探索校园'&&c.website==='https://example.com'&&window.profileTest.sync.profileSyncConflicts().length===0}),'Independent concurrent card fields merge automatically without a prompt');
 await flush(mac);
 await mac.evaluate(()=>{window.profileTest.stop();window.profileTest.cards.savePersonalCard({name:'张铭'})});
 await win.evaluate(()=>{window.profileTest.stop();window.profileTest.cards.savePersonalCard({name:'张明'})});
 await mac.evaluate(()=>{window.profileTest.stop=window.profileTest.sync.startProfileSync()});await flush(mac);
 await win.evaluate(()=>{window.profileTest.stop=window.profileTest.sync.startProfileSync()});
 await win.waitForFunction(()=>window.profileTest.sync.profileSyncStatus()==='conflict');
 ok(await win.evaluate(()=>window.profileTest.cards.cardsSnapshot().personal.name==='张明'),'A real same-field conflict does not silently overwrite the local card');
 // Full application, real Contacts page and real conflict controls after restart.
 await win.goto(base+'?explorer-preview=profile-sync#/contacts');
 await win.locator('.contacts-page').waitFor({timeout:20000});
 await win.locator('.profile-sync-choices').waitFor();
 ok(await win.locator('.profile-sync-choice').count()===2,'True conflicts offer exactly two explicit versions');
 await win.keyboard.press('Escape');
 ok(await win.locator('.profile-sync-choices').isVisible(),'Escape cannot dismiss an unresolved conflict');
 ok(await win.getByRole('button',{name:'稍后再说',exact:true}).count()===0,'True conflicts have no defer action');
 await win.screenshot({path:out+'/conflict-preview.png'});
 await win.setViewportSize({width:390,height:844});
 await win.locator('.profile-sync-choice').nth(1).scrollIntoViewIfNeeded();
 await win.screenshot({path:out+'/conflict-phone.png'});
 await win.getByRole('button',{name:'使用另一张名片',exact:true}).click();
 await win.waitForFunction(async()=>{const m=await import('/src/state/profileSync.ts');return m.profileSyncStatus()==='synced'});
 ok(await win.evaluate(async()=>(await import('/src/state/nameCard.ts')).cardsSnapshot().personal.name==='张铭'),'Actual Contacts conflict button discards local conflicting edits and converges to cloud');
 ok(errors.length===0,'No React/browser runtime errors: '+errors.join('; '));
 await win.screenshot({path:out+'/windows-context.png'});
 passed=true;
}catch(error){console.error('Profile browser verification failed:',String(error),diagnostics);throw error;}finally{
 writeFileSync(out+'/report.json',JSON.stringify({passed,checks,errors,diagnostics,scope:'Actual state modules in two isolated macOS Chromium contexts (Mac/Windows platform hints), mocked authenticated cloud. No real Windows hardware or cloud writes.'},null,2));
 await browser.close();
 await server.close();
 rmSync(cache,{recursive:true,force:true});
}
