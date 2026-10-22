/** Wide touch-device editing gate, using real UI with isolated fictional data.
 * Does not connect to accounts or alter the user's browser/native dev session. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setup, call, close, browser } from './capture-public-preview.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const out = process.env.ONETHU_TEST_OUT ?? '/tmp/onethu-tablet-edit';
mkdirSync(out, { recursive: true });
const checks = [];
const check = (value, label) => { assert.ok(value, label); checks.push(label); console.log('✓ ' + label); };
const geometry = page => page.evaluate(() => localStorage.getItem('onethu.board.v1'));
async function bodyPoint(locator) {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    for (let y = Math.max(120, r.top + 10); y < Math.min(innerHeight - 140, r.bottom - 10); y += 10)
      for (let x = r.left + 12; x < Math.min(innerWidth - 180, r.right - 12); x += 12) {
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest('.free-item') === el && !hit.closest('a,button,input,textarea,[role=button],.free-toolbar,.free-handle,.hw-carousel')) return { x, y };
      }
    return null;
  });
}
async function touchDrag(client, point, dx, dy) {
  assert.ok(point, 'A visible widget body/handle is available');
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  for (let i = 1; i <= 12; i++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + dx * i / 12, y: point.y + dy * i / 12 }] });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
let passed = false; let currentPage;
try {
  const { page, context } = await setup(1280, 800, 'full', {
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79',
  });
  currentPage = page;
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'Linux armv8l' });
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => ({ platform: 'Android' }) });
  });
  await page.reload();
  await page.locator('[data-coach="home-edit"]').waitFor();
  const client = await context.newCDPSession(page);
  const wrap = () => page.locator('[data-tab-page="homepage"]:visible .freeboard-wrap');
  const clock = () => page.locator('[data-tab-page="homepage"]:visible .free-item[data-widget="clock"]');
  check(!(await page.locator('html').getAttribute('class')).split(' ').includes('is-phone'), 'landscape tablet keeps expanded geometry');
  check(await wrap().getAttribute('data-board-editable') === 'false', 'landscape tablet with spoofed Windows UA starts locked');
  check(await page.locator('.board-viewport-tools:visible button').count() === 1, 'wide touch device exposes only the explicit Edit button');
  let before = await geometry(page);
  await touchDrag(client, await bodyPoint(clock()), 60, 45);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
  check(await geometry(page) === before, 'locked touch dragging and keyboard shortcuts preserve geometry');
  check(await page.locator('.free-toolbar,.free-handle').count() === 0, 'locked tablet has no component selection/resize handles');
  check(await clock().evaluate(el => getComputedStyle(el).touchAction.includes('pan-y')), 'locked tablet allows vertical scrolling');
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  const startScroll = await page.evaluate(() => scrollY);
  await touchDrag(client, await bodyPoint(clock()), 0, -260);
  await page.waitForTimeout(300);
  check(await page.evaluate(() => scrollY) > startScroll, 'actual touch swipe scrolls the tablet board');
  await page.screenshot({ path: out + '/tablet-browse.png' });
  await page.getByRole('button', { name: '查看全部待办 →', exact: true }).click();
  await page.locator('[data-tab-page="tasks"]:visible').waitFor();
  check(true, 'locked board still opens component content normally');
  await call(page, '/src/state/explorer.ts', 'openTab', ['homepage']);
  await wrap().waitFor();

  await page.locator('[data-coach="home-edit"]').click();
  await page.locator('[data-board-editable="true"]').waitFor();
  check(await page.locator('[data-coach="home-add"]').isVisible(), 'tablet edit mode reveals the add-widget control');
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  before = await geometry(page);
  await touchDrag(client, await bodyPoint(clock()), 68, 54);
  await page.waitForTimeout(150);
  check(await geometry(page) !== before, 'explicit edit mode commits a real touch drag');
  // Handles use CSS classes; select any reachable handle rather than assuming placement.
  const resizePoint = await page.locator('.free-item.is-selected .free-handle').evaluateAll(elements => {
    for (const el of elements) {
      const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (document.elementFromPoint(x, y) === el) return { x, y };
    }
    return null;
  });
  before = await geometry(page);
  await touchDrag(client, resizePoint, 38, 32);
  await page.waitForTimeout(150);
  check(await geometry(page) !== before, 'explicit edit mode commits touch resize');
  await page.screenshot({ path: out + '/tablet-editing.png' });
  await page.locator('[data-coach="home-edit"]').click();
  await page.locator('[data-board-editable="false"]').waitFor();

  // Rotation changes content geometry, never grants editing rights.
  await page.setViewportSize({ width: 800, height: 1280 });
  check(await wrap().getAttribute('data-board-editable') === 'false', 'tablet portrait remains locked after rotation');
  await page.setViewportSize({ width: 1280, height: 800 });
  check(await wrap().getAttribute('data-board-editable') === 'false', 'returning to tablet landscape remains locked');
  await page.setViewportSize({ width: 844, height: 390 });
  check(await wrap().getAttribute('data-board-editable') === 'false', 'native Android phone landscape also remains locked without a phone query override');
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.evaluate(async () => {
    const board = await import('/src/state/board.ts'); const ops = await import('/src/state/boardOps.ts'); const free = await import('/src/state/freeBoard.ts');
    const result = ops.createBoard(board.loadBoard(), 'Fictional tablet OnePage');
    board.saveBoard(ops.setActiveBoard(result.doc, result.board.id));
    free.freeBoardOps(result.board.id, 'portrait').add({ kind: 'text', text: 'Fictional tablet note' }, 24, 24, 260, 160);
  });
  await call(page, '/src/state/explorer.ts', 'openTab', ['board']);
  const onepage = page.locator('[data-tab-page="board"]:visible .freeboard-wrap');
  await onepage.waitFor();
  check(await onepage.getAttribute('data-board-editable') === 'false', 'tablet OnePage starts independently locked');
  await page.locator('[data-coach="home-edit"]:visible').click();
  check(await onepage.getAttribute('data-board-editable') === 'true', 'tablet OnePage can explicitly enter edit mode');
  await call(page, '/src/state/explorer.ts', 'openTab', ['homepage']);
  await page.waitForTimeout(100);
  check(await wrap().getAttribute('data-board-editable') === 'false', 'returning Home never inherits another board’s editing grant');
  await page.locator('[data-coach="home-edit"]:visible').click();
  await page.evaluate(async () => {
    const source = await (await fetch('/src/components/FreeBoard.tsx')).text();
    const path = [...source.matchAll(/"([^" ]+)"/g)].map(m => m[1]).find(s => s.startsWith('/src/state/navStack.ts'));
    if (!path) throw Error('Missing navigation module');
    (await import(path)).back();
  });
  check(await wrap().getAttribute('data-board-editable') === 'false', 'Back closes tablet editing before navigation');
  // Resolve the exact dependency used by the mounted component; Vite may keep
  // both an HMR-stamped module and a plain URL in resource timing entries.
  await page.evaluate(async () => {
    const source = await (await fetch('/src/components/FreeBoard.tsx')).text();
    const path = [...source.matchAll(/"([^" ]+)"/g)].map(m => m[1]).find(s => s.startsWith('/src/state/experienceMode.ts'));
    if (!path) throw Error('Missing mounted experience-mode module');
    window.__tabletExperience = await import(path);
  });
  for (const mode of ['practical', 'simple']) {
    await page.locator('[data-coach="home-edit"]:visible').click();
    await page.evaluate(mode => window.__tabletExperience.setExperienceMode(mode), mode);
    await page.locator('.simple-home').waitFor();
    await page.evaluate(() => window.__tabletExperience.setExperienceMode('full'));
    await wrap().waitFor();
    check(await wrap().getAttribute('data-board-editable') === 'false', `returning from ${mode} mode clears the editing grant`);
  }
  await close(page, context);

  const desktop = await setup(1280, 800, 'full', { hasTouch: false });
  check(await desktop.page.locator('.freeboard-wrap').first().getAttribute('data-board-editable') === 'true', 'mouse desktop remains directly editable');
  check(await desktop.page.locator('[data-coach="home-edit"]').count() === 0, 'mouse desktop keeps its established controls');
  await close(desktop.page, desktop.context);
  passed = true;
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({path:out+'/failure.png'}).catch(()=>{});
    writeFileSync(out+'/failure.txt', await currentPage.locator('body').innerText().catch(()=>''));
  }
  throw error;
} finally {
  await closeTestBrowser(browser);
  writeFileSync(out + '/report.json', JSON.stringify({ passed, checks, scope: 'Isolated Chromium native touch input + Android host signals; no physical-device install' }, null, 2));
}
