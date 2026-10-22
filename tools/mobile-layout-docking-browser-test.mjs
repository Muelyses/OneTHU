/** Trusted touch for mobile navigation, guide choices and docked vault access. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {setup,call,close,browser} from './capture-public-preview.mjs';
import {advanceOnboardingLanguage,advanceOnboardingPrivacy,closeTestBrowser} from './lib/onboarding-browser-steps.mjs';
const out=process.env.ONETHU_TEST_OUT??'/Volumes/OneTHUBuild/artifacts/mobile-layout-docking';mkdirSync(out,{recursive:true});
const checks=[];let passed=false;const check=(v,label)=>{assert.ok(v,label);checks.push(label);console.log('✓ '+label);};
async function drag(page,start,end){const c=await page.context().newCDPSession(page);await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});for(let n=1;n<=12;n++)await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*n/12,y:start.y+(end.y-start.y)*n/12}]});await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await c.detach();}
try{
 for(const width of (process.env.ONETHU_LAYOUT_LANGUAGE_ONLY?[]:[360,390,430]))for(const mode of ['full','practical']){
  const {page,context}=await setup(width,844,mode);const label=width+' '+mode;
  await call(page,'/src/state/explorer.ts','openSettings',['settings']);if(mode==='full')await page.locator('.workbench-settings-phone-nav select').selectOption('外观与布局');
  const choices=page.locator('.settings-panel .mobile-layout-choice');await choices.waitFor();await choices.getByRole('button').filter({hasText:'侧边导航'}).tap();
  await call(page,'/src/state/explorer.ts','closeSettings');await page.locator('.oneshot.is-mobile-side').waitFor();
  const layout=await page.evaluate(()=>{const r=document.querySelector('.explorer-content').getBoundingClientRect(),nav=document.querySelector('.oneshot').getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scroll:document.documentElement.scrollWidth,navRight:nav.right,count:document.querySelectorAll('.oneshot .oneshot-button').length};});
  check(layout.count===5&&layout.left>=60&&layout.right<=width+1&&layout.scroll<=width+1,label+': five side shortcuts leave a real content gutter and fit the screen');
  await page.locator('.oneshot.is-mobile-side').getByRole('button',{name:'生活',exact:true}).tap();await page.locator(mode==='full'?'[data-tab-page="life"]:visible':'[data-simple-page="life"]').waitFor();check(true,label+': side shortcut actually opens Life');
  await page.screenshot({path:out+'/'+label.replace(' ','-')+'-side.png'});
  await call(page,'/src/state/mobileLayout.ts','setMobileNavigation',[mode,'bottom']);await page.locator('.oneshot:not(.is-mobile-side)').waitFor();check(await page.locator('.oneshot .oneshot-button').count()===5,label+': bottom layout remains available');
  if(width===390&&mode==='full'){
   const anchor=page.locator('.vault-floating-anchor.is-ready'),button=anchor.locator('.vault-box-button');let rect=await button.boundingBox();await drag(page,{x:rect.x+rect.width/2,y:rect.y+rect.height/2},{x:10,y:340});await page.locator('.vault-floating-anchor[data-vault-collapsed="true"]').waitFor();
   rect=await button.boundingBox();check(rect.x<0&&rect.x+rect.width>=28,'phone vault snaps left and leaves a visible handle');
   await page.touchscreen.tap(Math.max(18,rect.x+rect.width-16),rect.y+rect.height/2);await page.locator('.vault-manager').waitFor();check(true,'one tap on a half-hidden vault opens management');
   await page.locator('.vault-manager').getByRole('button',{name:'关闭',exact:true}).tap();rect=await button.boundingBox();await drag(page,{x:Math.max(18,rect.x+rect.width-16),y:rect.y+rect.height/2},{x:190,y:340});await page.locator('.vault-floating-anchor[data-vault-collapsed="false"]').waitFor();
   rect=await button.boundingBox();check(rect.x>80&&rect.x+rect.width<320,'dragging the docked handle inward restores free placement');
   await drag(page,{x:rect.x+rect.width/2,y:rect.y+rect.height/2},{x:width-8,y:360});await page.locator('.vault-floating-anchor[data-vault-collapsed="true"]').waitFor();check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'right-edge half hiding does not widen the page');
   await page.screenshot({path:out+'/vault-half-hidden.png'});
  }
  await close(page,context);
 }
 for(const [mode,label]of (process.env.ONETHU_LAYOUT_LANGUAGE_ONLY?[]:[['full','完整模式'],['practical','实用模式'],['simple','极简模式']])){
  const {page,context}=await setup(390,844);await call(page,'/src/components/OnboardingTour.tsx','replayOnboarding');await advanceOnboardingLanguage(page);await page.locator('.experience-mode-picker').getByRole('button',{name:label,exact:true}).tap();await page.locator('.tour-next').tap();
  if(mode==='simple'){await page.locator('[data-tour-phase="lesson"]').waitFor();check(await page.locator('.experience-tour .mobile-layout-choice').count()===0,'Simple guide retains its fixed layout');}
  else{const choice=page.locator('[data-tour-phase="layout"]');await choice.waitFor();await choice.getByRole('button').filter({hasText:'侧边导航'}).tap();await page.screenshot({path:out+'/guide-'+mode+'.png'});await page.locator('.tour-next').tap();await page.locator('[data-tour-phase="lesson"]').waitFor();check(await page.locator('html').getAttribute('data-mobile-navigation')==='side',mode+' guide applies the chosen layout and continues to the lessons');}
  await close(page,context);
 }
 for(const width of [320,1280])for(const mode of ['full','practical']){
  const {page,context}=await setup(width,844);
  await call(page,'/src/components/OnboardingTour.tsx','replayOnboarding');await advanceOnboardingPrivacy(page);await page.locator('.tour-language-option').filter({has:page.locator('input[value="en-US"]')}).click();await page.locator('.tour-language-continue').click();
  await page.locator('.experience-mode-picker').getByRole('button',{name:mode==='full'?'Full mode':'Practical mode',exact:true}).click();await page.locator('.tour-next').click();
  if(width===320){const phase=page.locator('[data-tour-phase="layout"]');await phase.waitFor();check(!/[\u3400-\u9fff]/u.test(await phase.locator('.mobile-layout-choice').innerText()),mode+' English layout choice follows the selected language');
   check(await phase.evaluate(el=>el.scrollWidth<=el.clientWidth+1)&&await page.locator('.tour-next').isVisible(),mode+' layout fits a narrow phone with a reachable Continue button');
   await phase.getByRole('button').filter({hasText:'Side navigation'}).click();await page.screenshot({path:out+'/english-'+mode+'-choice.png'});
   await page.locator('.tour-next').click();
  }else check(await page.locator('[data-tour-phase="layout"]').count()===0,mode+' desktop guide retains the desktop flow');
  await page.locator('[data-tour-phase="lesson"]').waitFor();if(width===320){await page.locator('.tour-footer').getByRole('button',{name:'Back',exact:true}).click();await page.locator('[data-tour-phase="layout"]').waitFor();check(await page.locator('.mobile-layout-option.is-active').innerText().then(s=>s.includes('Side navigation')),mode+' Back returns to the saved layout choice');await page.locator('.tour-next').click();await page.locator('[data-tour-phase="lesson"]').waitFor();}await page.locator('.tour-skip').click();await page.locator('.experience-tour').waitFor({state:'hidden'});await page.screenshot({path:out+'/english-'+width+'-'+mode+'-home.png'});await close(page,context);
 }
 passed=true;
}catch(error){for(const c of browser.contexts())for(const p of c.pages()){await p.screenshot({path:out+'/failure.png'}).catch(()=>{});console.log((await p.locator('body').innerText()).slice(-4000));}throw error;}finally{await closeTestBrowser(browser);writeFileSync(out+'/report.json',JSON.stringify({passed,checks,scope:'360/390/430 touch viewports with trusted CDP drags; fictional data only'},null,2));}
