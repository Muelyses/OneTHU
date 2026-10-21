/** Real home-widget clicks and ordinary tab navigation must have identical gutters.
 * Uses disposable browser contexts, preview fixtures, and no school requests.
 * Run against Vite: node tools/widget-navigation-layout-browser-test.mjs
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--disable-updater-scheduler'],
});
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
try {
  for (const [width, vertical] of [[1280, false], [1280, true], [390, false]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 600 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.addInitScript(() => {
      localStorage.setItem('onethu.experience.v1', 'full');
      localStorage.setItem('onethu.onboarded.phone', '1');
      localStorage.setItem('onethu.overlay.closed', '1');
    });
    await page.goto(base + '/?explorer-preview=onboarding');
    await page.locator('.explorer-shell').waitFor();
    await page.evaluate(async vertical => {
      const mod = path => import(performance.getEntriesByType('resource')
        .filter(e => new URL(e.name).pathname === path).at(-1)?.name ?? path);
      const explorer = await mod('/src/state/explorer.ts');
      (await mod('/src/state/cache.ts')).setPreviewMode(true);
      (await mod('/src/state/data.ts')).seedPreviewData();
      if (vertical) (await mod('/src/state/tabLayout.ts')).setTabLayoutMode('v');
      const free = await mod('/src/state/freeBoard.ts');
      const ops = free.freeBoardOps();
      // Mount fresh widgets after seeding so their local data hooks read fixtures.
      ops.replace([]);
      ops.add({ kind: 'nav', page: 'trace' }, 24, 24, 260, 90);
      ops.add({ kind: 'custom', id: 'homework' }, 24, 140, 500, 420);
      window.widgetLayout = { explorer };
    }, vertical);
    const home = page.locator('.explorer-panel[data-tab-id="home"]');
    await home.locator('.hw-card.is-cur').waitFor();
    const geometry = () => page.locator('.explorer-panel:visible').evaluate(panel => {
      const style = getComputedStyle(panel), main = panel.parentElement;
      const rect = panel.getBoundingClientRect(), parent = main.getBoundingClientRect();
      return { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight),
        shellLeft: parseFloat(getComputedStyle(main).paddingLeft), width: rect.width, hostWidth: parent.width };
    });
    const compare = async (route, click) => {
      await click();
      await page.locator(`[data-tab-page="${route}"]:visible`).waitFor();
      const fromWidget = await geometry();
      check(fromWidget.left >= 16 && fromWidget.left === fromWidget.right, `${width}/${vertical}: ${route} widget has balanced gutters`);
      check(fromWidget.shellLeft === 0, 'Spacing belongs to the tab, not the shared canvas host');
      check(fromWidget.width <= fromWidget.hostWidth + 1, 'Gutters do not overflow their host');
      await page.evaluate(route => window.widgetLayout.explorer.openTab(route, window.widgetLayout.explorer.activeTab().params, { forceNew: true }), route);
      await page.waitForFunction(route => document.querySelector('main').dataset.activePage === route, route);
      assert.deepEqual(await geometry(), fromWidget, 'Direct and widget routes have identical geometry'); checks++;
      if (route === 'learn-assignment-detail' && !vertical) {
        await page.locator('.explorer-panel:visible > .page-anim').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))));
        await page.screenshot({path: `/tmp/onethu-widget-layout-${width}.png`});
      }
      await page.evaluate(() => window.widgetLayout.explorer.openTab('homepage'));
      await home.waitFor({ state: 'visible' });
    };
    await compare('trace', () => home.locator('.wg-entry').click());
    await compare('learn-assignment-detail', () => home.locator('.hw-card.is-cur').click());
    await page.evaluate(() => window.widgetLayout.explorer.openTab('schedule'));
    await page.waitForFunction(() => document.documentElement.classList.contains('is-schedule-page'));
    check((await geometry()).left === 0, 'Schedule remains edge-to-edge');
    await page.evaluate(() => window.widgetLayout.explorer.openTab('trace'));
    await page.waitForFunction(() => !document.documentElement.classList.contains('is-schedule-page'));
    check((await geometry()).left >= 16, 'Returning from schedule restores ordinary tab gutters');
    check(errors.length === 0, errors.join('; '));
    await context.close();
    console.log(`✓ ${width}px ${vertical ? 'vertical tabs' : 'horizontal tabs'} widget/direct navigation`);
  }
} finally { await closeTestBrowser(browser); }
console.log(`Widget navigation layout: ${checks} checks passed`);
