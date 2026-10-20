/** Re-enter a still-retiring lesson from a different mode using real guide buttons. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const directory = 'docs/onegui/onboarding-autoplay-2026-10-20';
mkdirSync(directory, { recursive: true });
const checks = [], errors = [];
const report = { checks, errors, passed: false, naturalCleanup: false };
const check = (value, text) => { assert.ok(value, text); checks.push(text); console.log('✓', text); };
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-updater-scheduler'] });
const inspect = page => page.locator('[data-testid="tour-studio-canvas"]').evaluate(canvas => canvas.__tourStudioInspect());
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await installFakeCloud(page);
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await page.addInitScript(() => { localStorage.setItem('onethu.onboarded.phone', '1'); localStorage.setItem('onethu.chatdock.open', '0'); });
  await page.goto('http://127.0.0.1:5180/?explorer-preview=onboarding');
  await page.locator('.explorer-shell').waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('onethu.onboarding.replay')));
  const dialog = page.getByRole('dialog', { name: 'OneTHU 使用导览', exact: true });
  await dialog.getByRole('button', { name: '实用模式', exact: true }).click();
  await dialog.getByRole('button', { name: '按此模式开始', exact: true }).click();
  await page.waitForFunction(() => {
    const info = document.querySelector('[data-testid="tour-studio-canvas"]')?.__tourStudioInspect?.();
    return info?.lesson === 'today' && info.settled;
  });
  const initial = await inspect(page), initialToday = initial.models.find(model => model.active);
  check(initialToday.mode === 'practical' && initialToday.meshes.some(mesh => mesh.visible && mesh.screen?.key === 'practical-home'), 'Initial actual Today scene uses practical-home');
  const canvas = await page.locator('[data-testid="tour-studio-canvas"]').elementHandle();

  await dialog.getByRole('button', { name: '上一步', exact: true }).click();
  await dialog.getByRole('button', { name: '极简模式', exact: true }).click();
  const intermediate = await inspect(page);
  const retiring = intermediate.models.find(model => model.lesson === 'today' && !model.active);
  check(intermediate.lesson === 'mode-simple' && retiring?.mode === 'practical' && retiring.opacity > .002, 'The old practical Today actor is still retiring while the requested mode is already simple');
  report.intermediate = { lesson: intermediate.lesson, retiringMode: retiring.mode, retiringOpacity: retiring.opacity, retiringMatrix: retiring.worldMatrix };

  await dialog.getByRole('button', { name: '按此模式开始', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="tour-studio-canvas"]')?.__tourStudioInspect?.().lesson === 'today');
  const returning = await inspect(page), returned = returning.models.find(model => model.active);
  check(returned.mode === 'simple', 'Reused Today actor checks its own creation mode');
  check(returned.meshes.filter(mesh => mesh.screen).every(mesh => mesh.screen.key.startsWith('simple-home')), 'Every reactivated Today screen is rebuilt from simple screenshots');
  check(returned.meshes.filter(mesh => mesh.screen).every(mesh => mesh.textureSources.some(source => source?.includes('/simple-home'))), 'Actual texture image sources match simple mode rather than metadata alone');
  check(await canvas.evaluate(element => element === document.querySelector('[data-testid="tour-studio-canvas"]')), 'Rapid mode switch preserves the existing WebGL canvas');
  report.returning = { mode: returned.mode, opacity: returned.opacity, matrix: returned.worldMatrix, screenKeys: returned.meshes.filter(mesh => mesh.screen).map(mesh => mesh.screen.key) };
  await page.waitForFunction(() => document.querySelector('[data-testid="tour-studio-canvas"]')?.__tourStudioInspect?.().settled);
  await dialog.getByRole('button', { name: '暂停演示', exact: true }).click();
  await page.screenshot({ path: `${directory}/rapid-mode-simple.png` });
  check(errors.length === 0, 'Rapid cross-mode return has no uncaught errors');
  report.passed = true;
} finally {
  try { await closeTestBrowser(browser); report.naturalCleanup = true; }
  finally { writeFileSync(`${directory}/rapid-mode-report.json`, JSON.stringify(report, null, 2) + '\n'); }
}
