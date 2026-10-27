/** Actual application screenshots for the optional guide chapters. No alternate UI is rendered. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';

const directory = 'apps/desktop/src/assets/tour/real-ui';
mkdirSync(directory, { recursive: true });
const allTargets = ['workspaces', 'onego', 'plugins', 'appearance', 'learn', 'data'];
const targets = process.env.ONETHU_CAPTURE_TARGETS?.split(',') ?? allTargets;
assert.ok(targets.length && targets.every(target => allTargets.includes(target)), 'Unknown screenshot target');
const previous = existsSync(`${directory}/manifest-extras.json`) ? JSON.parse(readFileSync(`${directory}/manifest-extras.json`, 'utf8')) : {};
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-updater-scheduler'] });
const entries = [], errors = [];
let passed = false, naturalCleanup = false;
const campusFixture = {
  semester: { id: 'demo-2026-autumn' },
  courses: [
    { id: 'demo-math', name: '高等数学', englishName: 'Calculus', courseNumber: 'demo-math', courseIndex: 1, teacherName: '示例教师', timeAndLocation: ['六教 6A101'], url: '' },
    { id: 'demo-design', name: '设计思维', englishName: 'Design Thinking', courseNumber: 'demo-design', courseIndex: 1, teacherName: '示例教师', timeAndLocation: ['三教 3200'], url: '' },
  ],
  homework: [{ id: 'demo-hw-1', courseId: 'demo-math', title: '第二章习题', content: '课程示例作业', publishTime: '2026-10-18', deadline: '2026-10-20 23:59', submitted: false, graded: false, url: '' }],
  notifications: [], files: [], schedule: [],
};
try {
  for (const target of targets) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 });
    await installFakeCloud(page);
    await page.clock.setFixedTime(new Date('2026-10-20T02:00:00Z'));
    await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
    page.on('pageerror', error => errors.push({ target, message: error.message }));
    await page.addInitScript(campusFixture => {
      performance.setResourceTimingBufferSize(10000);
      localStorage.setItem('onethu.onboarded.flow4', '1');
      localStorage.setItem('onethu.overlay.closed', '1');
      localStorage.setItem('onethu.experience.v1', 'full');
      window.__realTourFixture = campusFixture;
    }, campusFixture);
    // Only replace unavailable campus data. Production components and styles are untouched.
    await page.route('**/src/state/data.ts*', async route => {
      const response = await route.fetch(); let body = await response.text();
      for (const name of ['useLearnData', 'useCampusData']) {
        const needle = `export function ${name}() {`;
        assert.ok(body.includes(needle));
        body = body.replace(needle, needle + 'return {data:window.__realTourFixture,state:"ready",error:null,reload:async()=>{}};');
      }
      await route.fulfill({ response, body });
    });
    // The "home" preview schedules focusTab("home") after 200 ms. A fast real
    // OneShot click can briefly open learn and then be reset before the capture.
    // The onboarding preview only bypasses login; it schedules no navigation.
    await page.goto(`http://127.0.0.1:5180/?explorer-preview=${target === 'learn' ? 'onboarding' : 'home'}`);
    await page.locator('.explorer-shell').waitFor();
    if (target === 'learn') await page.locator('.oneshot').getByRole('button', { name: '学习', exact: true }).click();
    else await page.evaluate(async target => {
      const path = '/src/lib/onboardingNavigation.ts';
      const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname.endsWith(path)) ?? path;
      (await import(url)).openLessonTarget(target);
    }, target);
    if (target === 'workspaces' || target === 'onego') {
      await page.getByRole('dialog', { name: 'OneGO!', exact: true }).waitFor();
      assert.equal(await page.getByRole('tab', { name: target === 'onego' ? '我的收藏' : '工作区', exact: true }).getAttribute('aria-selected'), 'true');
    } else if (target === 'learn') await page.locator('[data-tab-page="learn"]:visible').getByRole('heading', { name: '课程', exact: true }).waitFor();
    else if (target === 'plugins') await page.getByRole('dialog', { name: '我的', exact: true }).getByRole('heading', { name: '插件', exact: true }).waitFor();
    else await page.getByRole('tabpanel', { name: target === 'appearance' ? '外观' : '账号', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    let visibleEvidence;
    if (target === 'learn') {
      const learn = page.locator('[data-tab-page="learn"]:visible');
      const heading = learn.getByRole('heading', { name: '课程', exact: true });
      await heading.waitFor();
      visibleEvidence = await heading.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
          heading: element.textContent,
          headingBounds: bounds.toJSON(),
          headingInViewport: bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth,
          hitPage: hit?.closest('[data-tab-page]')?.getAttribute('data-tab-page'),
          visiblePages: [...document.querySelectorAll('[data-tab-page]')].filter(panel => getComputedStyle(panel).display !== 'none').map(panel => panel.getAttribute('data-tab-page')),
          hash: location.hash,
        };
      });
      assert.ok(visibleEvidence.headingInViewport && visibleEvidence.hitPage === 'learn', 'Screenshot must physically show the learning page heading');
      assert.deepEqual(visibleEvidence.visiblePages, ['learn'], 'The homepage must be hidden at capture time');
      assert.equal(await learn.getByText('高等数学', { exact: true }).count(), 1, 'Real course cards must be rendered');
    }
    const filename = `${target}.png`, path = `${directory}/${filename}`;
    await page.screenshot({ path, animations: 'disabled' });
    entries.push({ filename, sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), viewport: { width:390, height:844, deviceScaleFactor:2 }, mode:'full', entry:target === 'learn' ? 'OneShot 学习 button from neutral preview' : 'openLessonTarget', target, fixture:'isolated fake-cloud; sample courses and homework via production data hooks; actual production components and styles', visibleEvidence, pageText: (await page.locator('body').innerText()).slice(0, 1800) });
    console.log(`Captured real ${target}`);
    await page.close();
  }
  if (errors.length) throw new Error(JSON.stringify(errors));
  passed = true;
} finally {
  try { await closeTestBrowser(browser); naturalCleanup = true; }
  finally {
    const updated = new Map((previous.entries ?? []).map(entry => [entry.target, entry]));
    entries.forEach(entry => updated.set(entry.target, entry));
    writeFileSync(`${directory}/manifest-extras.json`, JSON.stringify({ capturedAt:new Date().toISOString(), command:`${process.env.ONETHU_CAPTURE_TARGETS ? `ONETHU_CAPTURE_TARGETS=${process.env.ONETHU_CAPTURE_TARGETS} ` : ''}node tools/capture-tour-real-ui-extras.mjs`, targets, passed, naturalCleanup, entries:allTargets.flatMap(target => updated.has(target) ? [updated.get(target)] : []), errors }, null, 2)+'\n');
  }
}
