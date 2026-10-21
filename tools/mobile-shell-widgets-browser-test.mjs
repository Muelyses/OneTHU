/** Mobile shell and real picker regressions, fictional data, no campus requests. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {setup,call,close,browser} from './capture-public-preview.mjs';
import {closeTestBrowser} from './lib/onboarding-browser-steps.mjs';
const out=process.env.ONETHU_TEST_OUT??'/Volumes/OneTHUBuild/artifacts/release-0.11/mobile-polish';mkdirSync(out,{recursive:true});
const checks=[];let passed=false;
const check=(v,label)=>{assert.ok(v,label);checks.push(label);console.log('✓ '+label)};
const box=locator=>locator.evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}});
async function topHit(locator){return locator.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})}
async function mount(page,name,props){await page.evaluate(async({name,props})=>{
 const source=await (await fetch('/src/main.tsx')).text();const urls=[...performance.getEntriesByType('resource').map(x=>x.name),...[...source.matchAll(/"([^" ]+)"/g)].map(m=>m[1]).filter(x=>x.startsWith('/node_modules/'))];const url=end=>urls.find(x=>new URL(x,location.origin).pathname.endsWith(end));
 const React=(await import(url('/deps/react.js'))).default;const {createRoot}=(await import(url('/deps/react-dom_client.js'))).default;
 const componentPath='/src/components/'+name+'.tsx';const C=(await import(componentPath))[name];const componentSource=await (await fetch(componentPath)).text();const favUrl=[...componentSource.matchAll(/"([^" ]+)"/g)].map(m=>m[1]).find(x=>x.startsWith('/src/state/favs.tsx'));const FavsProvider=favUrl?(await import(favUrl)).FavsProvider:React.Fragment;const host=document.createElement('div');document.body.append(host);const root=createRoot(host);window.__pickerRoot=root;
 root.render(React.createElement(FavsProvider,null,React.createElement(C,{...props,onClose:()=>root.unmount(),onPick:p=>{window.__picked=p;root.unmount()}})));
},{name,props});}
try {
 for(const [width,height,mode] of [[360,780,'full'],[390,844,'simple'],[390,844,'practical'],[844,390,'full']]){
  const {page,context}=await setup(width,height,mode);const label=`${mode}-${width}x${height}`;
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('RUNTIME',e.message)});
  // Browser safe area remains active; Android content padding consumes it instead.
  await page.addStyleTag({content:'html:not([data-native-insets]){--og-safe-bottom:34px;--og-safe-top:24px}'});
  for(const native of [false,true]){
   await page.evaluate(native=>{if(native)document.documentElement.dataset.nativeInsets='content';else delete document.documentElement.dataset.nativeInsets},native);
   const dock=await box(page.locator('.ex-bbar'));const capsule=await box(page.locator('.ex-bbar .ohx-capsule'));
   const safe=native?0:34;check(Math.abs(dock.height-60-safe)<1,`${label} ${native?'native':'browser'} inset applied once`);
   check(capsule.y>=dock.y+6&&capsule.bottom<=height-safe-6,`${label} capsule has balanced breathing room`);
   const shot=await box(page.locator('.oneshot'));check(Math.abs(dock.y-shot.bottom-8)<1,`${label} OneShot gap is exactly 8px`);
   check(capsule.height===44,`${label} capsule is compact 44px`);
  }
  await page.screenshot({path:`${out}/${label}-home.png`});
  if(mode==='full'){
   await page.locator('[data-coach="home-edit"]').click();await page.locator('[data-coach="home-add"]').click();await page.locator('.add-drawer').waitFor();await page.waitForTimeout(350);
   const drawer=await box(page.locator('.add-drawer'));check(drawer.y>=0&&drawer.bottom<=height+1,`${label} drawer fits viewport`);
   const scroll=page.locator('.add-scroll');if(width===360){const r=await box(scroll);const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:r.y+r.height-25}]});for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:180,y:r.y+r.height-25-i*15}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(200);check(await scroll.evaluate(e=>e.scrollTop>0),'Actual touch swipe scrolls the widget drawer');await cdp.detach();}await scroll.hover();await page.mouse.wheel(0,6000);await page.waitForTimeout(250);
   check(await scroll.evaluate(e=>e.scrollTop>0),`${label} actual wheel scroll reaches lower widgets`);
   const last=page.locator('.add-card').last();await last.scrollIntoViewIfNeeded();check(await topHit(last),`${label} last widget is not blocked by bottom navigation`);
   await page.screenshot({path:`${out}/${label}-drawer-end.png`});
   await last.click();await page.locator('.add-detail-add').waitFor();await page.waitForTimeout(400);check(await topHit(page.locator('.add-detail-add')),`${label} detail confirm is clickable`);
   await page.screenshot({path:`${out}/${label}-detail.png`});
   await page.locator('.add-detail-add').click();await page.locator('.add-drawer').waitFor({state:'hidden'});
  }
  // A long concrete-item picker must expose its last row at any orientation/keyboard height.
  await mount(page,'BoardItemPicker',{open:true,title:'Fixture picker',items:Array.from({length:40},(_,i)=>({key:String(i),label:'Item '+i,props:{id:i}}))});
  await page.locator('[data-item-picker]').waitFor();await page.waitForTimeout(300);
  const last=page.locator('[data-picker-key="39"]');await last.scrollIntoViewIfNeeded();check(await topHit(last),`${label} concrete item 40 is reachable`);await last.click();check(await page.evaluate(()=>window.__picked.id===39),`${label} last row selects the intended content`);
  // Actual nested picker uses the same legacy modal shell as Android widget binding.
  await mount(page,'FavAtomPicker',{title:'Fixture shortcuts'});await page.locator('.collect-modal').waitFor();await page.waitForTimeout(300);
  check(await topHit(page.locator('.collect-modal .home-modal-head button')),`${label} legacy modal actions above navigation`);
  check(await page.locator('.collect-search input').evaluate(e=>e!==document.activeElement),`${label} phone picker does not force keyboard open`);
  await page.setViewportSize({width,height:Math.min(height,430)});check(await topHit(page.locator('.collect-modal .home-modal-head button')),`${label} modal header stays reachable with keyboard-sized viewport`);
  await page.locator('.collect-modal .home-modal-head button').click();await page.locator('.collect-modal').waitFor({state:'hidden'});
  check(errors.length===0,`${label} no runtime errors`);await close(page,context);
 }
 // Android-only binding/settings UI: native commands are fixtures, rendering and state are real.
 {
  const {page,context}=await setup(390,844);
  await page.route(/\/src\/state\/(notifySources|widgetBridge)\.ts(?:\?|$)/,async route=>{
   const response=await route.fetch();let body=await response.text();body=body.replace(/import\s*\{\s*invoke\s*\}\s*from\s*["'][^"']+["'];?/g,'const invoke = (...args) => window.__mobileWidgetInvoke(...args);');await route.fulfill({response,body});
  });
  await page.addInitScript(()=>{window.__mobileWidgetInvoke=async cmd=>{
   if(cmd==='notify_backend')return 'android';
   if(cmd==='widget_instances')return {ok:true,instances:Array.from({length:30},(_,i)=>({id:i+1,w:180,h:100,provider:'OnethuWidgetShape4Standard',bound:true}))};
   if(cmd==='widget_status')return {ok:true,hostPlaced:30,slotsPlaced:{},hasSnapshot:true,snapshotAt:Date.now(),slotTitles:{},providersRegistered:['3×2']};
   return {ok:true};
  }});
  await page.reload();await page.locator('.explorer-shell').waitFor();await call(page,'/src/state/notifySources.ts','detectNotifyBackend');
  for(let i=0;i<2;i++){
   await call(page,'/src/state/widgetBindUi.ts','requestWidgetBind',[{to:'instance',id:'1'}]);await page.locator('.wb-kinds').waitFor();await page.waitForTimeout(350);
   check(await page.locator('.wb-kind').count()===4,'Android binding exposes all four content types');
   await page.screenshot({path:`${out}/native-widget-binding-${i}.png`});
   await page.locator('.wb-kind').last().click();await page.locator('.collect-modal').waitFor();await page.waitForTimeout(350);
   check(await topHit(page.locator('.collect-modal .home-modal-head button')),'Nested native shortcut picker is above its parent');
   await page.locator('.collect-modal .home-modal-head button').click();await page.locator('.collect-modal').waitFor({state:'hidden'});
   check(await page.locator('.wb-kinds').isVisible(),'Closing nested picker retains parent binding choices');
   await page.locator('.home-modal-head button').last().click();await page.locator('.wb-kinds').waitFor({state:'hidden'});
  }
  check(true,'Native binding can reopen and close repeatedly');await close(page,context);
 }
 const {page,context}=await setup(1280,900);check(await box(page.locator('.ex-bbar')).then(x=>x.height===60),'desktop dock retains its existing height');await close(page,context);
 passed=true;
}finally{await closeTestBrowser(browser);writeFileSync(out+'/report.json',JSON.stringify({passed,checks,scope:'Chromium real React components, synthetic browser/native safe-area ownership, touch viewports; no physical Android device attached'},null,2));}
