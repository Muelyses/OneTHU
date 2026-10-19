/**
 * 轻量组织回归（Phase 4 地基 + 联网短口令）：
 * 通讯录页「我的组织」页签 → 建组织、加成员、邀请（云盘短码）、接受邀请合并成员、
 * 重复邀请复用同一条短码、删除组织。
 * 邀请口令走假云盘夹具（不联网）；真实云盘互传见 short-share-browser-test。
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { installFakeCloud } from './lib/fake-cloud.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:5180';
let checks = 0;
const errors = [];
const check = (cond, msg) => { assert.ok(cond, msg); checks++; console.log('✓ ' + msg); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const p = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => { performance.setResourceTimingBufferSize(10000); localStorage.setItem('onethu.onboarded.phone', '1'); });
  await installFakeCloud(p, { token: 'test-token' }); /* 邀请口令现在要走云盘发布 */
  await p.route('**/src/state/data.ts*', async (route) => {
    const r = await route.fetch();
    const body = (await r.text()).replace(
      'export function useCampusData() {',
      'export function useCampusData() { return {data:{semester:{id:"x"},courses:[],homework:[],notifications:[],files:[],schedule:[]},state:"ready",error:null,reload:async()=>{}};',
    );
    await route.fulfill({ response: r, body });
  });
  await p.goto(base + '/?explorer-preview=page&page=contacts', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.explorer-shell');
  await p.waitForTimeout(1000);
  check(await p.getByRole('heading', { name: '通讯录', exact: true }).count() === 1, 'contacts page route works');

  /* 组织页签（组织成员/邀请口令已从设置页搬到通讯录） */
  await p.getByRole('radio', { name: '我的组织', exact: true }).click();
  await p.waitForTimeout(500);
  check(await p.getByText('组织成员、邀请口令与共享资料空间').count() >= 1, 'org tab shows member/invite section');

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

  /* 邀请：云盘发布后拿 22 字符短码 + 二维码 */
  await p.getByRole('button', { name: '邀请', exact: true }).first().click(); await p.waitForTimeout(1000);
  const code = (await p.locator('.vault-share-code').innerText()).trim();
  check(/^ON(-[0-9A-Z]{4}){4}$/.test(code), 'org invite is a short code: ' + code);
  check(await p.locator('.vault-qr svg').count() >= 1, 'org invite shows a scannable QR');
  const decoded = await p.evaluate(async (c) => {
    const org = await import('/src/state/org.ts');
    const ex = await import('/src/state/cloudExchange.ts');
    return org.decodeOrgInvite(await ex.resolveExchangeCode(c));
  }, code);
  check(decoded.ok && decoded.payload?.name === '开源小组', 'invite resolves through the cloud manifest and decodes');
  const model = await p.evaluate(async (c) => {
    const m = await import('/src/state/org.ts');
    const joined = await m.acceptOrgInvite(c, '王五');
    const org = m.orgSnapshot().orgs.find((o) => o.id === joined.orgId);
    const dup = m.addOrgMember(org.id, '李四');
    return { joined: joined.ok, n: org.members.length, dup: dup.reason };
  }, code);
  check(model.joined && model.n === 3 && model.dup === 'duplicate', 'accept invite merges member and dedupes');
  /* 同一个组织再邀一次：复用同一条短码，不在云盘堆目录 */
  const again = await p.evaluate(async () => {
    const m = await import('/src/state/org.ts');
    return m.orgInviteCode(m.orgSnapshot().orgs[0]);
  });
  check(again === code, 're-inviting the same org reuses the same short code');

  await p.getByRole('button', { name: '删除', exact: true }).first().click();
  await p.waitForSelector('.confirm-card');
  await p.getByRole('button', { name: '确定', exact: true }).click();
  await p.waitForTimeout(500);
  const left = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.orgs.v1')).orgs.length);
  check(left === 0, 'organization deleted');
  check(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.join(';') : ''));
  console.log(checks + ' organization assertions passed');
} finally {
  await browser.close();
}
