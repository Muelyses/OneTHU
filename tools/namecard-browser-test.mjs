/**
 * 名片/通讯录 Phase 3 地基回归：
 * ① 设置页「我的 OneTHU 名片」可编辑（简介限 120 字）；② 名片可放进暂存箱；
 * ③ 暂存箱里点名片 → 加入通讯录；④ 重复收取按姓名+手机去重。
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
    const r = await route.fetch();
    let b = await r.text();
    for (const n of ['useLearnData', 'useCampusData']) b = b.replace(`export function ${n}() {`, `export function ${n}() { return {data:{semester:{id:'x'},courses:[],homework:[],notifications:[],files:[],schedule:[]},state:'ready',error:null,reload:async()=>{}};`);
    await route.fulfill({ response: r, body: b });
  });
  await p.goto(base + '/?explorer-preview=home', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.explorer-shell');
  await p.waitForTimeout(900);
  const call = async (path, name, args = []) => p.evaluate(async ({ path, name, args }) => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => new URL(u).pathname.endsWith(path));
    if (!url) throw Error('module not mounted ' + path);
    const m = await import(url);
    return m[name](...args);
  }, { path, name, args });

  /* 设置入口已从「设置齿轮」换成「我的」；个人设置浮层的分段是 .settings-seg-item */
  await p.getByRole('button', { name: '我的' }).first().click();
  await p.waitForTimeout(500);
  await p.locator('.settings-seg-item').filter({ hasText: '我的名片' }).first().click();
  await p.waitForTimeout(600);
  check(await p.getByText('我的名片', { exact: true }).count() >= 1, 'settings has the name card section');
  await p.getByRole('button', { name: '编辑资料' }).click();
  await p.waitForSelector('.plg-form-modal');
  const inputs = p.locator('.plg-form-modal input');
  await inputs.nth(0).fill('张三');
  await inputs.nth(1).fill('https://example.com/zhangsan');
  await inputs.nth(2).fill('@zhangsan');
  await inputs.nth(3).fill('13800000000');
  await inputs.nth(4).fill('2025013332@tsinghua.edu.cn');
  await p.locator('.plg-form-modal textarea').fill('这是简介'.repeat(40));
  await p.getByRole('button', { name: '提交' }).click();
  await p.waitForTimeout(500);
  const card = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.cards.v1')).personal);
  check(card.name === '张三' && card.website === 'https://example.com/zhangsan' && card.phone === '13800000000' && card.cloudEmail === '2025013332@tsinghua.edu.cn', 'personal card fields saved (incl. cloud email)');
  check(Array.from(card.bio).length === 120, 'bio is clamped to 120 chars for NFC length');

  await p.getByRole('button', { name: '放进暂存箱' }).first().click();
  await p.waitForTimeout(600);
  const inVault = await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('onethu.vaults.v1'));
    return d.boxes.flatMap((b) => b.items).find((x) => x.payload?.kind === 'namecard');
  });
  check(inVault?.title?.includes('张三') && inVault?.payload?.card?.name === '张三', 'name card can be put into vault as payload');

  await call('/src/state/explorer.ts', 'closeSettings', []);
  await call('/src/state/explorer.ts', 'explorerNavigate', ['vault']);
  await p.waitForTimeout(700);
  await p.getByText('名片 · 张三').first().click();
  await p.waitForTimeout(600);
  const ownContacts = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.cards.v1')).contacts.length);
  check(ownContacts === 0, 'own card is not added to contacts (self rejected)');
  const model = await p.evaluate(async () => {
    const m = await import('/src/state/nameCard.ts');
    m.savePersonalCard({ name: '我', phone: '13800000000', bio: '' });
    const card = { name: '李四', avatar: '', website: '', social: '', phone: '13900000000', bio: '同学', updatedAt: Date.now() };
    const first = m.addContact('personal', card);
    const dup = m.addContact('personal', card);
    return { first: first.ok, dup: dup.reason, n: m.cardsSnapshot().contacts.length };
  });
  check(model.first && model.dup === 'duplicate' && model.n === 1, 'contacts dedupe by name+phone');
  check(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.join(';') : ''));
  console.log(checks + ' name card assertions passed');
} finally {
  await browser.close();
}
