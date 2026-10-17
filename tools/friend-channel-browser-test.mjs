/** 好友通道：打开通道、留言（无云盘时本机保留并如实提示）、消息列表展示。 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://127.0.0.1:5180';
let checks = 0; const errors = [];
const check = (c, m) => { assert.ok(c, m); checks++; console.log('✓ ' + m); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const p = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => {
    localStorage.setItem('onethu.onboarded.phone', '1');
    localStorage.setItem('onethu.cards.v1', JSON.stringify({
      v: 1,
      personal: { name: '我', avatar: '', website: '', social: '', phone: '138', bio: '', updatedAt: Date.now() },
      orgs: [],
      contacts: [{ id: 'ct.test', kind: 'personal', name: '好友甲', note: '同学', card: { name: '好友甲', avatar: '', website: '', social: '', phone: '139', bio: '', updatedAt: Date.now() }, addedAt: Date.now() }],
    }));
  });
  await p.route('**/src/state/data.ts*', async (route) => {
    const r = await route.fetch(); let b = await r.text();
    for (const n of ['useLearnData', 'useCampusData']) b = b.replace(`export function ${n}() {`, `export function ${n}() { return {data:{semester:{id:'x'},courses:[],homework:[],notifications:[],files:[],schedule:[]},state:'ready',error:null,reload:async()=>{}};`);
    await route.fulfill({ response: r, body: b });
  });
  await p.goto(base + '/?explorer-preview=home', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.explorer-shell'); await p.waitForTimeout(800);
  await p.getByRole('button', { name: '设置' }).first().click(); await p.waitForTimeout(400);
  await p.getByRole('tab', { name: '账号' }).click(); await p.waitForTimeout(600);
  check(await p.getByText('好友甲').count() >= 1, 'seeded contact visible');
  await p.getByRole('button', { name: '通道', exact: true }).click(); await p.waitForTimeout(300);
  check(await p.getByText('好友通道').count() === 1, 'friend channel opens');
  await p.getByRole('button', { name: '留言', exact: true }).click();
  await p.waitForSelector('.plg-form-modal');
  await p.locator('.plg-form-modal textarea').fill('一起做项目');
  await p.getByRole('button', { name: '提交' }).click(); await p.waitForTimeout(700);
  const msgs = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.friendMsgs.v1') || '{}').messages ?? []);
  check(msgs.some((m) => m.text === '一起做项目'), 'message stored locally when cloud is unavailable');
  check(await p.getByText(/留言只留在本机/).count() >= 1, 'local fallback is explained');
  check(await p.getByText('一起做项目').count() >= 1, 'channel list shows the message');
  check(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.join(';') : ''));
  console.log(checks + ' friend channel assertions passed');
} finally { await browser.close(); }
