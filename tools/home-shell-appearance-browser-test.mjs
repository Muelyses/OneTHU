/** Wide-screen centering and home material regression using the real application.
 *
 * Covers three reported Windows/wide-screen defects:
 *   1. limited-width pages and the compact shell sit at the leading edge instead of centered;
 *   2. hovering a primary-function dock icon paints a second, darker surface on the icon;
 *   3. the clock keeps an extra opaque plate and halo with wallpaper/transparent glass.
 *
 * Runs its own Vite server (or reuses ONETHU_TEST_URL), isolated storage, Windows
 * platform hint, no external requests. Browser coverage, not a claim of native
 * Windows WebView2 execution.
 *
 * Run: node tools/home-shell-appearance-browser-test.mjs
 *   ONETHU_PLAYWRIGHT_PATH / CHROME_BIN select existing local tools;
 *   ONETHU_TEST_OUT overrides the report and screenshot directory.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.ONETHU_PLAYWRIGHT_PATH
  ? pathToFileURL(process.env.ONETHU_PLAYWRIGHT_PATH).href : 'playwright');
const out = process.env.ONETHU_TEST_OUT ?? join(tmpdir(), 'onethu-home-shell-appearance');
mkdirSync(out, { recursive: true });
const report = { checks: [], failures: [], errors: [], samples: [], screenshots: [], passed: false };
const check = (ok, label) => {
  report.checks.push(label);
  if (!ok) report.failures.push(label);
  console.log((ok ? '✓ ' : '✗ ') + label);
};

/* Host the real application unless the caller already runs Vite. A separate cache
   directory keeps this test independent from any long-lived dev server. */
const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
let server, cacheDir;
let base = process.env.ONETHU_TEST_URL;
if (!base) {
  const { createServer } = await import(pathToFileURL(join(dirname(requireDesktop.resolve('vite/package.json')), 'dist/node/index.js')).href);
  cacheDir = mkdtempSync(join(tmpdir(), 'onethu-appearance-vite-'));
  server = await createServer({
    root: resolve('apps/desktop'), configFile: resolve('apps/desktop/vite.config.ts'),
    cacheDir, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  });
  await server.listen();
  base = 'http://127.0.0.1:' + server.httpServer.address().port;
}
const origin = new URL(base).origin;
const call = (page, path, name, args = []) => page.evaluate(async ({ path, name, args }) => {
  const url = performance.getEntriesByType('resource').map(e => e.name)
    .findLast(u => new URL(u).pathname === path) ?? path;
  return (await import(url))[name](...args);
}, { path, name, args });
const savedBoard = page => page.evaluate(() => localStorage.getItem('onethu.board.v1'));
const shot = async (page, name) => {
  const path = join(out, name + '.png');
  await page.screenshot({ path, animations: 'disabled' }); report.screenshots.push(path);
};
const transparent = color => color === 'rgba(0, 0, 0, 0)' || /\/ 0\)$/.test(color);
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });

