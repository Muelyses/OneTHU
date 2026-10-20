/** Real three-mode navigation and phone capsule geometry; no school account/network needed. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const output=process.env.ONETHU_TEST_OUTPUT??'/tmp/onethu-mobile-shell';mkdirSync(output,{recursive:true});
const base=process.env.ONETHU_TEST_URL??'http://127.0.0.1:5180';
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let checks=0;
const check=(v,msg)=>{assert.ok(v,msg);checks++;console.log('✓ '+msg);};
const call=(p,file,fn,...args)=>p.evaluate(async({file,fn,args})=>{
  const url=performance.getEntriesByType('resource').map(x=>x.name).filter(x=>new URL(x).pathname===file).at(-1)??file;
  return (await import(url))[fn](...args);
},{file,fn,args});
const back=p=>call(p,'/src/state/navStack.ts','back');
const current=p=>p.locator('main.explorer-content').getAttribute('data-active-page');
try{
for(const width of (process.env.ONETHU_TEST_WIDTH?[Number(process.env.ONETHU_TEST_WIDTH)]:[320,390,430]))for(const mode of (process.env.ONETHU_TEST_MODE?[process.env.ONETHU_TEST_MODE]:['full','simple','practical'])){
 const p=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true});
 await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await p.addInitScript(({mode})=>{
  performance.setResourceTimingBufferSize(10000);
  localStorage.setItem('onethu.experience.v1',mode);
  localStorage.setItem('onethu.chatdock.open','0');
  localStorage.setItem('onethu.onboarded.flow4','1');
 },{mode});
 await p.goto(base+'/?explorer-preview=home');await p.locator('.ohx-capsule-ph').waitFor();
 await call(p,'/src/state/cache.ts','setPreviewMode',true);
 await call(p,'/src/state/data.ts','seedPreviewData');
 await p.waitForTimeout(1100);
 const label=`${width}/${mode}`;
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const geometry=await p.locator('.ohx-capsule').evaluate(el=>{
  const r=el.getBoundingClientRect(),m=el.querySelector('.harness-mark').getBoundingClientRect(),t=el.querySelector('.ohx-capsule-ph').getBoundingClientRect();
  return {offset:(m.left+t.right)/2-(r.left+r.width/2),inside:m.left>=r.left&&t.right<=r.right};
 });
 check(Math.abs(geometry.offset)<1&&geometry.inside,`${label}: idle OH + placeholder centered and inside capsule`);
 // Exercise actual store entry points used by OneShot and component links.
 await call(p,'/src/state/explorer.ts','openTab','learn');await p.waitForTimeout(80);
 check(await current(p)==='learn',`${label}: open Learn`);
 await call(p,'/src/state/explorer.ts','openTab','learn-course',{courseId:'c1',courseTab:'homework'});await p.waitForTimeout(80);
 check(await current(p)==='learn-course',`${label}: open course detail (actual ${await current(p)})`);
 await call(p,'/src/state/explorer.ts','openSettings','settings');await p.locator('.settings-mask').waitFor();
 check(await back(p),`${label}: Back consumes Settings`);await p.waitForTimeout(300);
 check(await current(p)==='learn-course'&&await p.locator('.settings-mask').count()===0,`${label}: overlay closes before course`);
 check(await back(p),`${label}: Back consumes course`);await p.waitForTimeout(80);
 check(await current(p)==='learn',`${label}: Back restores Learn`);
 check(await back(p),`${label}: Back consumes Learn`);await p.waitForTimeout(80);
 check(await current(p)==='homepage',`${label}: Back restores home`);
 check(!await back(p),`${label}: only home leaves Back to native exit`);
 if(width===390){
   await p.screenshot({path:`${output}/capsule-${mode}-390.png`});

   await call(p,'/src/plugins/ohControl.ts','requestOhPanel','search');await p.waitForTimeout(250);
   check(await p.locator('.ohx-capsule.is-open').count()===1,`${label}: OH opened`);
   check(await back(p),`${label}: Back closes OH instead of exit`);await p.waitForTimeout(300);
   check(await p.locator('.ohx-capsule.is-open').count()===0,`${label}: OH closed`);
 }
 if(width===390&&mode==='full'){
   const id=await call(p,'/src/state/explorer.ts','openTab','learn-course',{courseId:'c1',courseTab:'homework'});
   await call(p,'/src/state/explorer.ts','navigateInTab',id,'learn-assignment-detail',{courseId:'c1',itemId:'h1'});
   check(await back(p),`${label}: same-tab detail goes back`);
   const restored=await call(p,'/src/state/explorer.ts','activeTab');
   check(restored.id===id&&restored.page==='learn-course'&&restored.params.courseId==='c1'&&restored.params.courseTab==='homework',`${label}: tab identity and course parameters restored`);
   await back(p);
   const closed=await call(p,'/src/state/explorer.ts','openTab','life');
   await call(p,'/src/state/explorer.ts','openTab','reserve');
   await call(p,'/src/state/explorer.ts','closeTab',closed);
   check(await back(p),`${label}: closed history entry skipped`);await p.waitForTimeout(100);
   check(await current(p)==='homepage'&&!await call(p,'/src/state/explorer.ts','getTab',closed),`${label}: Back never resurrects a closed tab`);
   await call(p,'/src/state/explorer.ts','openTab','life');
   const fullState=JSON.stringify(await call(p,'/src/state/explorer.ts','explorerSnapshot'));
   await call(p,'/src/state/experienceMode.ts','setExperienceMode','simple');
   await call(p,'/src/state/experienceMode.ts','navigateSimple','reserve');await back(p);
   check(JSON.stringify(await call(p,'/src/state/explorer.ts','explorerSnapshot'))===fullState,`${label}: compact Back leaves full-mode tabs untouched`);
   await call(p,'/src/state/experienceMode.ts','setExperienceMode','full');await p.waitForTimeout(80);
   check(await current(p)==='life',`${label}: switching modes restores full page`);
   await back(p);

 }
 check(errors.length===0,`${label}: no browser runtime errors (${errors.join('; ')})`);
 await p.close();
}
// Exercise the Android API callback itself with a host adapter, preserving the real JS routing.
const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
await p.route(/(?:@tauri-apps_api_app|\/@tauri-apps\/api\/app)\.js/,async r=>{
 const response=await r.fetch(),source=await response.text();
 const replaced=source.replace(/async function onBackButtonPress\(handler\) \{[\s\S]*?\n\}/,`async function onBackButtonPress(handler) { window.__nativeBack=handler;window.__backRegistrations=(window.__backRegistrations||0)+1;return {unregister:async()=>{}};\n}`);
 assert.notEqual(source,replaced,'Android callback fixture attached to actual API entry');
 await r.fulfill({response,body:replaced});
});
await p.addInitScript(()=>{
 Object.defineProperty(navigator,'platform',{value:'Linux armv8l',configurable:true});
 localStorage.setItem('onethu.onboarded.flow4','1');localStorage.setItem('onethu.chatdock.open','0');localStorage.setItem('onethu.experience.v1','practical');
});
await p.goto(base+'/?explorer-preview=home');await p.waitForFunction(()=>!!window.__nativeBack);await p.waitForTimeout(1100);
check(await p.evaluate(()=>window.__backRegistrations)===1,'Android Back callback registered once at home');
await call(p,'/src/state/explorer.ts','openTab','life');await p.waitForTimeout(80);
await p.evaluate(()=>window.__nativeBack());await p.waitForTimeout(80);
check(await current(p)==='homepage','Android Back callback restores home instead of exiting on a page');
await p.evaluate(async()=>{window.__TAURI_INTERNALS__={invoke:async cmd=>{if(cmd==='plugin:onethu-mobile|mobile_exit')window.__exits=(window.__exits||0)+1;}};window.__nativeBack();});await p.waitForTimeout(80);
check(await p.evaluate(()=>window.__exits)===1,'Android Back at home invokes existing native exit command');
check(await p.evaluate(()=>window.__backRegistrations)===1,'Android navigation does not duplicate the Back listener');
await p.close();
}finally{await browser.close();}
console.log(`${checks} phone shell assertions passed`);
