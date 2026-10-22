/** Desktop regression: compare the two floating controls with identical input.
 * ONETHU_TEST_SIZES can opt into additional viewports; <600px uses CDP touch. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';

const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = process.env.ONETHU_FLOATING_OUT ?? '/tmp/onethu-floating-buttons';
const sizes = (process.env.ONETHU_TEST_SIZES ?? '1280x860').split(',').map(value => value.split('x').map(Number));
const controls = [
  { id: 'refresh', selector: '.hard-refresh-fab:not(.top-fab)' },
  { id: 'vault', selector: '.vault-floating-anchor.is-ready .vault-box-button' },
];
const report = {
  sizes, checks: [], cases: [], errors: [], passed: false, naturalCleanup: false,
  scope: 'Actual app DOM and native click/reload. CDP touch is trusted; desktop pointercancel is an explicitly injected protocol event followed by real mouse release. No production callbacks are replaced.',
};
mkdirSync(out, { recursive: true });
const check = (condition, message) => { assert.ok(condition, message); report.checks.push(message); console.log('✓ ' + message); };
const rect = locator => locator.evaluate(element => element.getBoundingClientRect().toJSON());
const center = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const loads = page => page.evaluate(() => Number(sessionStorage.getItem('qa.floating.loads') ?? 0));
const twoFrames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--disable-updater-scheduler'],
});
let currentPage;

async function ready(page) {
  await page.locator('.explorer-shell').waitFor();
  for (const control of controls) await page.locator(control.selector).waitFor();
  await twoFrames(page);
}

async function setup(width, height) {
  const touch = width < 600;
  const page = currentPage = await browser.newPage({ viewport: { width, height }, hasTouch: touch });
  page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(45000);
  page.on('pageerror', error => report.errors.push(`${width}: ${error.message}`));
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:5180|localhost:5180)/, route => route.abort());
  await page.addInitScript(() => {
    sessionStorage.setItem('qa.floating.loads', String(Number(sessionStorage.getItem('qa.floating.loads') ?? 0) + 1));
    localStorage.setItem('onethu.onboarded.phone', '1');
    localStorage.setItem('onethu.onboarded.flow4', '1');
    localStorage.setItem('onethu.privacy.v1',JSON.stringify({acknowledged:true,cloud:true,oh:true}));
    localStorage.setItem('onethu.experience.v1', 'full');
    localStorage.setItem('onethu.chatdock.open', '0');
    window.__floatingTrace = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click']) {
      window.addEventListener(type, event => {
        const target = event.target instanceof Element ? event.target : null;
        const entry = {
          type, time: performance.now(), trusted: event.isTrusted, pointerId: event.pointerId,
          pointerType: event.pointerType, detail: event.detail, x: event.clientX, y: event.clientY,
          target: target?.closest('button')?.getAttribute('aria-label') ?? target?.tagName, prevented: false,
        };
        window.__floatingTrace.push(entry);
        queueMicrotask(() => { entry.prevented = event.defaultPrevented; });
      }, true);
    }
  });
  await installFakeCloud(page);
  await page.goto(base + '/?explorer-preview=onboarding');
  await ready(page);
  const cdp = await page.context().newCDPSession(page);
  let point, pressed;
  const input = {
    async down(locator) {
      const box = await rect(locator); point = center(box); pressed = locator;
      check(await locator.evaluate((element, at) => element.contains(document.elementFromPoint(at.x, at.y)), point),
        `${width} ${await locator.getAttribute('aria-label')} 实际按下点可命中按钮`);
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, radiusX: 3, radiusY: 3, force: 1, id: 1 }] });
      else { await page.mouse.move(point.x, point.y); await page.mouse.down(); }
      return { ...point };
    },
    async move(target) {
      const from = point, steps = Math.max(1, Math.ceil(distance(from, target) / 6));
      for (let index = 1; index <= steps; index++) {
        const next = { x: from.x + (target.x - from.x) * index / steps, y: from.y + (target.y - from.y) * index / steps };
        if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...next, radiusX: 3, radiusY: 3, force: 1, id: 1 }] });
        else await page.mouse.move(next.x, next.y);
        await page.waitForTimeout(16);
      }
      point = target;
      await page.waitForFunction(({ x, y }) => {
        const move = window.__floatingTrace.findLast(event => event.type === 'pointermove');
        return move && Math.abs(move.x - x) < 1 && Math.abs(move.y - y) < 1;
      }, target);
      await twoFrames(page);
    },
    async up() {
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await page.mouse.up();
    },
    async cancel() {
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      else {
        await pressed.evaluate(element => {
          const down = window.__floatingTrace.findLast(event => event.type === 'pointerdown');
          element.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: down.pointerId, pointerType: 'mouse', button: 0 }));
        });
        await page.mouse.up();
      }
    },
    tap: locator => touch ? locator.tap() : locator.click(),
    close: () => cdp.detach(),
  };
  return { page, input, width, height, touch };
}

async function activation(ctx, control, action, label) {
  const { page } = ctx, before = await loads(page);
  const record = { label, beforeLoads: before, before: await rect(page.locator(control.selector)) };
  await action();
  if (control.id === 'refresh') {
    await page.waitForFunction(previous => Number(sessionStorage.getItem('qa.floating.loads')) > previous, before);
    await ready(page);
    check(await loads(page) === before + 1, label + ' 真实整页刷新一次');
  } else {
    await page.locator('.vault-manager').waitFor();
    check(await page.locator('.vault-manager').count() === 1, label + ' 真实打开一个管理弹层');
    check(await loads(page) === before && await page.locator('.vault-accept-halo').count() === 0, label + ' 无刷新或接受圆环闪现');
    await page.keyboard.press('Escape');
    await page.locator('.vault-manager').waitFor({ state: 'hidden' });
  }
  record.afterLoads = await loads(page); record.after = await rect(page.locator(control.selector));
  return record;
}

async function assertNoActivation(ctx, beforeLoads, label) {
  await twoFrames(ctx.page);
  check(await loads(ctx.page) === beforeLoads && await ctx.page.locator('.vault-manager').count() === 0, label + ' 不误触点击行为');
}

async function runControl(ctx, control) {
  const { page, input, width, height } = ctx;
  const label = `${width}x${height} ${control.id}`;
  const button = () => page.locator(control.selector);
  const evidence = { label, activations: [], drags: [], input: [] };
  report.cases.push(evidence);
  evidence.activations.push(await activation(ctx, control, () => input.tap(button()), label + ' 普通点击'));
  evidence.activations.push(await activation(ctx, control, async () => {
    const at = await input.down(button());
    await input.move({ x: at.x - 2, y: at.y });
    await input.up();
  }, label + ' 2px 小抖动'));
  evidence.activations.push(await activation(ctx, control, async () => {
    await input.down(button()); await page.waitForTimeout(460); await input.up();
  }, label + ' 慢按松手'));

  const beforeLoads = await loads(page), start = await rect(button());
  const pressedAt = await input.down(button());
  const first = { x: pressedAt.x - 20, y: pressedAt.y - 15 };
  await input.move(first);
  const immediate = await rect(button());
  check(distance(center(immediate), first) < 2, label + ' 越过点击容差后立即跟手');
  const target = { x: Math.round(width * (control.id === 'refresh' ? .36 : .66)), y: Math.round(height * .44) };
  await input.move(target); const beforeUp = await rect(button()); await input.up();
  const stable = await button().evaluate(element => new Promise(resolve => {
    const samples = [];
    const sample = () => {
      samples.push({ time: performance.now(), rect: element.getBoundingClientRect().toJSON() });
      if (samples.length === 30) resolve(samples); else requestAnimationFrame(sample);
    }; requestAnimationFrame(sample);
  }));
  const settled = stable.at(-1).rect;
  check(distance(center(settled), target) < 2, label + ' 放手停在实际目标位置');
  check(stable.every(sample => distance(center(sample.rect), center(beforeUp)) < 1), label + ' 放手后30帧不跳边或漂移');
  await assertNoActivation(ctx, beforeLoads, label + ' 拖动释放');
  evidence.drags.push({ start, first, immediate, target, beforeUp, stable });
  evidence.input.push(...await page.evaluate(() => window.__floatingTrace));
  evidence.activations.push(await activation(ctx, control, () => input.tap(button()), label + ' 拖后下一次点击'));
  const beforeReload = await rect(button());
  await page.reload(); await ready(page);
  const restored = await rect(button());
  check(distance(center(beforeReload), center(restored)) < 2, label + ' 刷新后保持拖动落点');
  evidence.persistence = {
    beforeReload, restored, storage: await page.evaluate(() => ({
      refresh: localStorage.getItem('onethu.ui.refreshFab.v1'),
      desktop: localStorage.getItem('onethu.vault-anchor.desktop.v1'),
      phone: localStorage.getItem('onethu.vault-anchor.phone.v1'),
    })),
  };

  const cancelLoads = await loads(page), cancelStart = await input.down(button());
  await input.move({ x: cancelStart.x - 30, y: cancelStart.y + 20 });
  const beforeCancel = await rect(button()); await input.cancel();
  await assertNoActivation(ctx, cancelLoads, label + ' 取消拖动');
  const afterCancel = await rect(button());
  check(distance(center(beforeCancel), center(afterCancel)) < 2, label + ' pointercancel 按刷新按钮原行为结束在当前位置');
  evidence.activations.push(await activation(ctx, control, () => input.tap(button()), label + ' 取消后下一次点击'));
  await page.reload(); await ready(page);
  const cancelRestored = await rect(button());
  check(distance(center(beforeCancel), center(cancelRestored)) < 2, label + ' pointercancel 后刷新保持当前位置');
  evidence.cancel = { beforeCancel, afterCancel, restored: cancelRestored };
  evidence.activations.push(await activation(ctx, control, async () => {
    await button().focus(); await page.keyboard.press('Enter');
  }, label + ' 键盘Enter'));
  evidence.input.push(...await page.evaluate(() => window.__floatingTrace));
  await page.screenshot({ path: `${out}/${width}-${control.id}.png` });
}

try {
  for (const [width, height] of sizes) {
    const ctx = await setup(width, height);
    for (const control of controls) await runControl(ctx, control);
    await ctx.input.close(); await ctx.page.unrouteAll({ behavior: 'ignoreErrors' });
    await ctx.page.request.dispose(); await ctx.page.close();
  }
  check(report.errors.length === 0, '无浏览器页面异常'); report.passed = true;
} catch (error) {
  report.failure = error.stack;
  if (currentPage && !currentPage.isClosed()) {
    report.failureTrace = await currentPage.evaluate(() => window.__floatingTrace).catch(() => null);
    await currentPage.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  }
  throw error;
} finally {
  try { await closeTestBrowser(browser); report.naturalCleanup = true; }
  catch (error) { report.passed = false; report.cleanupFailure = error.stack; throw error; }
  finally { writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); }
}
console.log(`${report.checks.length} floating button assertions passed; browser cleanup complete`);
