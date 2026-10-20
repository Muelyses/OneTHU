/** Actual single-phone projection and screenshot comparison; no video or CPU benchmark. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const directory = 'docs/onegui/onboarding-autoplay-2026-10-20';
mkdirSync(directory, { recursive: true });
const phase = process.env.ONETHU_FRAMING_PHASE ?? 'after';
assert.ok(['before', 'after'].includes(phase));
const report = { phase, checks: [], errors: [], cases: [], passed: false, naturalCleanup: false };
const check = (value, message) => { assert.ok(value, message); report.checks.push(message); console.log('✓', message); };
const baseline = phase === 'after' ? JSON.parse(readFileSync(`${directory}/phone-framing-before.json`, 'utf8')) : null;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-updater-scheduler'] });
async function setup(width, height) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 600 });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  await installFakeCloud(page);
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await page.addInitScript(() => {
    localStorage.setItem('onethu.onboarded.phone', '1'); localStorage.setItem('onethu.chatdock.open', '0');
    window.__phoneFrames = [];
    window.__measurePhoneFrame = () => {
      const info = document.querySelector('[data-testid="tour-studio-canvas"]')?.__tourStudioInspect?.();
      if (!info) return null;
      const model = info.models.find(model => model.active), points = [];
      const mul = (matrix, point) => [0, 1, 2, 3].map(row => point.reduce((sum, value, column) => sum + matrix[column * 4 + row] * value, 0));
      for (const mesh of model.meshes.filter(mesh => mesh.visible)) for (let corner = 0; corner < 8; corner++) {
        const local = [0, 1, 2].map(axis => (corner & 1 << axis ? mesh.max : mesh.min)[axis]);
        const clip = mul(info.camera.projectionMatrix, mul(info.camera.matrixWorldInverse, mul(mesh.matrixWorld, [...local, 1])));
        points.push({ x: clip[0] / clip[3], y: clip[1] / clip[3], w: clip[3] });
      }
      const y = points.map(point => point.y);
      return {
        lesson: info.lesson, frames: info.frames, settled: info.settled, take: info.take?.kind ?? null,
        height: (Math.max(...y) - Math.min(...y)) / 2, pixels: (Math.max(...y) - Math.min(...y)) * info.viewport.height / 2,
        distance: info.camera.distance, viewport: info.viewport,
        minY: Math.min(...y), maxY: Math.max(...y), x: model.worldMatrix[12], opacity: model.opacity,
        fits: points.length > 0 && points.every(point => point.w > 0 && Math.abs(point.x) <= 1.015 && Math.abs(point.y) <= 1.015),
      };
    };
    const observe = () => {
      const sample = window.__measurePhoneFrame();
      if (sample && sample.frames !== window.__phoneFrames.at(-1)?.frames) window.__phoneFrames.push(sample);
      window.__phoneObserver = requestAnimationFrame(observe);
    };
    window.__phoneObserver = requestAnimationFrame(observe);
  });
  await page.goto('http://127.0.0.1:5180/?explorer-preview=onboarding');
  await page.locator('.explorer-shell').waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('onethu.onboarding.replay')));
  return page;
}
const ready = (page, lesson) => page.waitForFunction(lesson => {
  const info = document.querySelector('[data-testid="tour-studio-canvas"]')?.__tourStudioInspect?.();
  return info?.lesson === lesson && info.settled;
}, lesson);
try {
  for (const [width, height] of [[1280, 860], [390, 844], [320, 568], [844, 390]]) {
    const page = await setup(width, height), dialog = page.getByRole('dialog', { name: 'OneTHU 使用导览', exact: true });
    await dialog.getByRole('button', { name: '极简模式', exact: true }).click();
    await dialog.getByRole('button', { name: '按此模式开始', exact: true }).click();
    await page.locator('.tour-stage-canvas').scrollIntoViewIfNeeded();
    await ready(page, 'today');
    await dialog.getByRole('button', { name: '暂停演示', exact: true }).click();
    const measured = await page.evaluate(() => window.__measurePhoneFrame());
    const frames = await page.evaluate(() => window.__phoneFrames.filter(frame => frame.lesson === 'today'));
    report.cases.push({ name: `today-${width}`, ...measured, samples: frames });
    check(measured.fits, `${width} single phone and entire screenshot fit the canvas`);
    const footer = await dialog.locator('.tour-footer').evaluate(element => [...element.querySelectorAll('button')].map(button => {
      const bounds = button.getBoundingClientRect(), hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return { text: button.textContent, fits: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight, hit: !!hit && button.contains(hit) };
    }));
    check(footer.length > 0 && footer.every(button => button.fits && button.hit), `${width} fixed footer buttons remain visible and physically reachable`);
    report.cases.at(-1).footer = footer;
    if (phase === 'after') {
      const old = baseline.cases.find(item => item.name === `today-${width}`);
      check(measured.pixels / old.pixels >= 1.15, `${width} camera adds at least 15% on the already-enlarged stage (${(100 * (measured.pixels / old.pixels - 1)).toFixed(1)}%)`);
      check(measured.height >= .85 && measured.height <= .92, `${width} resting phone fills 85–92% of the canvas (${(100 * measured.height).toFixed(1)}%)`);
      const centeredFrames = frames.filter(frame => Math.abs(frame.x) < .005 && frame.opacity > .99);
      check(centeredFrames.length > 10 && centeredFrames.every(frame => frame.fits), `${width} intro turn and settling frames remain inside the view`);
    }
    await page.screenshot({ path: phase === 'before' ? `/tmp/onethu-phone-framing-before-${width}.png` : `${directory}/phone-framing-after-${width}.png` });
    if (width === 1280) {
      await dialog.getByRole('button', { name: '上一步', exact: true }).click();
      await dialog.getByRole('button', { name: '完整模式', exact: true }).click();
      await dialog.getByRole('button', { name: '按此模式开始', exact: true }).click();
      await dialog.getByRole('button', { name: '跳到：碰一碰', exact: true }).click();
      await page.locator('.tour-stage-canvas').scrollIntoViewIfNeeded();
      await ready(page, 'nfc');
      const nfc = await page.evaluate(() => window.__measurePhoneFrame());
      report.cases.push({ name: 'nfc-1280', ...nfc });
      check(nfc.fits, 'NFC two-phone scene remains fully framed');
      if (phase === 'after') check(Math.abs(nfc.height / baseline.cases.find(item => item.name === 'nfc-1280').height - 1) < .03, 'NFC apparent height stays within 3% while the physical bezel is refined');
    }
    await page.evaluate(() => cancelAnimationFrame(window.__phoneObserver));
    await page.close();
  }
  check(!report.errors.length, 'No uncaught application errors');
  report.passed = true;
} finally {
  try { await closeTestBrowser(browser); report.naturalCleanup = true; }
  finally { writeFileSync(`${directory}/phone-framing-${phase}.json`, JSON.stringify(report, null, 2) + '\n'); }
}
