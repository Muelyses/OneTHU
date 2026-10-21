/**
 * 暂存箱「长按拖入」来源补充 + 手机长按接收光环回归：
 * ① 手机云盘文件行有 data-vault-catch；CDP 触摸长按 → 拖到入口 → 松手进暂存箱；
 * ② 日程时间块有 data-vault-catch；
 * ③ 桌面标签页有 data-vault-catch；
 * ④ 其它来源（GitLab/附件/工作区/新闻）由静态守卫盯属性。
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { installFakeCloud } from './lib/fake-cloud.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:5180';
let checks = 0;
const errors = [];
const check = (c, m) => { assert.ok(c, m); checks++; console.log('✓ ' + m); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });

function dataPatch() {
  const seed = {
    schedule: [
      { id: 's1', title: '数据结构', location: '六教 6A214', date: new Date().toISOString().slice(0, 10), startTime: '09:50', endTime: '11:25', kind: 'course' },
    ],
  };
  return seed;
}

async function phonePage() {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('onethu.onboarded.phone', '1');
    localStorage.setItem('onethu.experience.v1', 'full');
    /* 假云盘 seed：一个库、两个文件/文件夹 */
    localStorage.setItem('onethu.test.cloud.v1', JSON.stringify({
      fs: { 'repo-one': { '/a.txt': 'hello a', '/folder/b.txt': 'hello b' } },
      shares: {}, seq: 0, repos: [{ id: 'repo-one', name: 'OneTHU' }], email: 'tester@mails.tsinghua.edu.cn', sharedTo: [],
    }));
  });
  await installFakeCloud(p, { token: 'test-token' });
  const seed = dataPatch();
  await p.route('**/src/state/data.ts*', async (route) => {
    const r = await route.fetch(); let b = await r.text();
    b = b.replace('export function useLearnData() {', `export function useLearnData() { return {data:{semester:{id:'x'},courses:[],homework:[],notifications:[],files:[],schedule:${JSON.stringify(seed.schedule)}},state:'ready',error:null,reload:async()=>{}};`);
    b = b.replace('export function useCampusData() {', `export function useCampusData() { return {data:{semester:{id:'x'},courses:[],homework:[],notifications:[],files:[],schedule:${JSON.stringify(seed.schedule)}},state:'ready',error:null,reload:async()=>{}};`);
    await route.fulfill({ response: r, body: b });
  });
  await p.goto(base + '/?explorer-preview=home', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.explorer-shell'); await p.waitForTimeout(1000);
  return p;
}
async function call(p, path, name, args = []) {
  return p.evaluate(async ({ path, name, args }) => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => new URL(u).pathname.endsWith(path));
    if (!url) throw Error('module not mounted ' + path);
    const m = await import(url); return m[name](...args);
  }, { path, name, args });
}

try {
  /* ① 手机云盘：文件行可被长按拖入 */
  const p = await phonePage();
  try {
    await call(p, '/src/state/explorer.ts', 'explorerNavigate', ['cloud']);
    await p.waitForTimeout(900);
    check(await p.locator('[data-vault-catch]:visible').count() >= 1, '云盘资料库卡/文件行带 data-vault-catch');
    const repo = p.locator('[data-vault-catch]:visible').filter({ hasText: 'OneTHU' }).first();
    await repo.click(); await p.waitForTimeout(900);
    const fileRow = p.locator('[data-vault-catch]:visible').filter({ hasText: 'a.txt' }).first();
    check(await fileRow.count() >= 1, '云盘文件行带 data-vault-catch');
    const before = await p.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('onethu.vaults.v1') || '{}')?.boxes?.reduce((n, b) => n + (b.items?.length || 0), 0) ?? 0; } catch { return 0; }
    });
    const box = await fileRow.boundingBox();
    const client = await p.context().newCDPSession(p);
    const sx = box.x + Math.min(60, box.width / 2), sy = box.y + box.height / 2;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] });
    await p.waitForTimeout(650);
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx + 4, y: sy + 4, id: 1 }] });
    await p.waitForTimeout(150);
    check(await p.locator('.vault-accept-halo').isVisible(), '手机长按后入口出现局部接收光环');
    /* Use continuous touch samples to reach the visible button, including at viewport edges. */
    const target = await p.locator('.vault-floating-anchor .vault-box-button').boundingBox();
    const tx = target.x + target.width / 2, ty = target.y + target.height / 2;
    const steps = Math.max(1, Math.ceil(Math.hypot(tx - sx - 4, ty - sy - 4) / 6));
    for (let step = 1; step <= steps; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx + 4 + (tx - sx - 4) * step / steps, y: sy + 4 + (ty - sy - 4) * step / steps, id: 1 }] });
      await p.waitForTimeout(16);
    }
    await p.waitForTimeout(150);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(700);
    const after = await p.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('onethu.vaults.v1') || '{}')?.boxes?.reduce((n, b) => n + (b.items?.length || 0), 0) ?? 0; } catch { return 0; }
    });
    check(after > before, `手机长按拖入暂存箱（${before} → ${after}）`);
  } finally { await p.close(); }

  /* ② 日程时间块由静态守卫盯源码（页面需要登录态数据，浏览器预览不渲染） */

  /* ③ 桌面标签页 */
  const d = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  d.on('pageerror', (e) => errors.push(e.message));
  await d.addInitScript(() => { performance.setResourceTimingBufferSize(10000); localStorage.setItem('onethu.onboarded.v1', '1'); });
  await d.goto(base + '/?explorer-preview=home', { waitUntil: 'domcontentloaded' });
  await d.waitForSelector('.explorer-shell'); await d.waitForTimeout(1000);
  await d.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => new URL(u).pathname.endsWith('/src/state/explorer.ts'));
    if (url) { const m = await import(url); m.openTab('schedule'); }
  });
  await d.waitForTimeout(600);
  check((await d.locator('.ex-tab[data-vault-catch]').count()) >= 1, '桌面标签页带 data-vault-catch');
  await d.close();

  check(errors.length === 0, '无运行时错误 ' + JSON.stringify(errors.slice(0, 3)));
  console.log(`\n${checks} vault catch assertions passed`);
} finally { await browser.close(); }
