/** Capture every localized guide screen using actual app components and isolated fixtures. */
import assert from 'node:assert/strict';
import {mkdirSync,copyFileSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setup,call,close,browser} from './capture-public-preview.mjs';
import {captureLocale,captureEnglish,captureSuffix,sample,uiLabel} from './lib/public-capture-locale.mjs';
import {closeTestBrowser} from './lib/onboarding-browser-steps.mjs';
assert.ok(captureEnglish,'Set ONETHU_CAPTURE_LOCALE=en-US; existing Chinese captures remain intact.');
const out='apps/desktop/src/assets/tour/real-ui'+captureSuffix;mkdirSync(out,{recursive:true});
const rest=Boolean(process.env.ONETHU_TOUR_CAPTURE_REST);
const entries=rest?JSON.parse(readFileSync(out+'/manifest-localized.json','utf8')).entries:[],errors=[];let passed=false,naturalCleanup=false;
const remember=entry=>{const index=entries.findIndex(item=>item.key===entry.key);if(index>=0)entries.splice(index,1);entries.push(entry);};
async function shot(page,key){
 await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(500);
 assert.equal(await page.locator('html').getAttribute('lang'),captureLocale);
 const text=await page.locator('body').innerText();
 // Native language selectors keep language autonyms; unselected options also appear in innerText.
 const chinese=(text.match(/[\u3400-\u9fff]+/g)??[]).filter(word=>word!=='简体中文');
 assert.deepEqual(chinese,[],key+': English sample must not contain Chinese labels or fixture content');
 const file=key+'.png';await page.screenshot({path:out+'/'+file,animations:'disabled'});
 remember({key,file,locale:captureLocale,viewport:page.viewportSize(),sha256:createHash('sha256').update(readFileSync(out+'/'+file)).digest('hex'),visibleText:text.slice(0,5000)});console.log('Captured English tour: '+key);
}
const copy=(from,key)=>{const file=key+'.png';copyFileSync('docs/assets/0.11'+captureSuffix+'/'+from+'.png',out+'/'+file);remember({key,file,locale:captureLocale,source:from,sha256:createHash('sha256').update(readFileSync(out+'/'+file)).digest('hex')});};
try{
 for(const [from,key] of [['home-simple','simple-home'],['home-practical','practical-home'],['home-full','full-home-mobile'],['schedule','schedule'],['vault','vault'],['organization','organization'],['learn','learn']])copy(from,key);
 for(const mode of (rest?[]:['simple','practical'])){
  const {page,context}=await setup(390,844,mode);
  await page.evaluate(()=>{window.__publicFixture.homework[0].submitted=true;});
  await call(page,'/src/state/experienceMode.ts','navigateSimple',['schedule']);
  await page.locator('.schedule-workspace').waitFor();
  await page.getByRole('button',{name:await uiLabel(page,'首页'),exact:true}).click();await page.locator('.simple-home').waitFor();
  await shot(page,mode+'-home-done');
  if(mode==='practical'){
   await page.locator('.oneshot').getByRole('button',{name:await uiLabel(page,'更多功能'),exact:true}).click();
   const more=page.getByRole('dialog',{name:await uiLabel(page,'更多功能'),exact:true});await more.waitFor();await shot(page,'practical-more');
   const place=more.locator('button').filter({hasText:await uiLabel(page,'云盘')}).filter({hasText:/Cloud/}).last();
   // Use the actual per-feature placement action rather than altering the screenshot.
   const buttons=more.getByRole('button');
   const target=await buttons.evaluateAll(buttons=>buttons.findIndex(b=>(b.getAttribute('aria-label')??'').includes('Cloud')));
   if(target>=0)await buttons.nth(target).click();else await place.click();
   await page.locator('.oneshot.is-placing').waitFor();await page.locator('.oneshot > button').nth(0).click();
   await shot(page,'practical-home-customized');
  }
  for(const type of ['search','oh']){
   await call(page,'/src/plugins/ohControl.ts','openOhPanel',[type,type==='search'?'assignment':'']);await page.locator('.dock-panel').waitFor();
   if(type==='search')await page.locator('.ohx-hit').first().waitFor();await shot(page,type+'-'+mode);
  }
  await close(page,context);
 }
 if(!rest){
  const {page,context}=await setup(1024,620);await page.locator('.freeboard').waitFor();await shot(page,'board-full');await close(page,context);
 }
 for(const target of ['workspaces','onego','plugins','appearance','data']){
  if(rest&&entries.some(entry=>entry.key===target))continue;
  const {page,context}=await setup();
  if(target==='workspaces'||target==='onego'){await page.locator('#ex-bbar-onego-btn').click();await page.getByRole('dialog').first().waitFor();await page.getByRole('tab',{name:await uiLabel(page,target==='workspaces'?'工作区':'我的收藏'),exact:true}).click();}
  else {await call(page,'/src/state/explorer.ts','openSettings',[target==='plugins'?'plugins':'settings']);await page.getByRole('dialog').first().waitFor();if(target!=='plugins')await page.locator('.workbench-settings-phone-nav select').selectOption(target==='appearance'?'外观':'账号');}
  await page.getByRole('dialog').first().waitFor();await shot(page,target);await close(page,context);
 }
 {
  const {page,context}=await setup();await call(page,'/src/state/explorer.ts','openTab',['xiaoda']);const panel=page.locator('[data-tab-page="xiaoda"]:visible');await panel.getByRole('textbox').waitFor();
  await panel.getByRole('textbox').fill('Help me plan this week’s revision.');await panel.getByRole('button',{name:await uiLabel(page,'发送'),exact:true}).click();
  await panel.getByText(/Start by listing the key topics/).waitFor();await shot(page,'xiaoda-chat');
  await panel.getByRole('tab',{name:await uiLabel(page,'技能'),exact:true}).click();const title=panel.getByText(await uiLabel(page,'OH 技能库'),{exact:true});await title.waitFor();await title.evaluate(el=>{el.scrollIntoView({block:'start'});for(let p=el.parentElement;p;p=p.parentElement)if(p.scrollHeight>p.clientHeight&&/auto|scroll/.test(getComputedStyle(p).overflowY)){p.scrollTop-=80;break;}});await shot(page,'xiaoda-skills');await close(page,context);
 }
 {
  const {page,context}=await setup();await call(page,'/src/state/vault.ts','addToVault',[{type:'text',title:'Course notes',text:'Review limits and continuity. Bring two questions to the group.',source:'Demo note'}]);await call(page,'/src/state/explorer.ts','openTab',['vault']);const vault=page.locator('[data-tab-page="vault"]:visible');await vault.waitFor();
  await vault.getByRole('button',{name:await uiLabel(page,'分享口令'),exact:true}).click();const send=page.getByRole('dialog',{name:await uiLabel(page,'分享内容'),exact:true});await send.waitFor();await shot(page,'vault-send-preview');
  await send.getByRole('button',{name:await uiLabel(page,'生成分享口令'),exact:true}).click();await send.locator('.vault-exchange-code').waitFor();const code=await send.locator('.vault-exchange-code').innerText();await shot(page,'vault-send-code');
  await page.keyboard.press('Escape');await send.waitFor({state:'hidden'});await vault.getByRole('button',{name:await uiLabel(page,'接收'),exact:true}).click();const receive=page.getByRole('dialog',{name:await uiLabel(page,'接收内容'),exact:true});await receive.waitFor();await receive.getByLabel(await uiLabel(page,'收到的口令')).fill(code);await shot(page,'vault-receive');
  await receive.getByRole('button',{name:await uiLabel(page,'接收口令'),exact:true}).click();await receive.getByRole('status').waitFor();await shot(page,'vault-received');await close(page,context);
 }
 for(const key of ['search','oh','vault-drag-start','vault-drag-done']){const file=key+'.png';remember({key,file,locale:captureLocale,source:'Approved public capture or actual drag recording',sha256:createHash('sha256').update(readFileSync(out+'/'+file)).digest('hex')});}
 assert.equal(entries.length,31);
 passed=true;
} catch(e){errors.push(e.message);throw e;} finally{
 try{await closeTestBrowser(browser);naturalCleanup=true;}finally{writeFileSync(out+'/manifest-localized.json',JSON.stringify({locale:captureLocale,passed:passed&&naturalCleanup,naturalCleanup,externalRequestsSent:0,source:'Actual app UI; isolated fictional services and English sample content; no rendered text replacement.',entries,errors},null,2)+'\n');}
}
