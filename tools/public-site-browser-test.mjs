/** Public site acceptance with browser-rendered fictional assets. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
const out='/Volumes/OneTHUBuild/artifacts/public-site-0.11/site';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const expected=JSON.parse(readFileSync('docs/contributors.json','utf8'));const report={passed:false,checks:[],errors:[]};const check=(value,label)=>{assert.ok(value,label);report.checks.push(label);console.log('✓ '+label);};
try{
 for(const [width,height] of [[1440,1000],[390,844],[320,568],[844,390]]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:8766/');await page.locator('.studio.is-ready').waitFor();await page.waitForTimeout(600);
  const logo=await page.locator('.top .brand').evaluate(el=>{const a=el.querySelector('.word').getBoundingClientRect(),b=el.querySelector('.u').getBoundingClientRect();return b.top>=a.bottom-2;});check(logo,`${width}: original stacked brand is preserved`);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}: page fits horizontally`);
  await page.screenshot({path:`${out}/home-${width}.png`});
  const tabs=page.getByRole('tab');await tabs.filter({hasText:'极简'}).click();check(await page.locator('#mode-simple').isVisible(),`${width}: real mode switch`);
  await tabs.filter({hasText:'极简'}).press('ArrowRight');check(await page.locator('#mode-practical').isVisible(),`${width}: keyboard mode switch`);
  await page.locator('.language').click();await page.waitForURL('**/en/index.html');check(await page.locator('html').getAttribute('lang')==='en',`${width}: language switch reaches English page`);
  check(await page.locator('[src*="assets/preview/"],video[poster]').evaluateAll(items=>items.length>0&&items.every(item=>[item.getAttribute('src'),item.getAttribute('poster')].filter(Boolean).every(url=>url.includes('/en-US/')))),`${width}: English page uses separately captured English images and video`);
  await page.locator('.studio.is-ready').waitFor();await page.waitForTimeout(600);await page.screenshot({path:`${out}/english-home-${width}.png`});
  await page.goto('http://127.0.0.1:8766/en/developers.html');check(await page.locator('#contributors .contributor').count()===expected.contributors.length,`${width}: all contributors visible`);check(await page.locator('#contributors .badge').count()===expected.contributors.filter(p=>p.major).length,`${width}: exact major-contributor threshold`);
  await page.locator('#contributors').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/contributors-${width}.png`});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}: developer page fits horizontally`);
  await context.close();
 }
 for(const language of ['', 'en/']){
  const context=await browser.newContext(),page=await context.newPage();
  await page.route('https://api.github.com/repos/smartThise/OneTHU-Market/contents/registry.json',route=>route.fulfill({json:{plugins:[{id:'theme.fixture',name:'Fixture theme',repo:'example/theme',category:'theme',version:'1.0',description:'Fictional preview'},{id:'tool.fixture',name:'Fixture tool',repo:'example/tool',category:'tool',description:'<img src=x onerror=alert(1)>'}]}}));
  await page.goto('http://127.0.0.1:8766/'+language+'market.html');await page.locator('#market-grid .card').first().waitFor();check(await page.locator('#market-grid .card').count()===2,language+'market: registry renders');
  await page.locator('#market-search').fill('theme');check(await page.locator('#market-grid .card').count()===1,language+'market: search filters');
  await page.locator('#market-search').fill('');await page.locator('#market-filters button').filter({hasText:language?'Tools':'工具'}).click();check(await page.locator('#market-grid .card').count()===1,language+'market: category filters');check(await page.locator('#market-grid img').count()===0,language+'market: registry text is not executable HTML');await context.close();
 }
 for(const kind of ['reduced','nojs','no-webgl']){
  const context=await browser.newContext({viewport:{width:390,height:844},javaScriptEnabled:kind!=='nojs',reducedMotion:kind==='reduced'?'reduce':'no-preference'}),page=await context.newPage();
  if(kind==='no-webgl')await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/.test(type)?null:original.call(this,type,...args);};});
  await page.goto('http://127.0.0.1:8766/en/');await page.waitForTimeout(600);check(await page.locator('.studio-poster').isVisible(),kind+': readable poster fallback');
  if(kind==='reduced')check(await page.locator('video').evaluate(video=>video.paused),'reduced: video remains paused');
  if(kind==='nojs')check(await page.getByRole('tabpanel').count()===3&&await page.locator('#mode-simple').isVisible(),'nojs: all mode descriptions remain accessible');
  await page.screenshot({path:out+'/'+kind+'.png'});await context.close();
 }
 check(report.errors.length===0,'No browser runtime errors');report.passed=true;
}finally{await browser.close();writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');}
