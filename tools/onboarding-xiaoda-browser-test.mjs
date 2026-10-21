/** The full-mode Xiaoda lesson: actual guide, 3D screens, navigation and return. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { installXiaodaTourFixture } from './lib/xiaoda-tour-fixture.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = '/Volumes/OneTHUBuild/artifacts/onboarding-xiaoda';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const checks = [], errors = [];
let passed = false, naturalCleanup = false;
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); console.log('✓ ' + label); };
try {
 for (const [width, height, locale, motion] of [[1280,860,'zh-CN','no-preference'],[390,844,'zh-CN','no-preference'],[390,844,'en-US','no-preference'],[320,568,'en-US','reduce']]) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 600, reducedMotion: motion });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', e => errors.push(e.message));
  await page.routeWebSocket('**/*', socket => socket.close());
  await installFakeCloud(page); await installXiaodaTourFixture(page);
  await page.addInitScript(locale => {
    localStorage.setItem('onethu.locale', locale); localStorage.setItem('onethu.overlay.closed','1');
    localStorage.setItem('onethu.experience.v1','full');
  }, locale);
  await page.goto(base + '/?explorer-preview=onboarding&tour=1');
  const tour = page.locator('.experience-tour');
  await tour.locator('.tour-language-continue').click();
  await tour.locator('.tour-next').click();
  await tour.locator('.tour-chapters button').nth(5).click();
  await tour.locator('[data-lesson="xiaoda"].tour-shell').waitFor();
  const label = width + '/' + locale + '/' + motion;
  check(await tour.getByRole('heading', { name: locale === 'zh-CN' ? '清小搭 in OneTHU' : 'Qingxiaoda in OneTHU', exact: true }).isVisible(), label + ': dedicated full-mode lesson');
  check(await tour.locator('.tour-steps li').count() === 4, label + ': chat, agents, skills and unsupported environments');
  if (locale === 'en-US') check(!/[\u3400-\u9fff]/u.test(await tour.locator('.tour-copy').innerText()), label + ': English copy has no Chinese fallback');
  check(await tour.locator('.tour-chapters [aria-current="step"]').innerText().then(text => /清小搭|Qingxiaoda/.test(text)), label + ': chapter navigation selects Xiaoda');
  await page.waitForFunction(() => {
    const stage = document.querySelector('.experience-tour .tour-stage');
    return stage?.dataset.phase === 'after' && (stage.querySelector('.tour-studio-scene')?.dataset.renderer === 'fallback' || stage.querySelector('canvas')?.__tourStudioInspect?.().settled);
  }, null, { timeout: 25000 });
  check(await tour.locator('.tour-stage').getAttribute('data-autoplay') === 'true', label + ': automatic demonstration');
  const screens = await tour.locator('.tour-stage').evaluate(stage => {
    const info = stage.querySelector('canvas')?.__tourStudioInspect?.();
    return info ? info.models.filter(model => model.active).flatMap(model => model.meshes.filter(mesh => mesh.screen).map(mesh => mesh.screen.key)) : [...stage.querySelectorAll('img[data-screen]')].map(image => image.dataset.screen);
  });
  check(screens.includes('xiaoda-chat') && screens.includes('xiaoda-skills'), label + ': real chat and skill screen assets');
  if (motion === 'reduce') check(await tour.locator('.tour-stage').getAttribute('data-running') === 'false', label + ': reduced motion remains static');
  check(await tour.evaluate(panel => { const box = panel.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1 && panel.querySelector('.tour-shell').scrollWidth <= panel.querySelector('.tour-shell').clientWidth + 1; }), label + ': guide fits viewport without sideways clipping');
  const action = tour.getByRole('button', { name: locale === 'zh-CN' ? '打开清小搭' : 'Open Qingxiaoda', exact: true });
  await action.scrollIntoViewIfNeeded();
  check(await action.evaluate(button => { const box=button.getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight&&button.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)); }), label + ': practice action is reachable');
  await page.screenshot({ path: out + `/lesson-${width}-${locale}-${motion}.png` });
  await action.click();
  const panel = page.locator('[data-tab-page="xiaoda"]:visible');
  await panel.getByRole('textbox').waitFor();
  check(await panel.getByRole('tab').count() === 4, label + ': opens actual Xiaoda with four tabs');
  await panel.getByRole('tab').nth(2).click();
  await panel.getByText('学习规划助手', { exact: true }).waitFor();
  await panel.getByRole('tab').nth(3).click();
  await panel.getByText(locale === 'zh-CN' ? 'OH 技能库' : 'OH skill library', { exact: true }).waitFor();
  check(true, label + ': agents and skill library are usable on destination');
  await page.locator('.tour-resume').getByRole('button').first().click();
  await tour.locator('[data-lesson="xiaoda"].tour-shell').waitFor();
  check(true, label + ': continue returns to the same lesson');
  await tour.locator('.tour-next').click();
  await tour.locator('[data-tour-phase="ready"]').waitFor();
  check(true, label + ': next reaches completion page');
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.request.dispose();
  await context.close();
 }
 check(errors.length === 0, 'No React runtime errors');
 passed = true;
} finally {
 try { await closeTestBrowser(browser); naturalCleanup = true; }
 finally { writeFileSync(out + '/report.json', JSON.stringify({ passed: passed && naturalCleanup, naturalCleanup, checks, errors, scope: 'Actual app UI with isolated Xiaoda/IPC fixtures; desktop and touch viewport; no school account or hardware performance claim.' }, null, 2)); }
}
