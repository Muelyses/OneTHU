/** Theme/material and editable home regression. Vite must run on 5180. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.argv[2]??'http://127.0.0.1:5180', out='docs/onegui/usability-repair';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let checks=0;const errors=[],results=[];const check=(c,m)=>{assert.ok(c,m);checks++;console.log('✓ '+m);};
const fixture={semester:{id:'2026-2027-1'},courses:[{id:'c1',name:'数据结构'},{id:'c2',name:'计算机系统'}],homework:Array.from({length:4},(_,i)=>({id:'hw'+i,courseId:i%2?'c2':'c1',title:['图与最短路径','缓存与存储层次','平衡树练习','系统实验报告'][i],deadline:`2026-10-${19+i} 23:59:00`,submitted:false,graded:false,audited:false})),notifications:[],files:[],schedule:[]};
const setup=async(p)=>{
 p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>localStorage.setItem('onethu.onboarded.phone','1'));
 await p.route('**/src/state/data.ts*',async route=>{const response=await route.fetch();let body=await response.text();for(const name of ['useLearnData','useCampusData'])body=body.replace(`export function ${name}() {`,`export function ${name}() { return {data:${JSON.stringify(fixture)},state:'ready',error:null,reload:async()=>{}};`);await route.fulfill({response,body});});
};
// Use Vite's actual module URL (including its HMR version). A second unversioned
// import creates a separate store, which cannot validate the mounted application.
const call=async(p,path,name,args=[])=>p.evaluate(async({path,name,args})=>{const url=performance.getEntriesByType('resource').map(r=>r.name).find(u=>new URL(u).pathname.endsWith(path));if(!url)throw Error('module not mounted '+path);const m=await import(url);return m[name](...args);},{path,name,args});
const go=async(p,q)=>{await p.goto(`${base}/?explorer-preview=${q}`,{waitUntil:'domcontentloaded'});await p.waitForSelector('.explorer-shell');await p.waitForTimeout(900);};
const board=async p=>p.evaluate(()=>JSON.parse(localStorage.getItem('onethu.board.v1')).boards.find(b=>b.id==='board.today').cells.portrait);

