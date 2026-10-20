/** Real default board widget → vault; capture-loss is an explicit API edge case. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';

const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = process.env.ONETHU_BOARD_VAULT_OUT ?? '/tmp/onethu-board-vault-final';
mkdirSync(out, { recursive: true });
const sourcePaths = [
  'apps/desktop/src/components/FreeBoard.tsx',
  'apps/desktop/src/components/vault/vaultDrag.ts',
  'apps/desktop/src/lib/gestureArena.ts',
];
const sourceHashes = () => Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const report = {
  scope: 'Chrome 1280×860, actual default home.clock component, isolated storage/fake cloud, trusted mouse input. releaseCapture additionally calls the real element.releasePointerCapture API: a deliberate protocol edge, not a spontaneous hardware event. No source elements or callbacks are fabricated.',
  sources: sourceHashes(), checks: [], cases: [], errors: [], passed: false, naturalCleanup: false,
};
const check = (value, message) => { assert.ok(value, message); report.checks.push(message); console.log('✓ ' + message); };
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--disable-updater-scheduler'],
});
let currentPage;

async function snapshot(page) {
  return page.evaluate(() => {
    const element = document.querySelector('[data-item-id="home.clock"]');
    const cat = JSON.parse(element.dataset.vaultCatch);
    const doc = JSON.parse(localStorage.getItem('onethu.board.v1') ?? '{"boards":[]}');
    const board = doc.boards.find(board => board.id === cat.board.boardId);
    const savedRects = Object.fromEntries(Object.entries(board?.cells ?? {}).map(([orientation, items]) => [
      orientation, items.find(item => item.id === 'home.clock')?.rect ?? null,
    ]));
    const boxes = JSON.parse(localStorage.getItem('onethu.vaults.v1') ?? '{"boxes":[]}').boxes;
    return {
      vault: window.__vaultModule.vaultDragSnapshot(), owner: window.__gestureModule.gestureOwner(),
      count: boxes.reduce((sum, box) => sum + box.items.length, 0), items: boxes.flatMap(box => box.items),
      clock: { rect: element.getBoundingClientRect().toJSON(), left: element.style.left, top: element.style.top, classes: element.className, cat, savedRects },
      halo: document.querySelector('.vault-accept-halo')?.outerHTML,
      anchor: document.querySelector('.vault-floating-anchor')?.className,
      events: window.__boardVaultEvents,
    };
  });
}

async function setup() {
  const page = currentPage = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:5180|localhost:5180)/, route => route.abort());
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('onethu.onboarded.phone', '1');
    localStorage.setItem('onethu.experience.v1', 'full');
    localStorage.setItem('onethu.chatdock.open', '0');
    window.__boardVaultEvents = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
      window.addEventListener(type, event => {
        const row = {
          type, time: performance.now(), trusted: event.isTrusted, id: event.pointerId,
          x: event.clientX, y: event.clientY, target: event.target?.getAttribute?.('data-item-id') ?? event.target?.tagName,
        };
        window.__boardVaultEvents.push(row);
        queueMicrotask(() => {
          row.owner = window.__gestureModule?.gestureOwner();
          row.vault = window.__vaultModule?.vaultDragSnapshot();
        });
      }, true);
    }
  });
  await installFakeCloud(page);
  await page.goto(base + '/?explorer-preview=onboarding');
  await page.locator('[data-item-id="home.clock"]').waitFor();
  await page.locator('.vault-floating-anchor.is-ready .vault-box-button').waitFor();
  await page.evaluate(async () => {
    const moduleUrl = path => performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname === path) ?? path;
    window.__vaultModule = await import(moduleUrl('/src/components/vault/vaultDrag.ts'));
    window.__gestureModule = await import(moduleUrl('/src/lib/gestureArena.ts'));
  });
  return page;
}

try {
  for (const kind of ['immediate', 'held', 'microMoveHeld', 'releaseCapture']) {
    const page = await setup(), item = page.locator('[data-item-id="home.clock"]');
    const from = await item.evaluate(element => {
      const rect = element.getBoundingClientRect();
      for (let y = rect.bottom - 24; y > rect.top + 12; y -= 16) {
        for (let x = rect.left + 24; x < rect.right - 24; x += 24) {
          const hit = document.elementFromPoint(x, y);
          if (hit?.closest('[data-item-id="home.clock"]') === element && !hit.closest('button,a,input,textarea,.free-toolbar,.free-handle')) return { x, y };
        }
      }
      throw Error('Actual clock has no reachable non-interactive body point');
    });
    const button = await page.locator('.vault-box-button').boundingBox();
    const to = { x: button.x + button.width / 2, y: button.y + button.height / 2 };
    const result = { kind, from, to, before: await snapshot(page) };
    report.cases.push(result);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    if (kind === 'microMoveHeld' || kind === 'releaseCapture') {
      await page.mouse.move(from.x + 6, from.y, { steps: 2 });
      await page.locator('[data-item-id="home.clock"].is-live').waitFor();
      result.preHandoff = await snapshot(page);
      check(result.preHandoff.clock.left !== result.before.clock.left, kind + ': 6px真实移动先建立白板live位移');
    }
    if (kind !== 'immediate') await page.waitForFunction(() => window.__vaultModule.vaultDragSnapshot().active);
    result.armed = await snapshot(page);
    await page.mouse.move(to.x, to.y, { steps: 30 });
    if (kind !== 'immediate') await page.locator('.vault-accept-halo.is-hover').waitFor();
    result.hover = await snapshot(page);
    await page.screenshot({ path: `${out}/${kind}-hover.png` });
    if (kind === 'releaseCapture') {
      result.capture = await item.evaluate(element => {
        const down = window.__boardVaultEvents.findLast(event => event.type === 'pointerdown');
        const had = element.hasPointerCapture(down.id);
        element.releasePointerCapture(down.id);
        return { had, id: down.id };
      });
      check(result.capture.had, 'releaseCapture: 实际组件确实持有待释放的pointer capture');
      await page.mouse.move(to.x + .1, to.y);
      await page.waitForFunction(() => window.__boardVaultEvents.some(event => event.type === 'lostpointercapture'));
      result.afterReleaseCapture = await snapshot(page);
      check(result.afterReleaseCapture.vault.active && result.afterReleaseCapture.vault.target === 'vault',
        'releaseCapture: 丢失capture后绿色命中仍等待真实pointerup投递');
    }
    await page.mouse.up();
    await page.waitForFunction(() => !window.__vaultModule.vaultDragSnapshot().active && !document.querySelector('.vault-drag-ghost'));
    result.after = await snapshot(page);
    if (kind === 'immediate') {
      check(result.after.count === result.before.count, 'immediate: 未长按的正常白板移动不误收纳');
      check(result.after.clock.left !== result.before.clock.left || result.after.clock.top !== result.before.clock.top,
        'immediate: 正常立即拖动仍改变组件位置');
      check(JSON.stringify(result.after.clock.savedRects) !== JSON.stringify(result.before.clock.savedRects), 'immediate: 白板位置变化实际落盘');
    } else {
      check(result.hover.vault.active && result.hover.vault.hover && result.hover.vault.target === 'vault', kind + ': 松手前是真实绿色投递命中');
      check(result.after.count === result.before.count + 1, kind + ': 松手实际新增一条暂存内容');
      check(result.after.items.some(value => value.type === 'board-item' && value.board?.itemId === 'home.clock' &&
        value.board?.boardId === result.before.clock.cat.board.boardId), kind + ': 存入真实白板组件引用');
      check(result.after.clock.left === result.before.clock.left && result.after.clock.top === result.before.clock.top,
        kind + ': 接管后原白板组件视觉位置不变');
      check(JSON.stringify(result.after.clock.savedRects) === JSON.stringify(result.before.clock.savedRects),
        kind + ': 接管后不提交旧live位置到白板存档');
    }
    check(result.after.owner === null, kind + ': 松手后手势所有权释放');
    await page.screenshot({ path: `${out}/${kind}-after.png` });
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.request.dispose(); await page.close();
  }
  check(JSON.stringify(sourceHashes()) === JSON.stringify(report.sources), '测试期间三个相关生产源码未变化');
  check(report.errors.length === 0, '无浏览器页面异常');
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  if (currentPage && !currentPage.isClosed()) {
    report.failureState = await snapshot(currentPage).catch(() => null);
    await currentPage.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  }
  throw error;
} finally {
  try { await closeTestBrowser(browser); report.naturalCleanup = true; }
  catch (error) { report.passed = false; report.cleanupFailure = error.stack; throw error; }
  finally { writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); }
}
console.log(`${report.checks.length} board-to-vault assertions passed; browser cleanup complete`);
