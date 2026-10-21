/** Real Schedule clipping/hit/scroll acceptance; no locator auto-scroll for DDLs.
 * Isolated browser contexts, fake upstream data; no school/native calendar IO.
 * Chromium phone uses trusted CDP swipes. WebKit's mobile backend cannot wheel
 * or swipe, so its 390px touch viewport uses desktop-backend wheel + native tap.
 * These are browser layout/input checks, not physical iOS/WKWebView acceptance. */
import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = process.env.ONETHU_TEST_OUT ?? '/tmp/onethu-schedule-layout';
const engines = (process.env.SCHEDULE_LAYOUT_ENGINES ?? 'chromium,webkit').split(',');
const modes = (process.env.SCHEDULE_LAYOUT_MODES ?? 'full,simple,practical').split(',');
const widths = (process.env.SCHEDULE_LAYOUT_WIDTHS ?? '1280,390').split(',').map(Number);
assert.ok(engines.length && engines.every(v => ['chromium','webkit'].includes(v)), 'valid browser engines required');
assert.ok(modes.length && modes.every(v => ['full','simple','practical'].includes(v)), 'valid modes required');
assert.ok(widths.length && widths.every(v => [1280,390].includes(v)), 'valid viewports required');
mkdirSync(out, { recursive: true });
const report = {
  passed: false, checks: [], samples: [], errors: [], screenshots: [],
  environment: { engines, modes, widths, chromiumPhone: 'mobile emulation, trusted CDP swipe and tap', webkitPhone: '390px touch viewport, desktop-backend wheel and native tap', physicalDevice: false },
  fixture: { course: 'Tuesday 08:00–09:35', deadline: 'Tuesday 23:59', agendaRows: 20 },
  css: createHash('sha256').update(readFileSync(new URL('../packages/gui/src/recipes/schedule.css', import.meta.url))).digest('hex'),
};
const check = (value, label) => { assert.ok(value, label); report.checks.push(label); console.log('✓ ' + label); };
async function call(page, path, name, args = []) {
  return page.evaluate(async ({ path, name, args }) => {
    const url = performance.getEntriesByType('resource').map(e => e.name).findLast(u => new URL(u).pathname === path);
    if (!url) throw Error('Not loaded: ' + path);
    return (await import(url))[name](...args);
  }, { path, name, args });
}
async function setup(browser, engine, width, mode) {
  const page = await browser.newPage({ viewport: { width, height: width === 1280 ? 600 : 844 }, hasTouch: width === 390, isMobile: width === 390 && engine === 'chromium', timezoneId: 'Asia/Shanghai' });
  page.setDefaultTimeout(12000);
  page.on('pageerror', e => report.errors.push(e.message));
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:5180|localhost:5180)/, r => r.abort());
  await installFakeCloud(page);
  await page.addInitScript((mode) => {
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('onethu.onboarded.phone', '1');
    localStorage.setItem('onethu.experience.v1', mode);
    localStorage.setItem('onethu.schedule.window.v1', JSON.stringify({ from: 0, to: 1440 }));
  }, mode);
  await page.goto(base + '/?explorer-preview=onboarding');
  await page.locator('.explorer-shell').waitFor();
  await call(page, '/src/state/cache.ts', 'setPreviewMode', [true]);
  await call(page, '/src/state/data.ts', 'seedPreviewData');
  await page.evaluate(async () => {
    const mod = async path => import(performance.getEntriesByType('resource').map(e => e.name).findLast(u => new URL(u).pathname === path));
    const data = await mod('/src/state/data.ts'), { learn, info } = await mod('/src/lib/clients.ts');
    const now = new Date(), tue = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + 1);
    const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const date = ymd(tue);
    const courses = [{ id: 'layout-course', name: '早课布局示例' }];
    const timetable = [{ date, dayOfWeek: 2, courseName: '早课布局示例', startTime: '08:00', endTime: '09:35', courseId: 'layout-course' }];
    window.__layoutFixture = { date, many: false };
    const homework = () => window.__layoutFixture.many
      ? Array.from({ length: 20 }, (_, i) => ({ id: `layout-${i+1}`, courseId: 'layout-course', title: `同日作业 ${String(i+1).padStart(2,'0')}`, deadline: `${date} ${String(9 + Math.floor(i/2)).padStart(2,'0')}:${i%2 ? '30' : '00'}`, submitted: false }))
      : [{ id: 'late-ddl', courseId: 'layout-course', title: '晚间 23:59 截止作业', deadline: date + ' 23:59', submitted: false }];
    learn.getCurrentSemester = async () => ({ id: 'layout-current' });
    learn.getCourseList = async () => courses;
    learn.getAllHomework = async () => homework();
    learn.getAllNotifications = async () => [];
    learn.getFileList = async () => [];
    info.getSchedule = async () => timetable.map(e => ({ ...e }));
    // Keep production state publication/subscriptions; only transport methods are fixtures.
    await data.refreshLearnDataSilently();
    const campus = data.getCampusSnapshot();
    if (campus) { campus.homework = []; campus.schedule = timetable; }
  });
  if (mode === 'full') await call(page, '/src/state/explorer.ts', 'openTab', ['schedule', null, { forceNew: true }]);
  else await call(page, '/src/state/experienceMode.ts', 'navigateSimple', ['schedule']);
  await page.locator('.schedule-workspace:visible').waitFor();
  check(await page.evaluate(() => document.documentElement.classList.contains('is-phone')) === (width === 390), `${engine}-${width}-${mode}: actual phone/desktop layout matches viewport`);
  return page;
}
async function hitGeometry(locator) {
  return locator.evaluate((el) => {
    const rect = r => ({ x: r.left, y: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height });
    const r = el.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const ancestors = [];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const c = getComputedStyle(p), b = p.getBoundingClientRect();
      const x = /auto|scroll|hidden|clip/.test(c.overflowX), y = /auto|scroll|hidden|clip/.test(c.overflowY);
      if (x) { clip.left = Math.max(clip.left, b.left + p.clientLeft); clip.right = Math.min(clip.right, b.left + p.clientLeft + p.clientWidth); }
      if (y) { clip.top = Math.max(clip.top, b.top + p.clientTop); clip.bottom = Math.min(clip.bottom, b.top + p.clientTop + p.clientHeight); }
      if (x || y) ancestors.push({ cls: p.className, rect: rect(b), client: p.clientHeight, scroll: p.scrollHeight, top: p.scrollTop, overflowY: c.overflowY });
    }
    const x = r.left + r.width/2, y = r.top + r.height/2, hit = document.elementFromPoint(x,y);
    return { rect: rect(r), clip, x, y, centerInside: x >= clip.left && x <= clip.right && y >= clip.top && y <= clip.bottom,
      fullyInside: r.left >= clip.left-1 && r.right <= clip.right+1 && r.top >= clip.top-1 && r.bottom <= clip.bottom+1,
      hit: !!hit && (hit === el || el.contains(hit)), hitClass: hit?.className, ancestors,
      workspace: rect(el.closest('.schedule-workspace').getBoundingClientRect()) };
  });
}
const tap = async (page, locator, width) => width === 390 ? locator.tap() : locator.click();
async function view(page, width, kind) {
  const workspace = page.locator('.schedule-workspace:visible');
  const wanted = kind === 'agenda' ? '.schedule-scroll' : '.schedule-timeline';
  if (await workspace.locator(wanted).count()) return;
  await tap(page, workspace.getByRole('button', { name: '日程设置', exact: true }), width);
  await tap(page, page.locator('.schedule-panel:visible').getByRole('button', { name: kind === 'agenda' ? '列表' : '时间轴（周）', exact: true }), width);
  await page.keyboard.press('Escape');
  await page.locator('.schedule-panel:visible').waitFor({ state: 'hidden' });
}
async function dataMode(page, many) {
  await page.evaluate(many => { window.__layoutFixture.many = many; }, many);
  await call(page, '/src/state/data.ts', 'refreshLearnDataSilently');
}
async function timeline(page, width, label) {
  await dataMode(page, false); await view(page, width, 'timetable');
  const workspace = page.locator('.schedule-workspace:visible');
  const block = workspace.locator('.schedule-block').filter({ hasText: '晚间 23:59 截止作业' });
  await block.waitFor({ state: 'attached' });
  await page.waitForTimeout(800); // Let the real entrance transform settle, without scrolling the block.
  const g = await hitGeometry(block); report.samples.push({ label: label + ' timeline', ...g });
  check(g.workspace.h > 200, label + ': visible workspace has actual height');
  const course = workspace.locator('.schedule-block').filter({
    has: page.locator('.schedule-block-title').filter({ hasText: /^早课布局示例$/ }),
  });
  check(await course.count() === 1 && /08:00–09:35/.test(await course.getAttribute('title')), label + ': 08:00–09:35 course rendered alongside late DDL');
  check(g.centerInside, label + ': late DDL center lies inside actual ancestor scroll clip');
  check(g.hit, label + ': late DDL center actually hits the block (no auto-scroll)');
  if (width === 390) await page.touchscreen.tap(g.x,g.y); else await page.mouse.click(g.x,g.y);
  const detail = page.getByRole('dialog').filter({ hasText: '晚间 23:59 截止作业' });
  await detail.waitFor();
  check((await detail.innerText()).includes('23:59 截止'), label + ': visible coordinate click opens exact DDL detail');
  await page.keyboard.press('Escape'); await detail.waitFor({ state: 'hidden' });
}
async function scrollEnd(page, engine, width, scroll) {
  const box = await scroll.boundingBox();
  assert.ok(box && box.height > 80, 'visible agenda scroll container');
  if (width === 390 && engine === 'chromium') {
    const session = await page.context().newCDPSession(page);
    for (let n=0;n<10;n++) {
      const x = box.x + box.width*.42, y1 = Math.min(box.y + box.height*.75, 690), y2 = Math.max(box.y+30,y1-420);
      await session.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y:y1}]});
      for(let j=1;j<=8;j++) { await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y1+(y2-y1)*j/8}]}); await page.waitForTimeout(18); }
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForTimeout(90);
      if(await scroll.evaluate(el=>el.scrollTop+el.clientHeight>=el.scrollHeight-1))break;
    }
    await session.detach();
  } else {
    await page.mouse.move(box.x + box.width*.42, Math.min(box.y + box.height*.5, 500));
    for(let i=0;i<6;i++) { await page.mouse.wheel(0,1200); await page.waitForTimeout(100); }
  }
  await page.waitForTimeout(200);
}
async function agenda(page, engine, width, label) {
  await dataMode(page, true); await view(page,width,'agenda');
  const workspace=page.locator('.schedule-workspace:visible'), scroll=workspace.locator('.schedule-scroll');
  // The date picker must be reached through normal scrolling after a return.
  const date=await page.evaluate(()=>window.__layoutFixture.date);
  if(await scroll.evaluate(el=>el.scrollTop>0)) {
    const box=await scroll.boundingBox();await page.mouse.move(box.x+box.width*.42,box.y+Math.min(120,box.height*.4));await page.mouse.wheel(0,-10000);await page.waitForTimeout(150);
  }
  await tap(page,workspace.getByRole('button',{name:date+' · 有作业截止',exact:true}),width);
  check(await workspace.locator('[data-agenda-kind="hw"]').count()===20,label+': all 20 same-day homework rows exist');
  await scrollEnd(page,engine,width,scroll);
  const last=workspace.locator('[data-agenda-kind="hw"]').filter({hasText:'同日作业 20'});
  const g=await hitGeometry(last);report.samples.push({label:label+' agenda-last',...g});
  const metrics=await scroll.evaluate(el=>({top:el.scrollTop,h:el.clientHeight,all:el.scrollHeight}));
  check(metrics.top>0,label+': real wheel/touch scrolled the agenda');
  check(g.fullyInside,label+': entire last row is inside actual ancestor scroll clip');
  check(g.hit,label+': final row center hits itself rather than footer/OneShot');
  if(width===390)await page.touchscreen.tap(g.x,g.y);else await page.mouse.click(g.x,g.y);
  const detail=page.getByRole('dialog').filter({hasText:'同日作业 20'});await detail.waitFor();
  check(await detail.getByRole('button',{name:'前往',exact:true}).isVisible(),label+': actual final-row click/tap opens actionable details');
  await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});
}
for(const engine of engines) {
  const browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
  try {
    for(const width of widths) for(const mode of modes) {
      const label=`${engine}-${width}-${mode}`, page=await setup(browser,engine,width,mode);
      try {
        await timeline(page,width,label+' cold');
        await page.screenshot({path:`${out}/${label}-timeline.png`});report.screenshots.push(`${out}/${label}-timeline.png`);
        await agenda(page,engine,width,label+' cold');
        await page.screenshot({path:`${out}/${label}-agenda-end.png`});report.screenshots.push(`${out}/${label}-agenda-end.png`);
        if(mode==='full') {
          await call(page,'/src/state/explorer.ts','focusTab',['home']);
          await call(page,'/src/state/explorer.ts','openTab',['schedule']);
        } else {
          await call(page,'/src/state/experienceMode.ts','navigateSimple',['homepage']);
          await page.locator('.simple-home').waitFor();
          await call(page,'/src/state/experienceMode.ts','navigateSimple',['schedule']);
        }
        await timeline(page,width,label+' returned');
        await agenda(page,engine,width,label+' returned');
        if(mode==='simple') {
          await call(page,'/src/state/experienceMode.ts','setExperienceMode',['practical']);
          await timeline(page,width,label+' switch practical');await agenda(page,engine,width,label+' switch practical');
          await call(page,'/src/state/experienceMode.ts','setExperienceMode',['simple']);
          await timeline(page,width,label+' switch back');
        }
        await page.unrouteAll({behavior:'ignoreErrors'});await page.close();
      } catch(error) {
        await page.screenshot({path:`${out}/${label}-failure.png`}).catch(()=>{});
        report.failure={label,message:String(error)};
        writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
        throw error;
      }
    }
  } finally {await closeTestBrowser(browser);}
}
check(report.errors.length===0,'No browser runtime errors: '+report.errors.join('; '));
report.passed=true;writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
console.log(`Schedule actual layout: ${report.checks.length} checks passed.`);
