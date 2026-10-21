/** Actual common-guide actions and recorded drag on the real Three phone. No school traffic. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync,writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { installXiaodaTourFixture } from './lib/xiaoda-tour-fixture.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const base='http://127.0.0.1:5180',out='/Volumes/OneTHUBuild/artifacts/public-site-0.11/onboarding';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const checks=[],errors=[];let passed=false,naturalCleanup=false;
const check=(value,label)=>{assert.ok(value,label);checks.push(label);console.log('✓ '+label);};
async function setup(mode,width=390,reducedMotion='no-preference'){
 const context=await browser.newContext({viewport:{width,height:844},hasTouch:width<600,reducedMotion});const page=await context.newPage();page.setDefaultTimeout(20000);
 page.on('pageerror',e=>errors.push(e.message));await page.routeWebSocket('**/*',socket=>socket.close());
 await installFakeCloud(page);await installXiaodaTourFixture(page);
 await page.addInitScript(mode=>{localStorage.setItem('onethu.locale','zh-CN');localStorage.setItem('onethu.experience.v1',mode);localStorage.setItem('onethu.overlay.closed','1');},mode);
 await page.goto(base+'/?explorer-preview=onboarding&tour=1');const tour=page.locator('.experience-tour');await page.waitForTimeout(1200);await tour.locator('.tour-language-continue').click();await tour.locator('.tour-next').click();return {page,context,tour};
}
const inspect=page=>page.locator('.experience-tour canvas').evaluate(canvas=>canvas.__tourStudioInspect?.().models.find(model=>model.active)?.media);
async function cleanup(page,context){await page.unrouteAll({behavior:'ignoreErrors'});await context.request.dispose();await context.close();}
try{
 for(const mode of (process.env.ONETHU_VAULT_ONLY ? [] : ['simple','practical','full'])){
  const {page,context,tour}=await setup(mode);
  await tour.getByRole('heading',{name:'搜索、OH 与插件',exact:true}).waitFor();
  check(await tour.locator('.tour-steps').innerText().then(text=>text.includes('OH')&&text.includes('插件')&&text.includes('搜索')),mode+': common guide introduces all three capabilities');
  if(mode!=='full')check(await tour.locator('.tour-copy').innerText().then(text=>text.includes('完整模式')&&text.includes('自填 API')),mode+': states compact-mode limits accurately');
  await tour.getByRole('button',{name:'试试搜索',exact:true}).click();await page.locator('.dock-panel').waitFor();
  await page.screenshot({path:out+'/search-practice-'+mode+'.png'});await page.locator('.ohx-input:visible :is(input,textarea)').fill('日程');await page.waitForTimeout(1000);await page.screenshot({path:out+'/search-result-'+mode+'.png'});await page.locator('.ohx-hit').first().waitFor();check(true,mode+': search finds an actual supported feature');
  await page.getByRole('button',{name:'继续导览',exact:true}).click();await tour.getByRole('heading',{name:'搜索、OH 与插件',exact:true}).waitFor();
  await page.locator('.dock-panel').waitFor({state:'hidden'});check(true,mode+': practice return closes search panel');
  await tour.getByRole('button',{name:'打开小 OH',exact:true}).click();await page.locator('.dock-panel').waitFor();check(true,mode+': opens actual OH panel');
  await page.getByRole('button',{name:'继续导览',exact:true}).click();await tour.getByRole('heading',{name:'搜索、OH 与插件',exact:true}).waitFor();
  await tour.getByRole('button',{name:mode==='full'?'打开插件页':'查看使用模式',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'我的',exact:true});await settings.waitFor();
  if(mode==='full')await settings.getByRole('heading',{name:'插件',exact:true}).waitFor();else await settings.getByRole('button',{name:'切换模式',exact:true}).waitFor();
  check(true,mode+': plugin explanation opens the correct mode-specific destination');
  await page.getByRole('button',{name:'继续导览',exact:true}).click();await tour.getByRole('heading',{name:'搜索、OH 与插件',exact:true}).waitFor();
  if(mode==='full'){
   await page.evaluate(async()=>{const source=await(await fetch('/src/plugins/ChatDock.tsx')).text();const url=[...source.matchAll(/"([^" ]+)"/g)].map(m=>m[1]).find(url=>url.startsWith('/src/plugins/ohControl.ts'));(await import(url)).openOhPanel('search');});await page.locator('.dock-panel').waitFor();
   await tour.getByRole('button',{name:'试试搜索',exact:true}).click();await page.locator('.ohx-input input').waitFor();
   await page.getByRole('button',{name:'继续导览',exact:true}).click();await tour.getByRole('heading',{name:'搜索、OH 与插件',exact:true}).waitFor();await page.waitForTimeout(350);
   check(await page.locator('.dock-panel').isVisible(),'full: guide opens an existing panel without toggling or closing the user’s prior panel');
   await page.evaluate(async()=>{const source=await(await fetch('/src/plugins/ChatDock.tsx')).text();const url=[...source.matchAll(/"([^" ]+)"/g)].map(m=>m[1]).find(url=>url.startsWith('/src/plugins/ohControl.ts'));(await import(url)).requestOhPanel('search');});await page.locator('.dock-panel').waitFor({state:'hidden'});
  }
  await page.screenshot({path:out+'/basics-'+mode+'.png'});await cleanup(page,context);
 }
 for(const [width,motion] of [[1280,'no-preference'],[390,'no-preference'],[320,'reduce']]){
  const {page,context,tour}=await setup('full',width,motion);
  await tour.locator('.tour-chapters button').filter({hasText:'暂存箱'}).click();
  await tour.getByRole('heading',{name:'暂存箱：长按、拖入、再分享',exact:true}).waitFor();
  await tour.locator('.tour-stage-canvas').scrollIntoViewIfNeeded();
  check(await tour.locator('.tour-steps').innerText().then(text=>text.includes('长按')&&text.includes('高亮区域')&&text.includes('标签页')&&text.includes('已接入')),width+': specific gesture and supported-source guidance');
  await page.waitForFunction(()=>document.querySelector('.experience-tour canvas')?.__tourStudioInspect?.().models.find(model=>model.active)?.media,{timeout:20000});
  if(motion==='reduce'){
   check((await inspect(page)).paused,width+': reduced motion uses a static result');
  }else{
   await page.waitForFunction(()=>{const media=document.querySelector('.experience-tour canvas')?.__tourStudioInspect?.().models.find(model=>model.active)?.media;return media&&!media.paused&&media.currentTime>1;},null,{timeout:25000});
   check((await inspect(page)).src.endsWith('/assets/tour/real-ui/vault-drag.mp4'),width+': real drag recording plays on the Three screen');
   await page.waitForFunction(()=>document.querySelector('.experience-tour canvas')?.__tourStudioInspect?.().models.find(model=>model.active)?.media?.currentTime>4.7,null,{timeout:15000});
   const framing=await page.locator('.experience-tour canvas').evaluate(canvas=>{
    const info=canvas.__tourStudioInspect();const model=info.models.find(model=>model.active);
    const mul=(m,p)=>[0,1,2,3].map(row=>p.reduce((sum,v,col)=>sum+m[col*4+row]*v,0));const points=[];
    for(const mesh of model.meshes.filter(mesh=>mesh.visible))for(let corner=0;corner<8;corner++){
     const local=[0,1,2].map(axis=>(corner&1<<axis?mesh.max:mesh.min)[axis]);
     const clip=mul(info.camera.projectionMatrix,mul(info.camera.matrixWorldInverse,mul(mesh.matrixWorld,[...local,1])));points.push([clip[0]/clip[3],clip[1]/clip[3]]);
    }
    return {width:(Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])))/2,height:(Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1])))/2,fits:points.every(p=>Math.abs(p[0])<=1.02&&Math.abs(p[1])<=1.02)};
   });
   console.log('FRAMING',width,framing);check(framing.width>=.7&&framing.height>=.8&&framing.fits,width+': enlarged phone fills the stage without clipping');
   await page.screenshot({path:out+'/vault-'+width+'.png'});
   await tour.getByRole('button',{name:'暂停演示',exact:true}).click();const paused=await inspect(page);await page.waitForTimeout(500);const later=await inspect(page);
   check(paused.paused&&later.paused&&Math.abs(later.currentTime-paused.currentTime)<.1,width+': pause freezes the actual video');
  }
  await cleanup(page,context);
 }
 check(errors.length===0,'No browser runtime errors');passed=true;
}catch(error){console.error(error);throw error;}finally{try{await closeTestBrowser(browser);naturalCleanup=true;}finally{writeFileSync(out+'/report.json',JSON.stringify({passed:passed&&naturalCleanup,naturalCleanup,checks,errors,scope:'Real UI and Three models with isolated services. Video gesture was separately recorded through the actual drag handlers; no campus account or physical-device claim.'},null,2));}}
