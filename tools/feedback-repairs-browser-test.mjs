import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
const base=process.env.ONETHU_TEST_URL??'http://127.0.0.1:5180';
const out='docs/onegui/feedback-repairs';mkdirSync(out,{recursive:true});
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const results=[],errors=[];
const check=(ok,label)=>{assert.ok(ok,label);results.push(label);console.log('✓ '+label)};
const call=async(p,path,name,args=[])=>p.evaluate(async({path,name,args})=>{const u=performance.getEntriesByType('resource').map(x=>x.name).find(x=>new URL(x).pathname.endsWith(path));if(!u)throw Error('Module not loaded: '+path);return (await import(u))[name](...args)},{path,name,args});
const newPage=async(width=1280,height=900)=>{const p=await b.newPage({viewport:{width,height},hasTouch:width<600,isMobile:width<600});p.setDefaultTimeout(8000);p.on('pageerror',e=>{/* 浏览器预览没有 Tauri 桥：读取 invoke 的异常是预览环境噪声，真机上不存在 */if(!/reading 'invoke'/.test(e.message))errors.push(e.message)});await p.addInitScript(()=>{performance.setResourceTimingBufferSize(10000);localStorage.setItem('onethu.onboarded.phone','1')});return p};
const go=async(p,q='home')=>{await p.goto(base+'/?explorer-preview='+q);await p.waitForSelector('.explorer-shell');await p.waitForTimeout(700)};
const rect=async(p,s)=>p.locator(s).first().boundingBox();
try {
const p=await newPage();await go(p);
let top=await rect(p,'.explorer-topbar'),oh=await rect(p,'.ex-bbar'),book=await rect(p,'.onego-bookmarks');
check(top.y+top.height<=oh.y&&oh.y+oh.height<=book.y,'横标签、OH 和收藏栏互不覆盖');
await p.locator('.ex-tab-add').click();await p.waitForTimeout(200);
check(await p.locator('.explorer-topbar .ex-tab').count()===2,'+ 新建独立首页标签');
check(await p.locator('.explorer-panel:visible .home-free').count()===1,'新首页显示完整画布');
await p.reload();await p.waitForTimeout(700);check(await p.locator('.explorer-topbar .ex-tab').count()===2,'新首页刷新后保留');
await p.screenshot({path:out+'/desktop-home.png'});
await call(p,'/src/state/tabLayout.ts','setTabLayoutMode',['v']);await p.waitForTimeout(200);
let rail=await rect(p,'.ex-rail');book=await rect(p,'.onego-bookmarks');check(rail.x+rail.width<=book.x+1,'完整竖栏不盖 OneGO');
await p.locator('.ex-rail-width').click();await p.mouse.move(900,400);await p.waitForTimeout(250);
let action=await rect(p,'.ex-rail-actions'),glyph=await rect(p,'.ex-rail .ex-tab-glyph');
await p.locator('.ex-rail-actions').hover();await p.waitForTimeout(250);
let actionHover=await rect(p,'.ex-rail-actions'),glyphHover=await rect(p,'.ex-rail .ex-tab-glyph');
check(Math.abs(action.y-actionHover.y)<1&&Math.abs(action.x-actionHover.x)<1,'侧栏底部按钮悬停后原位不动');
check(Math.abs(glyph.x-glyphHover.x)<1&&Math.abs(glyph.width-glyphHover.width)<1,'侧栏图标展开前后尺寸和位置一致');
for(let i=0;i<30;i++)await call(p,'/src/state/explorer.ts','openTab',['schedule',null,{forceNew:true}]);await p.waitForTimeout(300);
action=await rect(p,'.ex-rail-actions');check(action.y+action.height<=900,'30 个标签时底部动作仍在屏内');
await p.screenshot({path:out+'/vertical-rail.png'});
await go(p,'page&page=contacts');
await call(p,'/src/state/nameCard.ts','addContact',['personal',{name:'反馈测试',bio:'名片删除确认测试',avatar:'',website:'',social:'',phone:'',updatedAt:Date.now()},'']);
await p.getByRole('button',{name:'打开反馈测试的名片'}).click();await p.getByRole('button',{name:'删除',exact:true}).last().click();
const confirmation=p.locator('.shared-confirm-modal');await confirmation.waitFor();
check(await confirmation.isVisible(),'名片删除确认显示');
check(await confirmation.evaluate(e=>{let r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}),'删除确认在名片详情之上');
await confirmation.getByRole('button',{name:'取消',exact:true}).click();await confirmation.waitFor({state:'hidden'});check(await p.getByRole('dialog').isVisible(),'取消删除保留名片详情');await p.keyboard.press('Escape');
await go(p,'settings-tab&settings-tab=通知与提醒');
check(await p.locator('.settings-panel').getByText('我的组织',{exact:true}).count()===0,'设置不再重复显示我的组织');
await go(p,'search-oh');await p.getByRole('textbox',{name:'搜索或问小OH'}).waitFor({state:'visible'});
check(await p.getByRole('textbox',{name:'搜索或问小OH'}).isVisible(),'OH 输入在底栏胶囊里（用户 2026-10-19 拍板删掉面板内第二个输入框）');
check(await p.locator('.dock-panel .dock-composer').count()===0,'OH 面板内不再有独立输入框');
await p.getByRole('textbox',{name:'搜索或问小OH'}).fill('回归草稿，不发送');
check(await p.locator('.ohx-input input').inputValue()==='回归草稿，不发送','胶囊是唯一输入口，草稿直接进胶囊');
await p.screenshot({path:out+'/oh-composer.png'});
// Mount actual shared controls in an isolated fixture within the same CSS environment.
await go(p);

await p.evaluate(async()=>{
 const urls=performance.getEntriesByType('resource').map(x=>x.name);
 const url=end=>urls.find(x=>new URL(x).pathname.endsWith(end));
 const React=(await import(url('/deps/react.js'))).default;const {createRoot}=(await import(url('/deps/react-dom_client.js'))).default;
 const gui=await import(url('/packages/gui/src/index.ts'));
 const Layout=await import(url('/src/components/Layout.tsx'));
 const host=document.createElement('div');host.id='feedback-fixture';Object.assign(host.style,{position:'fixed',left:'280px',top:'200px',width:'240px',zIndex:'14000',background:'var(--og-canvas)',padding:'10px'});document.body.append(host);
 const h=React.createElement;
 function Demo(){const [v,set]=React.useState('0');return h(React.Fragment,null,
 h(gui.Segment,{options:Array.from({length:12},(_,i)=>({value:String(i),label:'选项 '+i})),value:v,onChange:set,block:true}),
 h(Layout.SegmentedOverflow,{ariaLabel:'旧分段栏'},Array.from({length:12},(_,i)=>h('button',{key:i,className:i===+v?'is-active':'',onClick:()=>set(String(i))},'分段 '+i))),
 h(gui.Surface,{pad:'lg'},'有内边距的消息气泡'),h(gui.Btn,null,'返回 · 下载与存储'))}
 createRoot(host).render(h(Demo));
});
await p.waitForTimeout(400);
for(const [track,scroll] of [['.og-segment-scroll','.og-segment'],['.seg-indi','.seg-track']]){
 check(await p.locator('#feedback-fixture '+track).isVisible(),track+' 溢出指示条可见');
 const t=await rect(p,'#feedback-fixture '+track);await p.mouse.move(t.x+15,t.y+t.height/2);await p.mouse.down();await p.mouse.move(t.x+t.width-10,t.y+t.height/2,{steps:12});await p.mouse.up();
 check(await p.locator('#feedback-fixture '+scroll).evaluate(e=>e.scrollLeft>100),track+' 真实鼠标拖动滚动选项');
}
check(await p.locator('#feedback-fixture .og-surface').evaluate(e=>parseFloat(getComputedStyle(e).padding)>0),'Surface 内边距实际应用');
check(await p.locator('#feedback-fixture .og-btn-label').evaluate(e=>parseFloat(getComputedStyle(e).lineHeight)>parseFloat(getComputedStyle(e).fontSize)),'按钮中文上下沿有足够行高');
// 胶囊几何统一：旧 .chip 与状态签 .task-tag 并排等高
await p.evaluate(()=>{const h=document.createElement('div');h.id='pill-fixture';h.style.cssText='position:fixed;left:280px;top:520px;z-index:14000;display:flex;gap:6px;background:var(--og-canvas);padding:8px';h.innerHTML='<span class="chip">雨课堂</span><span class="task-tag">未交 2</span>';document.body.append(h)});
await p.waitForTimeout(150);
const pill=await p.evaluate(()=>{const [a,c]=document.querySelectorAll('#pill-fixture > *');return {chip:a.getBoundingClientRect().height,tag:c.getBoundingClientRect().height,chipR:getComputedStyle(a).borderRadius,tagR:getComputedStyle(c).borderRadius}});
check(Math.abs(pill.chip-pill.tag)<1&&pill.chipR===pill.tagR,'状态胶囊与 chip 同高同圆角（'+Math.round(pill.chip)+'/'+Math.round(pill.tag)+'）');
// #10 Segment 选中态：胶囊指示器落位 + 选中文字不与轨道底色重合
const seg=await p.evaluate(()=>{const g=document.querySelector('#feedback-fixture .og-segment');if(!g)return null;
 const ind=g.querySelector('.og-segment-indicator');const act=g.querySelector('.is-active,[aria-checked=true],[aria-selected=true]');
 const hex=v=>(v||'').match(/[\d.]+/g)?.slice(0,3).map(Number);const L=a=>a?(0.2126*a[0]+0.7152*a[1]+0.0722*a[2])/255:0;
 const gr=g.getBoundingClientRect(),ir=ind?ind.getBoundingClientRect():null;
 return {gw:Math.round(gr.width),indW:ir?Math.round(ir.width):0,indH:ir?Math.round(ir.height):0,
  ink:L(hex(act?getComputedStyle(act).color:'')),fill:L(hex(getComputedStyle(g).backgroundColor)),
  indBg:ind?getComputedStyle(ind).backgroundColor:null,
  indBgLum:L(hex(ind?getComputedStyle(ind).backgroundColor:''))}});
check(!!seg&&seg.gw>0&&seg.indW>0&&seg.indH>0,'Segment 胶囊指示器可见且按选中项落位（'+seg?.indW+'×'+seg?.indH+'）');
/* 选中项坐在胶囊上：要比的是「字 vs 胶囊底」，不是「字 vs 轨道底」 */
check(!!seg&&Math.abs(seg.ink-seg.indBgLum)>0.2,'Segment 选中文字与胶囊底色不重合（亮度 '+seg?.ink?.toFixed(2)+' vs '+seg?.indBgLum?.toFixed(2)+'）');
await p.screenshot({path:out+'/segments.png'});
await p.close();

// ── 逐项复核：Codex 阶段只做了共享原语、未回写到能断言的项，全部补行为断言 ──
// #3 登录按钮：<Btn type=submit> 必须在 form 里真正提交（旧实现在按钮上 onClick，点不动）
const lg=await newPage();await lg.goto(base+'/');await lg.waitForTimeout(2000);
await lg.evaluate(()=>{window.__sub=0;document.querySelector('form')?.addEventListener('submit',()=>{window.__sub++},true)});
const loginBtn=lg.locator('button[type=submit]');check(await loginBtn.count()===1,'登录按钮是表单提交钮');
await lg.locator('#username').fill('2024000001');await lg.locator('#password').fill('pw');await loginBtn.click();await lg.waitForTimeout(600);
check(await lg.evaluate(()=>window.__sub)===1,'登录按钮点击真的提交表单');
await lg.close();

// #6 输入焦点环：壳层负责，原生 input 内层不许再画一圈
const fp=await newPage();await go(fp,'settings-tab&settings-tab=通知与提醒');await fp.waitForTimeout(900);
const ring=await fp.locator('.og-input-el').first().evaluate(e=>{const inner=getComputedStyle(e);return {shadow:inner.boxShadow,outline:inner.outlineStyle}});
check(ring.shadow==='none'&&ring.outline==='none','输入框内层无焦点环（'+ring.outline+'/'+ring.shadow+'）');
await fp.close();

// #17 折叠列表：展开、收起两个方向都得有过渡（收起时不能瞬间消失）
const ap=await newPage();await go(ap,'settings-tab&settings-tab=数据与同步');await ap.waitForTimeout(1600);
const head=ap.locator('.og-accordion-head:visible').first();const bodyEl=ap.locator('.og-accordion-body').first();
/* 采样过渡中间态：逐 20ms 读高度，取「既不是 0 也不是终值」的最大样本（动画可能晚一帧起步） */
const sample=async()=>{const seen=[];for(let i=0;i<14;i++){seen.push(await bodyEl.evaluate(e=>e.getBoundingClientRect().height));await ap.waitForTimeout(20)}return seen};
await head.click();const openSamples=await sample();const fullOpen=Math.max(...openSamples);
const midOpen=Math.max(...openSamples.filter(h=>h>0&&h<fullOpen-1));
await ap.waitForTimeout(500);
await head.click();const closeSamples=await sample();const closedH=Math.min(...closeSamples);
const midClose=Math.max(...closeSamples.filter(h=>h>0.5&&h<fullOpen-1));
check(fullOpen>10,'折叠展开后内容有实际高度（'+Math.round(fullOpen)+'）');
check(midOpen>0,'折叠展开有过渡（中间态 '+Math.round(midOpen)+'）');
check(midClose>0,'折叠收起也有过渡（中间态 '+Math.round(midClose)+'）');
check(closedH<5,'折叠收起后高度归零（'+closedH.toFixed(1)+'）');
await ap.close();

// #18 玻璃皮肤：浮层真的带 backdrop-filter（不是只有半透明）
const gp=await b.newPage({viewport:{width:1280,height:900}});gp.setDefaultTimeout(8000);
await gp.addInitScript(()=>{localStorage.setItem('onethu.onboarded.phone','1');localStorage.setItem('onethu.glass.level','rich')});
await gp.goto(base+'/?explorer-preview=settings-tab&settings-tab=通知与提醒');await gp.waitForTimeout(1900);
const glass=await gp.evaluate(()=>{const m=document.querySelector('.settings-mask'),pn=document.querySelector('.settings-panel');
 return {skin:document.documentElement.dataset.ogSkin,mask:m?getComputedStyle(m).backdropFilter:'',panel:pn?getComputedStyle(pn).backdropFilter:'',fill:m?getComputedStyle(m).animationFillMode:''}});
check(glass.skin==='glass'&&/blur\(/.test(glass.mask)&&/blur\(/.test(glass.panel),'玻璃皮肤下遮罩与面板都有模糊（'+glass.mask+'）');
check(glass.fill==='backwards','遮罩入场动画不留下永久 backdrop root');
await gp.screenshot({path:out+'/glass-blur.png'});await gp.close();

// #23 深色壁纸：前景字自动转亮（OnePage 壁纸同理走同一条采样链）
const wp=await b.newPage({viewport:{width:1280,height:900}});wp.setDefaultTimeout(8000);
await wp.addInitScript(()=>{localStorage.setItem('onethu.onboarded.phone','1');localStorage.setItem('onethu.wallpaper.v1',JSON.stringify({v:2,global:'builtin:ink',library:[],videoSound:false}))});
await wp.goto(base+'/?explorer-preview=home');await wp.waitForTimeout(1900);
const ink=await wp.evaluate(()=>{const root=document.querySelector('.explorer-shell')||document.documentElement;const t=document.querySelector('.workbench-board-head .og-text--title')||document.querySelector('.workbench-board-head h1')||document.querySelector('.free-item[data-widget=text] .wg-title');const hero=document.querySelector('.free-item[data-widget=text] .wg-title');
 const rgb=s=>{const m=(s||'').match(/[\d.]+/g);return m?m.slice(0,3).map(Number):null};
 const lum=a=>{if(!a)return 0;return (0.2126*a[0]+0.7152*a[1]+0.0722*a[2])/255};
 return {lum:root.dataset.wallpaperLum,headLum:lum(rgb(t?getComputedStyle(t).color:'')),heroLum:lum(rgb(hero?getComputedStyle(hero).color:''))}});
check(ink.lum==='dark','深色壁纸给壳层打上 data-wallpaper-lum=dark');
check(ink.headLum>0.85&&ink.heroLum>0.85,'深色壁纸上前景标题转亮（'+ink.headLum.toFixed(2)+' / '+ink.heroLum.toFixed(2)+'）');
await wp.screenshot({path:out+'/wallpaper-ink.png'});await wp.close();

// #24 拖动期间画布边界实时跟随（放手才变的旧行为会在拖到一半腰斩组件）
const dp=await newPage();await go(dp);await dp.waitForTimeout(700);
const startRect=await dp.locator('.free-item').first().boundingBox();
await dp.mouse.click(startRect.x+40,startRect.y+40);await dp.waitForTimeout(350);
const beforeMin=await dp.evaluate(()=>document.querySelector('.freeboard').style.minWidth);
const handle=await dp.locator('.fh-e').boundingBox();
await dp.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await dp.mouse.down();
await dp.mouse.move(handle.x+handle.width/2+1200,handle.y+handle.height/2,{steps:16});await dp.waitForTimeout(200);
const duringMin=await dp.evaluate(()=>document.querySelector('.freeboard').style.minWidth);
await dp.mouse.up();await dp.waitForTimeout(200);
check(parseInt(duringMin)>parseInt(beforeMin),'拖动改尺寸时画布边界实时跟随（'+beforeMin+'→'+duringMin+'）');
await dp.close();

// #19 首页组件卡溢出时可滚但不出滚动条
const sp=await newPage();await go(sp);await sp.waitForTimeout(900);
const silent=await sp.evaluate(()=>{const els=[...document.querySelectorAll('.free-item > .wg-card, .free-item .wg-card > *:not(.wg-entry)')].slice(0,6);
 return {n:els.length,all:els.every(e=>getComputedStyle(e).scrollbarWidth==='none'),values:[...new Set(els.map(e=>getComputedStyle(e).scrollbarWidth))]}});
check(silent.n>0&&silent.all,'首页组件卡静默滚动（scrollbar-width: '+silent.values.join(',')+'）');
await sp.close();

// #8 预设布局可一键复位（用户自定义布局永远不被自动重置）
const rl=await newPage();await go(rl,'settings-tab&settings-tab=外观与布局');await rl.waitForTimeout(1200);
check(await rl.locator('.settings-panel').getByText('恢复默认首页布局',{exact:true}).count()===1,'设置提供「恢复默认首页布局」，不自动改用户布局');
await rl.close();

// #21 页头标题回到 title 档（原来是 display 档，作业详情里比正文大出两级）
const ty=await newPage();await go(ty,'page&page=tasks');await ty.waitForTimeout(1200);
const fs=await ty.locator('.og-pagehead .og-text--title').first().evaluate(e=>({size:parseFloat(getComputedStyle(e).fontSize),slot:e.className}));
check(fs.size<=26&&/og-text--title/.test(fs.slot),'页头标题用 title 档（'+fs.size+'px）');
await ty.close();

// #11 暂存箱浮在内容之上，不占一行高度（内容顶 = 三条栏底）
const vp=await newPage();await go(vp,'page&page=tasks');await vp.waitForTimeout(900);
const vault=await vp.evaluate(()=>{const a=document.querySelector('.vault-anchor,.vault-desktop-anchor');const top=document.querySelector('.explorer-topbar').getBoundingClientRect();const bar=document.querySelector('.ex-bbar').getBoundingClientRect();const book=document.querySelector('.onego-bookmarks').getBoundingClientRect();
 const h=document.querySelector('.og-pagehead')||document.querySelector('.og-page');
 return {pos:a?getComputedStyle(a).position:null,chromeBottom:book.bottom||bar.bottom||top.bottom,contentTop:h?h.getBoundingClientRect().top:0}});
check(vault.pos==='fixed','暂存箱锚点是浮层（position:'+vault.pos+'）');
check(vault.contentTop>=vault.chromeBottom-1,'内容从栏底开始、不被暂存箱再挤一行（'+Math.round(vault.contentTop)+'≥'+Math.round(vault.chromeBottom)+'）');
await vp.close();

// #2 白板工具栏：按钮带文字，不是纯图标（用户"意义不明"）
const tb=await newPage();await go(tb);await tb.waitForTimeout(900);
const tools=await tb.locator('.board-viewport-tools .og-btn').evaluateAll(els=>els.map(e=>({t:e.textContent.trim(),w:Math.round(e.getBoundingClientRect().width)})));
check(tools.length>=2&&tools.some(t=>t.t==='组件')&&tools.some(t=>t.t==='画笔'),'白板工具栏按钮带中文标签（'+tools.map(t=>t.t).join('/')+'）');
await tb.close();

// #9 卡片点击区：入口卡的按钮撑满整卡（旧实现只有内侧 div 可点）
const ca=await newPage();await go(ca,'page&page=learn');await ca.waitForTimeout(1500);
const hit=await ca.evaluate(()=>{const card=[...document.querySelectorAll('.stat-card.og-card--flush, .course-card.og-card--flush')].find(e=>e.getBoundingClientRect().width>0);if(!card)return null;
 const btn=card.querySelector('button');if(!btn)return null;
 const c=card.getBoundingClientRect(),b=btn.getBoundingClientRect();
 const probe=(x,y)=>{const el=document.elementFromPoint(x,y);return {inBtn:!!btn.contains(el),tag:el?el.className.toString().slice(0,24):null}};
 return {cardW:Math.round(c.width),btnW:Math.round(b.width),cardH:Math.round(c.height),btnH:Math.round(b.height),
   rightEdge:probe(c.right-4,c.top+c.height/2),bottomEdge:probe(c.left+c.width/2,c.bottom-4)}});
check(!!hit&&hit.btnW>=hit.cardW-2&&hit.btnH>=hit.cardH-2,'卡片入口按钮撑满整卡（'+hit?.btnW+'/'+hit?.cardW+'）');
check(!!hit&&hit.rightEdge.inBtn&&hit.bottomEdge.inBtn,'卡片右边与下边的空白区也在点击范围内（'+hit?.rightEdge.tag+' / '+hit?.bottomEdge.tag+'）');
await ca.close();

// #15 页标题与内容之间留有间隔
const gp2=await newPage();await go(gp2,'page&page=info');await gp2.waitForTimeout(1200);
/* 页头与下方内容的间隔由 .og-pagehead 的下外边距统一给（页面差异不许各写一套） */
const gap=await gp2.evaluate(()=>{const hs=[...document.querySelectorAll('.og-pagehead')].map(e=>parseFloat(getComputedStyle(e).marginBottom)).filter(v=>v>0);
 return hs.length?Math.max(...hs):null});
check(gap!==null&&gap>=16,'页标题与下方内容有统一间距（margin-bottom '+gap+'px）');
await gp2.close();

// #22 OnePage 右键：菜单与「添加组件」抽屉不许同时打开
const cm=await newPage();await go(cm);await cm.waitForTimeout(900);
const board=await cm.locator('.freeboard').boundingBox();
await cm.mouse.click(board.x+40,board.y+40,{button:'right'});await cm.waitForTimeout(400);
const both=await cm.evaluate(()=>({menu:!!document.querySelector('.explorer-ctxmenu,.ex-ctxmenu,.og-menu'),add:[...document.querySelectorAll('.ex-sheet,.og-modal-panel,.free-add-panel')].some(e=>e.getBoundingClientRect().height>0)}));
check(!(both.menu&&both.add),'右键不会同时弹出菜单与添加抽屉（菜单 '+(both.menu?'开':'关')+' / 抽屉 '+(both.add?'开':'关')+'）');
await cm.keyboard.press('Escape');await cm.close();

// #25 组件背景材质统一：一张卡只有最外层一种材质（内层不许再叠不透明底）
const mt=await newPage();await go(mt);await mt.waitForTimeout(900);
const mats=await mt.evaluate(()=>{const items=[...document.querySelectorAll('.free-item')].slice(0,7);
 const inner=items.map(it=>{const card=it.querySelector('.wg-card,.og-card,.home-card');if(!card)return null;
  const cs=getComputedStyle(card);return {bg:cs.backgroundColor,img:cs.backgroundImage}}).filter(Boolean);
 return {n:items.length,nestedSolid:inner.filter(x=>x.bg!=='rgba(0, 0, 0, 0)').length,total:inner.length}});
check(mats.n>0&&mats.nestedSolid===0,'组件卡内层不再叠第二层底（'+(mats.total-mats.nestedSolid)+'/'+mats.total+' 透明）');
await mt.close();

// #30 免费模型报错分流：免费档失败必须说「免费档/校园网/自费」，不能把人误导成「未配置 API Key」
const mp=await newPage();await go(mp);await mp.waitForTimeout(900);
const mad=await mp.evaluate(async()=>{const urls=performance.getEntriesByType('resource').map(x=>x.name);const url=e=>urls.find(x=>new URL(x).pathname.endsWith(e));
 const mm=await import(url('/src/state/madmodel.ts'));const hint=await mm.preflightMadModel();
 return {active:mm.madmodelActive(),hint:String(hint??'')}});
check(mad.active===true,'默认走清华免费档语义（madmodelActive）');
check(/清华免费档（MadModel）/.test(mad.hint)&&/校园网|自费 API/.test(mad.hint),'免费档失败的报错给真实原因而非「未配置 API Key」');
await mp.close();

// 手机档：硬刷新钮不得压在白板工具栏上（工具栏带文字后变宽，旧位置会重叠）
for(const width of [390,320]){const m=await newPage(width,844);await go(m);check(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'手机 '+width+' 无横向溢出');
 const sh=await rect(m,'.oneshot'),tool=await rect(m,'.board-viewport-tools'),fab=await rect(m,'.hard-refresh-fab');
 check(tool.y+tool.height<=sh.y||tool.x>=sh.x+sh.width,'手机 '+width+' 白板工具避让 OneShot');
 check(fab.y+fab.height<=tool.y||fab.x+fab.width<=tool.x||fab.x>=tool.x+tool.width,'手机 '+width+' 硬刷新钮不压白板工具');
 await m.screenshot({path:out+'/home-'+width+'.png'});await m.close()}
check(errors.length===0,'无浏览器运行时异常 '+errors.join(';'));
}finally{writeFileSync(out+'/report.json',JSON.stringify({checks:results.length,results,errors},null,2));await b.close()}
