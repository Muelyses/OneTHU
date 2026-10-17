/**
 * 轻量组织 Phase 4 地基回归：建组织、成员、邀请口令、接受邀请、删除。
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://127.0.0.1:5180';
let checks = 0;
const errors = [];
const check = (cond, msg) => { assert.ok(cond, msg); checks++; console.log('✓ ' + msg); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const p = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => localStorage.setItem('onethu.onboarded.phone', '1'));
  await p.route('**/src/state/data.ts*', async (route) => {
    const r = await route.fetch(); let b = await r.text();
    for (const n of ['useLearnData', 'useCampusData']) b = b.replace(`export function ${n}() {`, `export function ${n}() { return {data:{semester:{id:'x'},courses:[],homework:[],notifications:[],files:[],schedule:[]},state:'ready',error:null,reload:async()=>{}};`);
    await route.fulfill({ response: r, body: b });
  });
  await p.goto(base + '/?explorer-preview=home', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.explorer-shell'); await p.waitForTimeout(900);
  await p.getByRole('button', { name: '设置' }).first().click(); await p.waitForTimeout(500);
  await p.getByRole('tab', { name: '账号' }).click(); await p.waitForTimeout(600);
  check(await p.getByText('我的组织').count() >= 1, 'settings has organization section');
  await p.getByRole('button', { name: '新建组织', exact: true }).click();
  await p.waitForSelector('.plg-form-modal');
  const inputs = p.locator('.plg-form-modal input');
  await inputs.nth(0).fill('开源小组');
  await p.locator('.plg-form-modal textarea').fill('一起做点东西');
  await p.locator('.plg-form-modal input').nth(1).fill('https://git.tsinghua.edu.cn/groups/open');
  await p.getByRole('button', { name: '提交' }).click(); await p.waitForTimeout(500);
  let org = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.orgs.v1')).orgs[0]);
  check(org.name === '开源小组' && org.members.length === 1, 'organization created with owner');
  await p.getByRole('button', { name: '加成员', exact: true }).first().click();
  await p.waitForSelector('.plg-form-modal');
  await p.locator('.plg-form-modal input').first().fill('李四');
  await p.getByRole('button', { name: '提交' }).click(); await p.waitForTimeout(500);
  org = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.orgs.v1')).orgs[0]);
  check(org.members.some((m) => m.name === '李四'), 'member added');
  await p.getByRole('button', { name: '邀请', exact: true }).first().click(); await p.waitForTimeout(500);
  const code = await p.locator('.vault-share-code').innerText();
  check(/^ONORG1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/.test(code.trim()), 'org invite code has ONORG1.body.checksum shape');
  check(await p.locator('.vault-qr svg').count() >= 1, 'org invite shows a scannable QR');
  const decoded = await p.evaluate(async (c) => { const m = await import('/src/state/org.ts'); return m.decodeOrgInvite(c); }, code.trim());
  check(decoded.ok && decoded.payload?.name === '开源小组', 'invite code decodes');
  const model = await p.evaluate(async (c) => {
    const m = await import('/src/state/org.ts');
    const joined = m.acceptOrgInvite(c, '王五');
    const org = m.orgSnapshot().orgs.find((o) => o.id === joined.orgId);
    const dup = m.addOrgMember(org.id, '李四');
    return { joined: joined.ok, n: org.members.length, dup: dup.reason };
  }, code.trim());
  check(model.joined && model.n === 3 && model.dup === 'duplicate', 'accept invite merges member and dedupes');
  await p.getByRole('button', { name: '删除', exact: true }).first().click();
  await p.waitForSelector('.confirm-card');
  await p.getByRole('button', { name: '确定', exact: true }).click();
  await p.waitForTimeout(500);
  const left = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.orgs.v1')).orgs.length);
  check(left === 0, 'organization deleted');
  check(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.join(';') : ''));
  console.log(checks + ' organization assertions passed');
} finally { await browser.close(); }
