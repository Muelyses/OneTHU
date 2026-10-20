/** Trusted input: edge placement, phone rotation, profile separation, reset and navigation Back. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = process.env.ONETHU_TEST_OUT ?? process.env.ONETHU_VAULT_OUT ?? 'docs/onegui/vault-refinement-2026-10-20';
mkdirSync(out, { recursive: true });
const checks = [], geometry = [];
const check = (value, label) => { assert.ok(value, label); checks.push(label); console.log('✓ ' + label); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-updater-scheduler'] });
let passed = false;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(10000);
  await installFakeCloud(page);
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('onethu.onboarded.phone', '1');
    if (!localStorage.getItem('onethu.vault-anchor.phone.v1')) localStorage.setItem('onethu.vault-anchor.phone.v1', JSON.stringify({ side: 'left', ratio: .62 }));
    if (!localStorage.getItem('onethu.vault-anchor.desktop.v1')) localStorage.setItem('onethu.vault-anchor.desktop.v1', JSON.stringify({ side: 'right', ratio: .25 }));
  });
  await page.goto(base + '/?explorer-preview=home', { waitUntil: 'domcontentloaded' });
  const anchor = page.locator('.vault-floating-anchor.is-ready .vault-box-button');
  await anchor.waitFor();
  await page.locator('.oneshot').waitFor();
  const initialOH = page.getByRole('dialog', {name: 'OneTHU Harness 对话', exact: true});
  if (await initialOH.isVisible()) { await initialOH.getByRole('button', { name: '收起', exact: true }).tap(); await initialOH.waitFor({ state: 'hidden' }); }
  const bounds = async label => {
    const result = await anchor.evaluate(el => {
      const r = el.getBoundingClientRect();
      const obstacles = [...document.querySelectorAll('.explorer-topbar,.ex-bbar,.onego-bookmarks,.oneshot,.board-viewport-tools,.hard-refresh-fab,.top-fab,[data-oh-drop],.ex-rail')].filter(o => {
        const q = o.getBoundingClientRect(); return q.width && q.height && Math.min(r.right, q.right) > Math.max(r.left, q.left) && Math.min(r.bottom, q.bottom) > Math.max(r.top, q.top);
      }).map(o => o.className);
      return { x: r.x, y: r.y, width: r.width, height: r.height, side: el.parentElement.className, hitNode: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.outerHTML.slice(0,350), hit: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), obstacles, viewport: {width: innerWidth,height:innerHeight} };
    });
    geometry.push({ label, ...result });
    check(result.x >= 0 && result.y >= 0 && result.x + result.width <= result.viewport.width && result.y + result.height <= result.viewport.height, label + ' 入口完整可见');
    check(result.width >= 44 && result.height >= 44 && result.hit, label + ' 44px以上真实命中区域');
    check(result.obstacles.length === 0, label + ' 不遮挡导航、OH、OneShot、白板工具与刷新');
    return result;
  };
  let rect = await bounds('390竖屏');
  check(rect.side.includes('is-left'), '手机使用独立保存的左侧位置');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => !document.documentElement.classList.contains('is-phone'));
  await page.waitForTimeout(150);
  rect = await bounds('844触屏横屏');
  check(rect.side.includes('is-left'), '旋转切换桌面布局后仍沿用手机入口位置');
  await anchor.tap();
  await page.locator('.vault-manager').waitFor();
  check(await page.locator('.vault-radar').count() === 0, '普通点击直接管理，不出现传输雷达');
  const managerBounds = await page.locator('.vault-manager').boundingBox();
  check(managerBounds && managerBounds.y >= 0 && managerBounds.y + managerBounds.height <= 390, '横屏管理面板全高夹紧');
  await page.locator('.vault-manager').getByRole('button', { name: '关闭', exact: true }).tap();
  await page.waitForFunction(() => document.activeElement?.matches('.vault-box-button'));
  check(true, '直接管理后关闭仍归还持久入口焦点');
  await page.screenshot({ animations: 'disabled', path: `${out}/edge-landscape.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.classList.contains('is-phone'));
  await page.waitForTimeout(150);
  await anchor.tap();
  await page.locator('.vault-manager').waitFor();
  const url = page.url();
  // Android native Back enters this registered stack, rather than browser history.
  const navBack = () => page.evaluate(async () => { const path = '/src/state/navStack.ts'; const resource = performance.getEntriesByType('resource').map(r => r.name).find(url => new URL(url).pathname === path) ?? path; return (await import(resource)).back(); });
  await navBack();
  await page.locator('.vault-manager').waitFor({ state: 'hidden' });
  check(page.url() === url, '导航栈返回只关管理面板，当前页保持不变');
  await anchor.tap();
  await page.locator('.vault-manager').getByRole('button', { name: '入口位置', exact: true }).tap();
  const menu = page.getByRole('menu', { name: '暂存箱入口位置', exact: true });
  await menu.waitFor();
  await navBack(); await menu.waitFor({ state: 'hidden' });
  check(page.url() === url, '导航栈返回只关位置菜单');
  await anchor.tap(); await page.locator('.vault-manager').getByRole('button', { name: '入口位置', exact: true }).tap();
  await menu.getByRole('menuitem', { name: '恢复默认位置', exact: true }).tap();
  await page.waitForFunction(() => document.querySelector('.vault-floating-anchor')?.classList.contains('is-right'));
  const prefs = await page.evaluate(() => ({ phone: JSON.parse(localStorage.getItem('onethu.vault-anchor.phone.v1')), desktop: JSON.parse(localStorage.getItem('onethu.vault-anchor.desktop.v1')) }));
  check(prefs.phone.side === 'right' && prefs.phone.ratio === .4 && prefs.desktop.side === 'right' && prefs.desktop.ratio === .25, '复位只修改手机位置，保留桌面设置');
  rect = await bounds('复位默认');
  check(Math.abs(rect.y + rect.height / 2 - 844 * .4) < 20, '默认右侧约40%高度');
  await page.screenshot({ animations: 'disabled', path: `${out}/edge-phone390.png` });
  for (const ratio of [0, 1]) {
    await page.evaluate(ratio => localStorage.setItem('onethu.vault-anchor.phone.v1', JSON.stringify({ side:'right', ratio })), ratio);
    await page.reload({ waitUntil: 'domcontentloaded' }); await anchor.waitFor(); await bounds(`极端保存高度${ratio}`);
  }
  // A real drag cancelled by Escape must not persist or open the preview.
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 3, radiusY: 3, force: 1, id: 1 }] });
  const before = await page.evaluate(() => localStorage.getItem('onethu.vault-anchor.phone.v1'));
  rect = await anchor.boundingBox();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await touch('touchStart', x, y); await page.waitForTimeout(360); await touch('touchMove', 60, 300);
  await page.keyboard.press('Escape'); await touch('touchEnd');
  await page.waitForTimeout(150);
  check(before === await page.evaluate(() => localStorage.getItem('onethu.vault-anchor.phone.v1')), '取消拖动不保存中途位置');
  check(await page.locator('.vault-radar,.vault-manager').count() === 0, '取消拖动不误开面板');
  await bounds('取消拖动恢复');
  await cdp.detach();
  const call = (path, method, args = []) => page.evaluate(async ({path,method,args}) => {
    const resource = performance.getEntriesByType('resource').map(r => r.name).find(url => new URL(url).pathname === path) ?? path;
    return (await import(resource))[method](...args);
  }, {path,method,args});
  await call('/src/state/vault.ts', 'addToVault', [{type:'text',title:'完整文字验证',text:'管理面板中的文字可以打开全文，关闭后焦点仍回到边缘入口。'}]);
  await anchor.tap();
  const textRow = page.locator('.vault-manager .og-row').filter({hasText:'完整文字验证'}).first();
  await textRow.tap();
  await page.locator('.vault-text-preview').waitFor();
  await page.keyboard.press('Escape'); await page.locator('.vault-text-preview').waitFor({state:'hidden'});
  check(await page.locator('.vault-manager').isVisible(), '全文预览Escape只关闭子层，保留管理面板');
  await page.locator('.vault-manager').getByRole('button', {name:'关闭',exact:true}).tap();
  await page.locator('.vault-manager').waitFor({state:'hidden'});
  await page.waitForFunction(() => document.activeElement?.matches('.vault-box-button'));
  check(true, '全文预览与管理面板依次关闭后焦点回到持久入口');
  for (const theme of ['dark','glass']) {
    if (theme === 'dark') check(await call('/src/state/theme.ts', 'activateTheme', ['onethu.theme.night']), '真实主题引擎激活夜航');
    else { await call('/src/state/theme.ts','deactivateTheme'); await call('/src/lib/glassLevel.ts','setGlassLevel',['rich']); }
    await anchor.tap(); await page.locator('.vault-manager').waitFor();
    check(await page.locator('.vault-radar').count() === 0, theme + ' 点击入口不挂载传输雷达');
    const colors = await page.evaluate(() => {
      const button = getComputedStyle(document.querySelector('.vault-box-button'));
      const manager = getComputedStyle(document.querySelector('.vault-manager'));
      const workspace = getComputedStyle(document.querySelector('.vault-manager .vault-workspace'));
      const text = getComputedStyle(document.querySelector('.vault-manager .vault-item-in'));
      return { scheme:document.documentElement.dataset.ogScheme, skin:document.documentElement.dataset.ogSkin, button:{color:button.color,background:button.backgroundColor}, manager:{color:manager.color,background:manager.backgroundColor,blur:workspace.backdropFilter}, title:text.color };
    });
    check(colors.button.color !== colors.button.background && colors.manager.color !== colors.manager.background, theme + ' 把手与管理面板前景背景区分');
    if (theme === 'glass') check(colors.skin === 'glass' && colors.manager.blur.includes('blur('), '玻璃管理面板沿用真实共享背景模糊');
    geometry.push({ theme, colors });
    await page.screenshot({ animations: 'disabled', path: `${out}/manager-${theme}-phone390.png` });
    await page.locator('.vault-manager').getByRole('button',{name:'关闭',exact:true}).tap();
    await page.locator('.vault-manager').waitFor({state:'hidden'});
  }
  passed = true;
} finally {
  writeFileSync(`${out}/edge-results.json`, JSON.stringify({ passed, checks, geometry, input:'Playwright taps and Chrome CDP trusted touch; native Back registration checked through navStack.back, not a physical Android device' }, null, 2));
  await closeTestBrowser(browser);
}
