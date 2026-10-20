/** Focused vault entry/radar acceptance: real DOM, trusted pointer input, isolated data. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
import { recordScreencast } from './lib/onboarding-recording.mjs';

const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = process.env.ONETHU_RADAR_OUT ?? 'docs/onegui/vault-radar-2026-10-20';
// Also exercise the original third row after a real scroll on narrow phones.
const ohTitle = process.env.ONETHU_RADAR_OH_SOURCE ?? '练习文件';
// Send continuous trusted touch samples; 0 retains the coarse six-step diagnostic.
const touchStep = Number(process.env.ONETHU_RADAR_TOUCH_STEP ?? 6);
const sizes = (process.env.ONETHU_TEST_SIZES ?? '1280x860,390x844,320x568,844x390').split(',').map(size => size.split('x').map(Number));
for (const name of ['screenshots', 'recordings', 'frames']) mkdirSync(`${out}/${name}`, { recursive: true });
const report = { sizes, ohSource: ohTitle, touchSampling: { maxStepPx: touchStep || null, intervalMs: touchStep ? 16 : 0, coarseSteps: touchStep ? null : 6 }, checks: [], errors: [], geometry: [], recordings: [], input: [], passed: false, naturalCleanup: false };
const check = (value, message) => { assert.ok(value, message); report.checks.push(message); console.log('✓ ' + message); };
const call = (page, path, name, args = []) => page.evaluate(async ({ path, name, args }) => {
  const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname === path) ?? path;
  return (await import(url))[name](...args);
}, { path, name, args });
const countItems = page => page.evaluate(() => JSON.parse(localStorage.getItem('onethu.vaults.v1')).boxes.reduce((sum, box) => sum + box.items.length, 0));
const radar = page => page.locator('.vault-radar');
const manager = page => page.locator('.vault-manager');
const anchor = page => page.locator('.vault-floating-anchor.is-ready .vault-box-button');
const source = (page, title) => page.locator('[data-vault-catch]:visible').filter({ hasText: title }).first();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--disable-updater-scheduler'],
});
let currentPage;

async function setup(width, height) {
  const touch = width !== 1280;
  const page = currentPage = await browser.newPage({ viewport: { width, height }, hasTouch: touch });
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => report.errors.push(`${width}x${height}: ${error.message}`));
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  // This fixture has no plugin PID/API configuration; also block external requests.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:5180|localhost:5180)/, route => route.abort());
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('onethu.onboarded.phone', '1');
    localStorage.setItem('onethu.experience.v1', 'full');
    localStorage.setItem('onethu.chatdock.open', '0');
    localStorage.setItem('onethu.test.cloud.v1', JSON.stringify({
      fs: { 'repo-one': { '/课程资料/说明.txt': '课程资料', '/研讨项目/说明.txt': '研讨项目', '/练习文件/说明.txt': '练习文件' } },
      repos: [{ id: 'repo-one', name: 'OneTHU', owner: 'tester@mails.tsinghua.edu.cn' }], shares: {}, seq: 0,
    }));
    window.__radarQA = { appearances: 0, pointers: [], touches: [], presses: [], contextMenus: [], oh: [] };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(type, event => {
      window.__radarQA.pointers.push({ time: performance.now(), type, pointerId: event.pointerId, pointerType: event.pointerType, trusted: event.isTrusted, x: event.clientX, y: event.clientY, active: document.body.classList.contains('is-vault-dragging') });
    }, true);
    document.addEventListener('touchmove', event => setTimeout(() => window.__radarQA.touches.push({ time: performance.now(), cancelled: event.defaultPrevented, cancelable: event.cancelable, active: document.body.classList.contains('is-vault-dragging') }), 0), { passive: true });
    document.addEventListener('contextmenu', event => setTimeout(() => window.__radarQA.contextMenus.push({ time: performance.now(), cancelled: event.defaultPrevented, target: event.target?.className, menus: document.querySelectorAll('[role=menu]').length }), 0), true);
    addEventListener('DOMContentLoaded', () => {
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes)
          if (node instanceof Element && (node.matches('.vault-radar') || node.querySelector('.vault-radar'))) window.__radarQA.appearances++;
      }).observe(document.body, { subtree: true, childList: true });
    });
  });
  await installFakeCloud(page);
  await page.route('**/src/plugins/ChatDock.tsx*', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('export function ohAsk(text) {', 'export function ohAsk(text) { window.__radarQA.oh.push(text);');
    assert.ok(body.includes('window.__radarQA.oh.push(text)'), 'Passive OH observer attaches to the real function');
    await route.fulfill({ response, body });
  });
  await page.route('**/src/state/data.ts*', async route => {
    const response = await route.fetch(); let body = await response.text();
    for (const name of ['useLearnData', 'useCampusData']) body = body.replace(`export function ${name}() {`, `export function ${name}() { return {data:{semester:{id:'fixture'},courses:[],homework:[],notifications:[],files:[],schedule:[]},state:'ready',error:null,reload:async()=>{}};`);
    await route.fulfill({ response, body });
  });
  await page.goto(base + '/?explorer-preview=onboarding');
  await page.locator('.explorer-shell').waitFor();
  for (const [title, text] of [['课程清单', '本周课程材料'], ['项目计划', '研讨项目安排'], ['复习提纲', '复习三章内容']])
    await call(page, '/src/state/vault.ts', 'addToVault', [{ type: 'text', title, text }]);
  await call(page, '/src/state/explorer.ts', 'explorerNavigate', ['cloud']);
  await source(page, 'OneTHU').click();
  await source(page, '课程资料').waitFor();
  await anchor(page).waitFor();
  const cdp = await page.context().newCDPSession(page);
  let lastPoint;
  const input = {
    async down(locator) {
      await locator.scrollIntoViewIfNeeded();
      lastPoint = await locator.evaluate(element => {
        const rect = element.getBoundingClientRect();
        for (const dx of [Math.min(28, rect.width / 2), Math.min(70, rect.width / 2), rect.width / 2, rect.width - 20]) {
          const point = { x: rect.x + dx, y: rect.y + rect.height / 2 };
          if (element.contains(document.elementFromPoint(point.x, point.y))) return point;
        }
        throw Error('Source has no physically reachable press point');
      });
      await page.evaluate(point => {
        let element = document.elementFromPoint(point.x, point.y);
        const ancestors = [];
        while (element) {
          const style = getComputedStyle(element);
          ancestors.push({ tag: element.tagName, className: String(element.className), touchAction: style.touchAction,
            overflow: style.overflow, scrollTop: element.scrollTop, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight });
          element = element.parentElement;
        }
        window.__radarQA.presses.push({ time: performance.now(), point, ancestors });
      }, lastPoint);
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...lastPoint, radiusX: 3, radiusY: 3, force: 1, id: 1 }] });
      else { await page.mouse.move(lastPoint.x, lastPoint.y); await page.mouse.down(); }
    },
    async move(point) {
      if (touch) {
        const steps = touchStep ? Math.max(1, Math.ceil(Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) / touchStep)) : 6;
        for (let step = 1; step <= steps; step++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
            x: lastPoint.x + (point.x - lastPoint.x) * step / steps, y: lastPoint.y + (point.y - lastPoint.y) * step / steps, radiusX: 3, radiusY: 3, force: 1, id: 1,
          }] });
          if (touchStep) await page.waitForTimeout(16);
        }
      }
      else await page.mouse.move(point.x, point.y, { steps: 8 });
      lastPoint = point;
    },
    async up() { if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up(); },
    async swipeUp(locator, distance) {
      await input.down(locator);
      await input.move({ x: lastPoint.x + 2, y: Math.max(70, lastPoint.y - distance) });
      await input.up();
    },
    async cancel() {
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      else {
        await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.__radarQA.pointers.findLast(event => event.type === 'pointerdown').pointerId })));
        await page.mouse.up();
      }
    },
    tap: locator => touch ? locator.tap() : locator.click(),
    close: () => cdp.detach(),
  };
  return { page, input, label: `${width}x${height}`, width, height };
}

