/** Trusted touch for docked vault access. Feature navigation has its own browser test. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {setup,close,browser} from './capture-public-preview.mjs';
import {closeTestBrowser} from './lib/onboarding-browser-steps.mjs';
const out=process.env.ONETHU_TEST_OUT??'/Volumes/OneTHUBuild/artifacts/mobile-layout-docking';mkdirSync(out,{recursive:true});
const checks=[];let passed=false;const check=(v,label)=>{assert.ok(v,label);checks.push(label);console.log('✓ '+label);};
async function drag(page,start,end){const c=await page.context().newCDPSession(page);await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});for(let n=1;n<=12;n++)await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*n/12,y:start.y+(end.y-start.y)*n/12}]});await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await c.detach();}
try{
 const width=390;const {page,context}=await setup(width,844,'full');

   const anchor=page.locator('.vault-floating-anchor.is-ready'),button=anchor.locator('.vault-box-button');let rect=await button.boundingBox();await drag(page,{x:rect.x+rect.width/2,y:rect.y+rect.height/2},{x:10,y:340});await page.locator('.vault-floating-anchor[data-vault-collapsed="true"]').waitFor();
   rect=await button.boundingBox();check(rect.x<0&&rect.x+rect.width>=28,'phone vault snaps left and leaves a visible handle');
   await page.touchscreen.tap(Math.max(18,rect.x+rect.width-16),rect.y+rect.height/2);await page.locator('.vault-manager').waitFor();check(true,'one tap on a half-hidden vault opens management');
   await page.locator('.vault-manager').getByRole('button',{name:'关闭',exact:true}).tap();rect=await button.boundingBox();await drag(page,{x:Math.max(18,rect.x+rect.width-16),y:rect.y+rect.height/2},{x:190,y:340});await page.locator('.vault-floating-anchor[data-vault-collapsed="false"]').waitFor();
   rect=await button.boundingBox();check(rect.x>80&&rect.x+rect.width<320,'dragging the docked handle inward restores free placement');
   await drag(page,{x:rect.x+rect.width/2,y:rect.y+rect.height/2},{x:width-8,y:360});await page.locator('.vault-floating-anchor[data-vault-collapsed="true"]').waitFor();check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'right-edge half hiding does not widen the page');
   await page.screenshot({path:out+'/vault-half-hidden.png'});
 await close(page,context);
 passed=true;
}catch(error){for(const c of browser.contexts())for(const p of c.pages()){await p.screenshot({path:out+'/failure.png'}).catch(()=>{});console.log((await p.locator('body').innerText()).slice(-4000));}throw error;}finally{await closeTestBrowser(browser);writeFileSync(out+'/report.json',JSON.stringify({passed,checks,scope:'390px touch viewport with trusted CDP drags; fictional data only'},null,2));}
