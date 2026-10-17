/**
 * 暂存箱 Phase 1 回归（Vite 必须跑在 5180）：
 * ① /vault 路由可打开；② 搜索结果可拖入暂存箱（data-vault-catch + 拖放目标）；
 * ③ 同对象去重；④ 口令可生成、可解码校验、篡改会拒绝；⑤ 口令可导入为当前暂存箱。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const base = process.argv[2] ?? 'http://127.0.0.1:5180';
let checks = 0;
const errors = [];
const check = (cond, msg) => { assert.ok(cond, msg); checks++; console.log('✓ ' + msg); };

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const p = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => localStorage.setItem('onethu.onboarded.phone', '1'));
  await p.route('**/src/state/data.ts*', async (route) => {
    const r = await route.fetch();
    let b = await r.text();
    for (const n of ['useLearnData', 'useCampusData']) b = b.replace(`export function ${n}() {`, `export function ${n}() { return {data:{semester:{id:'x'},courses:[],homework:[],notifications:[],files:[],schedule:[]},state:'ready',error:null,reload:async()=>{}};`);
    await route.fulfill({ response: r, body: b });
  });
  await p.goto(base + '/?explorer-preview=page&page=vault', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.explorer-shell');
  await p.waitForTimeout(1500);
  check(await p.getByRole('heading', { name: '暂存箱', exact: true }).count() === 1, 'vault page route works');
  check(await p.evaluate(() => !document.body.innerText.includes('页面不存在')), 'no fallback page text');

  /* 搜索 → 拖入 */
  await p.keyboard.press('Control+KeyK');
  await p.waitForTimeout(350);
  const input = p.locator('.pal-input, input[placeholder*="搜索"], input[placeholder*="搜"]').first();
  await input.fill('电费');
  await p.waitForTimeout(450);
  const row = p.locator('.pal-row').first();
  check((await row.getAttribute('data-vault-catch'))?.includes('"type":"atom"'), 'search row is a vault drag source');
  const box = await row.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 24, { steps: 6 });
  await p.waitForTimeout(250);
  check(await p.locator('[data-vault-drop]').count() === 1, 'drop target appears while dragging');
  const drop = await p.locator('[data-vault-drop]').boundingBox();
  await p.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, { steps: 10 });
  await p.waitForTimeout(250);
  await p.mouse.up();
  await p.waitForTimeout(600);
  await p.keyboard.press('Escape');
  const count = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.vaults.v1')).boxes[0].items.length);
  check(count === 1, 'dragged object lands in vault');
  check(await p.getByText('宿舍电费').count() >= 1, 'vault shows dragged item title');

  /* 口令生成 + 校验 */
  await p.getByRole('button', { name: '生成口令' }).click();
  await p.waitForTimeout(600);
  const code = await p.locator('.vault-share-code').innerText();
  check(/^ONV2\.[A-Za-z0-9_-]+\.[0-9a-f]{32}$/.test(code.trim()), 'share code has ONV2.body.sha256 shape');
  const decoded = await p.evaluate(async (c) => {
    /* codec 是纯函数；直接按 Vite 原路径 import 不影响应用状态。 */
    const m = await import('/src/state/vaultShare.ts');
    const ok = await m.decodeShareAsync(c);
    const bad = await m.decodeShareAsync(c.slice(0, -1) + (c.endsWith('0') ? '1' : '0'));
    const v1 = m.encodeShare({ v: 1, kind: 'vault-share', issuedAt: Date.now(), name: '旧版口令', items: [] });
    const oldOk = await m.decodeShareAsync(v1);
    return { ok, bad, oldOk };
  }, code.trim());
  check(decoded.ok.ok && decoded.ok.payload?.name === '我的暂存箱', 'ONV2 code decodes with box name');
  check(decoded.oldOk.ok, 'ONV1 codes remain backward-compatible');
  check(!decoded.bad.ok, 'tampered code is rejected');
  const expired = await p.evaluate(async () => {
    const m = await import('/src/state/vaultShare.ts');
    const code = m.encodeShare({ v: 1, kind: 'vault-share', issuedAt: Date.now() - 1000, expiresAt: Date.now() - 1, name: '过期口令', items: [] });
    return m.decodeShareAsync(code);
  });
  check(!expired.ok && /过期/.test(expired.reason ?? ''), 'expired code is rejected with reason');
  check(readFileSync('apps/desktop/src/components/Collect.tsx', 'utf8').includes('data-vault-catch'), 'CollectStar is a global vault drag source');
  check(readFileSync('apps/desktop/src/plugins/ChatDock.tsx', 'utf8').includes('data-vault-catch'), 'OH search hits are vault drag sources');

  /* 导入为当前暂存箱（走真实 UI：新建箱 → 导入口令 → 提交） */
  await p.getByRole('button', { name: '新建', exact: true }).click();
  await p.waitForTimeout(350);
  await p.getByRole('button', { name: '导入口令' }).click();
  await p.waitForSelector('.plg-form-modal');
  await p.locator('.plg-form-modal textarea').fill(code.trim());
  await p.getByRole('button', { name: '提交' }).click();
  await p.waitForTimeout(700);
  const imported = await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('onethu.vaults.v1'));
    const active = d.boxes.find((b) => b.id === d.activeId);
    return { n: active.items.length, title: active.items[0]?.title, name: active.name };
  });
  check(imported.n === 1 && imported.title === '宿舍电费', 'import replaces current vault with shared items');
  check(imported.name !== '我的暂存箱', 'import targets active vault, not origin box');

  /* 文件通道：选择文件 → SHA-256 → 入箱；同内容再次入箱按 hash 去重 */
  const chooser = p.waitForEvent('filechooser');
  await p.getByRole('button', { name: '添加文件' }).click();
  const fc = await chooser;
  await fc.setFiles({ name: 'vault-note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello oneTHU vault') });
  await p.waitForTimeout(900);
  const fileState = await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('onethu.vaults.v1'));
    const box = d.boxes.find((b) => b.id === d.activeId);
    const item = box.items.find((x) => x.type === 'file');
    return { n: box.items.length, name: item?.file?.name, hash: item?.file?.hash, size: item?.file?.size };
  });
  check(fileState.name === 'vault-note.txt' && /^[0-9a-f]{64}$/.test(fileState.hash ?? ''), 'picked file staged with SHA-256 fingerprint');
  check(fileState.size === Buffer.byteLength('hello oneTHU vault'), 'staged file keeps byte size');
  const chooser2 = p.waitForEvent('filechooser');
  await p.getByRole('button', { name: '添加文件' }).click();
  const fc2 = await chooser2;
  await fc2.setFiles({ name: 'same-content.txt', mimeType: 'text/plain', buffer: Buffer.from('hello oneTHU vault') });
  await p.waitForTimeout(700);
  const n2 = await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('onethu.vaults.v1'));
    return d.boxes.find((b) => b.id === d.activeId).items.length;
  });
  check(n2 === fileState.n, 'same file content is deduped by hash (not by name)');

  /* 桌面 OS 文件拖入：全屏提示层 + 松手入箱（合成 DataTransfer） */
  const osDrop = await p.evaluate(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File(['dropped from desktop'], 'os-drop.txt', { type: 'text/plain' }));
    const ev = (type) => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
    document.dispatchEvent(ev('dragenter'));
    await new Promise((r) => setTimeout(r, 120));
    const overlay = Boolean(document.querySelector('.vault-file-overlay'));
    document.dispatchEvent(ev('dragover'));
    document.dispatchEvent(ev('drop'));
    await new Promise((r) => setTimeout(r, 900));
    const items = JSON.parse(localStorage.getItem('onethu.vaults.v1')).boxes.flatMap((b) => b.items);
    const hit = items.find((i) => i.title === 'os-drop.txt');
    return { overlay, found: Boolean(hit), hash: hit?.file?.hash };
  });
  check(osDrop.overlay, 'dragging OS files shows vault drop overlay');
  check(osDrop.found && /^[0-9a-f]{64}$/.test(osDrop.hash ?? ''), 'dropped OS file is hashed and stored in vault');
  /* 碰一碰组合：暂存箱口令 + 个人名片一起编码；接收端可导入 */
  await p.evaluate(() => localStorage.setItem('onethu.cards.v1', JSON.stringify({
    v: 1,
    personal: { name: '碰一碰测试', avatar: '', website: '', social: '', phone: '13800000000', bio: '一句话', updatedAt: Date.now() },
    orgs: [], contacts: [],
  })));
  await p.getByRole('button', { name: '碰一碰组合' }).click();
  await p.waitForSelector('.plg-form-modal');
  await p.getByRole('button', { name: '提交' }).click();
  await p.waitForTimeout(800);
  const touchCode = await p.locator('.vault-share-code').filter({ hasText: 'ONTOUCH1' }).innerText();
  check(touchCode.trim().startsWith('ONTOUCH1.'), 'touch combo generates ONTOUCH1 code');
  const touch = await p.evaluate(async (c) => {
    const m = await import('/src/state/touch.ts');
    const dec = m.decodeTouch(c);
    const r = await m.importTouchCode(c);
    return { ok: dec.ok, hasVault: Boolean(dec.payload?.vaultCode), hasCard: Boolean(dec.payload?.personal), imported: r };
  }, touchCode.trim());
  check(touch.ok && touch.hasVault && touch.hasCard, 'touch code carries vault share code + personal card');
  check(touch.imported.ok && touch.imported.vault === true, 'touch code can be imported by receiver');

  /* 设置行兜底：SettingsRow 没有逐条 data-vault-catch，长按/拖动靠 data-set-id 识别 */
  await p.getByRole('button', { name: '设置' }).first().click();
  await p.waitForTimeout(500);
  const settingRow = p.locator('.og-settings-row[data-set-id^="row-"]:visible').first();
  check(await settingRow.count() === 1, 'settings rows carry stable data-set-id');
  const settingTitle = (await settingRow.innerText()).split('\n')[0].trim();
  const sbox = await settingRow.boundingBox();
  const beforeSettings = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.vaults.v1')).boxes.flatMap((b) => b.items).length);
  await p.mouse.move(sbox.x + sbox.width / 2, sbox.y + 24);
  await p.mouse.down();
  await p.mouse.move(sbox.x + sbox.width / 2 + 20, sbox.y + 50, { steps: 5 });
  await p.waitForTimeout(250);
  const sdrop = await p.locator('[data-vault-drop]').boundingBox();
  await p.mouse.move(sdrop.x + sdrop.width / 2, sdrop.y + sdrop.height / 2, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(600);
  await p.keyboard.press('Escape');
  const afterSettings = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.vaults.v1')).boxes.flatMap((b) => b.items));
  check(afterSettings.length === beforeSettings + 1 && afterSettings.some((i) => i.title === settingTitle), 'setting row drags into vault via data-set-id fallback');

  check(await p.locator('.vault-dock').count() === 0, 'desktop hides the floating vault dock');

  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(600);
  check(await p.locator('.vault-dock').isVisible(), 'phone shows persistent vault dock (outside bottom bar grid)');
  const started = await p.evaluate(async () => {
    const el = document.querySelector('[data-vault-catch]');
    if (!el) return { ok: false, reason: 'no-source' };
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const ev = (type, cx, cy, extra = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: cx, clientY: cy, ...extra });
    el.dispatchEvent(ev('pointerdown', x, y));
    await new Promise((r2) => setTimeout(r2, 520));
    window.dispatchEvent(ev('pointermove', x + 36, y + 70));
    await new Promise((r2) => setTimeout(r2, 260));
    const drop = document.querySelector('[data-vault-drop]');
    const rect = drop?.getBoundingClientRect();
    const ok = Boolean(drop);
    window.dispatchEvent(ev('pointercancel', x + 36, y + 70));
    await new Promise((r2) => setTimeout(r2, 120));
    return { ok, bottom: rect?.bottom ?? 0, vh: window.innerHeight, cleared: !document.querySelector('[data-vault-drop]') };
  });
  check(started.ok, 'mobile long-press starts vault drag and shows drop target');
  check(started.cleared, 'pointercancel dismisses the drop target');
  check(started.bottom > 0 && started.bottom < started.vh, 'mobile drop target stays inside viewport');
  /* 云盘适配器：云分享只编码引用，接收端通过 adapter.resolve 读回 */
  const cloud = await p.evaluate(async () => {
    const vs = await import('/src/state/vaultShare.ts');
    const v = await import('/src/state/vault.ts');
    let uploaded = null;
    let revoked = false;
    vs.registerVaultCloudAdapter({
      async upload(p) {
        uploaded = p;
        return { provider: 'seafile', repoId: 'repo.test', path: '/Vault/shares/test/manifest.json', shareUrl: 'https://cloud.tsinghua.edu.cn/d/testtoken/', shareToken: 'testtoken', expiresAt: Date.now() + 3600_000 };
      },
      async resolve() { return uploaded; },
      async revoke() { revoked = true; },
    });
    v.createVault('云端测试箱');
    v.addToVault({ type: 'text', title: '云端对象', text: 'hello cloud' });
    const minted = await vs.mintShareCode(v.activeVault());
    const imported = await vs.importShareCodeAsCurrent(minted.code);
    const active = v.activeVault();
    const rv = await vs.revokeShare(minted.payload);
    vs.registerVaultCloudAdapter(null);
    return { cloud: minted.payload.cloud, inline: minted.payload.items, imported: imported.ok, n: active.items.length, title: active.items[0]?.title, rv, revoked };
  });
  check(cloud.cloud?.shareUrl?.includes('/d/testtoken/') && cloud.inline === undefined, 'cloud share code encodes a cloud ref, not the manifest');
  check(cloud.imported && cloud.n === 1 && cloud.title === '云端对象', 'cloud ref resolves back into current vault via adapter');
  check(cloud.rv && cloud.revoked, 'share revocation goes through the adapter');
  check(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.join(';') : ''));
  console.log(checks + ' vault assertions passed');
} finally {
  await browser.close();
}