async function gone(page, label) {
  await radar(page).waitFor({ state: 'detached' });
  await page.waitForFunction(() => !document.body.classList.contains('is-vault-dragging') && !document.querySelector('.vault-drag-ghost'));
  check((await call(page, '/src/lib/gestureArena.ts', 'gestureOwner')) === null, label + ' 雷达、跟随物与手势所有权均释放');
}
async function hold(page, input, title, label) {
  await input.down(source(page, title));
  const startedAt = performance.now();
  await page.waitForTimeout(180);
  check(await radar(page).count() === 0, label + ' 短按阶段不提前显示雷达');
  await radar(page).waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.vault-radar')).opacity === '1');
  await page.waitForTimeout(Math.max(0, 670 - (performance.now() - startedAt)));
  check(await radar(page).evaluate(element => element.parentElement === document.body), label + ' 长按内容才显示 body 级雷达');
  check(await manager(page).count() === 0, label + ' 长按收纳不误开管理弹层');
  check(await page.getByRole('menu').count() === 0, label + ' 长按收纳不叠加来源的菜单');
  check(await page.locator('.explorer-ctxmenu').count() === 0, label + ' 持续按住超过 650ms 不触发标签页背景菜单');
}
async function center(locator) {
  const rect = await locator.boundingBox();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
async function measure(page, label) {
  const result = await radar(page).evaluate(element => {
    const rect = element.getBoundingClientRect(), disc = element.querySelector('.vault-radar-disc').getBoundingClientRect();
    const caption = element.querySelector('.vault-radar-center').getBoundingClientRect();
    const oh = [...document.querySelectorAll('[data-oh-drop]')].map(el => el.getBoundingClientRect()).find(r => r.width > 0 && r.height > 0);
    return { bounds: rect.toJSON(), disc: disc.toJSON(), caption: caption.toJSON(), oh: oh?.toJSON(), portal: element.parentElement === document.body,
      fits: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
      captionFits: caption.left >= rect.left - 1 && caption.right <= rect.right + 1 && caption.top >= rect.top - 1 && caption.bottom <= rect.bottom + 1,
      discCaptionOverlap: Math.min(disc.right, caption.right) > Math.max(disc.left, caption.left) + 1 && Math.min(disc.bottom, caption.bottom) > Math.max(disc.top, caption.top) + 1,
      pointerEvents: getComputedStyle(element).pointerEvents,
      center: { x: disc.x + disc.width / 2, y: disc.y + disc.height / 2 } };
  });
  report.geometry.push({ label, ...result });
  check(result.fits && result.pointerEvents === 'none', label + ' 雷达完整在屏内，视觉层不截获底层指针');
  check(result.captionFits, label + ' 目标文字和当前内容在雷达边界内完整可见');
  check(!result.discCaptionOverlap, label + ' 扫描盘与文字不互相覆盖');
}
async function closeManager(page) {
  await page.keyboard.press('Escape'); await manager(page).waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.matches('.vault-box-button'));
}
async function setMotion(page, motion) {
  await page.evaluate(async motion => {
    const path = '/packages/gui/src/pipeline/director.ts';
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname.endsWith(path)) ?? path;
    (await import(url)).og.set({ motion });
  }, motion);
}
async function mainFlow({ page, input, label, width }) {
  await page.evaluate(() => { window.__radarQA.appearances = 0; });
  await input.tap(anchor(page)); await manager(page).waitFor();
  check(await radar(page).count() === 0 && await page.evaluate(() => window.__radarQA.appearances) === 0, label + ' 普通点击直接打开管理，全程无雷达闪现');
  const search = manager(page).getByRole('searchbox', { name: '查找箱内内容', exact: true });
  await search.fill('项目');
  await page.waitForFunction(() => document.querySelectorAll('.vault-manager .vault-item-in').length === 1);
  check(await manager(page).getByText('项目计划', { exact: true }).isVisible(), label + ' 点击直达的管理面板可真实筛选内容');
  await page.screenshot({ path: `${out}/screenshots/${label}-click-manager.png` });
  await closeManager(page);
  check(await radar(page).count() === 0, label + ' 关闭管理后不会回到旧雷达预览');
  const before = await countItems(page);
  await hold(page, input, '课程资料', label);
  await measure(page, label);
  await page.screenshot({ path: `${out}/screenshots/${label}-long-press.png` });
  await input.move(await center(radar(page).locator('.vault-radar-disc')));
  await page.waitForFunction(() => document.querySelector('.vault-radar')?.classList.contains('is-hover'));
  check(await radar(page).getByText('松手存入暂存箱', { exact: true }).isVisible(), label + ' 移入圆盘显示存入命中状态');
  await page.waitForTimeout(450); await input.up(); await gone(page, label + ' 存入后');
  await page.waitForFunction(n => JSON.parse(localStorage.getItem('onethu.vaults.v1')).boxes.reduce((sum, box) => sum + box.items.length, 0) === n + 1, before);
  check(await countItems(page) === before + 1, label + ' 松手只新增一个真实暂存项');
  await hold(page, input, ohTitle, label + ' OH');
  await input.move(await center(page.locator('[data-oh-drop]:visible').first()));
  await page.locator('.transfer-oh-hint.is-active').waitFor();
  check(await page.getByText('松手发给小OH', { exact: true }).isVisible(), label + ' 移到 OH 胶囊显示独立投递命中');
  await page.screenshot({ path: `${out}/screenshots/${label}-oh-hover.png` });
  await page.waitForTimeout(450); await input.up(); await gone(page, label + ' OH 松手后');
  await page.locator('.dock-panel').waitFor();
  const requests = await page.evaluate(() => window.__radarQA.oh);
  check(requests.length === 1 && requests[0].includes(ohTitle) && await countItems(page) === before + 1, label + ' OH 收到原内容且没有错误写入暂存箱');
  await page.locator('.dock-panel').getByRole('button', { name: '收起', exact: true }).click();
  await page.locator('.dock-panel').waitFor({ state: 'hidden' });
  if (width === 320) {
    const original = source(page, '研讨项目'), beforeScroll = await original.boundingBox();
    await input.swipeUp(source(page, '练习文件'), 150);
    await page.waitForTimeout(350);
    const afterScroll = await original.boundingBox();
    const oneShot = await page.locator('.oneshot').boundingBox();
    report.geometry.push({ label: '320 original source scroll', beforeScroll, afterScroll, oneShot });
    check(afterScroll.y + afterScroll.height < oneShot.y && afterScroll.y < beforeScroll.y - 20, '320 原第三行经真实向上滑动完整露出底栏上方');
    check(await radar(page).count() === 0, '320 普通竖向滚动不触发长按收纳');
    await hold(page, input, '研讨项目', label + ' scrolled original');
    await input.move(await center(page.locator('[data-oh-drop]:visible').first()));
    await page.locator('.transfer-oh-hint.is-active').waitFor();
    await page.screenshot({ path: `${out}/screenshots/${label}-scrolled-original-oh.png` });
    await input.up(); await gone(page, label + ' scrolled original');
    await page.locator('.dock-panel').waitFor();
    check(await page.evaluate(() => window.__radarQA.oh.length === 2 && window.__radarQA.oh[1].includes('研讨项目')), '320 同一个原底部条目滚入可见区域后可正常发给 OH');
    check(await countItems(page) === before + 1, '320 滚动后的 OH 传输不误存暂存箱');
    await page.locator('.dock-panel').getByRole('button', { name: '收起', exact: true }).click();
    await page.locator('.dock-panel').waitFor({ state: 'hidden' });
  }
}

