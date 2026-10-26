/** Dark-theme foreground regression (real application, self-hosted Vite).
 *
 * Guards the reported defect "some text stays black in dark mode": the contrast
 * engine must re-ink portaled surfaces (tour, modals) after a theme switch and
 * must not leave the OH capsule on a stale dark lock. Token-based controls use
 * OneGUI roles and are excluded from the engine.
 *
 * Run: node tools/dark-theme-foreground-browser-test.mjs
 *   ONETHU_PLAYWRIGHT_PATH / CHROME_BIN select existing local tools.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.ONETHU_PLAYWRIGHT_PATH
  ? pathToFileURL(process.env.ONETHU_PLAYWRIGHT_PATH).href : 'playwright');
const out = process.env.ONETHU_TEST_OUT ?? join(tmpdir(), 'onethu-dark-foreground');
mkdirSync(out, { recursive: true });
const report = { checks: [], failures: [], errors: [], samples: [], screenshots: [], passed: false };
const check = (ok, label) => {
  report.checks.push(label);
  if (!ok) report.failures.push(label);
  console.log((ok ? '✓ ' : '✗ ') + label);
};
const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const cacheDir = mkdtempSync(join(tmpdir(), 'onethu-dark-vite-'));
const { createServer } = await import(pathToFileURL(join(dirname(requireDesktop.resolve('vite/package.json')), 'dist/node/index.js')).href);
const server = await createServer({
  root: resolve('apps/desktop'), configFile: resolve('apps/desktop/vite.config.ts'), cacheDir, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
});
await server.listen();
const base = 'http://127.0.0.1:' + server.httpServer.address().port;
const origin = new URL(base).origin;
const cssColor = c => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
const luminance = c => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
const contrast = (a, b) => { const l1 = luminance(a), l2 = luminance(b); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
async function open(query) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', e => report.errors.push(e.message));
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32' });
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('onethu.privacy.v1', JSON.stringify({ acknowledged: true, cloud: true, oh: false }));
    localStorage.setItem('onethu.experience.v1', 'full');
    localStorage.setItem('onethu.onboarded.flow4', '1');
    localStorage.setItem('onethu.onboarded.flow3', '1');
    localStorage.setItem('onethu.overlay.closed', '1');
    localStorage.setItem('onethu.chatdock.open', '0');
    localStorage.setItem('onethu.glass.level', 'rich');
  });
  await page.goto(base + query);
  await page.locator('.explorer-shell').waitFor();
  await page.waitForTimeout(1500);
  return page;
}
async function foreground(page, selector) {
  return page.locator(selector).first().evaluate(el => {
    const style = getComputedStyle(el);
    for (let node = el; node; node = node.parentElement) {
      const s = getComputedStyle(node), bg = s.backgroundColor;
      const m = /rgba?\(([^)]+)\)/.exec(bg);
      if (m) {
        const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        if ((v.length > 3 ? v[3] : 1) >= .95) return { color: style.color, background: bg, locked: !!(el.dataset.tx || el.dataset.txi), backgroundImage: s.backgroundImage };
      }
      if (s.backgroundImage !== 'none') return { color: style.color, background: null, locked: !!(el.dataset.tx || el.dataset.txi), backgroundImage: s.backgroundImage };
    }
    return { color: style.color, background: null, locked: !!(el.dataset.tx || el.dataset.txi), backgroundImage: 'none' };
  });
}
async function switchTheme(page) {
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(e => e.name)
      .findLast(u => new URL(u).pathname === '/src/state/theme.ts');
    (await import(url)).activateTheme('onethu.theme.night');
  });
  // The engine re-reads one palette pass plus the settled pass.
  await page.waitForTimeout(1200);
}
function assertReadable(sample, label) {
  report.samples.push({ label, ...sample });
  const fg = cssColor(sample.color), bg = sample.background ? cssColor(sample.background) : null;
  check(!!fg && !!bg && contrast(fg, bg) >= 3, label + ': readable foreground (contrast ≥ 3)');
  check(sample.locked === false, label + ': not stuck on a stale contrast lock');
}
try {
  // 1. Home + experience tour after a live theme switch (portal + capsule).
  const page = await open('/?explorer-preview=home&tour=1');
  const dialog = page.locator('.experience-tour');
  check(await dialog.count() === 1, 'experience tour is open');
  await switchTheme(page);
  const scheme = await page.evaluate(() => document.documentElement.dataset.ogScheme || document.documentElement.dataset.scheme);
  check(scheme === 'dark', 'dark palette applied');
  assertReadable(await foreground(page, '.ex-bbar-center .ohx-capsule-ph'), 'OH capsule placeholder');
  assertReadable(await foreground(page, '.experience-tour .tour-counter'), 'tour step counter');
  await page.screenshot({ path: join(out, 'tour-dark.png'), animations: 'disabled' });
  // 2. Settings overlay (another portaled surface) keeps readable text.
  const settings = await open('/?explorer-preview=settings-tab');
  await switchTheme(settings);
  assertReadable(await foreground(settings, '.settings-panel .og-settings-row-title'), 'settings row title');
  assertReadable(await foreground(settings, '.settings-panel .og-pagehead-topic h1'), 'settings page title');
  await settings.screenshot({ path: join(out, 'settings-dark.png'), animations: 'disabled' });
  check(report.errors.length === 0, 'no browser runtime errors: ' + report.errors.join('; '));
  assert.deepEqual(report.failures, [], 'All dark-theme foreground checks must pass');
  report.passed = true;
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  server.httpServer.closeAllConnections?.(); await server.close(); rmSync(cacheDir, { recursive: true, force: true });
}
console.log(`Dark-theme foreground: ${report.checks.length} checks passed`);
