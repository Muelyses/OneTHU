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
const base = process.argv[2] ?? 'http://127.0.0.1:5180';
let checks = 0;
const errors = [];
const check = (c, m) => { assert.ok(c, m); checks++; console.log('✓ ' + m); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
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
  /* 手机端箱子入口在顶栏（Layout 的 {phone ? <VaultButton/> : null}），不是浮动 dock */
  check(await p.locator('.vault-anchor').isVisible(), '390 vault box button visible in topbar');
  const dockBox = await p.locator('.vault-anchor').boundingBox();
  check(dockBox && dockBox.y >= 0 && dockBox.y + dockBox.height <= 120, '390 vault box sits in the topbar (not floating over content)');
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 1, '390 vault page has no horizontal overflow');
  const buttons = await p.locator('.vault-action-row button').count();
  check(buttons >= 3, '390 unified vault actions (添加文件/分享口令/接收) wrap into visible buttons');
  const title = await p.getByRole('heading', { name: '暂存箱' }).count();
  check(title >= 1, '390 vault heading visible');

  /* 组合分享收进 <details> 折叠项（不占主流程） */
  await p.locator('details.vault-combination summary').click();
  await p.getByRole('button', { name: '选择组合内容' }).click();
  await p.waitForSelector('.plg-form-modal');
  await p.getByRole('button', { name: '提交' }).click();
  await p.waitForTimeout(800);
  const qr = p.locator('.vault-qr svg');
  check(await qr.count() >= 1, '390 touch code QR rendered');
  const qrBox = await qr.first().boundingBox();
  check(qrBox && qrBox.width <= 390, 'QR fits phone width');
  check(/^ON(-[0-9A-Z]{4}){4}$/.test((await p.locator('.vault-share-code').innerText()).trim()), '390 touch code is a short code (NFC/QR same code)');

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
  await p.getByText('成员按邮箱加入，资料库共享到邮箱，GitLab 仓库挂到组织上；组织自带名片。').first().waitFor({ timeout: 8000 });
  check(true, '390 contacts org section visible');

  await p.setViewportSize({ width: 320, height: 568 });
  await p.waitForTimeout(500);
  const narrowOverflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(narrowOverflow <= 1, '320 contacts org page has no horizontal overflow');
  check(await p.getByText('成员按邮箱加入，资料库共享到邮箱，GitLab 仓库挂到组织上；组织自带名片。').count() >= 1, '320 org section still reachable');
  check(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.join(';') : ''));
  console.log(checks + ' mobile vault/card assertions passed');
} finally { await browser.close(); }
