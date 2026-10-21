/** Real locale switching, decoded captures, GPU/video and no-WebGL language acceptance. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {installFakeCloud} from './lib/fake-cloud.mjs';
import {closeTestBrowser} from './lib/onboarding-browser-steps.mjs';
const out=process.env.ONETHU_MEDIA_OUT??'/Volumes/OneTHUBuild/artifacts/public-site-0.11/localized-media';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const checks=[],errors=[];let passed=false;
const check=(value,label)=>{assert.ok(value,label);checks.push(label);console.log('✓ '+label);};
async function setup(mode='full',fallback=false){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));await installFakeCloud(page);
 await page.routeWebSocket('**/*',socket=>socket.close());await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:5180'?route.fallback():route.abort());
 await page.addInitScript(({mode,fallback})=>{localStorage.setItem('onethu.locale','en-US');localStorage.setItem('onethu.experience.v1',mode);localStorage.setItem('onethu.overlay.closed','1');if(fallback){const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/.test(type)?null:original.call(this,type,...args);};}},{mode,fallback});
 await page.goto('http://127.0.0.1:5180/?explorer-preview=onboarding&tour=1');const tour=page.locator('.experience-tour');await page.waitForTimeout(1200);await tour.locator('.tour-language-continue').click();await tour.locator('.tour-next').click();return {page,tour,context};
}
async function locale(page,language){await page.evaluate(async language=>{const source=await(await fetch('/src/plugins/ChatDock.tsx')).text();const path=[...source.matchAll(/"([^" ]+)"/g)].map(m=>m[1]).find(v=>v.startsWith('/src/i18n/index.ts'));(await import(path)).setLocale(language);},language);}
const textureSources=page=>page.locator('.experience-tour canvas').evaluate(c=>c.__tourStudioInspect?.().models.filter(m=>m.active).flatMap(m=>m.meshes.filter(x=>x.screen&&x.visible).flatMap(x=>x.textureSources))??[]);
try{
 for(const mode of ['simple','practical','full']){
  const {page,tour,context}=await setup(mode);
  await page.waitForFunction(()=>document.querySelector('.experience-tour canvas')?.__tourStudioInspect?.().models.some(m=>m.active));
  const sources=await textureSources(page);check(sources.length>0&&sources.every(s=>s.includes('/real-ui/en-US/')),mode+': real GPU screens use English captures');
  if(mode==='full'){
   const decoded=await page.evaluate(async()=>{const mod=await import('/src/components/tourStudioScreens.ts');const a=await mod.loadStudioScreenAssets('en-US'),z=await mod.loadStudioScreenAssets('zh-CN');return {english:Object.values(a).map(i=>i.src),chinese:Object.values(z).map(i=>i.src),separate:a!==z};});
   check(decoded.separate&&decoded.english.length===31&&decoded.english.every(s=>s.includes('/en-US/'))&&decoded.chinese.length===31&&decoded.chinese.every(s=>!s.includes('/en-US/')),'All 62 images decode in separate language caches');
   await locale(page,'zh-CN');await page.waitForFunction(()=>{const c=document.querySelector('.experience-tour canvas');const ms=c?.__tourStudioInspect?.().models.filter(m=>m.active);return ms?.length&&ms.every(m=>m.meshes.filter(x=>x.screen).every(x=>x.textureSources.every(s=>s&&!s.includes('/en-US/'))));});check(true,'Switch to Chinese rebuilds the physical model using Chinese screens');
   await locale(page,'en-US');await page.waitForFunction(()=>{const ms=document.querySelector('.experience-tour canvas')?.__tourStudioInspect?.().models.filter(m=>m.active);return ms?.length&&ms.every(m=>m.meshes.filter(x=>x.screen).every(x=>x.textureSources.every(s=>s?.includes('/en-US/'))));});check(true,'Switch back to English never reuses Chinese textures');
   await tour.locator('.tour-chapters button').nth(2).click();await tour.locator('.tour-stage-canvas').scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>{const media=document.querySelector('.experience-tour canvas')?.__tourStudioInspect?.().models.find(m=>m.active)?.media;return media?.src.includes('/en-US/vault-drag.mp4')&&!media.paused&&media.currentTime>1;});check(true,'English real drag recording plays on the GPU phone');
   await page.screenshot({path:out+'/english-vault.png'});
   await locale(page,'zh-CN');await page.waitForFunction(()=>{const media=document.querySelector('.experience-tour canvas')?.__tourStudioInspect?.().models.find(m=>m.active)?.media;return media?.src.endsWith('/real-ui/vault-drag.mp4')&&!media.paused&&media.currentTime>0;});check(true,'Switching during playback replaces and restarts the Chinese recording');
  }
  await context.close();
 }
 {
  const {page,tour,context}=await setup('full',true);await tour.locator('.tour-real-display img').first().waitFor();check(await tour.locator('.tour-real-display img').evaluateAll(imgs=>imgs.length>0&&imgs.every(i=>i.src.includes('/en-US/')&&i.complete&&i.naturalWidth>0)),'No-WebGL fallback uses English screenshots');
  await tour.locator('.tour-chapters button').nth(2).click();const video=tour.locator('video[data-tour-vault-replay]');await video.waitFor();await video.scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const v=document.querySelector('video[data-tour-vault-replay]');return v?.currentSrc.includes('/en-US/')&&!v.paused&&v.currentTime>0;});check(true,'No-WebGL fallback plays the English recording');await context.close();
 }
 check(errors.length===0,'No browser runtime errors');passed=true;
}finally{await closeTestBrowser(browser);writeFileSync(out+'/report.json',JSON.stringify({passed,checks,errors},null,2)+'\n');}
