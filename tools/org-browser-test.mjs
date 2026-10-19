/**
 * 组织回归（2026-10-19 重构：组织是完整页面，不是卡片/弹层）：
 * 通讯录「我的组织」建组织 → 打开组织页 → 成员（真实邮箱）→ 邀请口令（可起名、可限定邮箱）
 * → 资料库（云盘 repo：新建/共享给成员邮箱）→ 删除组织。
 * 云盘走假云盘夹具（不联网）；真实云盘互传见 short-share-browser-test。
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
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => { performance.setResourceTimingBufferSize(10000); localStorage.setItem('onethu.onboarded.phone', '1'); });
  await installFakeCloud(p, { token: 'test-token' });
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
  await p.getByRole('heading', { name: '通讯录', exact: true }).waitFor({ timeout: 15000 });

  /* 组织页签 → 新建组织 → 自动进组织主页 */
  await p.getByRole('radio', { name: '我的组织', exact: true }).click();
  await p.waitForTimeout(400);
  check(await p.getByText('成员按邮箱加入，资料库共享到邮箱，GitLab 仓库挂到组织上；组织自带名片。').count() >= 1, 'org tab explains the real-member/real-resource model');
  await p.getByRole('button', { name: '新建组织', exact: true }).click();
  await p.waitForSelector('.plg-form-modal');
  await p.locator('.plg-form-modal input').nth(0).fill('开源小组');
  await p.locator('.plg-form-modal textarea').fill('一起做点东西');
  await p.locator('.plg-form-modal input').nth(1).fill('https://git.tsinghua.edu.cn/groups/open');
  await p.getByRole('button', { name: '提交' }).click();
  await p.waitForTimeout(1200);
  await p.getByRole('heading', { name: '开源小组', exact: true }).waitFor({ timeout: 10000 });
  check(true, 'creating an org opens its full page (not a card/modal)');
  check(await p.getByRole('radio').allTextContents().then((t) => ['概览', '成员', '资料库', 'GitLab', '项目', '公告'].every((x) => t.includes(x))), 'org page has full section tabs');

  let org = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.orgs.v1')).orgs[0]);
  check(org.name === '开源小组' && org.members.length === 1 && org.members[0].role === 'owner', 'organization created with owner member');
  check(org.members[0].email === 'tester@mails.tsinghua.edu.cn', 'owner is bound to the real cloud email');

  /* 成员：真实邮箱 + 邮箱去重 */
  await p.getByRole('radio', { name: '成员', exact: true }).click();
  await p.getByRole('button', { name: '添加成员', exact: true }).click();
  await p.waitForSelector('.plg-form-modal');
  await p.locator('.plg-form-modal input').nth(0).fill('lisi@mails.tsinghua.edu.cn');
  await p.locator('.plg-form-modal input').nth(1).fill('李四');
  await p.getByRole('button', { name: '提交' }).click();
  await p.waitForTimeout(600);
  org = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.orgs.v1')).orgs[0]);
  check(org.members.some((m) => m.name === '李四' && m.email === 'lisi@mails.tsinghua.edu.cn'), 'member added with real email');
  const dup = await p.evaluate(async () => {
    const m = await import('/src/state/org.ts');
    return m.addOrgMember(m.orgSnapshot().orgs[0].id, '李四二号', 'lisi@mails.tsinghua.edu.cn');
  });
  check(dup.reason === 'duplicate', 'members dedupe by email (not just display name)');

  /* 邀请：可起名 + 限定接收邮箱；同一组织复用同一条短码 */
  await p.getByRole('button', { name: '邀请成员', exact: true }).click();
  await p.waitForSelector('.plg-form-modal');
  await p.locator('.plg-form-modal input').nth(0).fill('招新口令');
  await p.locator('.plg-form-modal input').nth(1).fill('zhaoliu@mails.tsinghua.edu.cn');
  await p.getByRole('button', { name: '提交' }).click();
  await p.waitForTimeout(1400);
  const code = (await p.locator('.vault-share-code').first().innerText()).trim();
  check(/^ON(-[0-9A-Z]{4}){4}$/.test(code), 'org invite is a short code: ' + code);
  check(await p.locator('.vault-qr svg').count() >= 1, 'org invite shows a scannable QR');
  const decoded = await p.evaluate(async (c) => {
    const org = await import('/src/state/org.ts');
    const ex = await import('/src/state/cloudExchange.ts');
    return org.decodeOrgInvite(await ex.resolveExchangeCode(c));
  }, code);
  check(decoded.ok && decoded.payload?.name === '开源小组' && decoded.payload?.label === '招新口令' && decoded.payload?.allowEmail === 'zhaoliu@mails.tsinghua.edu.cn', 'invite resolves with label + allowEmail in the cloud manifest');
  const again = await p.evaluate(async () => {
    const m = await import('/src/state/org.ts');
    const o = m.orgSnapshot().orgs[0];
    return m.orgInviteCode(o, '我', { label: '招新口令', allowEmail: 'zhaoliu@mails.tsinghua.edu.cn' });
  });
  check(again === code, 're-inviting the same org reuses the same short code');
  await p.getByRole('button', { name: '收起' }).click();
  await p.waitForTimeout(300);

  /* 限定邮箱：别的云盘账号接不了；本机换成被限定邮箱后可以接受 */
  const guard = await p.evaluate(async (c) => {
    const m = await import('/src/state/org.ts');
    const before = m.orgSnapshot().orgs[0].members.length;
    window.__cloud.email = 'wangwu@mails.tsinghua.edu.cn';
    const wrong = await m.acceptOrgInvite(c, '王五');
    window.__cloud.email = 'zhaoliu@mails.tsinghua.edu.cn';
    const right = await m.acceptOrgInvite(c, '赵六');
    return { before, wrong: wrong.ok, wrongReason: wrong.reason, right: right.ok, members: m.orgSnapshot().orgs[0].members.length };
  }, code);
  check(!guard.wrong && /限定/.test(guard.wrongReason ?? ''), 'invite restricted to another email is rejected: ' + (guard.wrongReason ?? ''));
  check(guard.right && guard.members === guard.before + 1, 'invite accepted by the bound email joins as new member');

  /* 资料库：新建云盘资料库（repo）并共享给成员邮箱 */
  await p.getByRole('radio', { name: '资料库', exact: true }).click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: '新建资料库', exact: true }).click();
  await p.waitForSelector('.plg-form-modal');
  await p.getByRole('button', { name: '提交' }).click();
  await p.waitForTimeout(1200);
  org = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.orgs.v1')).orgs[0]);
  check(org.libraries.length === 1 && /资料库/.test(org.libraries[0].name), 'org library (cloud repo) created and linked');
  const repoIds = await p.evaluate(() => window.__cloud.repos.map((r) => r.id));
  check(repoIds.includes(org.libraries[0].repoId), 'library points at a real cloud repo, not a folder inside the org');
  await p.getByRole('button', { name: '共享给成员', exact: true }).click();
  await p.waitForSelector('.confirm-card');
  await p.getByRole('button', { name: '确定', exact: true }).click();
  await p.waitForTimeout(1200);
  org = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.orgs.v1')).orgs[0]);
  const shared = await p.evaluate(() => window.__cloud.sharedTo);
  check(shared.length >= 1 && shared.every((s) => s.repoId && s.path === '/' && s.email.includes('@')), 'library shared to cloud accounts by email (root of the repo)');
  check((org.libraries[0].sharedWith ?? []).includes('lisi@mails.tsinghua.edu.cn'), 'member email recorded as shared');

  /* GitLab 页签：无会话时入口仍在（真实创建/关联需要 GitLab 登录，测试里只验 UI 骨架） */
  await p.getByRole('radio', { name: 'GitLab', exact: true }).click();
  await p.waitForTimeout(300);
  check(await p.getByRole('button', { name: '新建仓库', exact: true }).count() === 1, 'gitlab tab offers creating a repo');
  check(await p.getByRole('button', { name: '关联已有仓库', exact: true }).count() === 1, 'gitlab tab offers linking an existing repo');

  /* 删除组织：回通讯录，本机记录清空（云盘资料库不动） */
  await p.getByRole('radio', { name: '概览', exact: true }).click();
  await p.getByRole('button', { name: '删除这个组织', exact: true }).click();
  await p.waitForSelector('.confirm-card');
  await p.getByRole('button', { name: '确定', exact: true }).click();
  await p.waitForTimeout(900);
  const left = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.orgs.v1')).orgs.length);
  check(left === 0, 'organization deleted');
  check(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.join(';') : ''));
  console.log(checks + ' organization assertions passed');
} finally {
  await browser.close();
}