async function interruptionFlow({ page, input, label, width, height }) {
  await anchor(page).focus(); await page.keyboard.press('Enter'); await manager(page).waitFor();
  check(await radar(page).count() === 0, label + ' 键盘 Enter 也直接打开管理');
  await closeManager(page);
  await input.down(anchor(page)); await page.waitForTimeout(420);
  const handle = await anchor(page).boundingBox();
  await input.move({ x: handle.x + handle.width / 2, y: Math.min(height - 110, handle.y + handle.height / 2 + 45) });
  await input.up();
  check(await radar(page).count() === 0 && await manager(page).count() === 0, label + ' 长按拖动入口只换位置，不打开雷达或管理');
  const before = await countItems(page);
  for (const way of ['release', 'cancel', 'blur', 'escape']) {
    await hold(page, input, '练习文件', label + ' ' + way);
    if (way === 'release') {
      const safe = await page.evaluate(() => {
        const targets = [...document.querySelectorAll('[data-vault-drop],[data-oh-drop]')].map(el => el.getBoundingClientRect());
        for (const p of [{ x: 4, y: 4 }, { x: 4, y: innerHeight - 4 }, { x: innerWidth - 4, y: innerHeight - 4 }])
          if (targets.every(r => !r.width || !r.height || p.x < r.left - 20 || p.x > r.right + 20 || p.y < r.top - 20 || p.y > r.bottom + 20)) return p;
        throw Error('No outside drop point available');
      });
      await input.move(safe); await input.up();
    } else if (way === 'cancel') await input.cancel();
    else if (way === 'blur') { await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await input.up(); }
    else { await page.keyboard.press('Escape'); await input.up(); }
    await gone(page, label + ' ' + way);
    check(await countItems(page) === before, label + ' ' + way + ' 取消不存入内容');
    check(await source(page, '练习文件').isVisible(), label + ' ' + way + ' 抬手不误触来源的打开动作');
  }
  for (const mode of ['system', 'application']) {
    if (mode === 'system') await page.emulateMedia({ reducedMotion: 'reduce' }); else await setMotion(page, 'reduced');
    await hold(page, input, '练习文件', label + ' ' + mode + ' reduced');
    const running = await radar(page).evaluate(el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && Number(animation.effect?.getComputedTiming().duration) > 50).map(animation => animation.constructor.name));
    check(running.length === 0, label + ' ' + mode + ' 减少动态下雷达无持续动画，投递提示仍可见');
    if (mode === 'system') await page.screenshot({ path: `${out}/screenshots/${label}-reduced.png` });
    await input.cancel(); await gone(page, label + ' ' + mode + ' reduced cancel');
    if (mode === 'system') await page.emulateMedia({ reducedMotion: 'no-preference' }); else await setMotion(page, 'full');
  }
  if (width === 390) {
    check(await call(page, '/src/state/theme.ts', 'activateTheme', ['onethu.theme.night']), '真实主题引擎切换深色');
    await hold(page, input, '练习文件', label + ' dark');
    await measure(page, label + ' dark');
    const colors = await radar(page).evaluate(el => ({ scheme: document.documentElement.dataset.ogScheme, panel: getComputedStyle(el).backgroundColor, text: getComputedStyle(el.querySelector('.vault-radar-center b')).color }));
    check(colors.scheme === 'dark' && colors.text !== colors.panel, '深色雷达继承主题，目标文字与背景区分');
    report.geometry.push({ label: label + ' dark colors', ...colors });
    await page.screenshot({ path: `${out}/screenshots/${label}-dark.png` });
    await input.cancel(); await gone(page, label + ' dark cancel');
    await call(page, '/src/state/theme.ts', 'deactivateTheme');
    await call(page, '/src/state/vault.ts', 'createVault', ['空箱验收']);
    await hold(page, input, '练习文件', label + ' empty');
    check(await radar(page).locator('.vault-radar-echo').count() === 0 && await radar(page).getByText('0 项已暂存', { exact: true }).isVisible(), '空箱显示零项，不制造虚假的雷达回波');
    await page.screenshot({ path: `${out}/screenshots/${label}-empty.png` });
    await input.cancel(); await gone(page, label + ' empty cancel');
  }
  report.input.push({ label, ...await page.evaluate(() => ({
    pointerEvents: window.__radarQA.pointers, touches: window.__radarQA.touches,
    presses: window.__radarQA.presses, contextMenus: window.__radarQA.contextMenus,
  })), note: width === 1280 ? 'Real mouse input; pointercancel and blur explicitly injected lifecycle events.' : 'Trusted CDP touch input and touchCancel; blur explicitly injected lifecycle event.' });
}
try {
  for (const [width, height] of sizes) {
    const context = await setup(width, height);
    if ([1280, 390].includes(width) && process.env.ONETHU_RADAR_SKIP_VIDEO !== '1') {
      const recording = await recordScreencast(context.page, out, `${context.label}-click-hold-transfer`, () => mainFlow(context));
      // The shared recorder crops the MP4; apply that identical viewport crop to its stills.
      for (const frame of recording.filmstrip) {
        const temporary = frame.path.replace(/\.jpg$/, '.cropped.jpg');
        execFileSync(process.env.FFMPEG_BIN ?? 'ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', frame.path, '-vf', `crop=${width}:${height}:0:0`, '-frames:v', '1', '-q:v', '2', temporary], { stdio: 'pipe' });
        renameSync(temporary, frame.path);
      }
      recording.filmstripCrop = { x: 0, y: 0, width, height };
      report.recordings.push(recording);
    } else await mainFlow(context);
    await interruptionFlow(context);
    await context.input.close();
    await context.page.unrouteAll({ behavior: 'ignoreErrors' }); await context.page.request.dispose(); await context.page.close();
  }
  check(report.errors.length === 0, '无浏览器页面异常');
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  if (currentPage && !currentPage.isClosed()) {
    report.failureState = await currentPage.evaluate(() => ({
      qa: window.__radarQA,
      dragging: document.body.classList.contains('is-vault-dragging'),
      targets: [...document.querySelectorAll('[data-vault-catch]:not([hidden]),[data-vault-drop],[data-oh-drop]')].map(el => ({ text: el.textContent?.slice(0, 100), rect: el.getBoundingClientRect().toJSON(), type: el.getAttribute('data-vault-catch') ?? (el.hasAttribute('data-oh-drop') ? 'oh' : 'vault') })),
    })).catch(() => null);
    await currentPage.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  }
  throw error;
} finally {
  try { await closeTestBrowser(browser); report.naturalCleanup = true; }
  catch (error) { report.passed = false; report.cleanupFailure = error.stack; throw error; }
  finally { writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); }
}
console.log(`${report.checks.length} vault radar assertions passed; browser cleanup complete`);
