import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
const base=process.env.ONETHU_TEST_URL??'http://127.0.0.1:5180';
const out='docs/onegui/feedback-repairs';mkdirSync(out,{recursive:true});
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const results=[],errors=[];
const check=(ok,label)=>{assert.ok(ok,label);results.push(label);console.log('✓ '+label)};
const call=async(p,path,name,args=[])=>p.evaluate(async({path,name,args})=>{const u=performance.getEntriesByType('resource').map(x=>x.name).find(x=>new URL(x).pathname.endsWith(path));if(!u)throw Error('Module not loaded: '+path);return (await import(u))[name](...args)},{path,name,args});
const newPage=async(width=1280,height=900)=>{const p=await b.newPage({viewport:{width,height},hasTouch:width<600,isMobile:width<600});p.setDefaultTimeout(8000);p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>{performance.setResourceTimingBufferSize(10000);localStorage.setItem('onethu.onboarded.phone','1')});return p};
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
check(await p.locator('.confirm-mask').isVisible(),'名片删除确认显示');
check(await p.locator('.confirm-card').evaluate(e=>{let r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}),'删除确认在名片详情之上');
await p.locator('.confirm-mask').getByRole('button',{name:'取消',exact:true}).click();check(await p.getByRole('dialog').isVisible(),'取消删除保留名片详情');await p.keyboard.press('Escape');
await go(p,'settings-tab&settings-tab=通知与提醒');
check(await p.locator('.settings-panel').getByText('我的组织',{exact:true}).count()===0,'设置不再重复显示我的组织');
await go(p,'search-oh');await p.getByRole('textbox',{name:'给小OH发消息'}).waitFor({state:'visible'});
check(await p.getByRole('textbox',{name:'给小OH发消息'}).isVisible(),'OH 面板内有可见输入框');
await p.getByRole('textbox',{name:'给小OH发消息'}).fill('回归草稿，不发送');
check(await p.locator('.ohx-input input').inputValue()==='回归草稿，不发送','OH 面板和胶囊共享同一草稿');
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
await p.screenshot({path:out+'/segments.png'});
await p.close();
for(const width of [390,320]){const m=await newPage(width,844);await go(m);check(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'手机 '+width+' 无横向溢出');const sh=await rect(m,'.oneshot'),tool=await rect(m,'.board-viewport-tools');check(tool.y+tool.height<=sh.y||tool.x>=sh.x+sh.width,'手机 '+width+' 白板工具避让 OneShot');await m.screenshot({path:out+'/home-'+width+'.png'});await m.close()}
check(errors.length===0,'无浏览器运行时异常 '+errors.join(';'));
}finally{writeFileSync(out+'/report.json',JSON.stringify({checks:results.length,results,errors},null,2));await b.close()}