async function setup(width, mode = 'full', vertical = false, scenario = 'home') {
  const context = await browser.newContext({
    viewport: { width, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', hasTouch: width < 600,
  });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', e => report.errors.push(e.message));
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.addInitScript(({ mode, vertical }) => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32' });
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('onethu.privacy.v1', JSON.stringify({ acknowledged: true, cloud: true, oh: false }));
    localStorage.setItem('onethu.experience.v1', mode);
    localStorage.setItem('onethu.onboarded.flow4', '1');
    localStorage.setItem('onethu.overlay.closed', '1');
    localStorage.setItem('onethu.chatdock.open', '0');
    localStorage.setItem('explorer.tabLayout.default', vertical ? 'v' : 'h');
  }, { mode, vertical });
  await page.goto(base + '/?explorer-preview=' + scenario);
  await page.locator(mode === 'full' ? '.explorer-panel:not([style*="none"])' : '.simple-home').first().waitFor();
  await page.waitForTimeout(600);
  return page;
}
async function ordinaryPage(page, pageId, mode) {
  await page.goto(base + '/?explorer-preview=page&page=' + pageId);
  await page.waitForFunction(id => document.querySelector('main')?.dataset.activePage === id, pageId);
  await page.waitForTimeout(400);
}
async function center(page, selector, label, { fullWidth = false } = {}) {
  const g = await page.locator(selector).first().evaluate(el => {
    const main = document.querySelector('main'), shell = main.parentElement;
    const r = el.getBoundingClientRect(), s = shell.getBoundingClientRect();
    const rail = parseFloat(getComputedStyle(main).getPropertyValue('--ex-rail-w')) || 0;
    return {
      left: Math.round(r.left - s.left - rail), right: Math.round(s.right - r.right),
      width: Math.round(r.width), available: Math.round(s.width - rail), rail,
      scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth,
    };
  });
  report.samples.push({ label, ...g });
  check(Math.abs(g.left - g.right) <= 2, label + ': centered in the available area (excluding rail)');
  check(g.left >= -1 && g.right >= -1 && g.scrollWidth <= g.viewport + 1, label + ': no horizontal clipping');
  if (fullWidth) check(Math.abs(g.width - g.available) <= 2, label + ': retains edge-to-edge width');
}
async function iconSurface(page, locator, label, { expectButtonFeedback = true } = {}) {
  await locator.hover(); await page.waitForTimeout(250);
  const s = await locator.evaluate(el => {
    const icon = getComputedStyle(el.querySelector('.sphere-ball'));
    return {
      background: getComputedStyle(el).backgroundColor, icon: icon.backgroundColor,
      image: icon.backgroundImage, shadow: icon.boxShadow, border: icon.borderWidth,
    };
  });
  report.samples.push({ label, ...s });
  if (expectButtonFeedback) check(!transparent(s.background), label + ': button retains hover feedback');
  check(transparent(s.icon) && s.image === 'none' && s.shadow === 'none' && s.border === '0px', label + ': icon adds no second surface');
}
async function clockMaterial(page, label, level) {
  const c = await page.locator('.chrome-clock').evaluate(el => {
    const s = getComputedStyle(el), outer = getComputedStyle(el.closest('.free-item'));
    return {
      background: s.backgroundColor, shadow: s.boxShadow, image: s.backgroundImage,
      material: outer.backgroundColor, blur: outer.backdropFilter, scheme: document.documentElement.dataset.ogScheme,
    };
  });
  report.samples.push({ label, ...c });
  check(transparent(c.background) && c.shadow === 'none' && c.image === 'none', label + ': clock has no opaque inner plate or halo');
  // The glass skin may hand an opted-in surface to the optical edge-refraction
  // filter, whose SVG graph contains the same blur plus real displacement. Both
  // forms are the selected material; an empty backdrop is the regression.
  const optical = /url\("#og-lens-\d+"\)/.test(c.blur);
  const blurred = c.blur.includes('blur(');
  check(!transparent(c.material) && (level === 'balanced' ? c.blur === 'none' : optical || blurred),
    label + ': outer clock card retains selected material');
}

