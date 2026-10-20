/**
 * 手机端暂存箱/名片/组织回归（390 与 320）：
 * ① 暂存箱在手机上可打开、dock 可见、按钮不横向溢出；
 * ② 碰一碰组合二维码在手机宽度内；
 * ③ 设置账号页的名字/组织不横向溢出；
 * ④ 320 窄屏仍可用。
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:5180';
let checks = 0;
const errors = [];
const check = (c, m) => { assert.ok(c, m); checks++; console.log('✓ ' + m); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-updater-scheduler'] });
try {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('onethu.onboarded.phone', '1');
    localStorage.setItem('onethu.cards.v1', JSON.stringify({
      v: 1,
      personal: { name: '手机名片', avatar: '', website: 'https://example.com', social: '@phone', phone: '13800000000', bio: '手机端简介', updatedAt: Date.now() },
      orgs: [], contacts: [],
    }));
  });
  await installFakeCloud(p, { token: 'test-token' }); /* 碰一碰组合口令要走云盘发布 */
  await p.route('**/src/state/data.ts*', async (route) => {
    const r = await route.fetch(); let b = await r.text();
    for (const n of ['useLearnData', 'useCampusData']) b = b.replace(`export function ${n}() {`, `export function ${n}() { return {data:{semester:{id:'x'},courses:[],homework:[],notifications:[],files:[],schedule:[]},state:'ready',error:null,reload:async()=>{}};`);
    await route.fulfill({ response: r, body: b });
  });
  await p.goto(base + '/?explorer-preview=home', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.explorer-shell'); await p.waitForTimeout(900);
  const call = async (path, name, args = []) => p.evaluate(async ({ path, name, args }) => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => new URL(u).pathname.endsWith(path));
    if (!url) throw Error('module not mounted ' + path);
    const m = await import(url); return m[name](...args);
  }, { path, name, args });
  await call('/src/state/explorer.ts', 'explorerNavigate', ['vault']);
  await p.waitForTimeout(700);
  /* 手机入口随手可移到两侧，不再固定在顶栏。手势与持久化由 workspace 回归覆盖。 */
  const entry = p.locator('.vault-floating-anchor .vault-box-button');
  check(await entry.isVisible(), '390 movable vault entry is visible');
  const dockBox = await entry.boundingBox();
  check(dockBox && dockBox.x >= 0 && dockBox.y >= 0 && dockBox.x + dockBox.width <= 390 && dockBox.y + dockBox.height <= 844, '390 movable vault entry is fully inside the viewport');
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 1, '390 vault page has no horizontal overflow');
  const buttons = await p.locator('.vault-action-row button').count();
  check(buttons >= 3, '390 unified vault actions (添加文件/分享口令/接收) wrap into visible buttons');
  const title = await p.getByRole('heading', { name: '暂存箱' }).count();
  check(title >= 1, '390 vault heading visible');

  /* 组合分享属于发送预览，显式选择名片并生成。 */
  await p.getByRole('button', { name: '分享口令', exact: true }).click();
  const send = p.getByRole('dialog', { name: '分享内容', exact: true });
  await send.locator('summary').click();
  await send.getByLabel('带上我的个人名片', { exact: true }).check();
  await send.getByRole('button', { name: '生成分享口令', exact: true }).click();
  await send.locator('.vault-exchange-code').waitFor();
  const qr = send.locator('.vault-exchange-qr svg');
  check(await qr.count() >= 1, '390 touch code QR rendered');
  const qrBox = await qr.first().boundingBox();
  check(qrBox && qrBox.x >= 0 && qrBox.x + qrBox.width <= 390, 'QR fits phone width');
  check(/^ON(-[0-9A-Z]{4}){4}$/.test((await send.locator('.vault-exchange-code').innerText()).trim()), '390 touch code is a short code (NFC/QR same code)');
  await p.keyboard.press('Escape');
  await send.waitFor({ state: 'hidden' });

  /* 个人设置浮层：入口是「我的」，名片在「我的名片」分段（组织已搬到通讯录页） */
  await p.getByRole('button', { name: '我的' }).first().click();
  await p.waitForTimeout(500);
  await p.locator('.settings-seg-item').filter({ hasText: '我的名片' }).first().click();
  await p.waitForTimeout(600);
  check(await p.getByText('我的名片', { exact: true }).count() >= 1, '390 settings card section visible');
  const settingsOverflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(settingsOverflow <= 1, '390 settings page has no horizontal overflow');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);

  /* 组织：通讯录页的「我的组织」页签 */
  await call('/src/state/explorer.ts', 'explorerNavigate', ['contacts']);
  await p.getByRole('heading', { name: '通讯录' }).waitFor({ timeout: 15000 });
  await p.getByRole('radio', { name: '我的组织', exact: true }).click();
  await p.getByRole('button', { name: '新建组织', exact: true }).waitFor({ timeout: 8000 });
  check(true, '390 contacts org section visible');

  await p.setViewportSize({ width: 320, height: 568 });
  await p.waitForTimeout(500);
  const narrowOverflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(narrowOverflow <= 1, '320 contacts org page has no horizontal overflow');
  check(await p.getByRole('button', { name: '新建组织', exact: true }).isVisible(), '320 org section still reachable');
  check(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.join(';') : ''));
} finally { await closeTestBrowser(browser); }
console.log(checks + ' mobile vault/card assertions passed; browser cleanup complete');
