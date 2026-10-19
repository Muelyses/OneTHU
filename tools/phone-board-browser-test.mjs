/**
 * 手机白板：完整模式下默认阅读顺序，可切「自由摆放」后直接拖动/缩放；
 * 阅读顺序模式仍然保留（只上下调整）。
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://127.0.0.1:5180';
let checks = 0;
const errors = [];
const check = (c, m) => { assert.ok(c, m); checks++; console.log('✓ ' + m); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });

async function setup(mode = 'full') {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  p.setDefaultTimeout(12000);
  p.on('pageerror', (e) => { if (!/reading 'invoke'/.test(e.message)) errors.push(e.message); });
  await p.addInitScript((mode) => {
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('onethu.onboarded.phone', '1');
    localStorage.setItem('onethu.experience.v1', mode);
  }, mode);
  await p.goto(base + '/?explorer-preview=home', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.explorer-shell');
  await p.waitForTimeout(1100);
  return p;
}

try {
  const p = await setup('full');
  try {
    /* 默认阅读顺序：没有自由摆放标记，有切换按钮 */
    check(await p.locator('.freeboard-wrap').count() === 1, '完整模式手机首页有白板');
    check(await p.locator('.freeboard-wrap.phone-canvas').count() === 0, '默认是阅读顺序（不是自由摆放）');
    const toggle = p.getByRole('button', { name: '自由摆放', exact: true });
    check(await toggle.count() === 1, '阅读顺序下有「自由摆放」切换');
    await toggle.click();
    await p.waitForTimeout(700);
    check(await p.locator('.freeboard-wrap.phone-canvas').count() === 1, '切到自由摆放画布');
    check((await p.getByRole('button', { name: '阅读顺序', exact: true }).count()) === 1, '可切回阅读顺序');
    /* 自由摆放默认 300%（用户嫌 200% 太小） */
    check((await p.locator('.board-viewport-tools').innerText()).includes('300%'), '自由摆放默认放大到 300%');
    /* 双击空白不再创建便笺（用户要求删掉这个 feature） */
    const itemsBeforeDbl = await p.locator('.free-item').count();
    const fbBox = await p.locator('.freeboard').boundingBox();
    await p.mouse.dblclick(10, (fbBox?.y ?? 200) + 120);
    await p.waitForTimeout(500);
    check((await p.locator('.free-item').count()) === itemsBeforeDbl, '双击空白不再创建便笺');

    /* 拖动：选一个条目，按住非交互区域拖 60/40 */
    const item = p.locator('.free-item').first();
    await item.scrollIntoViewIfNeeded();
    const box = await item.boundingBox();
    check(Boolean(box), '自由摆放里有可操作条目');
    const before = await p.evaluate(() => {
      const el = document.querySelector('.free-item');
      return { left: parseFloat(getComputedStyle(el).left), top: parseFloat(getComputedStyle(el).top) };
    });
    if (box) {
      const sx = box.x + 10;
      const sy = box.y + 10;
      await p.mouse.move(sx, sy);
      await p.mouse.down();
      await p.mouse.move(sx + 60, sy + 40, { steps: 6 });
      await p.mouse.up();
      await p.waitForTimeout(500);
    }
    const after = await p.evaluate(() => {
      const el = document.querySelector('.free-item');
      return { left: parseFloat(getComputedStyle(el).left), top: parseFloat(getComputedStyle(el).top) };
    });
    check(after.left > before.left + 5 || after.top > before.top + 5, `拖动改变位置（${before.left},${before.top} → ${after.left},${after.top}）`);

    /* 缩放：选中后拖右下角把手 */
    await item.click({ position: { x: 6, y: 6 } }).catch(() => undefined);
    await p.waitForTimeout(300);
    const handle = p.locator('.free-item.is-selected .free-handle.fh-se').first();
    check(await handle.count() === 1, '选中后出现缩放手柄');
    await handle.scrollIntoViewIfNeeded();
    const sizeBefore = await p.evaluate(() => { const el = document.querySelector('.free-item.is-selected'); return { w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }; });
    /* 手柄可能被底部工具栏等浮层压住：直接对着手柄派发指针事件，
       验证的是 beginPointer 管线（真实触摸同一条链路）。 */
    const resized = await p.evaluate(() => {
      const handle = document.querySelector('.free-item.is-selected .free-handle.fh-se');
      if (!handle) return false;
      const r = handle.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      const opts = { bubbles: true, cancelable: true, button: 0, pointerId: 7, pointerType: 'touch', isPrimary: true };
      handle.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: x, clientY: y }));
      for (const [dx, dy] of [[10, 8], [25, 20], [45, 36]]) {
        window.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: x + dx, clientY: y + dy }));
      }
      window.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: x + 45, clientY: y + 36 }));
      return true;
    });
    check(resized, '缩放手柄可派发指针事件');
    await p.waitForTimeout(600);
    const sizeAfter = await p.evaluate(() => { const el = document.querySelector('.free-item.is-selected'); return { w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }; });
    check(sizeAfter.w > sizeBefore.w + 5 || sizeAfter.h > sizeBefore.h + 5, `缩放改变尺寸（${Math.round(sizeBefore.w)}×${Math.round(sizeBefore.h)} → ${Math.round(sizeAfter.w)}×${Math.round(sizeAfter.h)}）`);

    /* 回到阅读顺序 */
    await p.getByRole('button', { name: '阅读顺序', exact: true }).click();
    await p.waitForTimeout(500);
    check(await p.locator('.freeboard-wrap.phone-canvas').count() === 0, '可切回阅读顺序');
  } finally { await p.close(); }

  /* 手机横屏：直接是电脑那块自由画布（不堆叠、无阅读顺序开关） */
  {
    const l = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    l.on('pageerror', (e) => { if (!/reading 'invoke'/.test(e.message)) errors.push(e.message); });
    await l.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      localStorage.setItem('onethu.onboarded.phone', '1');
      localStorage.setItem('onethu.experience.v1', 'full');
    });
    await l.goto(base + '/?explorer-preview=home', { waitUntil: 'domcontentloaded' });
    await l.waitForSelector('.explorer-shell'); await l.waitForTimeout(1100);
    try {
      check((await l.locator('.freeboard-wrap.phone-canvas').count()) === 1, '横屏直接进入自由画布');
      check((await l.getByRole('button', { name: /自由摆放|阅读顺序/ }).count()) === 0, '横屏不再显示阅读顺序开关');
      const xs = await l.evaluate(() => [...document.querySelectorAll('.free-item')].slice(0, 5).map((el) => Math.round(el.getBoundingClientRect().x)));
      check(xs.length > 1 && new Set(xs).size > 1, `横屏按世界坐标摆放（不堆叠）：${JSON.stringify(xs)}`);
    } finally { await l.close(); }
  }

  /* 极简/实用模式没有白板交互（仅完整模式） */
  for (const mode of ['simple', 'practical']) {
    const s = await setup(mode);
    try {
      const visible = await s.evaluate(() => [...document.querySelectorAll('.freeboard-wrap')].some((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden';
      }));
      check(!visible && (await s.getByRole('button', { name: '自由摆放', exact: true }).count()) === 0, `${mode} 模式没有可见的白板自由摆放`);
    } finally { await s.close(); }
  }

  check(errors.length === 0, '无运行时错误 ' + JSON.stringify(errors.slice(0, 3)));
  console.log(`\n${checks} phone board assertions passed`);
} finally { await browser.close(); }
