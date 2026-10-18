/**
 * 日程 · 全宽周时间表验收（2026-10-18 用户口径）
 *
 * 用户要求：时间轴完全以周为单位、铺满中间全部内容、不要大标题、只留少量筛选控件；
 * 作业「前往」开新作业标签、课程「前往/寻迹」都开新标签。
 *
 * 数据：用 route 拦截 Vite 客户端模块注入课程夹具，不触网、不写产品数据。
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.argv[2]??'http://127.0.0.1:5180',out='docs/onegui/navigation-rebuild';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let checks=0;const errors=[];const check=(c,m)=>{assert.ok(c,m);checks++;console.log('✓ '+m);};
const fixture={semester:{id:'x'},courses:[],homework:[],notifications:[],files:[],schedule:[
 {courseName:'数据结构',dayOfWeek:1,startTime:'10:00',endTime:'11:30',location:'六教 6A205',teacher:'张老师'},
 {courseName:'计算机网络',dayOfWeek:3,startTime:'14:00',endTime:'15:30',location:'三教 3200',teacher:'王老师'},
 {courseName:'数据结构',dayOfWeek:5,startTime:'09:00',endTime:'10:30',location:'六教 6A205',teacher:'张老师'},
]};
const setup=async p=>{
 p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{performance.setResourceTimingBufferSize(10000);localStorage.setItem('onethu.onboarded.phone','1')});
 await p.route('**/src/state/data.ts*',async r=>{const res=await r.fetch();let b=await res.text();
  for(const n of ['useLearnData','useCampusData'])b=b.replace(`export function ${n}() {`,`export function ${n}() {return {data:${JSON.stringify(fixture)},state:'ready',error:null,reload:async()=>{}};`);
  await r.fulfill({response:res,body:b});});
};
const go=async(p,vpName)=>{await p.goto(base+'/?explorer-preview=page&page=schedule',{waitUntil:'domcontentloaded'});await p.waitForSelector('.explorer-shell');await p.waitForTimeout(1600);};
try{
 const p=await browser.newPage({viewport:{width:1280,height:860}});await setup(p);await go(p);
 check(await p.locator('.schedule-day-cell').count()===7,'desktop week has seven day columns');
 const cells=await p.locator('.schedule-day-cell').allInnerTexts();
 check(cells.join(' ').includes('周一')&&cells.join(' ').includes('周日'),'week semantics (Mon–Sun), no day mode');
 check(await p.getByRole('heading',{name:'日程',exact:true}).count()===0,'no big page title');
 const tl=await p.locator('.schedule-timeline').boundingBox();
 check(tl.height>480&&tl.width>1100,'timeline fills the content area');
 const blocks=p.locator('.schedule-block');
 check(await blocks.count()>=3,'course blocks rendered from fixture');
 // 唯一常驻控件：悬浮圆钮 → 设置浮层（周切换/视图/筛选/同步/新建）
 await p.locator('.schedule-dock button').first().click();await p.waitForTimeout(700);
 const popVisible=await p.locator('.schedule-panel').waitFor({state:'visible',timeout:5000}).then(()=>true).catch(()=>false);
 if(!popVisible)console.log('dock debug',await p.evaluate(()=>({exp:document.querySelector('.schedule-dock button')?.getAttribute('aria-expanded'),pop:document.querySelectorAll('.og-popover').length})));
 check(popVisible,'settings popover opens above the dock');
 const pop=await p.locator('.og-floating.og-popover').boundingBox();
 check(pop&&pop.y>0&&pop.y<860,'popover placed inside viewport');
 await p.screenshot({path:out+'/schedule-desktop.png'});
 await p.keyboard.press('Escape');await p.waitForTimeout(300);
 // 详情 → 前往/寻迹 开新标签（放在最后：点「前往」会切走当前标签）
 const tabsBefore=await p.locator('.ex-tab').count();
 await p.locator('.schedule-block').first().click();await p.waitForTimeout(500);
 check(await p.locator('.og-modal button').count()>0,'block detail opens');
 check(await p.getByRole('button',{name:'前往'}).count()>0,'detail offers 前往');
 check(await p.getByRole('button',{name:'寻迹'}).count()>0,'detail offers 寻迹');
 await p.getByRole('button',{name:'前往',exact:true}).first().click();await p.waitForTimeout(1200);
 const tabsAfter=await p.locator('.ex-tab').count();
 check(tabsAfter>tabsBefore,'前往 opens a new tab');
 await p.close();
 for(const [w,h,name] of [[390,844,'phone'],[844,390,'landscape']]){
  const m=await browser.newPage({viewport:{width:w,height:h},hasTouch:true,isMobile:true});await setup(m);await go(m);
  check(await m.locator('.schedule-day-cell').count()===7,`${name}: still week view (7 columns)`);
  check(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name}: no horizontal overflow`);
  const b2=await m.locator('.schedule-timeline').boundingBox();
  check(b2.height>120,`${name}: timeline visible`);
  await m.screenshot({path:out+`/schedule-${name}.png`});
  await m.close();
 }
 check(errors.length===0,'no runtime errors '+errors.join(';'));
 writeFileSync(out+'/schedule-report.json',JSON.stringify({checks,errors},null,2));
}finally{await browser.close();}
