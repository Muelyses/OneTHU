/** Mobile operation regressions in isolated, fictional previews. All external traffic blocked. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {setup,call,close,browser} from './capture-public-preview.mjs';
import {closeTestBrowser} from './lib/onboarding-browser-steps.mjs';
const out=process.env.ONETHU_TEST_OUT??'/Volumes/OneTHUBuild/artifacts/mobile-round3';mkdirSync(out,{recursive:true});
const checks=[];let passed=false;const check=(yes,label)=>{assert.ok(yes,label);checks.push(label);console.log('✓ '+label);};
try{
 const {page,context}=await setup(390,844);
 // Remove the preview's forced-phone hint so viewport classification is exercised.
 await page.goto('http://127.0.0.1:5180/?explorer-preview=onboarding');await page.locator('[data-coach="home-edit"]').waitFor();
 const state=()=>page.evaluate(()=>({phone:document.documentElement.classList.contains('is-phone'),width:innerWidth,scroll:document.documentElement.scrollWidth,reading:!!document.querySelector('.freeboard-wrap.is-reading')}));
 let before=await state();await page.locator('[data-coach="home-edit"]').click();let after=await state();check(after.phone&&after.reading===before.reading&&after.width===390&&after.scroll<=391,'entering edit retains the actual portrait phone layout');
 const boardSnapshot=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('onethu.board.v1')));
 const original=await boardSnapshot();
 await page.evaluate(async()=>{const source=await(await fetch('/src/components/FreeBoard.tsx')).text();const url=[...source.matchAll(/"([^" ]+)"/g)].map(m=>m[1]).find(u=>u.startsWith('/src/state/freeBoard.ts'))??'/src/state/freeBoard.ts';const m=await import(url);const ops=m.freeBoardOps();const it=ops.items()[0];ops.move(it.id,(it.rect?.x??0)+37,(it.rect?.y??0)+29);});
 await page.getByRole('button',{name:'撤销上一步',exact:true}).click();
 const undone=await boardSnapshot();check(JSON.stringify(undone.boards[0].cells.portrait.map(i=>[i.id,i.rect?.x,i.rect?.y]))===JSON.stringify(original.boards[0].cells.portrait.map(i=>[i.id,i.rect?.x,i.rect?.y])),'mobile Undo restores the real saved board positions');
 await page.evaluate(async()=>{const source=await(await fetch('/src/components/FreeBoard.tsx')).text();const url=[...source.matchAll(/"([^" ]+)"/g)].map(m=>m[1]).find(u=>u.startsWith('/src/state/freeBoard.ts'))??'/src/state/freeBoard.ts';const m=await import(url);const ops=m.freeBoardOps();ops.remove(ops.items()[0].id);});
 const removed=await boardSnapshot();await page.getByRole('button',{name:'恢复默认',exact:true}).click();const confirm=page.getByRole('dialog').filter({hasText:'恢复首页默认组件与布局'});await confirm.waitFor();await confirm.getByRole('button',{name:'确定',exact:true}).click();
 await page.getByRole('button',{name:'撤销上一步',exact:true}).click();const restored=await boardSnapshot();check(JSON.stringify(restored.boards[0].cells.portrait.map(i=>i.id))===JSON.stringify(removed.boards[0].cells.portrait.map(i=>i.id)),'Restore defaults is confirmed and can itself be undone');
 await page.screenshot({path:out+'/phone-edit.png'});await page.locator('[data-coach="home-edit"]').click();
 await call(page,'/src/state/explorer.ts','openSettings',['profile']);await page.getByRole('button',{name:'管理组织',exact:true}).click();
 await page.locator('.contacts-page:visible').waitFor();check(await page.locator('.settings-mask').count()===0,'Manage organizations reveals its destination and closes settings');
 await page.locator('.contacts-page').getByRole('button',{name:'新建组织',exact:true}).click();const create=page.getByRole('dialog',{name:'新建组织',exact:true});await create.waitFor();await create.locator('input').first().fill('Round 3 demo organization');await create.getByRole('button',{name:'提交',exact:true}).click();await page.locator('.org-page:visible').waitFor();
 await page.locator('.org-page:visible').getByRole('button',{name:'编辑资料',exact:true}).first().click();const form=page.getByRole('dialog',{name:'编辑组织资料',exact:true});await form.waitFor();
 check(await form.isVisible(),'organization edit opens a reachable form');await page.screenshot({path:out+'/organization-form.png'});await form.getByRole('button',{name:'取消',exact:true}).click();
 await call(page,'/src/state/explorer.ts','openSettings',['settings']);await page.locator('.workbench-settings-phone-nav select').selectOption('关于');
 const row=page.locator('[id="row-检查-OneTHU-更新"]');await row.waitFor();
 let release;await page.route('https://github.com/smartThise/OneTHU/releases/latest/download/latest.json',route=>new Promise(resolve=>{release=()=>route.abort().then(resolve);}));
 await row.getByRole('button',{name:'检查更新',exact:true}).click();await row.locator('[aria-busy="true"]').waitFor();
 const status=await row.locator('[aria-busy="true"]').evaluate(el=>{const label=el.querySelector('.og-btn-label'),spinner=el.querySelector('.og-btn-spinner');return {text:label?.textContent,visible:label&&getComputedStyle(label).visibility!=='hidden',ink:getComputedStyle(el).color,spinnerWidth:spinner?.getBoundingClientRect().width,spinnerBorder:spinner&&getComputedStyle(spinner).borderTopWidth};});
 check(status.text?.includes('正在检查')&&status.visible&&status.ink!=='rgba(0, 0, 0, 0)'&&status.spinnerWidth>0&&status.spinnerBorder!=='0px','loading button keeps readable text and a drawn spinner');
 await page.screenshot({path:out+'/update-checking.png'});await row.getByRole('button',{name:'取消',exact:true}).click();await row.getByRole('button',{name:'检查更新',exact:true}).waitFor();check(await row.getByRole('button',{name:'检查更新',exact:true}).isEnabled(),'cancel immediately restores the update button');if(release)await release();
 await close(page,context);passed=true;
}catch(error){for(const c of browser.contexts())for(const p of c.pages()){await p.screenshot({path:out+'/failure.png'}).catch(()=>{});console.log((await p.locator('body').innerText()).slice(-5500));}throw error;}finally{await closeTestBrowser(browser);writeFileSync(out+'/report.json',JSON.stringify({passed,checks,scope:'390px actual viewport classification; isolated fictional browser data, no native install or cloud writes'},null,2));}