const drag=async(p,el,dx,dy)=>{await el.scrollIntoViewIfNeeded();const r=await el.boundingBox();await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.mouse.move(r.x+r.width/2+dx,r.y+r.height/2+dy,{steps:10});await p.mouse.up();await p.waitForTimeout(120);};
try {
 const p=await browser.newPage({viewport:{width:1280,height:840}});p.setDefaultTimeout(12000);await setup(p);await go(p,'home');
 check(await p.getByRole('heading',{name:'首页',exact:true}).count()===1,'home title');
 check(!(await p.evaluate(()=>document.body.innerText.includes('编辑布局')))&&await p.locator('.free-drag-handle').count()===0,'edit-layout mode removed');
 const tools=p.locator('.board-viewport-tools');check(await tools.getByRole('button',{name:'100%',exact:true}).count()===1,'100% default');
 const fits=()=>p.locator('.free-item').evaluateAll(es=>es.every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}));
 check(await fits(),'100% fits all authored cards');
 const clock=p.locator('[data-item-id="home.clock"]');const old=(await board(p)).find(i=>i.id==='home.clock').rect;
 await drag(p,clock.locator('.chrome-clock-time'),60,35);
 const moved=(await board(p)).find(i=>i.id==='home.clock').rect;check(moved.x>old.x&&moved.y>old.y,'direct drag without edit');
 await drag(p,clock.locator('.fh-se'),45,35);const resized=(await board(p)).find(i=>i.id==='home.clock').rect;check(resized.w>moved.w&&resized.h>moved.h,'direct selected corner resize');
 await p.reload();await p.waitForTimeout(800);check((await board(p)).find(i=>i.id==='home.clock').rect.w===resized.w,'resize persists');
 // Selection chrome must release on any click outside the card, not only in edit mode.
 await clock.locator('.chrome-clock-time').click();await p.waitForTimeout(120);
 check(await p.locator('.free-item.is-selected').count()===1&&await p.locator('.free-handle').count()===6,'selecting a card shows resize handles');
 await p.locator('.workbench-board-head h2').click();await p.waitForTimeout(120);
 check(await p.locator('.free-item.is-selected').count()===0&&await p.locator('.free-handle').count()===0,'outside click releases selection');
 await clock.locator('.chrome-clock-time').click();await p.waitForTimeout(120);
 const blank=await p.evaluate(()=>{const fb=document.querySelector('.freeboard');if(!fb)return null;const r=fb.getBoundingClientRect();const y0=Math.min(r.bottom-24,innerHeight-24),y1=Math.max(r.top+24,24);for(let y=y0;y>y1;y-=24)for(let x=r.left+24;x<r.right-24;x+=48){const el=document.elementFromPoint(x,y);if(el&&fb.contains(el)&&!el.closest('.free-item'))return{x,y};}return null;});
 if(blank)await p.mouse.click(blank.x,blank.y);await p.waitForTimeout(120);
 check(await p.locator('.free-handle').count()===0,'blank canvas releases selection');
 // Right-click blank and the + button must open one shared picker (thumbnails + search).
 await p.mouse.click(blank.x,blank.y,{button:'right'});await p.waitForSelector('.add-drawer[data-add-drawer]');
 const drawer=p.locator('.add-drawer');const pickerSearch=drawer.getByPlaceholder('搜索组件');
 const optionCount=await drawer.locator('.add-grid .add-card').count();
 check(await pickerSearch.count()===1,'right-click blank opens unified picker with search');
 check((await drawer.locator('.add-section-title').allInnerTexts()).join('|')==='常用|OnePage 与组合|全部组件','picker keeps all sections');
 check((await drawer.locator('[data-add-section="quick"] .add-card-name').first().innerText())==='便笺','note stays first in quick section');
 check(await drawer.locator('[data-add-section="onepage"]').count()===1,'onePage and folder section kept');
 await pickerSearch.fill('分隔线');await p.waitForTimeout(150);
 check(await drawer.locator('.add-grid .add-card').count()===1&&await drawer.locator('[data-widget-option]').count()===1,'picker search filters widgets');
 const cardsBefore=await p.locator('.free-item').count();
 await drawer.locator('.add-grid .add-card').first().click();await p.waitForTimeout(150);
 await drawer.locator('[data-add-confirm]').click();await p.waitForTimeout(350);
 check(await p.locator('.free-item').count()===cardsBefore+1,'picker adds the chosen widget');
 await p.locator('.board-viewport-tools').getByRole('button',{name:'组件',exact:true}).click();await p.waitForSelector('.add-drawer[data-add-drawer]');await p.waitForTimeout(500);
 check(await p.locator('.add-drawer').getByPlaceholder('搜索组件').count()===1&&await p.locator('.add-drawer').locator('.add-grid .add-card').count()===optionCount,'plus button opens the same picker');
 const drawerEl=p.locator('.add-drawer');const h0=await drawerEl.evaluate(e=>e.getBoundingClientRect().height);
 const grip=await p.locator('.add-drawer-grip').boundingBox();
 await p.mouse.move(grip.x+grip.width/2,grip.y+4);await p.mouse.down();await p.mouse.move(grip.x+grip.width/2,grip.y-160,{steps:10});await p.mouse.up();await p.waitForTimeout(200);
 const h1=await drawerEl.evaluate(e=>({h:e.getBoundingClientRect().height,tall:e.classList.contains('is-tall')}));
 check(h1.h>h0+40&&h1.tall,'drawer grip expands the sheet');
 await p.screenshot({path:`${out}/add-picker.png`});
 await p.locator('.add-drawer').getByRole('button',{name:'关闭'}).click();await p.waitForTimeout(250);
 // Pen palette: three ink colors + undo/clear, floating above the tool bar.
 await tools.getByRole('button',{name:'画笔',exact:true}).click();await p.waitForTimeout(250);
 check(await p.locator('.free-pen-panel .board-pen-swatch').count()===3,'pen palette has three ink colors');
 await p.locator('.free-pen-panel .board-pen-swatch').nth(1).click();await p.waitForTimeout(100);
 check(await p.locator('.free-pen-panel .board-pen-swatch').nth(1).getAttribute('aria-pressed')==='true','pen palette selects ink color');
 await p.screenshot({path:`${out}/pen-palette.png`});
 await tools.getByRole('button',{name:'画笔',exact:true}).click();await p.waitForTimeout(150);
 // A note must exist before the wallpaper/glass section to prove its paper follows the material.
 await p.mouse.dblclick(blank.x,blank.y);await p.waitForTimeout(300);
 const note=p.locator('.free-item.is-note');check(await note.count()===1,'double-click blank creates a note');
 const carousel=p.locator('.free-item[data-widget="homework"] .hw-carousel');await carousel.scrollIntoViewIfNeeded();const cr=await carousel.boundingBox();await p.mouse.move(cr.x+cr.width/2,cr.y+50);
 let scroll=await p.evaluate(()=>window.scrollY);await p.mouse.wheel(0,300);await p.waitForTimeout(300);console.log('SCROLL',scroll,await p.evaluate(()=>({window:scrollY,nodes:[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+10&&getComputedStyle(e).overflowY.match(/auto|scroll/)).map(e=>({cls:e.className,top:e.scrollTop,h:e.clientHeight,total:e.scrollHeight}))})));check(await p.evaluate(()=>window.scrollY)>scroll,'wheel over homework scrolls home down');
 scroll=await p.evaluate(()=>window.scrollY);await p.mouse.wheel(0,-250);await p.waitForTimeout(300);check(await p.evaluate(()=>window.scrollY)<scroll,'wheel scrolls home up');
 await p.evaluate(()=>window.scrollTo(0,0));await p.screenshot({path:`${out}/home.png`});
 await go(p,'settings-tab&settings-tab=外观');check(!(await p.locator('body').innerText()).includes('想昼夜自动切换就打开上面的开关'),'settings sentence removed');
 await call(p,'/src/lib/glassLevel.ts','setGlassLevel',['clear']);await call(p,'/src/state/explorer.ts','closeSettings');
 const image=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=1280;c.height=840;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,1280,840);g.addColorStop(0,'#102c46');g.addColorStop(.45,'#6a90ad');g.addColorStop(.55,'#dca37d');g.addColorStop(1,'#faf0d5');x.fillStyle=g;x.fillRect(0,0,1280,840);return c.toDataURL();});
 await call(p,'/src/state/wallpaper.ts','setGlobalWallpaper',[image]);await p.waitForTimeout(1500);
 const material=await clock.evaluate(e=>({bg:getComputedStyle(e).backgroundColor,blur:getComputedStyle(e).backdropFilter}));check(material.bg.includes('0.3')&&material.blur.includes('blur')&&material.blur.includes('saturate'),'real clear material transmits 70% and blurs');
 const probe=await clock.locator('.chrome-clock-time').evaluate(e=>window.__txProbe(e));check(probe.kind==='image','contrast engine samples actual wallpaper');check(probe.layers.some(l=>Math.abs(l.a-.3)<.01),'contrast engine reads computed srgb alpha');
 // The 首页 title plate is a surface: it must use the same glass material as the topbar/cards.
 const plate=await p.locator('.workbench-board-head').evaluate(e=>{const c=getComputedStyle(e);return{bg:c.backgroundColor,blur:c.backdropFilter};});
 check(plate.bg.includes('0.3')&&plate.blur.includes('blur')&&plate.blur.includes('saturate'),'home title plate follows glass material');
 const noteGlass=await note.evaluate(e=>{const c=getComputedStyle(e);return{bg:c.backgroundColor,bf:c.backdropFilter,inner:getComputedStyle(e.querySelector('.free-note')).backgroundColor};});
 check(noteGlass.bg.includes('/ 0.3')&&noteGlass.bf.includes('blur')&&noteGlass.inner==='rgba(0, 0, 0, 0)','note paper follows glass material');
 await p.screenshot({path:`${out}/glass.png`});results.push({material,probe,plate});
 await go(p,'search');check(await p.locator('.dock-ops').getByRole('button',{name:'创造模式',exact:true}).count()===0,'search excludes creative');
 for(const [name,show] of [['OH',true],['清小搭',false],['搜索',false]]){await p.locator('.ohx-modeswitch').getByRole('tab',{name,exact:true}).click();check((await p.locator('.dock-ops').getByRole('button',{name:'创造模式',exact:true}).count()>0)===show,'creative only OH '+name);check((await p.locator('.dock-ops').getByRole('button',{name:'新会话',exact:true}).count()>0)===show,'session actions only OH '+name);}
 await p.locator('.dock-ops').getByRole('button',{name:'收起',exact:true}).click();const capsule=p.locator('.ohx-capsule');const cb=await capsule.boundingBox();await p.mouse.move(cb.x+30,cb.y+cb.height/2);await p.mouse.down();await p.waitForTimeout(180);check(await capsule.evaluate(e=>getComputedStyle(e).transform)!=='none','capsule press scales');await p.mouse.up();check(await capsule.evaluate(e=>getComputedStyle(e).animationName)==='og-capsule-rebound','capsule release rebounds');await p.waitForTimeout(400);
 await p.locator('.dock-ops').getByRole('button',{name:'收起',exact:true}).click();await capsule.focus();await p.keyboard.press('Enter');check(await capsule.evaluate(e=>getComputedStyle(e).animationName)==='og-capsule-rebound','keyboard bounce');
 // Tab glyphs follow 一级功能区 icons; OnePage tab shows its own name and icon.
 await p.evaluate(()=>{
   const key='onethu.board.v1';const doc=JSON.parse(localStorage.getItem(key));
   doc.boards=doc.boards.filter(b=>b.id!=='board.test');
   doc.boards.push({id:'board.test',name:'考研资料',icon:'book',kind:'user',cells:{portrait:[],landscape:[]}});
   doc.activeBoardId='board.test';localStorage.setItem(key,JSON.stringify(doc));
 });
 await call(p,'/src/state/onePage.ts','openOnePage',['board.test']);
 for(const page of ['tasks','mail','cloud','schedule','info','thubook','board'])await call(p,'/src/state/explorer.ts','openTab',[page,null,{}]);
 await p.waitForTimeout(500);
 const tabMap=await p.evaluate(()=>Object.fromEntries([...document.querySelectorAll('.ex-tab')].map(e=>[e.querySelector('.ex-tab-title')?.textContent,e.querySelector('.ex-tab-glyph')?.innerHTML])));
 check(tabMap['考研资料']!==undefined,'board tab shows the OnePage name');
 check(tabMap['考研资料']===tabMap['THUBook'],'board tab uses its OnePage icon');
 const infoTitle=Object.keys(tabMap).find((k)=>k.startsWith('信息'));
 check(tabMap['待办']!==tabMap['邮箱']&&tabMap['课表']!==tabMap['邮箱']&&!!infoTitle&&tabMap[infoTitle]!==tabMap['邮箱'],'page tabs use distinct nav icons');
 await p.screenshot({path:`${out}/tabs.png`});
 await p.close();
 for(const width of [900,390,320]){const m=await browser.newPage({viewport:{width,height:844},hasTouch:width<840,isMobile:width<840});await setup(m);await go(m,'home');const t=m.locator('.board-viewport-tools');check(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page width overflow '+width);
 if(width<840){check(await m.locator('.free-item').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().right<=innerWidth)),'stacked cards fit width '+width);const clockTime=m.locator('[data-item-id="home.clock"] .chrome-clock-time');await clockTime.scrollIntoViewIfNeeded();await clockTime.tap();await m.waitForTimeout(180);check(await m.locator('.free-item.is-selected').count()===1,'tap selects stacked card '+width);const old=(await board(m)).find(i=>i.id==='home.clock').rect;const toolbar=m.locator('.free-toolbar');await toolbar.getByRole('button',{name:'增高',exact:true}).click();await m.waitForTimeout(180);check((await board(m)).find(i=>i.id==='home.clock').rect.h>old.h,'phone toolbar resizes '+width);}
 await m.screenshot({path:`${out}/home-${width}.png`});await m.close();}
 check(errors.length===0,'no runtime errors '+errors.join(';'));writeFileSync(`${out}/report.json`,JSON.stringify({checks,results,errors},null,2));console.log(`${checks} usability browser assertions passed`);
}finally{await browser.close();}
