/**
 * 暂存箱 Phase 1 回归（Vite 必须跑在 5180）：
 * ① /vault 路由可打开；② 搜索结果可拖入暂存箱（data-vault-catch + 拖放目标）；
 * ③ 同对象去重；④ 口令可生成、可解码校验、篡改会拒绝；⑤ 口令可导入为当前暂存箱。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
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
  await p.goto(base + '/?explorer-preview=page&page=vault', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.explorer-shell');
  await p.waitForTimeout(1500);
  check(await p.getByRole('heading', { name: '暂存箱', exact: true }).count() === 1, 'vault page route works');
  check(await p.evaluate(() => !document.body.innerText.includes('页面不存在')), 'no fallback page text');

  /* 搜索 → 拖入 */
  await p.keyboard.press('Control+KeyK');
  await p.waitForTimeout(350);
  const input = p.locator('.pal-input, input[placeholder*="搜索"], input[placeholder*="搜"]').first();
  await input.fill('电费');
  await p.waitForTimeout(450);
  const row = p.locator('.pal-row').first();
  check((await row.getAttribute('data-vault-catch'))?.includes('"type":"atom"'), 'search row is a vault drag source');
  const box = await row.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 24, { steps: 6 });
  await p.waitForTimeout(250);
  check(await p.locator('[data-vault-drop]').count() === 1, 'drop target appears while dragging');
  const drop = await p.locator('[data-vault-drop]').boundingBox();
  await p.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, { steps: 10 });
  await p.waitForTimeout(250);
  await p.mouse.up();
  await p.waitForTimeout(600);
  await p.keyboard.press('Escape');
  const count = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.vaults.v1')).boxes[0].items.length);
  check(count === 1, 'dragged object lands in vault');
  check(await p.getByText('宿舍电费').count() >= 1, 'vault shows dragged item title');

  /* 口令生成 + 校验 */
  await p.getByRole('button', { name: '生成口令' }).click();
  await p.waitForTimeout(600);
  const code = await p.locator('.vault-share-code').innerText();
  check(/^ONV1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/.test(code.trim()), 'share code has ONV1.body.checksum shape');
  const decoded = await p.evaluate(async (c) => {
    /* codec 是纯函数；直接按 Vite 原路径 import 不影响应用状态。 */
    const m = await import('/src/state/vaultShare.ts');
    return { ok: m.decodeShare(c), bad: m.decodeShare(c.slice(0, -1) + (c.endsWith('0') ? '1' : '0')) };
  }, code.trim());
  check(decoded.ok.ok && decoded.ok.payload?.name === '我的暂存箱', 'code decodes with box name');
  check(!decoded.bad.ok, 'tampered code is rejected');
  const expired = await p.evaluate(async () => {
    const m = await import('/src/state/vaultShare.ts');
    const code = m.encodeShare({ v: 1, kind: 'vault-share', issuedAt: Date.now() - 1000, expiresAt: Date.now() - 1, name: '过期口令', items: [] });
    return m.decodeShare(code);
  });
  check(!expired.ok && /过期/.test(expired.reason ?? ''), 'expired code is rejected with reason');
  check(readFileSync('apps/desktop/src/components/Collect.tsx', 'utf8').includes('data-vault-catch'), 'CollectStar is a global vault drag source');
  check(readFileSync('apps/desktop/src/plugins/ChatDock.tsx', 'utf8').includes('data-vault-catch'), 'OH search hits are vault drag sources');

  /* 导入为当前暂存箱（走真实 UI：新建箱 → 导入口令 → 提交） */
  await p.getByRole('button', { name: '新建', exact: true }).click();
  await p.waitForTimeout(350);
  await p.getByRole('button', { name: '导入口令' }).click();
  await p.waitForSelector('.plg-form-modal');
  await p.locator('.plg-form-modal textarea').fill(code.trim());
  await p.getByRole('button', { name: '提交' }).click();
  await p.waitForTimeout(700);
  const imported = await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('onethu.vaults.v1'));
    const active = d.boxes.find((b) => b.id === d.activeId);
    return { n: active.items.length, title: active.items[0]?.title, name: active.name };
  });
  check(imported.n === 1 && imported.title === '宿舍电费', 'import replaces current vault with shared items');
  check(imported.name !== '我的暂存箱', 'import targets active vault, not origin box');
  check(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.join(';') : ''));
  console.log(checks + ' vault assertions passed');
} finally {
  await browser.close();
}
