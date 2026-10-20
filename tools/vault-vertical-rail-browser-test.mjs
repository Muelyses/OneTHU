/** Desktop vertical rail: use real pointer hover/click and keep the saved anchor preference intact. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = 'docs/onegui/vault-refinement-2026-10-20';
mkdirSync(out, { recursive: true });
const checks = [], geometry = [];
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('✓ ' + message); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let passed = false;
try {
  for (const narrow of [false, true]) {
    const label = narrow ? '悬停展开' : '固定展开';
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(10000);
    await installFakeCloud(page);
    await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
    await page.addInitScript(narrow => {
      localStorage.setItem('onethu.onboarded.phone', '1');
      localStorage.setItem('onethu.chatdock.open', '0');
      localStorage.setItem('explorer.tabLayout.default', 'v');
      localStorage.setItem('ex-rail-narrow', narrow ? '1' : '0');
      localStorage.setItem('onethu.vault-anchor.desktop.v1', JSON.stringify({ side: 'left', ratio: .4 }));
    }, narrow);
    await page.goto(base + '/?explorer-preview=home', { waitUntil: 'domcontentloaded' });
    const rail = page.locator('.ex-rail'), anchor = page.locator('.vault-floating-anchor.is-ready .vault-box-button');
    await rail.waitFor(); await anchor.click({ trial: true });
    check(await page.evaluate(() => document.documentElement.classList.contains('tabs-vertical')), label + ' 使用真实竖标签布局');
    if (narrow) {
      const collapsed = await rail.boundingBox();
      await rail.hover();
      await page.waitForFunction(() => document.querySelector('.ex-rail').getBoundingClientRect().width >= parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--og-rail-full-width')) - .5);
      const expanded = await rail.boundingBox();
      check(expanded.width > collapsed.width + 80, label + ' 真实hover将竖栏展开');
    }
    const measure = async () => page.evaluate(() => {
      const handle = document.querySelector('.vault-box-button');
      const a = handle.getBoundingClientRect(), rail = document.querySelector('.ex-rail').getBoundingClientRect();
      const preview = document.querySelector('.vault-radar')?.getBoundingClientRect();
      const box = r => r ? ({x:r.x,y:r.y,width:r.width,height:r.height}) : null;
      const overlap = (a,b) => Math.min(a.right,b.right)>Math.max(a.left,b.left) && Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top);
      return {anchor:box(a),rail:box(rail),preview:box(preview), anchorHit:handle.contains(document.elementFromPoint(a.x+a.width/2,a.y+a.height/2)),anchorOverlapsRail:overlap(a,rail),previewOverlapsRail:preview ? overlap(preview,rail):false, saved:JSON.parse(localStorage.getItem('onethu.vault-anchor.desktop.v1'))};
    });
    let result = await measure();
    check(result.rail.width > 180, label + ' 验收时竖栏实际展开');
    check(!result.anchorOverlapsRail && result.anchorHit, label + ' 左侧保存位置自动避开竖栏且入口可命中');
    check(result.saved.side === 'left' && result.saved.ratio === .4, label + ' 避障未篡改用户保存的left/40%');
    await anchor.click(); await page.locator('.vault-radar').waitFor();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.vault-radar')).opacity === '1');
    if (narrow) { await rail.hover(); await page.waitForFunction(() => document.querySelector('.ex-rail').getBoundingClientRect().width >= parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--og-rail-full-width')) - .5); }
    result = await measure(); geometry.push({mode:label,...result});
    check(!result.previewOverlapsRail && result.preview.x>=0 && result.preview.y>=0 && result.preview.x+result.preview.width<=1280 && result.preview.y+result.preview.height<=900, label + ' 预览不被展开竖栏遮住且完整在屏内');
    const manage = page.locator('.vault-radar').getByRole('button',{name:'整理暂存箱',exact:true});
    check(await manage.evaluate(el => {const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}), label + ' 整理按钮在竖栏展开时真实命中');
    if (narrow) await page.screenshot({animations:'disabled',path:`${out}/edge-vertical-rail.png`});
    await manage.click(); await page.locator('.vault-manager').waitFor();
    check(true, label + ' 真实点击整理打开管理面板');
    await page.locator('.vault-manager').getByRole('button',{name:'关闭',exact:true}).click();
    await page.locator('.vault-manager').waitFor({state:'hidden'});
    await page.waitForFunction(() => document.activeElement?.matches('.vault-box-button'));
    check(true, label + ' 关闭管理后焦点回入口');
    await page.close();
  }
  passed = true;
} finally {
  writeFileSync(`${out}/vertical-rail-report.json`,JSON.stringify({passed,checks,geometry,input:'Playwright real mouse hover/click; 1280x900 desktop'},null,2));
  await closeTestBrowser(browser);
}
