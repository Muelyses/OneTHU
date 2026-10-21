/** Real hard-refresh control: three modes, desktop + touch, free drag, persistence and actual reload. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const base=process.env.ONETHU_TEST_URL??'http://127.0.0.1:5180';
const out=process.env.ONETHU_TEST_ARTIFACTS??'/Volumes/OneTHUBuild/artifacts/hard-refresh-review';mkdirSync(out,{recursive:true});
const checks=[];const check=(value,label)=>{assert.ok(value,label);checks.push(label);console.log('✓ '+label);};
const selector='.hard-refresh-fab:not(.top-fab)',key='onethu.ui.refreshFab.v1';
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
async function pageFor(mode,width,stored){
 const page=await browser.newPage({viewport:{width,height:850},isMobile:width<600,hasTouch:width<600});
 await page.routeWebSocket(/(?:localhost|127\.0\.0\.1):5180/,()=>{});
 await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.fallback():route.abort());
 await page.addInitScript(({mode,stored,key})=>{
  localStorage.setItem('onethu.onboarded.flow4','1');localStorage.setItem('onethu.chatdock.open','0');localStorage.setItem('onethu.experience.v1',mode);
  if(!sessionStorage.getItem('refresh-test-started')){if(stored)localStorage.setItem(key,JSON.stringify(stored));else localStorage.removeItem(key);sessionStorage.setItem('refresh-test-started','1');}
  sessionStorage.setItem('refresh-test-loads',String(Number(sessionStorage.getItem('refresh-test-loads')??0)+1));
 },{mode,stored,key});
 await page.goto(base+'/?explorer-preview=home');await page.locator('.explorer-shell').waitFor();await page.waitForTimeout(1800);return page;
}
async function visible(page,label){
 const button=page.locator(selector);await button.waitFor();check(await button.count()===1,`${label}: refresh is mounted once`);
 const info=await button.evaluate(el=>{const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height,vw:Math.min(innerWidth,document.documentElement.clientWidth,document.documentElement.getBoundingClientRect().width),vh:innerHeight,hit:!!top&&(top===el||el.contains(top))};});
 check(info.x>=0&&info.y>=0&&info.right<=info.vw+1&&info.bottom<=info.vh+1,`${label}: complete button is inside the viewport ${JSON.stringify(info)}`);
 check(info.hit,`${label}: refresh can receive a pointer at its center`);return button;
}
async function drag(page,button,{cancel=false}={}){
 const r=await button.boundingBox(),from={x:r.x+r.width/2,y:r.y+r.height/2},to={x:Math.max(80,from.x-150),y:Math.max(200,from.y-180)};
 if(page.viewportSize().width<600){
  const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
  for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/6,y:from.y+(to.y-from.y)*i/6}]});
  await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await cdp.detach();
 }else{await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});await page.mouse.up();}
 return r;
}
async function loads(page){return page.evaluate(()=>Number(sessionStorage.getItem('refresh-test-loads')));}
async function refresh(page,button){
 const before=await loads(page);
 if(page.viewportSize().width<600)await button.tap();else await button.click();
 await page.waitForFunction(expected=>Number(sessionStorage.getItem('refresh-test-loads'))===expected,before+1);
 await page.locator('.explorer-shell').waitFor();return before;
}
let passed=false;
try{
 for(const width of [1280,390]){
  const page=await pageFor('full',width,{right:20,bottom:700});
  for(const delta of [2,4,6]){
   const button=page.locator(selector),before=await loads(page),r=await button.boundingBox();
   const from={x:r.x+r.width/2,y:r.y+r.height/2},to={x:from.x+delta,y:from.y+delta};
   if(width<600){
    const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[to]});
    const held=await button.boundingBox();check(Math.abs(held.x-r.x)<1&&Math.abs(held.y-r.y)<1,`${width}: ${delta}px touch jitter leaves button in place`);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
   }else{
    await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y);
    const held=await button.boundingBox();check(Math.abs(held.x-r.x)<1&&Math.abs(held.y-r.y)<1,`${width}: ${delta}px mouse jitter leaves button in place`);
    await page.mouse.up();
   }
   await page.waitForFunction(expected=>Number(sessionStorage.getItem('refresh-test-loads'))===expected,before+1);
   await page.locator('.explorer-shell').waitFor();
   check(await loads(page)===before+1,`${width}: ${delta}px press jitter still reloads once`);
  }
  await page.locator(selector).focus();const before=await loads(page);await page.keyboard.press('Enter');
  await page.waitForFunction(expected=>Number(sessionStorage.getItem('refresh-test-loads'))===expected,before+1);
  check(await loads(page)===before+1,`${width}: keyboard activation reloads once`);await page.close();
 }
 if(process.env.ONETHU_REFRESH_SCOPE!=='boundary')for(const width of [1280,390])for(const mode of ['full','simple','practical']){
  const page=await pageFor(mode,width),label=`${width}/${mode}`;const button=await visible(page,label),initialLoads=await loads(page);
  const before=await drag(page,button);await page.waitForTimeout(150);const moved=await button.boundingBox();
  check(Math.abs(before.x-moved.x)>80&&Math.abs(before.y-moved.y)>80,`${label}: free drag moves in both directions`);
  const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);check(Number.isFinite(stored?.right)&&Number.isFinite(stored?.bottom),`${label}: dragging stores its position`);
  check(await loads(page)===initialLoads,`${label}: releasing a drag does not refresh the page`);
  await page.waitForTimeout(300);const settled=await button.boundingBox();check(Math.abs(settled.x-moved.x)<2&&Math.abs(settled.y-moved.y)<2,`${label}: release keeps the chosen position without snapping`);
  await refresh(page,button);check(await loads(page)===initialLoads+1,`${label}: the very next real click/tap reloads exactly once`);
  const restored=await page.locator(selector).boundingBox();check(Math.abs(restored.x-settled.x)<2&&Math.abs(restored.y-settled.y)<2,`${label}: reload restores the freely chosen position`);
  await page.screenshot({path:`${out}/fixed-${width}-${mode}.png`,animations:'disabled'});await page.close();
 }
 for(const width of [1280,390])for(const stored of [{right:5000,bottom:5000},{right:-100,bottom:-100}]){
  const page=await pageFor('full',width,stored),label=`${width}/stored(${stored.right},${stored.bottom})`;
  await visible(page,label);const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
  check(saved.right>=4&&saved.bottom>=4&&saved.right<width&&saved.bottom<850,`${label}: recovered coordinates are persisted`);
  await page.close();
 }
 const resized=await pageFor('full',1280,{right:1000,bottom:600});await resized.setViewportSize({width:390,height:600});await resized.waitForTimeout(100);await visible(resized,'desktop shrunk to390');await resized.close();
 const cancelled=await pageFor('full',390);const button=cancelled.locator(selector);await drag(cancelled,button,{cancel:true});const before=await loads(cancelled);
 await refresh(cancelled,button);check(await loads(cancelled)===before+1,'touch cancellation without compatibility click cannot swallow the next real tap');await cancelled.close();
 passed=true;
}finally{writeFileSync(out+'/report.json',JSON.stringify({passed,checks,scope:'Real Vite application; desktop mouse and Chromium mobile touch input; no Android hardware. All external requests blocked.'},null,2));await browser.close();}
console.log(`${checks.length} hard refresh browser assertions passed`);