try {
  for (const [width, vertical] of [[1920, false], [2560, false], [1280, false], [900, false], [375, false], [1920, true]]) {
    const page = await setup(width, 'full', vertical), label = `${width}/${vertical ? 'vertical' : 'horizontal'}`;
    const saved = await savedBoard(page);
    await center(page, '.home-free > .freeboard-wrap', label + ' home canvas');
    for (const pageId of ['tasks', 'trace', 'info', 'services', 'cloud']) {
      await ordinaryPage(page, pageId, 'full');
      await center(page, 'main', label + ' ' + pageId);
    }
    await page.goto(base + '/?explorer-preview=home');
    await page.locator('.home-free .free-item').first().waitFor();
    await page.evaluate(id => import(performance.getEntriesByType('resource').map(e => e.name)
      .findLast(u => new URL(u).pathname === '/src/state/explorer.ts') ?? '/src/state/explorer.ts')
      .then(m => m.openTab(id)), 'schedule');
    await page.waitForFunction(() => document.documentElement.classList.contains('is-schedule-page'));
    await page.waitForTimeout(300);
    await center(page, 'main', label + ' schedule', { fullWidth: true });
    check(await savedBoard(page) === saved, label + ': navigation never rewrites board geometry');

    if (width === 1920 && !vertical) {
      await page.goto(base + '/?explorer-preview=home');
      await page.locator('.home-free .free-item').first().waitFor();
      for (const scheme of ['light', 'dark']) {
        await page.evaluate(v => { document.documentElement.dataset.scheme = v; }, scheme);
        for (const level of ['balanced', 'clear', 'rich', 'deep']) {
          await call(page, '/src/lib/glassLevel.ts', 'setGlassLevel', [level]);
          await call(page, '/src/state/wallpaper.ts', 'setGlobalWallpaper', ['builtin:aurora']);
          await page.waitForTimeout(250);
          const name = `${scheme}/${level}`;
          await iconSurface(page, page.locator('.home-services-widget .hs-dock-sphere').first(), name + ' home dock hover');
          await clockMaterial(page, name + ' clock', level);
          if (level === 'clear') await shot(page, 'home-glass-' + scheme);
        }
      }
      // Dark scheme + a light CUSTOM wallpaper: the dock icon must take the same ink
      // as its label instead of falling back to the dark-theme white ink.
      await page.evaluate(async () => {
        const f = (s) => performance.getEntriesByType('resource').map(e => e.name).findLast(u => new URL(u).pathname.endsWith(s));
        const theme = await import(f('/src/state/theme.ts'));
        theme.activateTheme('onethu.theme.night');
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f2efe6'; ctx.fillRect(0, 0, 64, 64);
        const wallpaper = await import(f('/src/state/wallpaper.ts'));
        wallpaper.setGlobalWallpaper(canvas.toDataURL('image/png'));
        await new Promise(r => setTimeout(r, 2800));
      });
      const customWallInk = await page.evaluate(() => {
        const button = document.querySelector('.home-services-widget .hs-dock-sphere');
        const name = button?.querySelector('.sphere-name');
        const ball = button?.querySelector('.sphere-ball');
        return {
          label: name ? getComputedStyle(name).color : null,
          icon: ball ? getComputedStyle(ball).color : null,
          lum: document.querySelector('.explorer-shell')?.getAttribute('data-wallpaper-lum'),
        };
      });
      report.samples.push({ customWallInk });
      check(customWallInk.lum === 'light' && customWallInk.label === customWallInk.icon,
        'dark scheme + light custom wallpaper keeps dock icon ink in sync with its label');

      // Follow-system day/night: the two background slots switch with prefers-color-scheme.
      await page.evaluate(async () => {
        const f = (s) => performance.getEntriesByType('resource').map(e => e.name).findLast(u => new URL(u).pathname.endsWith(s));
        const theme = await import(f('/src/state/theme.ts'));
        const wallpaper = await import(f('/src/state/wallpaper.ts'));
        theme.setDayNightTheme('onethu.theme.ivory', 'onethu.theme.night');
        theme.setFollowSystem(true);
        wallpaper.setWallpaperSlot('day', 'builtin:aurora');
        wallpaper.setWallpaperSlot('night', 'builtin:ink');
        await new Promise(r => setTimeout(r, 300));
      });
      const dayNight = async () => page.evaluate(() => {
        const layer = document.querySelector('.shell-wallpaper-img');
        return { scheme: document.documentElement.dataset.scheme, bg: layer ? getComputedStyle(layer).backgroundImage : null };
      });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(700);
      const nightBg = await dayNight();
      await page.emulateMedia({ colorScheme: 'light' });
      await page.waitForTimeout(700);
      const dayBg = await dayNight();
      report.samples.push({ dayNight: { day: dayBg, night: nightBg } });
      check(nightBg.scheme === 'dark' && /rgb\(23, 24, 28\)|rgb\(35, 37, 43\)/.test(nightBg.bg ?? ''),
        'follow-system uses the night background in dark mode');
      check(dayBg.scheme !== 'dark' && /rgb\(26, 35, 64\)/.test(dayBg.bg ?? ''),
        'follow-system uses the day background in light mode');
      await page.evaluate(async () => {
        const f = (s) => performance.getEntriesByType('resource').map(e => e.name).findLast(u => new URL(u).pathname.endsWith(s));
        (await import(f('/src/state/theme.ts'))).setFollowSystem(false);
        const wallpaper = await import(f('/src/state/wallpaper.ts'));
        wallpaper.setWallpaperSlot('day', null);
        wallpaper.setWallpaperSlot('night', null);
        wallpaper.setGlobalWallpaper('builtin:aurora');
      });
      await page.waitForTimeout(300);
      // The dock's "more functions" library shares the same icon treatment.
      await page.locator('.home-services-widget').getByRole('button', { name: '更多功能', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('.hs-dock-sphere').first().waitFor();
      await iconSurface(page, dialog.locator('.hs-dock-sphere').first(), 'service library hover', { expectButtonFeedback: false });
      await page.keyboard.press('Escape');
      // Appearance work must not disturb persisted board geometry or gestures.
      await page.evaluate(() => window.scrollTo(0, 0));
      const clock = page.locator('[data-item-id="home.clock"]'), text = clock.locator('.chrome-clock-time');
      const before = await clock.boundingBox(), b = await text.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 50, b.y + b.height / 2 + 30, { steps: 8 }); await page.mouse.up();
      const after = await clock.boundingBox();
      check(Math.abs(after.x - before.x - 50) <= 1 && Math.abs(after.y - before.y - 30) <= 1, 'clock drag keeps screen/world coordinates aligned');
      const handle = await clock.locator('.fh-se').boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2 + 35, handle.y + handle.height / 2 + 20, { steps: 6 }); await page.mouse.up();
      check((await clock.boundingBox()).width > after.width + 30, 'clock remains resizable');
      const changed = await savedBoard(page);
      await page.reload(); await clock.waitFor();
      check(await savedBoard(page) === changed, 'customized geometry survives reload');
    }
    if (width === 375) {
      check(await page.locator('.freeboard-wrap.is-reading').count() === 1, 'phone keeps its reading projection');
      await call(page, '/src/lib/glassLevel.ts', 'setGlassLevel', ['clear']);
      await call(page, '/src/state/wallpaper.ts', 'setGlobalWallpaper', ['builtin:aurora']);
      await page.waitForTimeout(250); await shot(page, 'home-phone-glass');
      check(await page.locator('.chrome-clock').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgba(0, 0, 0, 0)', 'phone clock also has no extra background');
    }
    await page.context().close();
  }
  for (const mode of ['simple', 'practical']) {
    const page = await setup(1920, mode);
    await center(page, 'main', mode + ' shell content');
    await center(page, '.simple-home', mode + ' home');
    await page.goto(base + '/?explorer-preview=page&page=tasks');
    await page.waitForFunction(() => document.querySelector('main')?.dataset.activePage === 'tasks');
    await page.waitForTimeout(400);
    await center(page, 'main', mode + ' ordinary page');
    await page.context().close();
  }
  check(report.errors.length === 0, 'no browser runtime errors: ' + report.errors.join('; '));
  assert.deepEqual(report.failures, [], 'All layout/material regressions must pass');
  report.passed = true;
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  if (server) { server.httpServer.closeAllConnections?.(); await server.close(); rmSync(cacheDir, { recursive: true, force: true }); }
}
console.log(`Home/shell appearance: ${report.checks.length} checks passed`);