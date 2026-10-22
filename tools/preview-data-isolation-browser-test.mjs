/** Actual data hooks and SearchPage: concurrent widget previews cannot enter live data. */
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const base='http://127.0.0.1:5180',out='/Volumes/OneTHUBuild/artifacts/preview-data-isolation';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const checks=[],errors=[];const check=(value,label)=>{assert.ok(value,label);checks.push(label);console.log('✓ '+label);};let passed=false;
try {
 const page=await browser.newPage({viewport:{width:1280,height:960},locale:"zh-CN"});await page.addInitScript(()=>localStorage.setItem("onethu.locale","zh-CN"));page.on('pageerror',e=>errors.push(e.message));
 await page.routeWebSocket('**/*',socket=>socket.close());
 await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.fallback():r.abort());
 // Keep a single module instance in this isolated harness despite the running server's HMR timestamps.
 await page.route('**/src/**',async route=>{const response=await route.fetch();const body=(await response.text()).replace(/(["'])(\/src\/[^"'?]+)\?t=\d+\1/g,'$1$2$1');await route.fulfill({response,body});});
 const source=await (await page.request.get(base+'/src/state/context.ts')).text();const react=source.match(/from "([^"\n]+react\.js[^"\n]*)"/)[1];
 const harness=readFileSync('tools/lib/preview-isolation-harness.mjs','utf8').replace('__REACT_URL__',react);
 await page.route('**/__preview-isolation-harness.js',r=>r.fulfill({contentType:'text/javascript',body:harness}));
 await page.route('**/__preview-isolation',r=>r.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('/__preview-isolation-harness.js');</script></body></html>`}));
 await page.goto(base+'/__preview-isolation');await page.waitForFunction(()=>window.__fetches>0);await page.locator('#live input').fill('第一周');await page.locator('#live').getByText('自有课程 1',{exact:true}).first().waitFor();
 await page.evaluate(()=>{window.__baseline=window.__snapshot();window.__beforeFetches=window.__fetches;window.__beforeBroadcasts=window.__broadcasts;window.__showPreviews(true);});
 await page.locator('#preview-two').getByText(/高等数学/).waitFor();
 check(await page.evaluate(()=>{const a=window.__baseline,b=window.__snapshot();return a.learn===b.learn&&a.campus===b.campus&&a.profile===b.profile&&JSON.stringify(a.keys)===JSON.stringify(b.keys)&&a.persisted===b.persisted;}),'Two StrictMode preview trees preserve live snapshots, cache keys and persisted data');
 check(await page.locator('#live').getByText('高等数学A(1)',{exact:true}).count()===0,'An existing real search never displays preview courses');
 await page.evaluate(()=>window.__addSearch());await page.locator('#added input').fill('第一周');await page.locator('#added').getByText('自有课程 1',{exact:true}).first().waitFor();
 check(await page.locator('#added').getByText('高等数学A(1)',{exact:true}).count()===0,'Search added while previews are open uses the account course and assignment');
 await page.evaluate(()=>window.__reloadPreview());check(await page.evaluate(()=>window.__fetches===window.__beforeFetches&&window.__broadcasts===window.__beforeBroadcasts&&window.__unexpected.length===0),'Preview reloads do not request school data or broadcast live changes');
 await page.evaluate(()=>window.__refreshReal());await page.locator('#added').getByText('自有课程 2',{exact:true}).first().waitFor();
 check((await page.locator('#preview-one').innerText()).includes('高等数学A(1)'),'A real background refresh cannot replace a preview with personal data');
 await page.screenshot({path:out+'/concurrent.png'});
 await page.evaluate(()=>window.__showPreviews(false));await page.locator('#preview-host').waitFor({state:'detached'});
 check(await page.evaluate(()=>window.__snapshot().learn===window.__updatedSnapshot&&window.__snapshot().profile.data.name==='更新后的自有用户'),'Closing previews retains fresh account data rather than restoring an old snapshot');
 check(await page.locator('#added').getByText('自有课程 2',{exact:true}).count()>0&&await page.locator('#added').getByText('高等数学A(1)',{exact:true}).count()===0,'Added real search remains correct after the drawer closes');
 await page.evaluate(()=>window.__showPreviews(true));await page.locator('#preview-one').waitFor();await page.evaluate(()=>window.__locale('en-US'));
 await page.waitForFunction(()=>JSON.parse(document.getElementById('preview-one').textContent).report===window.__previewTitle()&&document.documentElement.lang==='en-US');
 check(await page.evaluate(()=>window.__snapshot().learn===window.__updatedSnapshot),'Changing preview language rebuilds only the preview tree and preserves the live snapshot');
 check(errors.length===0,'No React or page errors');passed=true;
}catch(error){for(const context of browser.contexts())for(const page of context.pages()){console.log((await page.locator("body").innerText()).slice(0,4000));console.log(await page.evaluate(()=>({locale:localStorage.getItem("onethu.locale"),snapshot:{learn:window.__snapshot?.().learn,campus:window.__snapshot?.().campus},fetches:window.__fetches})));await page.screenshot({path:out+"/failure.png"});}throw error;}finally{await browser.close();writeFileSync(out+'/report.json',JSON.stringify({passed,checks,errors,scope:'StrictMode; actual hooks/SearchPage; isolated fictional account; no school network'},null,2));}
