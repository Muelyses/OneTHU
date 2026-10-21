/** Public 0.11 screenshots: disposable browser contexts, real UI, fictional data only.
 * Never attaches to the user's browser or native application. All non-local HTTP is blocked. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { installFakeOrganization } from './lib/fake-org.mjs';
import { installXiaodaTourFixture } from './lib/xiaoda-tour-fixture.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = 'docs/assets/0.11'; mkdirSync(out, { recursive: true });
const fixture = {
 user: { name: '示例同学', studentId: '2026000000', department: '示例院系', email: 'demo@example.invalid' },
 semester: { id: 'demo-2026-autumn' },
 courses: [
  { id: 'demo-math', name: '高等数学', englishName: 'Calculus', courseNumber: 'demo-math', courseIndex: 1, teacherName: '示例教师', timeAndLocation: ['六教 6A101'], url: '' },
  { id: 'demo-design', name: '设计思维', englishName: 'Design Thinking', courseNumber: 'demo-design', courseIndex: 1, teacherName: '示例教师', timeAndLocation: ['三教 3200'], url: '' },
  { id: 'demo-data', name: '数据结构', englishName: 'Data Structures', courseNumber: 'demo-data', courseIndex: 1, teacherName: '示例教师', timeAndLocation: ['四教 4104'], url: '' },
 ],
 homework: [
  { id: 'demo-hw-1', courseId: 'demo-math', title: '第二章习题', content: '示例作业内容', publishTime: '2026-10-18', deadline: '2026-10-21 23:59', submitted: false, graded: false, url: '' },
  { id: 'demo-hw-2', courseId: 'demo-design', title: '整理小组调研笔记', content: '示例作业内容', publishTime: '2026-10-19', deadline: '2026-10-22 18:00', submitted: false, graded: false, url: '' },
  { id: 'demo-hw-3', courseId: 'demo-data', title: '树与图的练习', content: '示例作业内容', publishTime: '2026-10-19', deadline: '2026-10-24 23:59', submitted: false, graded: false, url: '' },
 ],
 notifications: [{ id:'demo-notice',courseId:'demo-design',title:'本周课堂讨论安排',content:'示例通知内容',publishTime:'2026-10-20',read:false }], files: [],
 schedule: [
  { courseName: '高等数学', date: '2026-10-21', dayOfWeek: 3, startSection: 3, endSection: 4, location: '六教 6A101', startTime: '09:50', endTime: '11:25', raw: {} },
  { courseName: '设计思维', date: '2026-10-21', dayOfWeek: 3, startSection: 6, endSection: 7, location: '三教 3200', startTime: '13:30', endTime: '15:05', raw: {} },
  { courseName: '数据结构', date: '2026-10-22', dayOfWeek: 4, startSection: 1, endSection: 2, location: '四教 4104', startTime: '08:00', endTime: '09:35', raw: {} },
 ],
 news: [{ id:'demo-news',title:'示例校园活动：秋日读书会',date:'2026-10-21',url:'' }],
};
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? (process.platform==='darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true, args: ['--disable-updater-scheduler'] });
const previous = process.env.ONETHU_CAPTURE_REST ? JSON.parse(readFileSync(out+'/manifest.json','utf8')).entries : [];
const entries = previous, errors = [], blocked = [];
let passed = false, naturalCleanup = false;
const call = async (page, path, name, args=[]) => page.evaluate(async ({path,name,args}) => {
 let url = performance.getEntriesByType('resource').map(entry=>entry.name).filter(url=>new URL(url).pathname===path).at(-1) ?? path;
 if (path === '/src/state/explorer.ts') {
  const source = await (await fetch('/src/components/explorer/TabHost.tsx')).text();
  const dependency = [...source.matchAll(/"([^" ]+)"/g)].map(match=>match[1]).find(value=>value.startsWith('/src/state/explorer.ts'));
  if (dependency) url = dependency;
 }
 if (path === '/src/plugins/ohControl.ts') {
  const source=await (await fetch('/src/plugins/ChatDock.tsx')).text();
  const dependency=[...source.matchAll(/"([^" ]+)"/g)].map(match=>match[1]).find(value=>value.startsWith('/src/plugins/ohControl.ts'));
  if(dependency)url=dependency;
 }
 if (path === '/src/state/vault.ts') {
  const source = await (await fetch('/src/components/vault/VaultWorkspace.tsx')).text();
  const dependency = [...source.matchAll(/"([^" ]+)"/g)].map(match=>match[1]).find(value=>value.startsWith('/src/state/vault.ts'));
  if (dependency) url = dependency;
 }
 return (await import(url))[name](...args);
}, { path, name, args });
async function setup(width=390,height=844,mode='full',contextOptions={}) {
 const context = await browser.newContext({ viewport:{width,height}, deviceScaleFactor:2, hasTouch:width<900, locale:'zh-CN', timezoneId:'Asia/Shanghai', ...contextOptions });
 const recordingStart = Date.now();const page = await context.newPage();page.__recordingStart=recordingStart;page.setDefaultTimeout(18000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.routeWebSocket('**/*', socket=>socket.close());
 await page.route('**/*',route=>{
  const url = new URL(route.request().url());
  if(url.origin===new URL(base).origin)return route.fallback();
  blocked.push(url.origin+url.pathname);return route.abort();
 });
 await installFakeCloud(page); await installFakeOrganization(page); await installXiaodaTourFixture(page);
 await page.clock.setFixedTime(new Date('2026-10-21T02:00:00Z'));
 await page.addInitScript(({fixture,mode})=>{
  performance.setResourceTimingBufferSize(10000); window.__publicFixture=fixture;
  localStorage.setItem('onethu.locale','zh-CN');localStorage.setItem('onethu.experience.v1',mode);
  localStorage.setItem('onethu.onboarded.flow4','1');localStorage.setItem('onethu.overlay.closed','1');
  localStorage.setItem('onethu.chatdock.open','0');localStorage.setItem('onethu.home.coach.v1','done');
 },{fixture,mode});
 await page.route('**/src/state/data.ts*', async route=>{
  const response=await route.fetch();let body=await response.text();
  for(const name of ['useLearnData','useCampusData']){
   const needle=`export function ${name}() {`;assert.ok(body.includes(needle));
   body=body.replace(needle,needle+'return {data:window.__publicFixture,state:"ready",error:null,reload:async()=>{}};');
  }
  const needle='export function useCalendar() {';assert.ok(body.includes(needle));
  body=body.replace(needle,needle+'return {data:{semesterId:"demo-2026-autumn",semesterName:"2026秋季学期",firstDay:"2026-09-07",weekCount:20,nextSemesterList:[]},state:"ready",error:null,reload:async()=>{}};');
  await route.fulfill({response,body});
 });
 await page.goto(base+'/?explorer-preview=onboarding'+(width<900?'&phone=1':''));
 await page.locator(mode==='full'?'.explorer-shell':'.simple-home').waitFor();await page.waitForTimeout(1200);
 await page.evaluate(async()=>{
  const path='/src/lib/clients.ts'; const url=performance.getEntriesByType('resource').map(e=>e.name).find(url=>new URL(url).pathname===path)??path;
  const clients=await import(url);clients.session.username='2026000000';clients.session.state='ready';
  clients.info.getSchedule=async()=>structuredClone(window.__publicFixture.schedule);
 });
 return {page,context};
}
async function capture(page,key,description){
 await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(500);
 assert.equal(await page.locator('.experience-tour').count(),0,'No guide overlay in public captures');
 const previousIndex=entries.findIndex(entry=>entry.key===key);if(previousIndex>=0)entries.splice(previousIndex,1);
 const file=key+'.png';await page.screenshot({path:out+'/'+file,animations:'disabled'});if(['search','oh'].includes(key))copyFileSync(out+'/'+file,'apps/desktop/src/assets/tour/real-ui/'+file);
 entries.push({key,file,description,viewport:page.viewportSize(),deviceScaleFactor:2,orientation:page.viewportSize().width>page.viewportSize().height?'landscape':'portrait',sha256:createHash('sha256').update(readFileSync(out+'/'+file)).digest('hex'),fixture:'Fictional courses, assignments, people and services. Real React/OneGUI components; no real account or campus requests.',source:'Uncomposited screenshot of an isolated browser viewport. No inserted UI or real personal data.'});
 console.log('Captured '+key);
}
async function close(page,context){await page.unrouteAll({behavior:'ignoreErrors'});await context.request.dispose();await context.close();}
export { setup, call, capture, close, browser };
if (process.argv[1]?.endsWith('capture-public-preview.mjs')) {
try{
 for(const mode of (process.env.ONETHU_CAPTURE_REST ? [] : ['simple','practical','full'])){
  const {page,context}=await setup(390,844,mode);
  await capture(page,'home-'+mode, mode+' 模式手机首页');await close(page,context);
 }
 for(const [key,target,width,height] of (process.env.ONETHU_CAPTURE_REST ? [] : [['learn','learn',390,844],['schedule','schedule',390,844],['tasks','tasks',390,844],['home-landscape','homepage',844,390],['schedule-landscape','schedule',844,390],['home-desktop','homepage',1440,900],['learn-desktop','learn',1440,900]])){
  const {page,context}=await setup(width,height);
  if(target!=='homepage')await call(page,'/src/state/explorer.ts','openTab',[target]);
  await page.locator(`[data-tab-page="${target}"]:visible`).waitFor();
  if(target==='learn')await page.locator('[data-tab-page="learn"]:visible').getByText('高等数学',{exact:true}).first().waitFor();
  await capture(page,key,target+' 模拟界面');await close(page,context);
 }
 {
  const {page,context}=await setup();
  await call(page,'/src/state/vault.ts','addToVault',[{type:'text',title:'小组调研的三个方向',text:'校园空间、日常动线、协作方式。',source:'模拟便笺'}]);
  await call(page,'/src/state/vault.ts','addToVault',[{type:'atom',title:'高等数学',sub:'示例课程',atom:{kind:'course',key:'demo-math'},source:'模拟课程'}]);
  await call(page,'/src/state/vault.ts','addToVault',[{type:'text',title:'读书会准备清单',text:'准备书目和讨论问题。',source:'模拟便笺'}]);
  await call(page,'/src/state/explorer.ts','openTab',['vault']);
  await page.getByText('小组调研的三个方向',{exact:true}).waitFor();
  await capture(page,'vault','暂存箱：模拟课程与文字');await close(page,context);
 }
 {
  const {page,context}=await setup();
  await call(page,'/src/state/explorer.ts','openTab',['contacts',{section:'orgs'}]);
  await page.getByRole('radio',{name:'我的组织',exact:true}).click();
  await page.getByRole('button',{name:'新建组织',exact:true}).click();
  await page.locator('.plg-form-modal input').first().fill('示例学习小组');
  await page.locator('.plg-form-modal textarea').fill('一起整理资料，完成每周学习计划');
  await page.getByRole('button',{name:'提交',exact:true}).click();
  await page.getByRole('heading',{name:'示例学习小组',exact:true}).waitFor();
  await capture(page,'organization','虚构学习组织：名片与管理入口');await close(page,context);
 }
 {
  const {page,context}=await setup();
  await call(page,'/src/state/explorer.ts','openTab',['xiaoda']);
  const panel=page.locator('[data-tab-page="xiaoda"]:visible');await panel.getByRole('textbox').waitFor();
  await capture(page,'xiaoda','清小搭模拟对话入口');
  await panel.getByRole('tab',{name:'技能',exact:true}).click();
  await panel.getByText('OH 技能库',{exact:true}).waitFor();
  await panel.getByText('OH 技能库',{exact:true}).evaluate(el=>{el.scrollIntoView({block:'start'});for(let p=el.parentElement;p;p=p.parentElement)if(p.scrollHeight>p.clientHeight&&/auto|scroll/.test(getComputedStyle(p).overflowY)){p.scrollTop-=80;break;}});
  await capture(page,'skills','模拟轻量技能库');await close(page,context);
 }
 {
  const {page,context}=await setup();
  await call(page,'/src/plugins/ohControl.ts','requestOhPanel',['search','作业']);
  await page.locator('.dock-panel').waitFor();await page.locator('.ohx-hit').first().waitFor();await capture(page,'search','搜索胶囊：模拟功能与作业结果');
  await call(page,'/src/plugins/ohControl.ts','requestOhPanel',['oh','']);
  await page.locator('.dock-panel').waitFor();await capture(page,'oh','OH 与搜索胶囊：模拟预览');await close(page,context);
 }
 assert.deepEqual(errors,[]);passed=true;
}finally{
 try{await closeTestBrowser(browser);naturalCleanup=true;}
 finally{writeFileSync(out+'/manifest.json',JSON.stringify({version:'0.11.0',capturedAt:new Date().toISOString(),passed:passed&&naturalCleanup,naturalCleanup,command:'node tools/capture-public-preview.mjs',privacy:'Only fictional data in disposable browser contexts. No real browser profile, real credentials, native app or campus service used.',externalRequestsSent:0,blockedExternalRequests:blocked,entries,errors},null,2)+'\n');}
}

}
