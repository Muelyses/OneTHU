/** Unmodified app UI, isolated service/IPC data. Capture the actual Xiaoda page. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { installXiaodaTourFixture } from './lib/xiaoda-tour-fixture.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = 'apps/desktop/src/assets/tour/real-ui';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const entries = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/*', () => {});
  await installFakeCloud(page);
  await installXiaodaTourFixture(page);
  await page.addInitScript(() => {
    localStorage.setItem('onethu.onboarded.flow4', '1');
    localStorage.setItem('onethu.overlay.closed', '1');
    localStorage.setItem('onethu.experience.v1', 'full');
    localStorage.setItem('onethu.locale', 'zh-CN');
    performance.setResourceTimingBufferSize(10000);
  });
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.fallback() : route.abort());
  await page.goto(base + '/?explorer-preview=onboarding');
  await page.locator('.explorer-shell').waitFor();
  await page.evaluate(async () => {
    const path = '/src/lib/onboardingNavigation.ts';
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname === path) ?? path;
    (await import(url)).openLessonTarget('xiaoda');
  });
  const panel = page.locator('[data-tab-page="xiaoda"]:visible');
  await panel.getByRole('textbox').waitFor();
  const capture = async key => {
    if (key === 'xiaoda-skills') await panel.getByText('OH 技能库', { exact: true }).evaluate(element => {
      element.scrollIntoView({ block: 'start' });
      for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) { parent.scrollTop -= 80; break; }
    });
    else await panel.getByRole('heading', { name: '清小搭', exact: true }).scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350);
    const file = key + '.png';
    await page.screenshot({ path: out + '/' + file, animations: 'disabled' });
    entries.push({ key, file, sha256: createHash('sha256').update(readFileSync(out + '/' + file)).digest('hex'), viewport: { width: 390, height: 844, deviceScaleFactor: 2 }, mode: 'full', route: 'xiaoda', source: 'Uncomposited real app screenshot; production components and styles; isolated Xiaoda/skill data adapter; no school requests or private account data' });
  };
  await panel.getByRole('textbox').fill('帮我规划一下这周的复习。');
  await panel.getByRole('button', { name: '发送', exact: true }).click();
  await panel.getByText('可以先按课程整理重点', { exact: false }).waitFor();
  await capture('xiaoda-chat');
  await panel.getByRole('tab', { name: '智能体', exact: true }).click();
  await panel.getByText('学习规划助手', { exact: true }).waitFor();
  assert.equal(await panel.getByRole('button', { name: '找它聊', exact: true }).count(), 1);
  await panel.getByRole('tab', { name: '技能', exact: true }).click();
  await panel.getByText('OH 技能库', { exact: true }).waitFor();
  await panel.getByText('示例资料整理', { exact: true }).first().waitFor();
  assert.equal(await panel.getByText('请先登录 OneTHU 与清小搭，再重试。', { exact: true }).count(), 0, 'Capture must show a ready skill library, not an authentication error');
  await capture('xiaoda-skills');
  assert.deepEqual(errors, []);
} finally {
  await closeTestBrowser(browser);
  writeFileSync(out + '/manifest-xiaoda.json', JSON.stringify({ entries, errors, passed: entries.length === 2 && !errors.length, command: 'node tools/capture-tour-xiaoda.mjs' }, null, 2) + '\n');
}
