/** Capture uncomposited, actual OneTHU DOM for the studio phone screens. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';

const out = 'apps/desktop/src/assets/tour/real-ui';
mkdirSync(out, { recursive: true });
const assets = [], errors = [];
const fixture = {
  courses: [
    { id: 'demo-math', name: '高等数学', englishName: 'Calculus', courseNumber: 'demo-math', courseIndex: 1, teacherName: '示例教师', timeAndLocation: ['六教 6A101'], url: '' },
    { id: 'demo-design', name: '设计思维', englishName: 'Design Thinking', courseNumber: 'demo-design', courseIndex: 1, teacherName: '示例教师', timeAndLocation: ['三教 3200'], url: '' },
  ],
  homework: [
    { id: 'demo-hw-1', courseId: 'demo-math', title: '第二章习题', content: '课程示例作业', publishTime: '2026-10-18', deadline: '2026-10-20 23:59', submitted: false, graded: false, url: '' },
    { id: 'demo-hw-2', courseId: 'demo-design', title: '整理小组调研笔记', content: '课程示例作业', publishTime: '2026-10-19', deadline: '2026-10-21 18:00', submitted: false, graded: false, url: '' },
  ],
  notifications: [], files: [],
  schedule: [
    { courseName: '高等数学', date: '2026-10-20', dayOfWeek: 2, startSection: 3, endSection: 4, location: '六教 6A101', startTime: '09:50', endTime: '11:25', raw: {} },
    { courseName: '设计思维', date: '2026-10-20', dayOfWeek: 2, startSection: 6, endSection: 7, location: '三教 3200', startTime: '13:30', endTime: '15:05', raw: {} },
    { courseName: '高等数学', date: '2026-10-22', dayOfWeek: 4, startSection: 1, endSection: 2, location: '六教 6A101', startTime: '08:00', endTime: '09:35', raw: {} },
  ],
  user: { name: '示例同学', studentId: '2026000000', department: '示例院系', email: 'demo@example.invalid' },
  semester: { id: 'demo-2026-autumn' },
};
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--disable-updater-scheduler'],
});
const call = (page, file, name, args = []) => page.evaluate(async ({ file, name, args }) => {
  const path = '/src/state/' + file + '.ts';
  const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname === path) ?? path;
  return (await import(url))[name](...args);
}, { file, name, args });
let passed = false, naturalCleanup = false;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, timezoneId: 'Asia/Shanghai', locale: 'zh-CN' });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-10-20T02:00:00Z'));
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await installFakeCloud(page);
  await page.addInitScript(fixture => {
    localStorage.setItem('onethu.onboarded.phone', '1');
    localStorage.setItem('onethu.chatdock.open', '0');
    localStorage.setItem('onethu.overlay.closed', '1');
    window.__realTourFixture = fixture;
    performance.setResourceTimingBufferSize(10000);
  }, fixture);
  // Only API data is stubbed. All pages, CSS, controls, overlays and navigation are production components.
  await page.route('**/src/state/data.ts*', async route => {
    const response = await route.fetch(); let body = await response.text();
    for (const name of ['useLearnData', 'useCampusData']) {
      const needle = `export function ${name}() {`;
      assert.ok(body.includes(needle), 'Data fixture hook must match: ' + name);
      body = body.replace(needle, needle + 'return {data:window.__realTourFixture,state:"ready",error:null,reload:async()=>{}};');
    }
    const calendarHook = 'export function useCalendar() {';
    assert.ok(body.includes(calendarHook), 'Calendar data fixture hook must match');
    body = body.replace(calendarHook, calendarHook + 'return {data:{semesterId:"demo-2026-autumn",semesterName:"2026秋季学期",firstDay:"2026-09-07",weekCount:20,nextSemesterList:[]},state:"ready",error:null,reload:async()=>{}};');
    await route.fulfill({ response, body });
  });
  await page.goto('http://127.0.0.1:5180/?explorer-preview=onboarding');
  await page.locator('.explorer-shell').waitFor();
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname === '/src/lib/clients.ts') ?? '/src/lib/clients.ts';
    (await import(path)).info.getSchedule = async () => structuredClone(window.__realTourFixture.schedule);
  });
  const capture = async (key, mode, route, steps, fixtureDetails = {}) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350);
    if (await page.locator('.toast-host').count()) await page.locator('.toast-host').waitFor({ state: 'hidden', timeout: 6000 }).catch(() => {});
    assert.equal(await page.getByRole('dialog', { name: 'OneTHU 使用导览' }).count(), 0, 'Capture must not include the tour');
    const file = `${key}.png`, path = `${out}/${file}`;
    await page.screenshot({ path });
    assets.push({
      key, file, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      mode, route, url: page.url(), entrySteps: steps, fixture: { campus: 'isolated sample data via real data hooks', calendar: 'sample autumn semester and info.getSchedule date-window response', clock: '2026-10-20 10:00 Asia/Shanghai', ...fixtureDetails },
      source: 'Uncomposited Playwright page screenshot of actual application DOM; no synthetic status bar or replacement UI',
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    });
    console.log('Captured actual UI:', key);
  };
  const home = async (mode, submitted = false) => {
    await page.evaluate(submitted => { window.__realTourFixture = { ...window.__realTourFixture, homework: window.__realTourFixture.homework.map((item, index) => ({ ...item, submitted: index === 0 && submitted })) }; }, submitted);
    await call(page, 'experienceMode', 'setExperienceMode', [mode]);
    await call(page, 'experienceMode', 'navigateSimple', ['schedule']);
    await page.locator('[data-simple-page="schedule"]').waitFor();
    await page.getByRole('button', { name: '首页', exact: true }).click();
    await page.locator('.simple-home').waitFor();
  };
  for (const mode of ['simple', 'practical']) {
    await home(mode);
    await capture(`${mode}-home`, mode, 'homepage', ['Set the real experience mode', 'Use the actual 首页 button'], { submittedHomework: 0 });
    await home(mode, true);
    await capture(`${mode}-home-done`, mode, 'homepage', ['Fixture reports one submitted assignment', 'Re-enter actual 首页'], { submittedHomework: 1, semantic: 'Backend data fixture marks an assignment submitted; no nonexistent homepage checkbox is implied' });
  }
  await home('practical');
  await page.locator('.oneshot').getByRole('button', { name: '更多功能', exact: true }).click();
  const more = page.getByRole('dialog', { name: '更多功能', exact: true });
  await more.waitFor();
  await capture('practical-more', 'practical', 'homepage + 更多功能', ['Tap actual OneShot 更多功能']);
  await more.getByRole('button', { name: '把云盘放进快捷入口', exact: true }).click();
  await page.locator('.oneshot.is-placing').waitFor();
  await page.locator('.oneshot > button').nth(0).click();
  await page.waitForFunction(() => document.querySelector('.oneshot button')?.textContent?.includes('云盘'));
  await capture('practical-home-customized', 'practical', 'homepage', ['更多功能 → 把云盘放进快捷入口 → 入口1'], { customizedSlot: '1 = 云盘' });
  await page.locator('.oneshot').getByRole('button', { name: '课表', exact: true }).click();
  await page.locator('.schedule-workspace').waitFor();
  await capture('schedule', 'practical', 'schedule', ['Tap actual OneShot 课表']);
  await call(page, 'experienceMode', 'setExperienceMode', ['full']);
  const box = await call(page, 'vault', 'activeVault');
  await call(page, 'vault', 'renameVault', [box.id, '课程资料']);
  await call(page, 'vault', 'addToVault', [{ type: 'text', title: '课程笔记', text: '本周课程：极限与连续。复习第二章例题，整理小组问题。', source: '示例文字' }]);
  await call(page, 'vault', 'addToVault', [{ type: 'text', title: '小组讨论安排', text: '周三 16:00，在图书馆讨论设计调研。', source: '示例文字' }]);
  await call(page, 'vault', 'addToVault', [{ type: 'text', title: '阅读清单', text: '设计思维导论，第 3 章。', source: '示例文字' }]);
  await call(page, 'explorer', 'openTab', ['vault']);
  const vault = page.locator('[data-tab-page="vault"]:visible'); await vault.waitFor();
  await capture('vault', 'full', 'vault', ['Open actual VaultPage'], { vaultItems: ['课程笔记', '小组讨论安排', '阅读清单'], storage: 'isolated localStorage' });
  await vault.getByRole('button', { name: '分享口令', exact: true }).click();
  const send = page.getByRole('dialog', { name: '分享内容', exact: true }); await send.waitFor();
  await capture('vault-send-preview', 'full', 'vault + 分享内容', ['Click actual 分享口令'], { cloud: 'installFakeCloud; no real account requests' });
  await send.getByRole('button', { name: '生成分享口令', exact: true }).click();
  await send.locator('.vault-exchange-code').waitFor();
  const code = await send.locator('.vault-exchange-code').innerText();
  await capture('vault-send-code', 'full', 'vault + 分享内容 generated', ['Click actual 生成分享口令', 'Wait for actual result component'], { cloud: 'isolated fake-cloud transport', code: 'generated demo code, invalid outside this local fixture' });
  await page.keyboard.press('Escape'); await send.waitFor({ state: 'hidden' });
  await vault.getByRole('button', { name: '接收', exact: true }).click();
  const receive = page.getByRole('dialog', { name: '接收内容', exact: true }); await receive.waitFor();
  await receive.getByLabel('收到的口令').fill(code);
  await capture('vault-receive', 'full', 'vault + 接收内容', ['Click actual 接收', 'Fill the generated demo code'], { transport: 'short code; NFC remains unsupported in browser' });
  await receive.getByRole('button', { name: '接收口令', exact: true }).click();
  await receive.getByRole('status').waitFor();
  assert.match(await receive.getByRole('status').innerText(), /新暂存箱/);
  await capture('vault-received', 'full', 'vault + 接收内容 success', ['Click actual 接收口令', 'Wait for real import result and new vault'], { transport: 'actual application code flow against fake-cloud', hardwareNfcSuccess: false });
  assert.deepEqual(errors, []);
  passed = true;
} finally {
  try { await closeTestBrowser(browser); naturalCleanup = true; }
  finally { writeFileSync(`${out}/capture-core-manifest.json`, JSON.stringify({ passed, naturalCleanup, assets, errors, scope: 'Actual app DOM screenshots; fixtures replace data/transport only, never the UI' }, null, 2) + '\n'); }
}
console.log(`${assets.length} real application screenshots captured; browser cleanup complete`);
