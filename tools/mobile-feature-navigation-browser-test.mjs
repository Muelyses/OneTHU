/** Legacy-style temporary feature navigation. Fictional isolated UI, no account writes. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {setup,call,close,browser} from './capture-public-preview.mjs';
import {advanceOnboardingLanguage,closeTestBrowser} from './lib/onboarding-browser-steps.mjs';
const out=process.env.ONETHU_TEST_OUT??'/Volumes/OneTHUBuild/artifacts/mobile-feature-navigation';mkdirSync(out,{recursive:true});
const checks=[];let passed=false;const check=(v,s)=>{assert.ok(v,s);checks.push(s);console.log('✓ '+s);};
const contentBounds=page=>page.locator('.explorer-content').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};});
async function chooseLayout(page,mode,text){
 await call(page,'/src/state/explorer.ts','openSettings',['settings']);
 if(mode==='full')await page.locator('.workbench-settings-phone-nav select').selectOption('外观与布局');
 await page.locator('.settings-panel .mobile-layout-choice').getByRole('button').filter({hasText:text}).click();
 await page.locator('.settings-head').getByRole('button').last().click();await page.locator('.settings-mask').waitFor({state:'hidden'});
}
try{
 for(const width of [320,390,430])for(const mode of ['simple','practical','full']){
  const {page,context}=await setup(width,844,mode),label=width+' '+mode;
  const before=await contentBounds(page);await chooseLayout(page,mode,'弹出式侧边导航');
  const trigger=page.locator('.mobile-nav-trigger');await trigger.waitFor();
  check(await page.locator('.oneshot').count()===0,label+': pop-out navigation replaces OneShot');
  check(await trigger.evaluate(el=>{const r=el.getBoundingClientRect();return r.left<32&&r.top<80;}),label+': trigger is at the top left');
  assert.deepEqual(await contentBounds(page),before);check(true,label+': closed navigation preserves the full content width');
  await trigger.tap();const drawer=page.getByRole('dialog',{name:'一级功能区',exact:true});await drawer.waitFor();await page.waitForTimeout(350);check(await drawer.evaluate(el=>el.getBoundingClientRect().width<innerWidth-24),label+': overlay leaves the underlying page visible');
  const links=drawer.locator('.mobile-feature-link');check(await links.count()===(mode==='simple'?5:16),label+': expected five shortcuts or all sixteen primary features');
  if(mode!=='simple')check(await links.filter({hasText:'通讯录'}).count()===1&&await links.filter({hasText:'清小搭'}).count()===1&&await links.filter({hasText:'选课'}).count()===1,label+': complete primary feature list is present');
  assert.deepEqual(await contentBounds(page),before);check(true,label+': open navigation overlays rather than squeezing the page');
  await drawer.getByRole('button',{name:'生活',exact:true}).tap();await drawer.waitFor({state:'hidden'});await page.locator(mode==='full'?'[data-tab-page="life"]:visible':'[data-simple-page="life"]').waitFor();check(true,label+': choosing a feature navigates and closes the overlay');
  await trigger.tap();await drawer.waitFor();await call(page,'/src/state/navStack.ts','back');await drawer.waitFor({state:'hidden'});check(true,label+': Back closes the overlay first');
  await trigger.tap();await drawer.waitFor();await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});
  if(width===390&&mode==='practical'){
   await trigger.tap();await drawer.waitFor();await drawer.getByRole('button',{name:'通讯录',exact:true}).tap();await page.locator('.settings-mask').waitFor();check(await page.getByRole('button',{name:'切换模式',exact:true}).isVisible(),'Practical-only guard opens an actionable mode switch instead of silently failing');await page.locator('.settings-head').getByRole('button').last().click();await page.locator('.settings-mask').waitFor({state:'hidden'});
  }
  await trigger.tap();await drawer.waitFor();if(mode!=='simple'){await links.last().scrollIntoViewIfNeeded();check(await links.last().isVisible(),label+': the final feature is reachable by scrolling');}
  await page.waitForTimeout(350);await page.screenshot({path:out+'/'+width+'-'+mode+'.png'});await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});
  await chooseLayout(page,mode,'底部快捷入口');await page.locator('.oneshot').waitFor();check(await trigger.count()===0,label+': switching back restores OneShot and removes the trigger');await close(page,context);
 }
 for(const mode of ['full','practical','simple']){
  const {page,context}=await setup(390,844);await call(page,'/src/components/OnboardingTour.tsx','replayOnboarding');await advanceOnboardingLanguage(page);await page.locator('.experience-mode-picker').getByRole('button',{name:{full:'完整模式',practical:'实用模式',simple:'极简模式'}[mode],exact:true}).tap();await page.locator('.tour-next').tap();
  if(mode!=='simple'){const phase=page.locator('[data-tour-phase="layout"]');await phase.waitFor();await phase.getByRole('button').filter({hasText:'弹出式侧边导航'}).tap();check((await phase.innerText()).includes('点击左上角按钮'),'Guide describes the actual top-left trigger');await page.screenshot({path:out+'/guide-'+mode+'.png'});await page.locator('.tour-next').tap();}
  await page.locator('[data-tour-phase="lesson"]').waitFor();check(await page.locator('[data-tour-phase="layout"]').count()===0,mode+': appropriate guide continues');await page.locator('.tour-skip').tap();await page.locator('.experience-tour').waitFor({state:'hidden'});await close(page,context);
 }
 const english=await setup(390,844);await english.page.addInitScript(()=>{localStorage.setItem('onethu.locale','en-US');localStorage.setItem('onethu.mobile-navigation.v1',JSON.stringify({full:'side'}));});await english.page.reload();await english.page.locator('.mobile-nav-trigger').waitFor();await english.page.locator('.mobile-nav-trigger').tap();const enDrawer=english.page.getByRole('dialog',{name:'Main features',exact:true});await enDrawer.waitFor();await english.page.waitForTimeout(350);check(!/[\u3400-\u9fff]/u.test(await enDrawer.innerText()),'English navigation uses English interface labels');await english.page.screenshot({path:out+'/english.png'});await close(english.page,english.context);
 const {page,context}=await setup(1280,860);await call(page,'/src/state/mobileLayout.ts','setMobileNavigation',['full','side']);check(await page.locator('.mobile-nav-trigger').count()===0&&await page.locator('.oneshot').isVisible(),'Desktop retains its existing navigation');await close(page,context);passed=true;
}catch(error){for(const c of browser.contexts())for(const p of c.pages()){await p.screenshot({path:out+'/failure.png'}).catch(()=>{});console.log((await p.locator('body').innerText()).slice(-3000));}throw error;}finally{await closeTestBrowser(browser);writeFileSync(out+'/report.json',JSON.stringify({passed,checks,scope:'320/390/430 touch viewports, actual list navigation, fictional data; no package build'},null,2));}
