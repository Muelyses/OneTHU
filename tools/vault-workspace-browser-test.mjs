/** Shared vault page/manager + edge entry, against fake cloud and browser events only. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';

const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = process.env.ONETHU_TEST_OUT ?? process.env.ONETHU_VAULT_OUT ?? 'docs/onegui/vault-refinement-2026-10-20';
mkdirSync(out, { recursive: true });
const checks = [], errors = [], geometry = [];
const fullText = '微积分课程大纲与教材。'.repeat(30) + '正文结尾验收';
const sizes = (process.env.ONETHU_TEST_SIZES ?? '1280x860,390x844,320x568,844x390').split(',').map(size => size.split('x').map(Number));
const check = (condition, message) => { assert.ok(condition, message); checks.push(message); console.log('✓ ' + message); };
const call = (page, path, method, args = []) => page.evaluate(async ({ path, method, args }) => {
  const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname === path) ?? path;
  return (await import(url))[method](...args);
}, { path, method, args });
const vaultCall = (page, method, args = []) => call(page, '/src/state/vault.ts', method, args);
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-updater-scheduler'] });
let passed = false;
try {
  for (const [width, height] of sizes) {
    const prefix = `${width}×${height}`;
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 600 });
    page.setDefaultTimeout(10000);
    await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
    page.on('pageerror', error => errors.push(prefix + ': ' + error.message));
    await installFakeCloud(page);
    await page.route('**/src/state/vaultRegistry.ts*', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace(/import \{ invoke \} from [^;]+;/, 'const invoke = window.__cloudInvoke;');
      await route.fulfill({ response, body });
    });
    await page.addInitScript(() => { performance.setResourceTimingBufferSize(10000); localStorage.setItem('onethu.onboarded.phone', '1'); localStorage.setItem('onethu.chatdock.open', '0'); });
    await page.goto(base + '/?explorer-preview=home', { waitUntil: 'domcontentloaded' });
    await page.locator('.explorer-shell').waitFor();
    const initial = await vaultCall(page, 'activeVault');
    await vaultCall(page, 'renameVault', [initial.id, '课程资料']);
    for (const [title, text] of [['课程大纲', fullText], ['作业清单', '周五完成第二次作业'], ['研讨预约', '周四下午研讨间预约信息']]) {
      await vaultCall(page, 'addToVault', [{ type: 'text', title, text }]);
    }
    const anchor = page.locator('.vault-floating-anchor.is-ready .vault-box-button');
    await anchor.waitFor();
    await anchor.click({ trial: true });
    await page.evaluate(() => { window.__pointerTrace = []; for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) document.addEventListener(type, event => window.__pointerTrace.push({ type, target: event.target?.className, x: event.clientX, y: event.clientY, pointerType: event.pointerType, isPrimary: event.isPrimary, trusted: event.isTrusted }), true); });
    const entry = await anchor.boundingBox();
    check(entry && entry.x >= 0 && entry.y >= 0 && entry.x + entry.width <= width && entry.y + entry.height <= height, prefix + ' 贴边入口完整在视口内');
    const phone = await page.evaluate(() => document.documentElement.classList.contains('is-phone'));
    const positionKey = `onethu.vault-anchor.${phone ? 'phone' : 'desktop'}.v1`;
    const start = { x: entry.x + entry.width / 2, y: entry.y + entry.height / 2 };
    const target = { x: 16 + entry.width / 2, y: Math.round(height * 0.6) };
    const cdp = await page.context().newCDPSession(page);
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 3, radiusY: 3, force: 1, id: 1 }] });
    if (phone) {
      await touch('touchStart', start.x, start.y); await page.waitForTimeout(360);
      for (let step = 1; step <= 8; step++) await touch('touchMove', start.x + (target.x - start.x) * step / 8, start.y + (target.y - start.y) * step / 8);
      await touch('touchEnd');
    } else {
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(target.x, target.y, { steps: 10 }); await page.mouse.up();
    }
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.side === 'left', positionKey);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), positionKey);
    check(saved.ratio >= 0 && saved.ratio <= 1, prefix + ' 拖动入口贴到另一侧并保存归一化高度');
    check(await page.locator('.vault-manager, .vault-radar').count() === 0, prefix + ' 移动入口不会误开预览或管理面板');
    await page.reload({ waitUntil: 'domcontentloaded' }); await anchor.waitFor();
    await page.waitForFunction(() => document.querySelector('.vault-floating-anchor')?.classList.contains('is-left'));
    const restored = await anchor.boundingBox();
    check(restored.x < width / 2 && Math.abs(restored.y + restored.height / 2 - target.y) < 45, prefix + ' 刷新后保留入口边缘与高度');
    if (phone) {
      const center = { x: restored.x + restored.width / 2, y: restored.y + restored.height / 2 };
      await touch('touchStart', center.x, center.y);
      await touch('touchMove', center.x + 60, center.y + 2); await touch('touchEnd');
      await page.locator('.vault-manager').waitFor();
      check(true, prefix + ' 入口向内短滑直接打开完整管理面板');
      await page.locator('.vault-manager').getByRole('button', { name: '关闭', exact: true }).click();
      await page.locator('.vault-manager').waitFor({ state: 'hidden' });
      await touch('touchStart', 2, Math.round(height * 0.3));
      await touch('touchMove', 66, Math.round(height * 0.3)); await touch('touchEnd');
      check(await page.locator('.vault-manager').count() === 0, prefix + ' 普通页面边缘滑动不会触发暂存箱');
    }
    await cdp.detach();
    await anchor.click();
    const manager = page.locator('.vault-manager');
    await manager.waitFor();
    check(await page.locator('.vault-radar').count() === 0, prefix + ' 普通点击直接管理，未出现传输雷达');
    check(await manager.evaluate(el => el.closest('.og-scrim')?.parentElement === document.body), prefix + ' 管理面板挂在body，避开导航裁切');
    check(await manager.locator('.vault-item-in').count() === 3, prefix + ' 直接管理显示全部三个条目');
    for (const name of ['课程大纲', '作业清单', '研讨预约']) check(await manager.getByText(name, { exact: true }).isVisible(), prefix + ' 条目标题可读：' + name);
    const close = manager.getByRole('button', { name: '关闭', exact: true });
    const closeHit = await close.evaluate(el => { const r = el.getBoundingClientRect(); return r.y >= 0 && r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
    check(closeHit, prefix + ' 关闭按钮未被 OneShot 或导航遮住');
    geometry.push({ width, height, anchor: entry, manager: await manager.boundingBox(), close: await close.boundingBox() });
    await page.screenshot({ path: `${out}/entry-manager-${width}x${height}.png`, animations: 'disabled' });
    await close.click();
    await manager.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.matches('.vault-box-button'));
    check(true, prefix + ' 关闭管理后焦点回到入口');
    await anchor.click(); await manager.waitFor(); await page.keyboard.press('Escape'); await manager.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.matches('.vault-box-button'));
    check(true, prefix + ' Escape 退出管理并归还焦点');
    await anchor.click();
    await manager.waitFor();
    await page.waitForFunction(() => document.querySelector('.vault-manager')?.contains(document.activeElement));
    check(true, prefix + ' 真实点击入口直接打开管理面板并接管焦点');
    check(await manager.locator('.vault-workspace').count() === 1, prefix + ' 管理面板使用共享内容管理组件');
    const receiveTrigger = manager.getByRole('button', { name: '接收', exact: true });
    await receiveTrigger.click();
    const receive = page.getByRole('dialog', { name: '接收内容', exact: true });
    await receive.waitFor();
    await receive.getByLabel('收到的口令', { exact: true }).focus();
    await page.keyboard.press('Tab');
    check(await receive.getByRole('button', { name: '粘贴剪贴板', exact: true }).evaluate(el => el === document.activeElement), prefix + ' 子接收弹层 Tab 从输入框前进到粘贴按钮');
    await page.keyboard.press('Shift+Tab');
    check(await receive.getByLabel('收到的口令', { exact: true }).evaluate(el => el === document.activeElement), prefix + ' 子弹层 Shift+Tab 可回到输入框');
    await page.keyboard.press('Escape'); await receive.waitFor({ state: 'hidden' });
    check(await manager.isVisible(), prefix + ' Escape 只关闭接收子弹层，保留管理面板');
    const firstRow = manager.locator('.og-row').filter({ hasText: '课程大纲' }).first();
    await firstRow.focus(); await page.keyboard.press('Enter');
    const textPreview = page.locator('.vault-text-preview');
    await textPreview.waitFor();
    check(await textPreview.locator('.vault-text-body').innerText() === fullText, prefix + ' 键盘 Enter 打开完整文字，包含90字以后的末尾');
    await page.keyboard.press('Escape'); await textPreview.waitFor({ state: 'hidden' });
    check(await manager.isVisible(), prefix + ' Escape 只关闭文字预览，保留管理面板');
    const panelBounds = await manager.boundingBox();
    check(panelBounds && panelBounds.x >= -1 && panelBounds.y >= -1 && panelBounds.x + panelBounds.width <= width + 1 && panelBounds.y + panelBounds.height <= height + 1, prefix + ' 管理面板未超出屏幕');
    await manager.getByRole('button', { name: '新建暂存箱', exact: true }).click();
    const form = page.locator('.plg-form-modal');
    await form.waitFor();
    await form.locator('input').fill('临时收纳');
    await form.getByRole('button', { name: '提交', exact: true }).click();
    await form.waitFor({ state: 'hidden' });
    const newBox = await vaultCall(page, 'activeVault');
    if (phone) await page.waitForFunction(id => document.querySelector('.vault-manager select[aria-label="切换暂存箱"]')?.value === id, newBox.id);
    else await manager.getByRole('heading', { name: '临时收纳', exact: true }).waitFor();
    check(newBox.id !== initial.id && newBox.items.length === 0, prefix + ' 新建箱子成为当前箱，原箱保留');
    const select = manager.getByRole('combobox', { name: '切换暂存箱', exact: true });
    if (await select.isVisible()) await select.selectOption(initial.id);
    else await manager.locator('.vault-collections').getByRole('button', { name: /课程资料/ }).click();
    if (phone) await page.waitForFunction(id => document.querySelector('.vault-manager select[aria-label="切换暂存箱"]')?.value === id, initial.id);
    else await manager.getByRole('heading', { name: '课程资料', exact: true }).waitFor();
    check(await manager.locator('.vault-item-in').count() === 3, prefix + ' 切回原箱恢复全部内容');
    const search = manager.getByRole('searchbox', { name: '查找箱内内容', exact: true });
    await search.fill('作业');
    await page.waitForFunction(() => document.querySelectorAll('.vault-manager .vault-item-in').length === 1);
    check(await manager.getByText('作业清单', { exact: true }).isVisible(), prefix + ' 搜索筛选当前箱内容');
    await search.fill('不存在的关键词');
    await manager.getByRole('heading', { name: '没有找到相关内容', exact: true }).waitFor();
    await manager.getByRole('button', { name: '清除搜索', exact: true }).click();
    check(await search.inputValue() === '' && await manager.locator('.vault-item-in').count() === 3, prefix + ' 空搜索结果可一键恢复');
    const itemMore = manager.getByRole('button', { name: '更多操作：作业清单', exact: true });
    await itemMore.click();
    const itemMenu = page.getByRole('menu', { name: '暂存项操作菜单', exact: true });
    await itemMenu.waitFor();
    await page.screenshot({ path: `${out}/item-menu-${width}x${height}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape'); await itemMenu.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '更多操作：作业清单');
    check(true, prefix + ' 操作菜单关闭后焦点回到对应条目');
    await itemMore.click(); await itemMenu.getByRole('menuitem', { name: '移除', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.vault-manager .vault-item-in').length === 2);
    check(!(await vaultCall(page, 'activeVault')).items.some(item => item.title === '作业清单'), prefix + ' 更多菜单只移除选中的条目');

    // The real workspace and global drag listeners both receive this bubbling drop.
    // Count the file hash itself: item deduplication alone would hide double staging.
    const fileText = `single workspace drop ${width} ${height}`;
    await page.evaluate(async fileText => {
      window.__vaultHashCount = 0;
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest = (algorithm, bytes) => {
        if (new TextDecoder().decode(bytes) === fileText) window.__vaultHashCount++;
        return digest(algorithm, bytes);
      };
      const target = document.querySelector('.vault-manager .vault-contents');
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([fileText], 'workspace-drop.txt', { type: 'text/plain' }));
      for (const type of ['dragenter', 'dragover']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
      await new Promise(resolve => setTimeout(resolve, 100));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    }, fileText);
    await manager.getByText('workspace-drop.txt', { exact: true }).waitFor();
    await page.waitForTimeout(200);
    check(await page.evaluate(() => window.__vaultHashCount) === 1, prefix + ' 单次文件 drop 仅暂存及计算指纹一次');
    const afterDrop = await vaultCall(page, 'vaultSnapshot');
    check(afterDrop.boxes.find(box => box.id === initial.id).items.filter(item => item.title === 'workspace-drop.txt').length === 1 && afterDrop.boxes.find(box => box.id === newBox.id).items.length === 0, prefix + ' 文件只进入目标箱一次，不落入其他箱');
    check(await page.locator('.vault-file-overlay').count() === 0, prefix + ' drop 后全局拖入提示正确收起');
    if (width === 1280) {
      await manager.getByText('workspace-drop.txt', { exact: true }).click();
      const filePreview = page.locator('.confirm-card').filter({ has: page.locator('.fp-head') });
      await filePreview.waitFor();
      await manager.waitFor({ state: 'hidden' });
      check(true, prefix + ' 点击文件条目先退出管理面板，再进入独立文件预览');
      await filePreview.getByText(fileText, { exact: true }).waitFor();
      check(true, prefix + ' 文件预览读取实际拖入文件的完整内容');
      await page.keyboard.press('Escape');
      await filePreview.waitFor({ state: 'hidden' });
      check(true, prefix + ' Escape 关闭文件预览，没有残留管理面板抢占键盘');
      await anchor.click(); await manager.waitFor();
    }
    await page.locator('.toast-host').waitFor({ state: 'hidden' });
    await manager.locator(':scope > .og-panel-body').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `${out}/manager-${width}x${height}.png`, animations: 'disabled' });
    if (height <= 650) {
      await manager.getByRole('button', { name: /^已发出口令/ }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/manager-bottom-${width}x${height}.png`, animations: 'disabled' });
      await manager.locator(':scope > .og-panel-body').evaluate(el => { el.scrollTop = 0; });
    }
    await manager.getByRole('button', { name: '关闭', exact: true }).click();
    await manager.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.matches('.vault-box-button'));
    check(true, prefix + ' 关闭管理面板后焦点回到持久入口');
    await anchor.click(); await manager.waitFor();
    await manager.getByRole('button', { name: '在标签页打开', exact: true }).click();
    await manager.waitFor({ state: 'hidden' });
    const fullPage = page.locator('[data-tab-page="vault"]:visible');
    await fullPage.locator('.vault-workspace').waitFor();
    check(await fullPage.getByText('workspace-drop.txt', { exact: true }).isVisible(), prefix + ' 标签页与管理面板共享已修改内容');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), prefix + ' 页面无横向溢出');
    await page.screenshot({ path: `${out}/page-${width}x${height}.png`, animations: 'disabled' });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.request.dispose();
    await page.close();
  }
  check(errors.length === 0, '全部尺寸无页面运行时异常：' + errors.join('; '));
  passed = true;
} catch (error) {
  errors.push(error.stack ?? String(error));
  for (const context of browser.contexts()) for (const page of context.pages()) {
    const snapshot = await page.evaluate(() => ({ focus: document.activeElement?.outerHTML.slice(0, 600), pointers: window.__pointerTrace, entry: document.querySelector('.vault-floating-anchor')?.outerHTML, keys: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('onethu.vault-anchor.'))), dialogs: [...document.querySelectorAll('[role=dialog]')].map(el => el.textContent?.slice(0, 120)) })).catch(() => null);
    console.error('Failure UI state:', JSON.stringify(snapshot));
    await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  }
  throw error;
} finally {
  try { await closeTestBrowser(browser); }
  catch (error) { passed = false; errors.push(error.stack ?? String(error)); throw error; }
  finally { writeFileSync(`${out}/workspace-report.json`, JSON.stringify({ passed, checks, errors, geometry, sizes, environment: 'Fake cloud fixture, browser DOM file drop; no physical Android or real cloud account' }, null, 2)); }
}
console.log(`${checks.length} vault workspace assertions passed; browser cleanup complete`);
