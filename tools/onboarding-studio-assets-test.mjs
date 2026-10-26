/** Verify asynchronous screenshot decoding does not mount an empty studio or lose the fallback. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const directory = 'docs/onegui/onboarding-autoplay-2026-10-20';
mkdirSync(directory, { recursive: true });
const checks = [], errors = [];
const report = { checks, errors, passed: false, naturalCleanup: false };
const check = (value, message) => { assert.ok(value, message); checks.push(message); console.log('✓', message); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-updater-scheduler'] });
async function setup() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await installFakeCloud(page);
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await page.addInitScript(() => {
    localStorage.setItem('onethu.onboarded.phone', '1');
    localStorage.setItem('onethu.chatdock.open', '0');
    performance.setResourceTimingBufferSize(10000);
  });
  return page;
}
async function open(page) {
  await page.goto('http://127.0.0.1:5180/?explorer-preview=onboarding', { waitUntil: 'domcontentloaded' });
  await page.locator('.explorer-shell').waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('onethu.onboarding.replay')));
  const dialog = page.getByRole('dialog', { name: 'OneTHU 使用导览', exact: true });
  await dialog.getByRole('button', { name: '完整模式', exact: true }).click();
  await dialog.getByRole('button', { name: '按此模式开始', exact: true }).click();
  return dialog;
}
let release = () => {};
try {
  const page = await setup();
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/tour/real-ui/*.png*', async route => {
    if (route.request().resourceType() === 'image') await pending;
    await route.continue();
  });
  await open(page);
  await page.locator('.tour-studio-scene[data-context-state="loading-assets"]').waitFor();
  check(await page.getByRole('status').filter({ hasText: '正在载入真实界面' }).isVisible(), 'Pending decode shows an explicit loading status');
  check(await page.locator('[data-testid="tour-studio-canvas"]').count() === 0, 'No empty WebGL model is created before screenshots decode');
  release();
  await page.locator('.tour-studio-scene[data-renderer="webgl"]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="tour-studio-canvas"]')?.__tourStudioInspect?.().frames > 5);
  const info = await page.locator('[data-testid="tour-studio-canvas"]').evaluate(canvas => canvas.__tourStudioInspect());
  const screenshots = info.models.flatMap(model => model.meshes).filter(mesh => mesh.screen);
  check(screenshots.length > 0 && screenshots.every(mesh => mesh.textureSources.some(source => source?.includes('/assets/tour/real-ui/'))), 'Actual image-backed screen materials use the bundled real UI captures');
  check(info.renderer.calls > 0, 'Decoded screen assembly performs real Three.js draws');
  await page.screenshot({ path: `${directory}/asset-gate-loaded.png` });
  await page.close();

  const fallback = await setup();
  await fallback.route('**/assets/tour/real-ui/simple-home.png*', route => route.request().resourceType() === 'image' ? route.abort() : route.continue());
  const dialog = await open(fallback);
  await fallback.locator('.tour-studio-scene[data-context-state="assets-unavailable"]').waitFor();
  check(await fallback.locator('[data-testid="tour-studio-canvas"]').count() === 0, 'A failed asset keeps the functional fallback instead of a blank renderer');
  await fallback.waitForFunction(() => document.querySelector('.experience-tour .tour-stage')?.getAttribute('data-phase') === 'after');
  check(true, 'Asset failure preserves the automatic fallback sequence');
  await dialog.getByRole('button', { name: '下一步', exact: true }).click();
  await fallback.waitForFunction(() => document.querySelector('.experience-tour .tour-stage')?.getAttribute('data-lesson') === 'vault');
  check(await dialog.getByRole('button', { name: '打开暂存箱', exact: true }).isVisible(), 'Asset failure preserves chapter navigation and real feature action');
  await fallback.screenshot({ path: `${directory}/asset-gate-fallback.png` });
  check(errors.length === 0, 'No uncaught application errors in loading, success, or failure paths');
  report.passed = true;
} finally {
  release();
  try { await closeTestBrowser(browser); report.naturalCleanup = true; }
  finally { writeFileSync(`${directory}/asset-gate-report.json`, JSON.stringify(report, null, 2) + '\n'); }
}
