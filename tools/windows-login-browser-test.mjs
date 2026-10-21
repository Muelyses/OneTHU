/** Real login UI with deferred native calls. Chromium Windows UA, not Windows hardware. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = process.env.ONETHU_TEST_ARTIFACTS ?? '/Volumes/OneTHUBuild/artifacts/windows-login-probe';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const checks = [], errors = [];
const check = (value, label) => { assert.ok(value, label); checks.push(label); console.log('✓ ' + label); };
let passed = false;
try {
  for (const hold of ['cookies', 'network']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0' });
    page.setDefaultTimeout(12000);
    const logs = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
    await page.exposeFunction('__loginTestInvoke', async (command, args) => {
      if (command === 'log_debug') logs.push(args.line);
      if (command === 'http_native_clear_cookies_domain' && hold === 'cookies') return new Promise(() => {});
      if (command === 'http_native') {
        if (/webvpn|id\.tsinghua/.test(args.input.url)) return new Promise(() => {});
        return { status: 200, status_text: 'OK', headers: { 'content-type': 'application/json' }, set_cookies: [], set_cookie_hops: [], url: args.input.url, body: '{}' };
      }
      return null;
    });
    await page.addInitScript(() => {
      localStorage.clear();
      Object.defineProperty(navigator, 'platform', { value: 'Win32' });
      window.__authTestPhases = [];
      window.__TAURI_INTERNALS__ = {
        invoke: (command, args) => {
          if (command === 'log_debug') window.__authTestPhases.push(args.line);
          return window.__loginTestInvoke(command, args);
        },
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => 1,
      };
    });
    await page.goto(base);
    await page.locator('#username').fill('2099000000');
    await page.locator('#password').fill('fixture-only-password');
    await page.locator('form button[type=submit]').click();
    const phase = hold === 'cookies' ? 'AUTH-PHASE cookie-clear-start' : 'AUTH-PHASE handshake-start';
    await page.waitForFunction(phase => window.__authTestPhases.some(line => line.endsWith(phase)), phase);
    check(await page.locator('form button[type=submit]').isDisabled(), hold + ': only the login action is busy while native work is pending');
    await page.locator('#username').fill('2099000001');
    check(await page.locator('#username').inputValue() === '2099000001', hold + ': the actual input remains editable');
    check(await page.evaluate(() => new Promise(resolve => setTimeout(() => resolve(true), 20))), hold + ': the renderer event loop remains responsive');
    check(logs.some(line => line.endsWith('AUTH-PHASE submit')) && logs.some(line => line.endsWith('AUTH-PHASE fingerprint-ready')), hold + ': logs identify the stages before the native wait');
    check(!logs.some(line => /209900000[01]|fixture-only-password/.test(line)), hold + ': diagnostics omit credentials');
    await page.screenshot({ path: out + '/pending-' + hold + '.png' });
    await Promise.all([page.waitForEvent('load'), page.locator('.hard-refresh-fab').click()]);
    await page.locator('#username').waitFor();
    check(await page.locator('#username').inputValue() === '', hold + ': the real refresh button reloads the login page despite pending native work');
    await page.close();
  }
  check(errors.length === 0, 'No React/browser runtime errors: ' + errors.join('; '));
  passed = true;
} finally {
  writeFileSync(out + '/browser-report.json', JSON.stringify({ passed, checks, errors, scope: 'Real React login/refresh controls; simulated pending IPC, Windows UA on macOS Chromium; no real credentials, school traffic, Windows machine or TUN.' }, null, 2));
  await browser.close();
}
console.log(checks.length + ' login responsiveness assertions passed');
