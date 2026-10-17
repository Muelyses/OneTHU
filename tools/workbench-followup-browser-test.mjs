/** Five reported workbench defects; room requests are mocked in-browser only.
 * Start Vite, then node tools/workbench-followup-browser-test.mjs [baseURL].
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const base=process.argv[2]??'http://127.0.0.1:5180';
const out=fileURLToPath(new URL('../docs/onegui/followup-fixes/',import.meta.url));mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let checks=0;const errors=[];const results=[];
const check=(c,label)=>{assert.ok(c,label);checks++;};
const wait=async p=>p.waitForTimeout(1200);
const go=async(p,q)=>{await p.goto(`${base}/?explorer-preview=${q}`,{waitUntil:'domcontentloaded'});await p.waitForSelector('.explorer-topbar, .ex-rail');await wait(p);};
const shot=(p,name)=>p.screenshot({path:out+name+'.png'});
const mockClients=`
session.username='workbench-fixture';
window.__roomBookCalls=[];
info.getLibRoomAccNo=()=>12345;
info.getLibRoomInfoList=async()=>[{kindId:1,kindName:'测试研讨间',rooms:[]}];
info.getLibRoomRecords=async()=>[];
info.getLibRoomResourceList=async(_u,date)=>Array.from({length:12},(_,i)=>({devId:i+1,devName:'测试研讨间 '+(i+1),kindId:1,kindName:'测试研讨间',labId:1,labName:'测试馆',roomId:i+1,roomName:'测试研讨间 '+(i+1),limit:1,maxMinute:180,minMinute:i===1?90:30,cancelMinute:30,maxUser:1,minUser:1,openStart:'08:00',openEnd:'22:00',usage:[{id:i+1,start:new Date(date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6)+'T12:00:00'),end:new Date(date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6)+'T13:00:00'),title:'测试占用',owner:'测试',ownerId:'fixture'}]}));
info.bookLibRoom=async(...args)=>{window.__roomBookCalls.push(args);};
`;
try{
 const rail=await browser.newPage({viewport:{width:1280,height:800}});rail.on('pageerror',e=>errors.push(e.message));
 await rail.addInitScript(()=>{localStorage.setItem('explorer.tabLayout.default','v');localStorage.setItem('ex-rail-narrow','1');localStorage.setItem('onethu.onboarded.phone','1');});
 await go(rail,'tabs');await rail.mouse.move(800,600);await rail.waitForTimeout(250);
 const glyph=rail.locator('.ex-rail .ex-tab-glyph').first();
 const before=await glyph.evaluate(e=>{const r=e.getBoundingClientRect();const p=e.closest('.ex-tab-main').getBoundingClientRect();const bar=e.closest('.ex-rail').getBoundingClientRect();const svg=e.querySelector('svg').getBoundingClientRect();return{lane:r.toJSON(),main:p.toJSON(),bar:bar.toJSON(),svg:svg.toJSON()};});
 check(before.svg.left>=before.main.left&&before.svg.right<=before.main.right&&before.svg.right<=before.bar.right,'collapsed rail icon fits before hover '+JSON.stringify(before));
 await shot(rail,'rail-collapsed');await rail.locator('.ex-rail').hover();await rail.waitForTimeout(300);const after=await glyph.boundingBox();check(Math.abs(after.x-before.lane.x)<1,'hover preserves icon position');await shot(rail,'rail-expanded');
 check(await rail.locator('#ex-bbar-tabs-btn .workbench-wordmark').innerText()==='标签页','top-left button is labelled 标签页');await rail.close();results.push('竖栏收起与展开、标签页命名');
 for(const [tag,w,h]of [['desktop',1280,800],['phone',390,844]]){
 const p=await browser.newPage({viewport:{width:w,height:h},isMobile:w<600,hasTouch:w<600});p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>localStorage.setItem('onethu.onboarded.phone','1'));
 await go(p,'home');
 await p.locator('.free-fab[data-coach="home-add"]').click();await p.getByRole('dialog',{name:'添加组件',exact:true}).getByRole('button',{name:'便笺',exact:true}).click();
 const note=p.locator('.free-item.is-note').last();await note.scrollIntoViewIfNeeded();
 check(await note.evaluate(e=>getComputedStyle(e).backgroundColor)==='rgb(246, 231, 168)',tag+' note paper is yellow');
 await note.dblclick();const editor=p.getByRole('textbox',{name:'便笺内容'});await editor.fill('第一行：明天讨论\n第二行：不要丢掉草稿');
 const noteId=await note.getAttribute('data-item-id');
 check(await p.evaluate(id=>JSON.parse(localStorage.getItem('onethu.board.v1')).boards.flatMap(b=>Object.values(b.cells).flat()).find(i=>i.id===id).spec.props.text,noteId)==='第一行：明天讨论\n第二行：不要丢掉草稿',tag+' note saved while editor focused');
 await p.reload({waitUntil:'domcontentloaded'});await wait(p);
 const reloaded=p.locator(`[data-item-id="${noteId}"]`);check((await reloaded.innerText()).includes('不要丢掉草稿'),tag+' note survives reload');await reloaded.dblclick();check(await p.getByRole('textbox',{name:'便笺内容'}).inputValue()==='第一行：明天讨论\n第二行：不要丢掉草稿',tag+' reopening editor retains text');
 await p.locator('.workbench-board-head h2').click();await reloaded.scrollIntoViewIfNeeded();await shot(p,tag+'-note');
 // Recover older writes that were persisted to item.props but never rendered.
 await p.evaluate(id=>{const d=JSON.parse(localStorage.getItem('onethu.board.v1'));const i=d.boards.flatMap(b=>Object.values(b.cells).flat()).find(i=>i.id===id);i.props={text:'恢复旧版本已保存的内容'};delete i.spec.props;localStorage.setItem('onethu.board.v1',JSON.stringify(d));},noteId);
 await p.reload({waitUntil:'domcontentloaded'});await wait(p);check((await p.locator(`[data-item-id="${noteId}"]`).innerText()).includes('恢复旧版本已保存的内容'),tag+' legacy saved note recovered');
 await p.evaluate(()=>document.documentElement.dataset.scheme='dark');await p.waitForTimeout(150);await p.locator(`[data-item-id="${noteId}"]`).scrollIntoViewIfNeeded();await shot(p,tag+'-note-dark');
 await p.route('**/src/lib/clients.ts*',async route=>{const res=await route.fetch();await route.fulfill({response:res,body:(await res.text())+'\n'+mockClients});});
 await go(p,'page&page=reserve&params='+encodeURIComponent(JSON.stringify({reserveTab:'room'})));
 await p.locator('.og-row').getByRole('button',{name:'预约',exact:true}).first().waitFor({timeout:15000});
 // Tomorrow ensures selected slots are independent of the test run's wall-clock time.
 await p.locator('.og-segment-item').nth(1).click();await p.waitForTimeout(200);
 const segment=await p.locator('.og-segment').evaluate(e=>({border:getComputedStyle(e).borderTopStyle,bg:getComputedStyle(e).backgroundColor,active:getComputedStyle(e.querySelector('.is-active')).color,indicator:getComputedStyle(e.querySelector('.og-segment-indicator')).backgroundColor}));
 check(segment.border==='solid'&&segment.active!==segment.indicator,tag+' OG segment has visible track and contrasting selected ink');
 const legacy=await p.locator('.seg-track').evaluate(e=>({border:getComputedStyle(e).borderTopStyle,active:getComputedStyle(e.querySelector('.is-active')).color,pill:getComputedStyle(e.querySelector('.seg-pill')).backgroundColor}));check(legacy.border==='solid'&&legacy.active!==legacy.pill,tag+' secondary menu segment has visible track and selected state');
 const slot=p.getByRole('button',{name:'10:00~10:30 可约',exact:true}).first();await slot.click();
 const modal=p.getByRole('dialog',{name:'预约 测试研讨间 1',exact:true});await modal.waitFor();await p.waitForTimeout(250);
 check((await modal.innerText()).includes('10:00~10:30'),tag+' clicking slot carries exact selected range');
 check(await modal.getByRole('button',{name:/可约/}).count()===0,tag+' no duplicate all-day time grid in confirmation');
 const rect=await modal.boundingBox();check(rect.y>=0&&rect.y+rect.height<=h+1,tag+' confirmation appears in current viewport');
 check(await p.evaluate(()=>window.__roomBookCalls.length)===0,tag+' picking a slot never submits automatically');
 await shot(p,tag+'-room-confirm');
 // Time selectors must work above the standard modal's scrim.
 const timeSelectors=modal.locator('.filter-dd-btn');await timeSelectors.nth(1).click();
 const dd=p.locator('.filter-dd-panel');await dd.waitFor();await dd.getByPlaceholder('搜索…').fill('11:00');await dd.getByRole('button',{name:'11:00',exact:true}).click();
 check((await modal.innerText()).includes('10:00~11:00'),tag+' time adjustment works above modal');
 await modal.getByRole('button',{name:'提交预约',exact:true}).click();await p.waitForTimeout(300);
 const calls=await p.evaluate(()=>window.__roomBookCalls);check(calls.length===1&&calls[0][2].endsWith('10:00:00')&&calls[0][3].endsWith('11:00:00'),tag+' explicit confirmation submits selected range to mock only');
 // Longer minimum duration: a clicked half-hour becomes the shortest legal range.
 await p.getByRole('button',{name:'10:00~10:30 可约',exact:true}).nth(1).click();
 const minModal=p.getByRole('dialog',{name:'预约 测试研讨间 2',exact:true});await minModal.waitFor();check((await minModal.innerText()).includes('10:00~11:30'),tag+' minimum booking duration respected without reselection');await minModal.getByRole('button',{name:'取消',exact:true}).click();
 await p.waitForTimeout(250);
 const filter=p.locator('.og-field').filter({has:p.locator('.og-field-label',{hasText:'空闲时段'})});
 for(const [i,value]of [[0,'09:00'],[1,'10:30']]){
   await filter.locator('.filter-dd-btn').nth(i).click();const menu=p.locator('.filter-dd-panel');await menu.getByPlaceholder('搜索…').fill(value);await menu.getByRole('button',{name:value,exact:true}).click();
 }
 await p.locator('.og-row').getByRole('button',{name:'预约',exact:true}).first().click();
 const filteredModal=p.getByRole('dialog',{name:'预约 测试研讨间 1',exact:true});await filteredModal.waitFor();
 check((await filteredModal.innerText()).includes('09:00~10:30'),tag+' filtered room carries the full requested range');
 await filteredModal.getByRole('button',{name:'取消',exact:true}).click();
await p.close();results.push(tag+' 便笺保存与恢复、Segment、研讨间选时/确认');console.log(tag+' passed');
 }
 check(errors.length===0,'no runtime errors '+JSON.stringify(errors));writeFileSync(out+'report.json',JSON.stringify({checks,results,errors,roomRequests:'mocked; no real reservations sent'},null,2));console.log(checks+' checks passed');
}finally{await browser.close();}
