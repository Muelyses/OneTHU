/** Disposable real UI; external HTTP/WebSockets blocked, no real accounts. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {advanceOnboardingPrivacy,closeTestBrowser} from './lib/onboarding-browser-steps.mjs';
const base=process.env.ONETHU_TEST_URL??'http://127.0.0.1:5180';
const out=process.env.ONETHU_TEST_OUT??'/tmp/onethu-privacy';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-updater-scheduler']});
const checks=[];let passed=false;
const check=(v,name)=>{assert.ok(v,name);checks.push(name);};
async function call(page,file,fn,args=[]) {
 return page.evaluate(async ({file,fn,args})=>{
  const url=performance.getEntriesByType('resource').map(e=>e.name).filter(s=>new URL(s).pathname===file).at(-1)??file;
  return (await import(url))[fn](...args);
 },{file,fn,args});
}
try {
 for(const [width,height] of [[1280,860],[390,844],[320,568]]) {
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<600});const page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.routeWebSocket('**/*',s=>s.close());
  await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  await page.addInitScript(()=>{
   localStorage.setItem('onethu.overlay.closed','1');localStorage.setItem('onethu.experience.v1','full');
   localStorage.setItem('onethu.freeboard.home.portrait',JSON.stringify({sentinel:'keep-layout'}));
  });
  await page.goto(base+'/?explorer-preview=onboarding');
  const tour=page.locator('.experience-tour'),privacy=tour.locator('[data-tour-phase="privacy"]');await privacy.waitFor();
  const warning=privacy.locator('.privacy-read-carefully');
  check((await warning.innerText()).includes('请务必认真阅读，并在下方手动授权云盘和智能体服务。'),width+' prominent warning uses the requested manual-authorization wording');
  const warningStyle=await warning.evaluate(el=>({weight:Number(getComputedStyle(el).fontWeight),color:getComputedStyle(el).color,first:el.parentElement.firstElementChild===el,top:el.getBoundingClientRect().top,bodyTop:el.closest('.og-panel-body').getBoundingClientRect().top}));
  check(warningStyle.first&&warningStyle.weight>=600&&warningStyle.top>=warningStyle.bodyTop,width+' warning is bold and first in the notice');
  await page.screenshot({path:`${out}/warning-${width}.png`});
  check(await privacy.locator('[lang="zh-CN"]').count()>8&&await privacy.locator('[lang="en-US"]').count()>8,width+' bilingual notice before language');
  check(await privacy.getByRole('switch').count()===2,width+' independent cloud and OH controls');
  check(await privacy.getByRole('switch').evaluateAll(els=>els.every(e=>e.getAttribute('aria-checked')==='false')),width+' optional consent defaults off');
  check(await tour.locator('.tour-privacy-continue').isDisabled(),width+' notice cannot be skipped before acknowledgement');
  await page.keyboard.press('Escape');check(await privacy.isVisible(),width+' Escape cannot bypass notice');
  const fit=await tour.evaluate(el=>{const r=el.getBoundingClientRect(),f=el.querySelector('.tour-privacy-continue').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&f.bottom<=innerHeight+1&&el.scrollWidth<=el.clientWidth+1;});check(fit,width+' modal and footer fit without horizontal clipping');
  await privacy.getByRole('switch').first().scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/privacy-${width}.png`});
  await advanceOnboardingPrivacy(page,{cloud:false,oh:false});
  check(await tour.locator('[data-tour-phase="language"]').isVisible(),width+' acknowledgement leads to bilingual language step');
  await tour.locator('.tour-language-option').filter({has:page.locator('input[value="en-US"]')}).click();await tour.locator('.tour-language-continue').click();
  await tour.locator('[data-tour-phase="intro"]').waitFor();
  check(await tour.getByRole('button',{name:'Full mode',exact:true}).isDisabled(),width+' full mode disabled after cloud refusal');
  check(await tour.getByRole('button',{name:'Practical mode',exact:true}).isEnabled(),width+' practical mode remains available');
  await call(page,'/src/state/experienceMode.ts','setExperienceMode',['full']);
  check(await call(page,'/src/state/experienceMode.ts','experienceMode')==='practical',width+' direct mode setter cannot bypass refusal');
  const oh=await call(page,'/src/plugins/rust.ts','callRust',['onethu.harness','run',{command:'chat',text:'test'}]).then(()=>false,e=>e.message.includes('OH'));
  check(oh,width+' OH execution refused before invoking model/native transport');
  await tour.getByRole('button',{name:'Skip tour',exact:true}).click();
  await page.reload();await page.locator('.simple-panel').waitFor();
  check(await tour.count()===0,width+' ordinary reopen does not replay completed guide');
  check(await page.evaluate(()=>localStorage.getItem('onethu.experience.v1'))==='full',width+' denial preserves previous full preference');
  await page.evaluate(()=>window.dispatchEvent(new Event('onethu.onboarding.replay')));await privacy.waitFor();
  check(await privacy.getByRole('switch').first().getAttribute('aria-checked')==='false',width+' replay begins with privacy and saved refusal');
  await advanceOnboardingPrivacy(page,{cloud:true,oh:true});await tour.locator('.tour-language-continue').click();
  await tour.getByRole('button',{name:'Full mode',exact:true}).click();await tour.getByRole('button',{name:'Start with this mode',exact:true}).click();
  await tour.getByRole('button',{name:'Skip tour',exact:true}).click();
  check(await call(page,'/src/state/experienceMode.ts','experienceMode')==='full',width+' cloud consent unlocks full mode');
  await page.evaluate(()=>window.dispatchEvent(new Event('onethu.onboarding.replay')));await privacy.waitFor();
  await advanceOnboardingPrivacy(page,{cloud:false,oh:false});
  check(await call(page,'/src/state/experienceMode.ts','experienceMode')==='practical',width+' withdrawal immediately leaves full mode');
  check(await call(page,'/src/state/seafile.ts','getSeafileToken')==='',width+' withdrawal hides cached cloud credential');
  check(await page.evaluate(()=>JSON.parse(localStorage.getItem('onethu.freeboard.home.portrait')).sentinel)==='keep-layout',width+' permission changes never erase board preferences');
  check(errors.length===0,width+' no browser runtime errors: '+errors.join(';'));
  await context.close();
 }
 passed=true;
} finally {writeFileSync(out+'/report.json',JSON.stringify({passed,checks},null,2)+'\n');await closeTestBrowser(browser);}
console.log(JSON.stringify({passed,checks:checks.length,out}));
