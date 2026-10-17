/**
 * OH 路由 / OnePage 数据安全 / OneFlow 执行回归（Vite 必须跑在 5180）。
 *
 * 2026-10-17 审计修复的护栏：
 * ① OH 设置行深链必须真的切到 OneTHU Harness 段 + 高级档 + 高亮行（以前被后置 openSettings 打回插件页 / 切档丢失）
 * ② 设置页「搜索与胶囊」「极客模式」只出现在各自页签（以前泄漏到全部页签）
 * ③ 首页态 navigate learn-* 子页必须真的开标签（以前静默回首页）
 * ④ 所有白板页不能拿挂载时快照覆盖其他入口刚建的 OnePage（数据丢失）
 * ⑤ OneFlow 手动运行真的执行步骤；位置参数数组可用；失败原因落到 lastError
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
  await p.waitForTimeout(800);
  const call = async (path, name, args = []) => p.evaluate(async ({ path, name, args }) => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => new URL(u).pathname.endsWith(path));
    if (!url) throw Error('module not mounted ' + path);
    const m = await import(url);
    return m[name](...args);
  }, { path, name, args });

  /* ① 检索行 → OH 段 + 高级档 + 行高亮 */
  const ids = await p.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => new URL(u).pathname.endsWith('/state/searchRows.ts'));
    const m = await import(url);
    return m.allSearchRows().map((r) => r.id);
  });
  for (const id of ['oh-root', 'oh-mcp-server', 'oh-mcp-client', 'set-wallpaper', 'set-glass-level', 'set-tabbar-style', 'set-dyn-color', 'set-capsule-tap', 'set-geek', 'plg-market-search']) {
    check(ids.includes(id), 'search row registered: ' + id);
  }
  await p.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => new URL(u).pathname.endsWith('/state/searchRows.ts'));
    const m = await import(url);
    m.goSearchRow(m.allSearchRows().find((r) => r.id === 'oh-mcp-server'));
  });
  await p.waitForTimeout(900);
  const oh = await p.evaluate(() => ({
    seg: [...document.querySelectorAll('.settings-seg-item')].find((e) => e.classList.contains('is-active'))?.textContent?.trim(),
    focus: document.querySelector('.row-focus')?.textContent?.trim() ?? '',
    advanced: (document.querySelector('.explorer-settings-body')?.textContent ?? '').includes('模型 / MCP / 日志'),
  }));
  check(oh.seg?.includes('OneTHU Harness'), 'OH row lands the OneTHU Harness entry (not 插件)');
  check(oh.advanced, 'OH advanced row switches to advanced tier');
  check(oh.focus.includes('MCP'), 'OH row is focused/highlighted');

  /* ② 设置分节页签归属 */
  await call('/src/state/explorer.ts', 'openSettings', ['settings']);
  await p.waitForTimeout(400);
  const sectionShown = (t) => p.evaluate((t) => {
    const head = [...document.querySelectorAll('.og-section,.section-head')].find((e) => (e.textContent ?? '').trim().startsWith(t));
    return head ? getComputedStyle(head).display !== 'none' : null;
  }, t);
  check((await sectionShown('搜索与胶囊')) === false && (await sectionShown('极客模式')) === false, 'capsule/geek sections hidden under 账号 tab');
  await p.getByRole('tab', { name: '外观与布局' }).click();
  await p.waitForTimeout(600);
  check((await sectionShown('搜索与胶囊')) === true, 'capsule section visible under 外观与布局');
  await p.getByRole('tab', { name: '桌面小组件' }).click();
  await p.waitForTimeout(600);
  check((await sectionShown('极客模式')) === true, 'geek section visible under 桌面小组件');
  await call('/src/state/explorer.ts', 'closeSettings', []);
  await p.waitForTimeout(300);

  /* ③ 首页态 navigate 学堂子页 */
  await call('/src/state/explorer.ts', 'focusTab', ['home']);
  await call('/src/state/explorer.ts', 'explorerNavigate', ['learn-assignments']);
  await p.waitForTimeout(500);
  const tabTitle = await p.evaluate(() => document.querySelector('.ex-tab.is-active .ex-tab-title')?.textContent ?? '');
  check(tabTitle === '全部作业', 'home-state navigate opens learn-assignments tab (got ' + tabTitle + ')');

  /* ④ 所有白板页不被旧快照覆盖 */
  await call('/src/state/explorer.ts', 'explorerNavigate', ['boards']);
  await p.waitForTimeout(500);
  const extId = await p.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => new URL(u).pathname.endsWith('/state/onePage.ts'));
    const m = await import(url);
    const id = 'board.ext.' + Date.now();
    m.mutateBoards((d) => ({ ...d, boards: [...d.boards, { id, name: '外部建的板', icon: 'book', kind: 'user', cells: { portrait: [] } }] }));
    return id;
  });
  await p.waitForTimeout(400);
  check(await p.locator('[data-board-id="' + extId + '"]').count() === 1, 'board list subscribes to external OnePage creation');
  await p.getByRole('button', { name: '新建 OnePage' }).click();
  await p.waitForTimeout(500);
  const kept = await p.evaluate((id) => JSON.parse(localStorage.getItem('onethu.board.v1')).boards.some((b) => b.id === id), extId);
  check(kept, 'new OnePage action does not overwrite external board (no stale doc save)');

  /* ⑤ OneFlow：真实执行 + 位置参数 + lastError */
  const flow = await p.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => new URL(u).pathname.endsWith('/state/userext.ts'));
    const m = await import(url);
    let got = null;
    m.registerFlowExecutor(async (tool, args) => { got = { tool, args }; return { ok: true }; });
    m.upsertFlow({ id: 'fl.test', name: '测试流程', trigger: { kind: 'manual' }, steps: [{ tool: 'nav.go', args: ['schedule'] }] });
    const r1 = await m.runFlowNow('fl.test');
    const snapshot1 = m.userExtSnapshot().flows.find((f) => f.id === 'fl.test');
    m.registerFlowExecutor(async () => { throw new Error('第 2 步故意失败'); });
    m.upsertFlow({ id: 'fl.bad', name: '失败流程', trigger: { kind: 'manual' }, steps: [{ tool: 'nav.go', args: ['schedule'] }] });
    const r2 = await m.runFlowNow('fl.bad');
    const snapshot2 = m.userExtSnapshot().flows.find((f) => f.id === 'fl.bad');
    m.setFlowEnabled('fl.test', false);
    const disabled = m.userExtSnapshot().flows.find((f) => f.id === 'fl.test')?.enabled;
    return { r1, got, lastOk: snapshot1?.lastOk, r2, lastError: snapshot2?.lastError, disabled };
  });
  check(flow.r1.ok === true && flow.got?.tool === 'nav.go' && Array.isArray(flow.got?.args), 'OneFlow manually runs and passes positional args array');
  check(flow.lastOk === true, 'OneFlow success recorded');
  check(flow.r2.ok === false && /故意失败/.test(flow.lastError ?? ''), 'OneFlow failure reason persisted to lastError');
  check(flow.disabled === false, 'OneFlow can be disabled');
  check(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.join(';') : ''));
  console.log(checks + ' OH route / OnePage / OneFlow assertions passed');
} finally {
  await browser.close();
}
