/** Real Schedule and Agenda in all modes, with stale Campus + current Learn data.
 * Isolated preview storage. No school requests, no real calendar/email writes.
 * Browser viewport/touch emulation, not a physical-device claim.
 */
import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = process.env.ONETHU_TEST_OUT ?? '/tmp/onethu-schedule-sync';
mkdirSync(out,{recursive:true});
const report = { checks: [], errors: [], screenshots: [], passed: false };
const check = (c,m) => { assert.ok(c,m);report.checks.push(m);console.log('✓ '+m); };
const call = (p,path,name,args=[]) => p.evaluate(async({path,name,args})=>{
 const url=performance.getEntriesByType('resource').map(r=>r.name).findLast(u=>new URL(u).pathname===path);
 if(!url)throw Error('Module not loaded: '+path);
 return (await import(url))[name](...args);
},{path,name,args});
async function tap(p,locator,width) { if(width<600)await locator.tap();else await locator.click(); }
async function setup(browser,width) {
 const p=await browser.newPage({viewport:{width,height:width<600?844:900},timezoneId:'Asia/Shanghai',hasTouch:width<600,isMobile:width<600});
 p.setDefaultTimeout(12000);
 p.on('pageerror',e=>report.errors.push(e.message));
 await p.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/,()=>{});
 await p.route(/^https?:\/\/(?!127\.0\.0\.1:5180|localhost:5180)/,r=>r.abort());
 await installFakeCloud(p);
 await p.addInitScript(()=>{performance.setResourceTimingBufferSize(10000);localStorage.setItem('onethu.onboarded.phone','1');localStorage.setItem('onethu.experience.v1','full');});
 await p.goto(base+'/?explorer-preview=onboarding');
 await p.locator('.explorer-shell').waitFor();
 await call(p,'/src/state/cache.ts','setPreviewMode',[true]);
 await call(p,'/src/state/data.ts','seedPreviewData');
 await p.evaluate(async()=>{
  const mod=async path=>import(performance.getEntriesByType('resource').map(r=>r.name).findLast(u=>new URL(u).pathname===path));
  const data=await mod('/src/state/data.ts'),cache=await mod('/src/state/cache.ts');
  const learn=data.getLearnSnapshot(), campus=cache.cacheGet('campus').data;
  const d=new Date(),date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  window.__testDate=date;
  campus.homework=[];campus.schedule=[];
  learn.homework=[
    {id:'test-iso',courseId:'c1',title:'测试作业 DDL',deadline:date+'T15:30:00+08:00',submitted:false},
    {id:'test-midnight',courseId:'c1',title:'零点截止作业',deadline:date+' 00:00',submitted:false},
    {id:'test-ignore',courseId:'c1',title:'忽略的作业',deadline:date+' 10:00',submitted:false},
    {id:'test-audit',courseId:'c1',title:'旁听作业',deadline:date+' 18:00',audited:true},
  ];
  // Only the upstream boundary is stubbed; the production hooks and renderers run unchanged.
  const {info}=await mod('/src/lib/clients.ts');info.getSchedule=async()=>[];
 });
 await call(p,'/src/state/hwIgnore.ts','ignoreHw',['test-ignore','忽略的作业']);
 return p;
}
for(const engine of (process.env.ONETHU_TEST_ENGINES??'chromium,webkit').split(',')) {
 const browser=await(engine==='webkit'?webkit:chromium).launch(engine==='chromium'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}:{headless:true});
 try {
 for(const width of (process.env.ONETHU_TEST_WIDTHS??'1280,390').split(',').map(Number)) {
  const p=await setup(browser,width);
  for(const mode of ['full','simple','practical']) {
   const label=`${engine} ${width} ${mode}`;
   await call(p,'/src/state/experienceMode.ts','setExperienceMode',[mode]);
   const fullSaved=await p.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>/onethu\.(explorer|board|oneshot)/.test(k))));
   if(mode==='full')await call(p,'/src/state/explorer.ts','openTab',['schedule',null,{forceNew:true}]);
   else await call(p,'/src/state/experienceMode.ts','navigateSimple',['schedule']);
   const page=p.locator('.schedule-workspace:visible');await page.waitFor();
   if(!await page.locator('.schedule-timeline').count()) {
    await tap(p,page.getByRole('button',{name:'日程设置',exact:true}),width);
    await tap(p,p.locator('.schedule-panel:visible').getByRole('button',{name:'时间轴（周）',exact:true}),width);
    await p.keyboard.press('Escape');
   }
   const block=page.locator('.schedule-block').filter({hasText:'测试作业 DDL'});
   await block.waitFor();
   check(await page.locator('.schedule-day-cell').count()===7,label+': real week view');
   check(await block.isVisible(),label+': current Learn DDL shown despite empty Campus cache');
   check(await page.locator('.schedule-block').filter({hasText:'零点截止作业'}).isVisible(),label+': midnight DDL visible');
   check(await page.locator('.schedule-block').filter({hasText:/忽略的作业|旁听作业/}).count()===0,label+': ignored/audited omitted');
   await call(p,'/src/state/hwIgnore.ts','ignoreHw',['test-iso','测试作业 DDL']);
   await block.waitFor({state:'hidden'});
   await call(p,'/src/state/hwIgnore.ts','unignoreHw',['test-iso']);await block.waitFor();
   check(await block.isVisible(),label+': ignore/restore updates mounted timeline');
   await tap(p,block,width);const detail=p.getByRole('dialog').filter({hasText:'测试作业 DDL'});await detail.waitFor();
   check((await detail.innerText()).includes('15:30 截止'),label+': detail shows deadline rather than invented duration');
   await tap(p,detail.getByRole('button',{name:'前往',exact:true}),width);
   if(mode==='full') {
    const tabs=await call(p,'/src/state/explorer.ts','allTabs');
    check(tabs.some(t=>t.page==='learn-assignment-detail'&&t.params?.itemId==='test-iso'),label+': full mode opens assignment tab');
    await call(p,'/src/state/explorer.ts','openTab',['schedule']);
   } else {
    const route=await call(p,'/src/state/experienceMode.ts','simpleRoute');
    check(route.page==='learn-assignment-detail'&&route.params.itemId==='test-iso',label+': compact mode navigates actual visible route');
    await call(p,'/src/state/experienceMode.ts','navigateSimple',['schedule']);
   }
   await page.waitFor();
   await p.waitForTimeout(350);
   const dock=await page.locator('.schedule-dock').boundingBox(),quick=await p.locator('.oneshot-schedule-toggle').boundingBox();
   check(quick.y+quick.height<=dock.y+1,label+': OneShot remains above settings without blocking it');
   await tap(p,page.getByRole('button',{name:'日程设置',exact:true}),width);
   const panel=p.locator('.schedule-panel:visible');await panel.waitFor();
   check(await panel.getByRole('button',{name:'同步云日历',exact:true}).isVisible(),label+': cloud sync control retained');
   check(await panel.getByRole('button',{name:/导出 .ics|同步到系统日历/}).isVisible(),label+': system calendar/export control retained');
   await tap(p,panel.getByRole('button',{name:'列表',exact:true}),width);
   await p.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
   const agenda=page.locator('[data-agenda-kind="hw"]').filter({hasText:'测试作业 DDL'});await agenda.waitFor();
   check((await agenda.innerText()).includes('15:30 截止'),label+': selected-day list includes DDL');
   const today=await p.evaluate(()=>window.__testDate);
   check(await page.getByRole('button',{name:today+' · 有作业截止',exact:true}).count()===1,label+': month marks include homework');
   check(await page.locator('[data-agenda-kind="hw"]').count()===2,label+': list retains midnight and filters ignore/audit');
   await tap(p,agenda,width);await detail.waitFor();
   check(await detail.getByRole('button',{name:'前往',exact:true}).isVisible(),label+': list homework opens actionable details');
   await p.keyboard.press('Escape');await detail.waitFor({state:'hidden'});
   check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+': no horizontal page overflow');
   const path=`${out}/${engine}-${width}-${mode}.png`;await p.screenshot({path});report.screenshots.push(path);
   if(mode!=='full') {
    const after=await p.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>/onethu\.(explorer|board|oneshot)/.test(k))));
    check(JSON.stringify(fullSaved)===JSON.stringify(after),label+': compact navigation preserves full-mode storage');
    await tap(p,p.getByRole('button',{name:'设置',exact:true}),width);
    await tap(p,p.getByRole('button',{name:'管理同步',exact:true}),width);
    check(await p.getByText('日程云同步（清华邮箱日历）',{exact:true}).isVisible(),label+': compact settings exposes shared calendar setup');
    await tap(p,p.getByRole('button',{name:'关闭设置',exact:true}),width);
   }
  }
  // Preserve recurrence metadata and the actual end date when only the title changes.
  const multi=await p.evaluate(()=>{const d=new Date(window.__testDate+'T22:00:00+08:00');return {uid:'test-multi',summary:'跨日重复日程',start:+d,end:+d+6*3600000,rrule:'FREQ=DAILY;COUNT=2',location:'测试地点'};});
  await call(p,'/src/state/cloudCal.ts','putLocalEvent',[multi]);
  const row=p.locator('.schedule-workspace:visible [data-agenda-kind="local"]').filter({hasText:'跨日重复日程'});await row.waitFor();
  await tap(p,row,width);const editor=p.getByRole('dialog',{name:'编辑日程',exact:true});await editor.waitFor();
  const originalEnd=await editor.getByLabel('结束日期',{exact:true}).inputValue();
  check(originalEnd!==await editor.getByLabel('开始日期',{exact:true}).inputValue(),engine+' '+width+': cross-day editor retains end date');
  await editor.getByLabel('结束日期',{exact:true}).fill('');
  await tap(p,editor.getByRole('button',{name:'保存',exact:true}),width);
  await editor.getByText('保存失败：请填写完整的开始日期和结束日期',{exact:true}).waitFor();
  check((await call(p,'/src/state/cloudCal.ts','getLocalEvents')).find(e=>e.uid==='test-multi').end===multi.end,engine+' '+width+': empty date cannot corrupt persisted event');
  await editor.getByLabel('结束日期',{exact:true}).fill(originalEnd);
  await editor.getByPlaceholder('要做什么…').fill('只改标题');
  await tap(p,editor.getByRole('button',{name:'保存',exact:true}),width);await editor.waitFor({state:'hidden'});
  const events=await call(p,'/src/state/cloudCal.ts','getLocalEvents');const saved=events.find(e=>e.uid==='test-multi');
  check(saved.end===multi.end&&saved.start===multi.start&&saved.rrule===multi.rrule,engine+' '+width+': editing preserves cross-day duration and recurrence');
  const today=await p.evaluate(()=>window.__testDate);
  await call(p,'/src/state/cloudCal.ts','putLocalEvent',[{uid:'test-exclusive',summary:'昨天结束的日程',start:Date.parse(today+'T00:00:00+08:00')-86400000,end:Date.parse(today+'T00:00:00+08:00'),allDay:true}]);
  check(await p.locator('.schedule-workspace:visible [data-agenda-kind="local"]').filter({hasText:'昨天结束的日程'}).count()===0,engine+' '+width+': midnight end does not leak into next-day list');
  await p.unrouteAll({behavior:'ignoreErrors'});await p.close();
 }
 } catch(error) {
  for(const c of browser.contexts())for(const p of c.pages()) {
   await p.screenshot({path:out+'/failure.png'}).catch(()=>{});
   console.log('Failure geometry',await p.evaluate(()=>['.schedule-dock','.oneshot','.schedule-stage','.explorer-content'].map(s=>{const e=document.querySelector(s);return {s,r:e?.getBoundingClientRect().toJSON(),position:e&&getComputedStyle(e).position,bottom:e&&getComputedStyle(e).bottom,root:document.documentElement.className};})).catch(()=>[]));
  }
  throw error;
 } finally {await closeTestBrowser(browser);}
}
check(report.errors.length===0,'No browser runtime errors: '+report.errors.join('; '));
report.passed=true;writeFileSync(out+'/report.json',JSON.stringify(report,null,2));
console.log(report.checks.length+' assertions passed');
