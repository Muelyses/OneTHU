/** Real login/update UI, fictional responses and intercepted native installer IPC.
 * No school requests, package downloads or OS installers are allowed. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5211';
const origin = new URL(base).origin;
const out = process.env.ONETHU_TEST_OUT ?? '/tmp/onethu-login-update';
mkdirSync(out, { recursive: true });
const require = createRequire(new URL('../packages/info-lib/package.json', import.meta.url));
const publicKey = require('sm-crypto').sm2.generateKeyPairHex().publicKey;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const checks = [], errors = [];
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); console.log('PASS '+label); };
const prompt = page => page.getByTestId('software-update-prompt');
const center = page => page.getByTestId('software-update-center');
const response = (url, body, status = 200) => ({ status, status_text: status === 200 ? 'OK' : 'Unavailable', headers: { 'content-type': 'text/html; charset=utf-8' }, set_cookies: [], set_cookie_hops: [], url, body });
async function setup(locale, mode, mobile, twoFactor = false, holdManifest = false, downloadMode = 'immediate') {
  const context = await browser.newContext({ viewport: mobile ? { width: 393, height: 852 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile,
    userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 14; Fixture) AppleWebKit/537.36 Chrome/145.0.0.0 Mobile Safari/537.36' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36' });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  const calls = [], files = new Map();
  let releaseManifest;
  const held = new Promise(resolve => { releaseManifest = resolve; });
  let releaseDownload, releaseListener;
  const heldDownload = new Promise(resolve => { releaseDownload = resolve; });
  const heldListener = new Promise(resolve => { releaseListener = resolve; });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket(/.*/, socket => socket.close());
  await page.exposeFunction('__updateInvoke', async (command, args = {}) => {
    if (command === 'http_native_epoch') return 0;
    if (command === 'state_read') return files.get(args.name) ?? null;
    if (command === 'state_write') { files.set(args.name, args.content); return null; }
    if (command === 'state_delete') { files.delete(args.name); return null; }
    if (command.startsWith('updater_')) {
      calls.push({ command, args });
      if (command === 'updater_download') {
        if (downloadMode === 'download') await heldDownload;
        // A completion may already be queued when native cancellation arrives.
        return { path: '/tmp/fixture-update.apk', size: 123456, verified: true, sha256: 'a'.repeat(64) };
      }
      return null;
    }
    if (command === 'plugin:event|listen' && args.event === 'onethu-updater://progress') {
      calls.push({ command: 'download-listener' });
      if (downloadMode === 'listener') await heldListener;
      return 1;
    }
    if (command === 'http_request' || command === 'http_native') {
      const input = args.input, url = new URL(input.url); const fields = new URLSearchParams(input.body ?? '');
      if (url.hostname === 'github.com') {
        calls.push({ command: 'manifest' }); if (holdManifest) await held;
        const asset = ext => ({ url: `https://github.com/smartThise/OneTHU/releases/download/v99.0.0/OneTHU_99.0.0.${ext}`, name: `OneTHU_99.0.0.${ext}`, size: 123456, sha256: 'a'.repeat(64) });
        return response(input.url, JSON.stringify({ version: '99.0.0', notes: Array.from({ length: 30 }, (_, i) => `${i + 1}. ${locale === 'en-US' ? 'Fictional login and update improvements.' : '模拟登录与更新改进。'}`).join('\n'), assets: { windows: asset('exe'), android: asset('apk'), macos: asset('dmg'), linux: asset('AppImage') } }));
      }
      if (twoFactor) {
        if (url.hostname === 'webvpn.tsinghua.edu.cn' && url.pathname === '/login') return response(input.url, `<input id="sm2publicKey" value="${publicKey}">`);
        if (url.pathname.endsWith('/login/check')) return response(input.url, '<html><title>二次认证</title><script src="/v2/dist/doubleauth/doubleAuth.bundle.js"></script></html>');
        if (url.pathname === '/b/doubleAuth/login') return response(input.url, JSON.stringify({ result: 'success', object: fields.get('action') === 'FIND_APPROACHES' ? { hasTotp: true, phone: null, hasWeChatBool: false } : {} }));
      }
      // The campus is deliberately unavailable throughout the update test.
      return response(input.url, 'Fixture campus outage', 503);
    }
    return null;
  });
  await page.addInitScript(({ locale, mode, mobile }) => {
    localStorage.setItem('onethu.locale', locale); localStorage.setItem('onethu.experience.v1', mode);
    Object.defineProperty(navigator, 'platform', { value: mobile ? 'Linux armv8l' : 'Win32' });
    window.__TAURI_INTERNALS__ = { invoke: (cmd, args) => window.__updateInvoke(cmd, args), metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1 };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  }, { locale, mode, mobile });
  await page.goto(base); await page.locator('#username').waitFor();
  return { context, page, calls, releaseManifest, releaseDownload, releaseListener };
}
let passed = false;
try {
  for (const locale of ['zh-CN', 'en-US']) for (const mode of ['simple', 'practical', 'full']) {
    const mobile = mode !== 'full'; const h = await setup(locale, mode, mobile); const { page, calls } = h;
    const label = `${locale}/${mode}/${mobile ? 'phone' : 'desktop'}`;
    await prompt(page).waitFor();
    check(calls.filter(c => c.command === 'manifest').length === 1, `${label}: login auto-check has one host/request while campus is down`);
    const notes = page.getByTestId('software-update-notes');
    const scrollable = await notes.evaluate(el => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === 'auto');
    check(scrollable, `${label}: long announcement scrolls within reminder`);
    const bounds = await prompt(page).boundingBox();
    check(bounds && bounds.y >= 0 && bounds.y + bounds.height <= (mobile ? 852 : 900) + 1, `${label}: reminder fits screen`);
    check((await prompt(page).innerText()).includes(locale === 'en-US' ? 'Update available' : '发现新版本'), `${label}: reminder shell is localized`);
    await prompt(page).getByRole('combobox').selectOption('day');
    await prompt(page).getByRole('button').last().click(); await prompt(page).waitFor({ state: 'hidden' });
    check((await page.evaluate(() => JSON.parse(localStorage.getItem('onethu.update.snooze.v1')).version)) === '99.0.0', `${label}: login snooze is release-scoped`);
    await page.getByTestId('login-update-entry').click(); await center(page).waitFor();
    await center(page).getByRole('button', { name: locale === 'en-US' ? 'Download and install' : '下载并安装', exact: true }).waitFor();
    check(calls.filter(c => c.command === 'manifest').length === 1, `${label}: manual update reuses checked result despite snooze`);
    const sectionBounds = await center(page).boundingBox();
    check(sectionBounds && sectionBounds.y >= 0 && sectionBounds.y + sectionBounds.height <= (mobile ? 852 : 900) + 1, `${label}: independent updater fits screen`);
    if (mode === 'full' || (mode === 'simple' && locale === 'zh-CN')) {
      await center(page).getByRole('button', { name: locale === 'en-US' ? 'Download and install' : '下载并安装', exact: true }).click();
      const confirmation = page.getByRole('dialog').filter({ hasText: mobile ? 'OneTHU_99.0.0.apk' : 'OneTHU_99.0.0.exe' }).last();
      check(calls.every(c => c.command !== 'updater_download'), `${label}: download waits for explicit confirmation`);
      await confirmation.getByRole('button', { name: locale === 'en-US' ? 'Confirm' : '确定', exact: true }).click();
      await page.waitForFunction(() => document.body.textContent.includes('/tmp/fixture-update.apk'));
      check(calls.find(c => c.command === 'updater_download')?.args.expectSha256 === 'a'.repeat(64), `${label}: real download code forwards manifest SHA256`);
      check(calls.filter(c => c.command === 'updater_open_installer').length === 1, `${label}: mocked installer opens without campus login`);
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${locale}-${mode}.png` });
    await page.keyboard.press('Escape'); await center(page).waitFor({ state: 'hidden' });
    await h.context.close();
  }
  const manual = await setup('en-US', 'simple', true, false, true);
  await manual.page.waitForTimeout(3200);
  await manual.page.getByTestId('login-update-entry').click(); await center(manual.page).waitFor();
  manual.releaseManifest();
  await center(manual.page).getByRole('button', { name: 'Download and install', exact: true }).waitFor();
  check(manual.calls.filter(c => c.command === 'manifest').length === 1, 'opening manual center during background request shares that request');
  await manual.context.close();
  for (const action of ['close', 'cancel', 'listener-cancel']) {
    const h = await setup('en-US', 'simple', true, false, false, action === 'listener-cancel' ? 'listener' : 'download');
    await h.page.getByTestId('login-update-entry').click(); await center(h.page).waitFor();
    await center(h.page).getByRole('button', { name: 'Download and install', exact: true }).click();
    const confirmation = h.page.getByRole('dialog').filter({ hasText: 'OneTHU_99.0.0.apk' }).last();
    await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click();
    const expectedCommand = action === 'listener-cancel' ? 'download-listener' : 'updater_download';
    for (let i = 0; i < 100 && !h.calls.some(c => c.command === expectedCommand); i++) await h.page.waitForTimeout(20);
    check(h.calls.some(c => c.command === expectedCommand), `${action}: held real ${expectedCommand} path reached`);
    if (action === 'close') {
      await h.page.keyboard.press('Escape');
      check(await center(h.page).count() === 1, 'close: modal content remains mounted for its exit animation');
      // Deliver success inside the 260ms exit window, rather than after unmount.
      h.releaseDownload();
    } else {
      await center(h.page).getByRole('button', { name: 'Cancel', exact: true }).click();
      if (action === 'listener-cancel') h.releaseListener(); else h.releaseDownload();
    }
    await h.page.waitForTimeout(400);
    check(h.calls.every(c => c.command !== 'updater_open_installer'), `${action}: late success never opens an installer`);
    if (action === 'listener-cancel') {
      check(h.calls.every(c => c.command !== 'updater_download'), 'listener-cancel: cancelled registration never starts a native download');
    } else {
      check(h.calls.filter(c => c.command === 'updater_cancel_download').length === 1, `${action}: owned native download is cancelled once`);
    }
    if (action === 'close') await center(h.page).waitFor({ state: 'hidden' });
    else check((await center(h.page).innerText()).includes('cancel'), `${action}: cancellation remains actionable in the open updater`);
    await h.context.close();
  }
  const fa = await setup('zh-CN', 'full', true, true);
  await fa.page.locator('#username').fill('2099000000'); await fa.page.locator('#password').fill('fixture-only');
  await fa.page.locator('form').getByRole('button', { name: '登录', exact: true }).click();
  await fa.page.locator('.method-item').first().click();
  await fa.page.getByRole('button', { name: '下一步', exact: true }).click();
  await fa.page.locator('#code').fill('123456'); await fa.page.waitForTimeout(3500);
  check(await prompt(fa.page).count() === 0, 'automatic update never covers an active 2FA form');
  check(await fa.page.locator('#code').inputValue() === '123456', '2FA input survives background update check');
  await fa.page.getByTestId('login-update-entry').click(); await center(fa.page).waitFor();
  await center(fa.page).getByRole('button', { name: '下载并安装', exact: true }).waitFor();
  check(true, '2FA user can explicitly open independent updater');
  await fa.page.keyboard.press('Escape'); await center(fa.page).waitFor({ state: 'hidden' });
  check(await fa.page.locator('#code').inputValue() === '123456', 'closing updater preserves entered 2FA code');
  await fa.context.close();
  check(errors.length === 0, 'no runtime exceptions'); passed = true;
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify({ passed, checks, errors, scope: 'Chromium + simulated Tauri IPC; no actual downloads or installation' }, null, 2));
  await browser.close();
}
console.log(`${checks.length} login update browser checks passed.`);
