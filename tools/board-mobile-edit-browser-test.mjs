/** Real mobile editing gate on Home and OnePage; isolated fictional data, no account. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {setup,call,close,browser} from './capture-public-preview.mjs';
import {closeTestBrowser} from './lib/onboarding-browser-steps.mjs';
const out=process.env.ONETHU_TEST_OUT??'/Volumes/OneTHUBuild/artifacts/release-0.11/mobile-board-edit';mkdirSync(out,{recursive:true});
let passed=false;
const checks=[];const check=(v,label)=>{assert.ok(v,label);checks.push(label);console.log('✓ '+label);};
const geometry=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('onethu.board.v1')));
async function point(locator){await locator.scrollIntoViewIfNeeded();return locator.evaluate(el=>{const r=el.getBoundingClientRect();for(let y=Math.max(100,r.top+4);y<Math.min(innerHeight-155,r.bottom-4);y+=8)for(let x=r.left+4;x<Math.min(innerWidth-20,r.right-4);x+=10){const hit=document.elementFromPoint(x,y);if(hit?.closest('.free-item')===el&&!hit.closest('a,button,input,textarea,[role=button],.free-toolbar,.free-handle,.hw-carousel'))return{x,y};}return null;});}
async function move(page,p,dx=36,dy=35){await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+dx,p.y+dy,{steps:10});await page.mouse.up();await page.waitForTimeout(200);}
try{
 for(const [width,height] of [[390,844],[844,390]]){
  const {page,context}=await setup(width,height);const label=width+'px';
  await page.locator('[data-coach="home-edit"]').waitFor();
  check(await page.locator('.freeboard-wrap').first().getAttribute('data-board-editable')==='false',label+' Home starts locked');
  check(await page.locator('.board-viewport-tools button').count()===1,label+' only edit toggle remains');
  let before=await geometry(page);const item=page.locator('.free-item[data-widget="clock"]:visible').first();const p=await point(item);assert.ok(p);
  await move(page,p);await item.dblclick();await page.keyboard.press('ArrowRight');await page.keyboard.press('Delete');
  await page.locator('.freeboard').first().dispatchEvent('wheel',{deltaY:80,ctrlKey:true});
  check(JSON.stringify(await geometry(page))===JSON.stringify(before),label+' locked drag/double-click/keys do not mutate the board');
  check(await page.locator('.free-toolbar,.free-handle,.free-note-editor').count()===0,label+' no selection tools or resize handles while locked');
  check(await item.evaluate(el=>getComputedStyle(el).touchAction!=='none'),label+' touch scrolling is enabled');
  if(width===390){
   const client=await context.newCDPSession(page);await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
   const initial=await page.evaluate(()=>scrollY);await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:580}]});
   for(let i=1;i<=12;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:180,y:580-i*22}]});
   await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(400);
   check(await page.evaluate(()=>scrollY)>initial,label+' actual touch swipe scrolls the page');
  }
  await page.screenshot({path:out+'/'+label+'-locked.png'});
  await page.locator('[data-coach="home-edit"]').click();await page.locator('[data-board-editable="true"]').waitFor();
  check(await page.locator('[data-coach="home-add"]').isVisible(),label+' editing reveals add widget in the existing toolbar');
  if(width===390){await page.locator('.board-viewport-tools').getByRole('button',{name:'自由摆放',exact:true}).click();await page.locator('.board-viewport-tools').getByRole('button',{name:/^\d+%$/}).click();}
  const target=page.locator('.free-item[data-widget="clock"]:visible').first();const id=await target.getAttribute('data-item-id');before=await geometry(page);const q=await point(target);assert.ok(q);await move(page,q);
  check(JSON.stringify(await geometry(page))!==JSON.stringify(before),label+' editing allows real component dragging');
  const handles=page.locator(`[data-item-id="${id}"] .free-handle`);await handles.first().waitFor();
  const hp=await handles.evaluateAll(elements=>{for(const el of elements){const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;if(document.elementFromPoint(x,y)===el)return {x,y};}return null;});assert.ok(hp,'An actual resize handle must be reachable');
  before=await geometry(page);await move(page,hp,28,25);
  check(JSON.stringify(await geometry(page))!==JSON.stringify(before),label+' editing allows real resize commits');
  await page.screenshot({path:out+'/'+label+'-editing.png'});
  await page.locator('[data-coach="home-edit"]').click();await page.locator('[data-board-editable="false"]').waitFor();before=await geometry(page);
  const lockedPoint=await point(target);await move(page,lockedPoint);check(JSON.stringify(await geometry(page))===JSON.stringify(before),label+' Done editing locks the modified layout');
  // Create an independent user board via the actual board API, then open its surface.
  await page.evaluate(async()=>{const board=await import('/src/state/board.ts');const ops=await import('/src/state/boardOps.ts');const free=await import('/src/state/freeBoard.ts');let r=ops.createBoard(board.loadBoard(),'Fixture OnePage');board.saveBoard(ops.setActiveBoard(r.doc,r.board.id));free.freeBoardOps(r.board.id,'portrait').add({kind:'text',text:'Fictional note'},24,24,260,160);});
  await call(page,'/src/state/explorer.ts','openTab',['board']);await page.locator('[data-tab-page="board"]:visible .freeboard-wrap').waitFor();
  check(await page.locator('[data-tab-page="board"]:visible [data-board-editable]').getAttribute('data-board-editable')==='false',label+' OnePage independently starts locked');
  await page.locator('[data-coach="home-edit"]:visible').click();check(await page.locator('[data-tab-page="board"]:visible [data-board-editable]').getAttribute('data-board-editable')==='true',label+' OnePage uses the same explicit editing gate');
  await call(page,'/src/state/explorer.ts','openTab',['homepage']);await page.waitForTimeout(150);
  check(await page.locator('[data-tab-page="homepage"]:visible [data-board-editable]').getAttribute('data-board-editable')==='false',label+' returning Home does not inherit OnePage editing');
  if(width===390){
   await page.evaluate(()=>{localStorage.setItem('onethu.locale','en-US');dispatchEvent(new StorageEvent('storage',{key:'onethu.locale',newValue:'en-US',storageArea:localStorage}));});await page.getByRole('button',{name:'Edit board',exact:true}).waitFor();check(true,'English editing toggle is localized');
   await page.getByRole('button',{name:'Edit board',exact:true}).click();await page.getByRole('button',{name:'Done editing',exact:true}).waitFor();
   await page.evaluate(async()=>{const source=await (await fetch('/src/components/FreeBoard.tsx')).text();const path=[...source.matchAll(/\"([^\" ]+)\"/g)].map(m=>m[1]).find(s=>s.startsWith('/src/state/navStack.ts'));if(!path)throw Error('Missing actual navigation module');(await import(path)).back();});await page.getByRole('button',{name:'Edit board',exact:true}).waitFor();check(true,'mobile Back exits editing before leaving the board');
  }
  await close(page,context);
 }
 const {page,context}=await setup(1280,900);check(await page.locator('.freeboard-wrap').first().getAttribute('data-board-editable')==='true','desktop remains directly editable');check(await page.locator('[data-coach="home-edit"]').count()===0,'desktop has no mobile editing toggle');await close(page,context);
 passed=true;
}finally{await closeTestBrowser(browser);writeFileSync(out+'/report.json',JSON.stringify({checks,passed,scope:'Chromium touch viewport + real components; no physical device install claim'},null,2));}
