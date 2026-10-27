/** Real components, isolated synthetic data and upstream stubs; no campus requests. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {setup,call,close,browser} from './capture-public-preview.mjs';
import {closeTestBrowser} from './lib/onboarding-browser-steps.mjs';
const out=process.env.ONETHU_TEST_OUT??'output/release-0.11.4-fix-1/evidence/browser';
mkdirSync(out,{recursive:true});
const checks=[];
const check=(v,m)=>{assert.ok(v,m);checks.push(m);console.log('✓ '+m);};
try {
  for(const [width,height] of (process.env.ONETHU_TEST_HOME_ONLY?[]:[[390,844],[1280,800],[800,1280]])) {
    const {page,context}=await setup(width,height,'practical',{hasTouch:true});
    await page.getByRole('button',{name:'设置',exact:true}).click();
    const body=page.locator('.explorer-settings-body:visible');await body.waitFor();
    const geometry=await body.evaluate(el=>({client:el.clientHeight,total:el.scrollHeight,overflow:getComputedStyle(el).overflowY}));
    check(geometry.total>geometry.client&&/auto|scroll/.test(geometry.overflow),width+': practical settings has a scrollable body');
    const cdp=await context.newCDPSession(page),box=await body.boundingBox();
    const x=box.x+box.width*.72,y=box.y+Math.min(box.height-40,350);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*18}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(250);
    check(await body.evaluate(el=>el.scrollTop)>40,width+': trusted touch swipe actually scrolls settings');
    await body.evaluate(el=>el.scrollTop=el.scrollHeight);
    await page.screenshot({path:out+'/settings-'+width+'.png'});
    await close(page,context);
  }
  const {page,context}=await setup(390,844,'full');
  page.on('pageerror',e=>console.error('BROWSER',e.message));
  const classes=page.locator('[data-tab-page="homepage"]:visible .free-item[data-widget="classes"]');
  await classes.waitFor();
  check((await classes.boundingBox()).height<=282,'phone reading course card no longer inherits a tall desktop rectangle');
  const stored=await page.evaluate(()=>localStorage.getItem('onethu.board.v1'));
  await classes.scrollIntoViewIfNeeded();await page.screenshot({path:out+'/phone-courses.png'});
  await page.setViewportSize({width:1280,height:800});await page.waitForTimeout(250);
  check(await page.evaluate(()=>localStorage.getItem('onethu.board.v1'))===stored,'phone projection leaves saved desktop geometry untouched');
  // Mount the production course widget with real React/context/hooks. Only the
  // Info API and cache boundary are replaced; loading/error/retry/filtering run.
  await page.evaluate(async()=>{
    const mod=async path=>import(performance.getEntriesByType('resource').map(r=>r.name).findLast(u=>new URL(u).pathname===path)??path);
    const main=await (await fetch('/src/main.tsx')).text();
    const urls=[...performance.getEntriesByType('resource').map(r=>r.name),...[...main.matchAll(/"([^" ]+)"/g)].map(m=>m[1]).filter(x=>x.startsWith('/node_modules/'))];
    const resource=end=>urls.find(u=>new URL(u,location.origin).pathname.endsWith(end));
    const React=(await import(resource('/deps/react.js'))).default;
    const {createRoot}=(await import(resource('/deps/react-dom_client.js'))).default;
    const widgetUrl='/src/components/HomeWidgets.tsx?fix1-regression';
    const widgetSource=await (await fetch(widgetUrl)).text();
    const dependency=(source,prefix)=>[...source.matchAll(/from\s*["']([^"']+)["']/g)].map(m=>m[1]).find(u=>u.startsWith(prefix));
    const dataUrl=dependency(widgetSource,'/src/state/data.ts');
    const dataSource=await (await fetch(dataUrl)).text();
    const {Ctx}=await import(dependency(widgetSource,'/src/state/context.ts'));
    const {PreviewDataContext}=await import(dependency(dataSource,'/src/state/dataScope.ts'));
    const {info}=await import(dependency(dataSource,'/src/lib/clients.ts'));
    const {TodayClassesWidget}=await import(widgetUrl);
    window.__courseCalls=[];window.__courseMode='pending';
    info.getSchedule=async(from,to)=>{
      window.__courseCalls.push([from,to]);
      if(window.__courseMode==='pending')await new Promise(r=>window.__finishCourse=r);
      if(window.__courseMode==='error')throw Error('Synthetic timetable unavailable');
      if(window.__courseMode==='empty')return [];
      return [{courseName:'Synthetic secondary course',date:from,dayOfWeek:3,startTime:'13:30',endTime:'15:05',raw:{secondary:true}}];
    };
    const scope={preview:false,cacheGet:()=>null,cacheSet:()=>{},cacheFetch:(_,load)=>load()};
    const node=document.createElement('div');node.id='course-regression';node.style.cssText='position:fixed;inset:100px 50px 150px;background:white;z-index:999999;overflow:auto';document.body.append(node);
    const root=createRoot(node);let key=0;
    window.__renderCourse=()=>root.render(React.createElement(Ctx.Provider,{value:{status:'ready',navigate:()=>{}}},React.createElement(PreviewDataContext.Provider,{value:scope},React.createElement(TodayClassesWidget,{key:++key}))));
    window.__renderCourse();
  });
  const test=page.locator('#course-regression');
  
  await page.waitForFunction(()=>typeof window.__finishCourse==='function',null,{timeout:5000});
  check(!(await test.innerText()).includes('今天没有课'),'in-flight timetable never claims an empty day');
  await page.evaluate(()=>{window.__courseMode='rows';window.__finishCourse();});
  await test.getByText('Synthetic secondary course',{exact:true}).waitFor();
  check(await page.evaluate(()=>window.__courseCalls.every(([a,b])=>/^\d{4}-\d{2}-\d{2}$/.test(a)&&a===b)),'home requests the timetable source for the actual current day');
  await page.evaluate(()=>{window.__courseMode='error';window.__renderCourse();});
  await test.getByText('Synthetic timetable unavailable',{exact:false}).waitFor();
  check(!(await test.innerText()).includes('今天没有课'),'failed timetable exposes retry rather than a false empty day');
  await page.evaluate(()=>window.__courseMode='rows');
  await test.getByRole('button',{name:/重试/}).click();
  await test.getByText('Synthetic secondary course',{exact:true}).waitFor();
  check(true,'retry loads the real course renderer after an upstream failure');
  await page.evaluate(()=>{window.__courseMode='empty';window.__renderCourse();});
  await test.getByText('今天没有课。',{exact:true}).waitFor();
  check(true,'successful empty timetable alone displays the empty-day message');
  await close(page,context);
  writeFileSync(out+'/report.json',JSON.stringify({checks,passed:true,physicalDevice:false},null,2));
} finally {await closeTestBrowser(browser);}
