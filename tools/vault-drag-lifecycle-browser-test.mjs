/** Real browser gesture lifecycle. Source is a deliberately isolated protocol
 * fixture; blur/hidden/lost-capture and foreign pointer events are injected.
 * Mouse and multi-touch presses/releases use trusted Playwright/CDP input.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';

const checks = [], errors = [];
const check = (value, label) => { assert.ok(value, label); checks.push(label); console.log('✓ ' + label); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-updater-scheduler'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await installFakeCloud(page);
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('onethu.onboarded.phone', '1');
    localStorage.setItem('onethu.onboarded.v1', '1');
    localStorage.setItem('onethu.experience.v1', 'full');
  });
  await page.goto((process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180') + '/?explorer-preview=home', { waitUntil: 'domcontentloaded' });
  const anchor = page.locator('.vault-floating-anchor.is-ready .vault-box-button');
  await anchor.waitFor();
  await page.evaluate(async () => {
    const load = async path => import(performance.getEntriesByType('resource').map(r => r.name).find(url => new URL(url).pathname === path) ?? path);
    window.__vaultLifecycle = {
      drag: await load('/src/components/vault/vaultDrag.ts'),
      arena: await load('/src/lib/gestureArena.ts'),
      vault: await load('/src/state/vault.ts'), clicks: 0, pointerId: -1, trace: [],
    };
    const record = (type, event) => {
      const test = window.__vaultLifecycle;
      test.trace.push({ time:performance.now(), type, pointerId:event?.pointerId, pointerType:event?.pointerType,
        buttons:event?.buttons, x:event?.clientX, y:event?.clientY, trusted:event?.isTrusted,
        target:event?.target?.id || event?.target?.className, active:test.drag.vaultDragSnapshot().active, owner:test.arena.gestureOwner() });
      if (test.trace.length > 150) test.trace.shift();
    };
    for (const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','blur']) window.addEventListener(type, event => record(type, event), true);
    document.addEventListener('visibilitychange', event => record('visibility:' + document.visibilityState, event));
    window.__vaultLifecycle.drag.subscribeVaultDrag(() => record('drag-state'));
    window.__vaultLifecycle.arena.subscribeGesture(() => record('gesture-owner'));
    const source = document.createElement('button');
    source.id = 'vault-lifecycle-source';
    source.textContent = 'Gesture lifecycle fixture';
    source.dataset.vaultCatch = JSON.stringify({ type: 'text', title: 'Lifecycle fixture', text: 'Isolated drag source' });
    Object.assign(source.style, { position: 'fixed', left: '110px', top: '120px', width: '150px', height: '56px', zIndex: '2147483647', touchAction: 'none' });
    source.addEventListener('click', () => { window.__vaultLifecycle.clicks++; });
    source.addEventListener('pointerdown', event => { if (event.isPrimary) window.__vaultLifecycle.pointerId = event.pointerId; });
    document.body.append(source);
  });
  const source = page.locator('#vault-lifecycle-source');
  const center = async locator => { const rect = await locator.boundingBox(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; };
  const point = await center(source);
  const state = () => page.evaluate(() => {
    const test = window.__vaultLifecycle;
    return {
      ...test.drag.vaultDragSnapshot(), owner: test.arena.gestureOwner(),
      clicks: test.clicks, items: test.vault.activeVault().items.length,
      dragging: document.body.classList.contains('is-vault-dragging'),
      anchorHover: !!document.querySelector('.vault-floating-anchor.is-hover'),
      ghost: document.querySelector('.vault-drag-ghost')?.style.transform ?? '',
    };
  });
  const idle = async label => {
    const value = await state();
    check(!value.active && !value.hover && value.target === undefined && !value.dragging && value.owner === null && !value.anchorHover, label);
  };
  const mouseDown = async () => { await page.mouse.move(point.x, point.y); await page.mouse.down(); };
  const waitForPickup = async () => {
    try {
      // A 400ms browser timer can run after a Node-side 460ms sleep under load.
      // Wait for the actual state with a strict bound; never synthesize pickup.
      await page.waitForFunction(() => window.__vaultLifecycle.drag.vaultDragSnapshot().active, undefined, { timeout:2000 });
    } catch (error) {
      console.error('Hold failure diagnostic:', JSON.stringify(await page.evaluate(() => ({
        state:window.__vaultLifecycle.drag.vaultDragSnapshot(), trace:window.__vaultLifecycle.trace,
        source:document.getElementById('vault-lifecycle-source')?.outerHTML,
        hit:document.elementFromPoint(185,148)?.outerHTML.slice(0,500),
      }))));
      throw error;
    }
  };
  const holdMouse = async () => { await mouseDown(); await waitForPickup(); check((await state()).active, 'mouse long press acquires content gesture'); };
  const foreign = (type, pointerId = 999) => source.dispatchEvent(type, { pointerId, pointerType: 'touch', isPrimary: false, clientX: point.x, clientY: point.y, buttons: 1 });
  const hide = () => page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const show = () => page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const escapeMouse = async () => { await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(100); };
  const count = (await state()).items;

  await source.click();
  check((await state()).clicks === 1, 'normal source click remains usable');
  await mouseDown(); await page.waitForTimeout(80); await foreign('pointerup'); await waitForPickup();
  check((await state()).active, 'unrelated pointerup does not clear pending primary hold');
  await escapeMouse(); await idle('Escape releases owner and body lock');
  await mouseDown(); await page.waitForTimeout(80); await foreign('pointercancel'); await waitForPickup();
  check((await state()).active, 'unrelated pointercancel does not clear pending primary hold');
  await escapeMouse();

  for (const signal of ['blur', 'hidden']) {
    await mouseDown(); await page.waitForTimeout(80);
    if (signal === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur'))); else await hide();
    await page.waitForTimeout(440);
    await idle(signal + ' cancels a pending hold before its timer fires');
    await page.mouse.up(); if (signal === 'hidden') await show();
  }
  await page.evaluate(() => window.__vaultLifecycle.arena.claimGesture('lifecycle-other-owner'));
  const rejectedClicks = (await state()).clicks;
  await mouseDown(); await page.waitForTimeout(460); await page.mouse.up();
  check(!(await state()).active && (await state()).clicks === rejectedClicks + 1, 'rejected gesture ownership never installs click suppression');
  await page.evaluate(() => window.__vaultLifecycle.arena.releaseGesture('lifecycle-other-owner'));

  await holdMouse();
  const destination = await center(anchor);
  await page.mouse.move(destination.x, destination.y, { steps: 8 });
  check((await state()).target === 'vault', 'entering destination highlights the actual vault target');
  await page.keyboard.press('Escape');
  check(!(await state()).ghost.includes('0.18') && !(await state()).ghost.includes('(.18)'), 'cancel never plays a successful absorb animation');
  await page.mouse.up(); await page.waitForTimeout(100);
  await idle('cancel clears target as well as active flag');
  await holdMouse();
  check((await state()).target === undefined, 'next drag starts without previous target or highlight');
  await escapeMouse();

  const heldClicks = (await state()).clicks;
  await holdMouse();
  check((await state()).target === undefined, 'missed-release fixture stays outside the radar and OH drop bounds');
  await page.mouse.up(); await page.waitForTimeout(100);
  check((await state()).clicks === heldClicks, 'long-press release suppresses only its compatibility click');
  await source.click();
  check((await state()).clicks === heldClicks + 1, 'subsequent normal source click is not swallowed');

  await holdMouse();
  const escapeClicks = (await state()).clicks;
  await escapeMouse();
  check((await state()).clicks === escapeClicks, 'Escape followed by same-press release does not open source');
  await holdMouse();
  const lostClicks = (await state()).clicks;
  await source.dispatchEvent('lostpointercapture', { pointerId: await page.evaluate(() => window.__vaultLifecycle.pointerId), pointerType: 'mouse', isPrimary: true });
  check((await state()).active && (await state()).owner === 'vault-drag', 'lost capture leaves content drag active for window tracking');
  await escapeMouse();
  check(!(await state()).active && (await state()).clicks === lostClicks, 'explicit Escape cleans up after lost capture and protects the original press click');

  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ ...p, radiusX: 3, radiusY: 3, force: 1 })) });
  const first = { ...point, id: 1 }, second = { x: point.x + 45, y: point.y + 15, id: 2 };
  for (const signal of ['blur', 'hidden']) {
    await touch('touchStart', [first]); await waitForPickup();
    check((await state()).active, signal + ' test starts with trusted touch long press');
    if (signal === 'blur') {
      const context = await source.evaluate(el => {
        let bubbled = false;
        const listener = () => { bubbled = true; };
        window.addEventListener('contextmenu', listener);
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        el.dispatchEvent(event);
        window.removeEventListener('contextmenu', listener);
        return { prevented: event.defaultPrevented, bubbled };
      });
      check(context.prevented && !context.bubbled, 'touch source contextmenu suppresses native and competing JS menus');
    }
    const clicks = (await state()).clicks;
    if (signal === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur'))); else await hide();
    await idle(signal + ' releases active touch gesture');
    await touch('touchEnd'); if (signal === 'hidden') await show();
    await page.waitForTimeout(100);
    check((await state()).clicks === clicks, signal + ' same-press touchEnd does not activate the source');
    await source.tap();
    check((await state()).clicks === clicks + 1, signal + ' next legitimate tap works');
  }
  for (const wait of [80, 460]) {
    await touch('touchStart', [first]); if (wait === 80) await page.waitForTimeout(wait); else await waitForPickup();
    await touch('touchStart', [first, second]); await page.waitForTimeout(440);
    await idle('second trusted finger cancels ' + (wait === 80 ? 'pending' : 'active') + ' hold');
    await touch('touchEnd');
  }
  await touch('touchStart', [first]); await waitForPickup(); await touch('touchCancel');
  await idle('trusted touchCancel releases body lock and target');
  const afterCancelClicks = (await state()).clicks;
  await source.tap();
  check((await state()).clicks === afterCancelClicks + 1, 'pointercancel does not swallow next touch click');

  await touch('touchStart', [first]); await waitForPickup();
  const retarget = await source.evaluate(el => {
    // Explicit protocol fault injection: a manager can unmount this source
    // before the browser dispatches this press's compatibility events.
    const target = document.createElement('button');
    document.body.append(target); el.remove();
    let clicks = 0;
    target.addEventListener('click', () => { clicks++; });
    const context = new MouseEvent('contextmenu', { bubbles:true, cancelable:true });
    target.dispatchEvent(context);
    const keyboard = new MouseEvent('click', { bubbles:true, cancelable:true, detail:0 });
    target.dispatchEvent(keyboard);
    const foreign = new PointerEvent('click', { bubbles:true, cancelable:true, detail:1, pointerId:999 });
    target.dispatchEvent(foreign);
    const compatibility = new MouseEvent('click', { bubbles:true, cancelable:true, detail:1 });
    target.dispatchEvent(compatibility);
    target.remove(); document.body.append(el);
    return { context:context.defaultPrevented, keyboard:keyboard.defaultPrevented, foreign:foreign.defaultPrevented, compatibility:compatibility.defaultPrevented, clicks };
  });
  check(retarget.context, 'same touch contextmenu remains blocked after the source unmounts (injected retarget)');
  check(!retarget.keyboard && !retarget.foreign, 'global guard preserves keyboard and unrelated pointer clicks');
  check(retarget.compatibility && retarget.clicks === 2, 'same-press retargeted click cannot activate underlying UI (injected retarget)');
  await touch('touchCancel');
  const clicksAfterRetarget = (await state()).clicks;
  await source.tap();
  check((await state()).clicks === clicksAfterRetarget + 1, 'a new physical press clears global compatibility protection');

  const beforeAnchor = await page.evaluate(() => localStorage.getItem('onethu.vault-anchor.phone.v1'));
  const anchorPoint = await center(anchor);
  await touch('touchStart', [{ ...anchorPoint, id: 1 }]);
  await touch('touchMove', [{ x: 60, y: 390, id: 1 }]);
  check(await page.locator('.vault-floating-anchor').evaluate(el => el.classList.contains('is-moving')) && !(await state()).active, 'handle moves immediately without picking up content');
  await page.waitForTimeout(30);
  const movedAnchor = await center(anchor);
  await touch('touchCancel');
  await page.waitForTimeout(100);
  check(!await page.locator('.vault-floating-anchor').evaluate(el => el.classList.contains('is-moving')), 'pointercancel ends handle movement');
  const storedAnchor = await page.evaluate(() => localStorage.getItem('onethu.vault-anchor.phone.v1'));
  const endedAnchor = await center(anchor);
  check(storedAnchor !== beforeAnchor && Number.isFinite(JSON.parse(storedAnchor).xRatio) && Math.hypot(endedAnchor.x - movedAnchor.x, endedAnchor.y - movedAnchor.y) < 2, 'handle pointercancel keeps and saves the current position');
  await idle('finished handle drag has no content ownership');
  check(await page.locator('.vault-accept-halo,.vault-manager').count() === 0, 'handle pointercancel does not open acceptance halo or manager');
  await page.waitForTimeout(850);
  check(await page.locator('.vault-accept-halo,.vault-manager').count() === 0, 'finished pointercancel does not trigger a delayed manager open');
  await anchor.tap(); await page.locator('.vault-manager').waitFor();
  check(true, 'next legitimate handle tap still opens manager after cancellation');
  await page.locator('.vault-manager').getByRole('button', { name: '关闭', exact: true }).tap();
  await page.locator('.vault-manager').waitFor({ state: 'hidden' });
  const mouseAnchorPoint = await center(anchor);
  await page.mouse.move(mouseAnchorPoint.x, mouseAnchorPoint.y); await page.mouse.down(); await page.waitForTimeout(460);
  const stationaryAnchor = await center(anchor);
  check(!(await state()).active && await page.locator('.vault-accept-halo').count() === 0 && Math.hypot(stationaryAnchor.x - mouseAnchorPoint.x, stationaryAnchor.y - mouseAnchorPoint.y) < 1, 'stationary mouse press keeps its position without picking up content');
  await page.mouse.up(); await page.waitForTimeout(100);
  await page.locator('.vault-manager').waitFor();
  check(await page.locator('.vault-accept-halo').count() === 0, 'slow mouse click opens manager without showing an acceptance halo');
  check(await page.evaluate(() => localStorage.getItem('onethu.vault-anchor.phone.v1')) === storedAnchor, 'stationary mouse hold does not change saved position');
  await page.locator('.vault-manager').getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.vault-manager').waitFor({ state:'hidden' });
  await anchor.click(); await page.locator('.vault-manager').waitFor();
  check(true, 'ordinary mouse click still opens manager after stationary hold');
  await page.locator('.vault-manager').getByRole('button', { name: '关闭', exact: true }).tap();
  await page.locator('.vault-manager').waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    const scroll = document.createElement('div');
    scroll.id = 'vault-lifecycle-scroll';
    Object.assign(scroll.style, { position: 'fixed', left: '50px', top: '290px', width: '230px', height: '190px', overflow: 'auto', zIndex: '2147483647', touchAction: 'auto' });
    for (let index = 0; index < 10; index++) {
      const row = document.createElement('div');
      row.dataset.vaultCatch = JSON.stringify({ type: 'text', title: 'Scroll fixture ' + index, text: 'Scroll rather than hold' });
      row.textContent = 'Scrollable content ' + index;
      Object.assign(row.style, { height: '80px', background: 'white', color: 'black' });
      scroll.append(row);
    }
    document.body.append(scroll);
  });
  await touch('touchStart', [{ x: 160, y: 425, id: 1 }]);
  for (let step = 1; step <= 6; step++) await touch('touchMove', [{ x: 160, y: 425 - step * 15, id: 1 }]);
  await touch('touchEnd'); await page.waitForTimeout(150);
  check(await page.locator('#vault-lifecycle-scroll').evaluate(el => el.scrollTop) > 20, 'ordinary trusted swipe still scrolls touch-action:auto content');
  await idle('ordinary scrolling never becomes a content hold');
  await page.waitForTimeout(300);
  await touch('touchStart', [{ x: 140, y: 335, id: 1 }]); await waitForPickup();
  check((await state()).active, 'touch-action:auto content can be picked up after a stationary hold');
  const scrollBeforeDrag = await page.locator('#vault-lifecycle-scroll').evaluate(el => el.scrollTop);
  await touch('touchMove', [{ x: 165, y: 425, id: 1 }]); await page.waitForTimeout(80);
  check((await state()).active, 'large first move after holding stays in content drag');
  check(Math.abs(await page.locator('#vault-lifecycle-scroll').evaluate(el => el.scrollTop) - scrollBeforeDrag) < 2, 'armed content drag does not scroll its source container');
  await touch('touchCancel'); await idle('auto-scroll source releases cleanly after drag cancellation');
  await cdp.detach();
  check((await state()).items === count, 'cancelled and missed gestures never add vault content');
  check(errors.length === 0, 'no runtime page errors: ' + errors.join('; '));
  console.log(`\n${checks.length} vault drag lifecycle assertions passed`);
} finally {
  await closeTestBrowser(browser);
}
