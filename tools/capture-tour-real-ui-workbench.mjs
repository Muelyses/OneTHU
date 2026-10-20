/** Capture the real full-mode homepage and organization UI for physical studio screens. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { installFakeOrganization } from './lib/fake-org.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';

const directory = 'apps/desktop/src/assets/tour/real-ui';
mkdirSync(directory, { recursive: true });
const assets = [], errors = [];
const fixture = {
  courses: [{ id: 'demo-math', name: '高等数学', englishName: 'Calculus', courseNumber: 'demo-math', courseIndex: 1, teacherName: '示例教师', timeAndLocation: ['六教 6A101'], url: '' }],
  homework: [{ id: 'demo-hw-1', courseId: 'demo-math', title: '第二章习题', content: '课程示例作业', publishTime: '2026-10-18', deadline: '2026-10-20 23:59', submitted: false, graded: false, url: '' }],
  notifications: [], files: [],
  schedule: [{ courseName: '高等数学', date: '2026-10-20', dayOfWeek: 2, startSection: 3, endSection: 4, location: '六教 6A101', startTime: '09:50', endTime: '11:25', raw: {} }],
  user: { name: '示例同学', studentId: '2026000000', department: '示例院系', email: 'demo@example.invalid' },
  semester: { id: 'demo-2026-autumn' },
};
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--disable-updater-scheduler'],
});
const call = (page, file, name, args = []) => page.evaluate(async ({ file, name, args }) => {
  const path = `/src/state/${file}.ts`;
  const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname === path) ?? path;
  return (await import(url))[name](...args);
}, { file, name, args });
let passed = false, naturalCleanup = false;
async function setup(width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: width < 600, timezoneId: 'Asia/Shanghai', locale: 'zh-CN' });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-10-20T02:00:00Z'));
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await installFakeCloud(page);
  await installFakeOrganization(page);
  await page.addInitScript(fixture => {
    localStorage.setItem('onethu.onboarded.phone', '1');
    localStorage.setItem('onethu.onboarded.flow4', '1');
    localStorage.setItem('onethu.experience.v1', 'full');
    localStorage.setItem('onethu.chatdock.open', '0');
    localStorage.setItem('onethu.overlay.closed', '1');
    window.__realTourFixture = fixture;
    performance.setResourceTimingBufferSize(10000);
  }, fixture);
  await page.route('**/src/state/data.ts*', async route => {
    const response = await route.fetch(); let body = await response.text();
    for (const name of ['useLearnData', 'useCampusData']) {
      const needle = `export function ${name}() {`;
      assert.ok(body.includes(needle));
      body = body.replace(needle, needle + 'return {data:window.__realTourFixture,state:"ready",error:null,reload:async()=>{}};');
    }
    const calendarHook = 'export function useCalendar() {';
    assert.ok(body.includes(calendarHook));
    body = body.replace(calendarHook, calendarHook + 'return {data:{semesterId:"demo-2026-autumn",semesterName:"2026秋季学期",firstDay:"2026-09-07",weekCount:20,nextSemesterList:[]},state:"ready",error:null,reload:async()=>{}};');
    await route.fulfill({ response, body });
  });
  await page.goto('http://127.0.0.1:5180/?explorer-preview=home');
  await page.locator('.explorer-shell').waitFor();
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname === '/src/lib/clients.ts') ?? '/src/lib/clients.ts';
    (await import(path)).info.getSchedule = async () => structuredClone(window.__realTourFixture.schedule);
  });
  return page;
}
async function capture(page, key, route, entrySteps, details = {}) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  if (await page.locator('.toast-host').count()) await page.locator('.toast-host').waitFor({ state: 'hidden', timeout: 6000 });
  assert.equal(await page.getByRole('dialog', { name: 'OneTHU 使用导览' }).count(), 0);
  const file = `${key}.png`, path = `${directory}/${file}`;
  await page.screenshot({ path });
  assets.push({
    key, file, viewport: page.viewportSize(), deviceScaleFactor: 1, safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    mode: 'full', route, entrySteps, url: page.url(),
    fixture: { campus: 'isolated sample data through production data hooks', clock: '2026-10-20 10:00 Asia/Shanghai', ...details },
    source: 'Uncomposited screenshot of real production app DOM; no inserted UI, redraw, status bar, or screenshot montage',
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  });
  console.log('Captured actual UI:', key);
}
try {
  const desktop = await setup(1024, 620);
  await desktop.locator('.freeboard').waitFor();
  await capture(desktop, 'board-full', 'homepage', ['Open actual full-mode homepage']);
  await desktop.close();
  const mobile = await setup(390, 844);
  await mobile.locator('.freeboard').waitFor();
  await capture(mobile, 'full-home-mobile', 'homepage', ['Open actual full-mode homepage on phone']);
  await call(mobile, 'explorer', 'openTab', ['contacts', { section: 'orgs' }]);
  await mobile.getByRole('radio', { name: '我的组织', exact: true }).click();
  await mobile.getByRole('button', { name: '新建组织', exact: true }).click();
  await mobile.locator('.plg-form-modal input').first().fill('设计研习小组');
  await mobile.locator('.plg-form-modal textarea').fill('一起收集灵感，完成每周设计练习');
  await mobile.getByRole('button', { name: '提交', exact: true }).click();
  await mobile.getByRole('heading', { name: '设计研习小组', exact: true }).waitFor();
  await mobile.getByRole('button', { name: '启用多人协作', exact: true }).click();
  await mobile.waitForFunction(() => JSON.parse(localStorage.getItem('onethu.orgs.v1')).orgs[0]?.collaboration?.status === 'ready');
  await mobile.getByRole('radio', { name: '成员', exact: true }).click();
  await mobile.getByRole('button', { name: '添加成员', exact: true }).click();
  await mobile.locator('.plg-form-modal input').nth(0).fill('lisi');
  await mobile.locator('.plg-form-modal input').nth(1).fill('lisi@mails.tsinghua.edu.cn');
  await mobile.getByRole('button', { name: '提交', exact: true }).click();
  await mobile.getByText('lisi@mails.tsinghua.edu.cn', { exact: false }).waitFor();
  await mobile.getByRole('radio', { name: '概览', exact: true }).click();
  await mobile.locator('.identity-card-name').filter({ hasText: '设计研习小组' }).waitFor();
  await capture(mobile, 'organization', 'org overview', ['通讯录 → 新建组织', '启用多人协作 against isolated fake organization server', '成员 → 添加成员', '概览'], {
    organization: 'Isolated fake GitLab/Seafile services; actual organization UI and production synchronization flow',
    members: ['fixture owner', 'fixture lisi'], hardwareOrLiveServiceClaim: false,
  });
  assert.deepEqual(errors, []);
  passed = true;
} finally {
  try { await closeTestBrowser(browser); naturalCleanup = true; }
  finally { writeFileSync(`${directory}/capture-extra-manifest.json`, JSON.stringify({ passed, naturalCleanup, assets, errors }, null, 2) + '\n'); }
}
console.log(`${assets.length} real UI assets captured; browser cleanup complete`);
