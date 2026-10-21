/**
 * 名片/通讯录 Phase 3 地基回归：
 * ① 设置页「我的 OneTHU 名片」可编辑（简介限 120 字）；② 名片可放进暂存箱；
 * ③ 暂存箱里点名片 → 加入通讯录；④ 重复收取按姓名+手机去重。
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { installFakeCloud } from './lib/fake-cloud.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5180';
let checks = 0;
const errors = [];
const check = (cond, msg) => { assert.ok(cond, msg); checks++; console.log('✓ ' + msg); };

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const p = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  await p.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/,()=>{});
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => { performance.setResourceTimingBufferSize(10000); localStorage.setItem('onethu.onboarded.phone', '1'); });
  /* 假云盘：名片口令是联网短码（publishExchangeCode），不联网也要能验「通讯录直接粘贴收名片」。 */
  await installFakeCloud(p);
  await p.route('**/src/state/data.ts*', async (route) => {
    const r = await route.fetch();
    let b = await r.text();
    for (const n of ['useLearnData', 'useCampusData']) b = b.replace(`export function ${n}() {`, `export function ${n}() { return {data:{semester:{id:'x'},courses:[],homework:[],notifications:[],files:[],schedule:[]},state:'ready',error:null,reload:async()=>{}};`);
    await route.fulfill({ response: r, body: b });
  });
  await p.goto(base + '/?explorer-preview=home', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.explorer-shell');
  await p.waitForTimeout(900);
  const call = async (path, name, args = []) => p.evaluate(async ({ path, name, args }) => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => new URL(u).pathname.endsWith(path));
    if (!url) throw Error('module not mounted ' + path);
    const m = await import(url);
    return m[name](...args);
  }, { path, name, args });

  /* 设置入口已从「设置齿轮」换成「我的」；个人设置浮层的分段是 .settings-seg-item */
  await p.getByRole('button', { name: '我的' }).first().click();
  await p.waitForTimeout(500);
  await p.locator('.settings-seg-item').filter({ hasText: '我的名片' }).first().click();
  await p.waitForTimeout(600);
  check(await p.getByText('我的名片', { exact: true }).count() >= 1, 'settings has the name card section');
  await p.getByRole('button', { name: '编辑资料' }).click();
  await p.waitForSelector('.plg-form-modal');
  const inputs = p.locator('.plg-form-modal input');
  await inputs.nth(0).fill('张三');
  await inputs.nth(1).fill('https://example.com/zhangsan');
  await inputs.nth(2).fill('@zhangsan');
  await inputs.nth(3).fill('13800000000');
  await inputs.nth(4).fill('2025013332@tsinghua.edu.cn');
  await p.locator('.plg-form-modal textarea').fill('这是简介'.repeat(40));
  await p.getByRole('button', { name: '提交' }).click();
  await p.waitForTimeout(500);
  const card = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.cards.v1')).personal);
  check(card.name === '张三' && card.website === 'https://example.com/zhangsan' && card.phone === '13800000000' && card.cloudEmail === '2025013332@tsinghua.edu.cn', 'personal card fields saved (incl. cloud email)');
  check(Array.from(card.bio).length === 120, 'bio is clamped to 120 chars for NFC length');

  /* 自定义卡面：选图 → 拖动/缩放 → 自动字色（白底图应选黑字）→ 存进名片 */
  await p.getByRole('button', { name: '自定义卡面', exact: true }).click();
  await p.getByRole('dialog', { name: '自定义卡面' }).waitFor();
  const chooser = p.waitForEvent('filechooser');
  await p.getByRole('button', { name: '选择照片', exact: true }).click();
  const fc = await chooser;
  const whitePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PzWvWQAAAABJRU5ErkJggg==', 'base64');
  await fc.setFiles({ name: 'white.png', mimeType: 'image/png', buffer: whitePng });
  await p.locator('.cover-editor-stage .identity-card.has-cover').waitFor({ timeout: 8000 });
  /* 手动字色：白字/黑字必须真的生效（此前会被全局文字自动对比度写死成黑字） */
  await p.getByRole('button', { name: '白字', exact: true }).click();
  await p.waitForTimeout(200);
  const manualLight = await p.evaluate(() => {
    const n = document.querySelector('.cover-editor-stage .identity-card-name');
    return { cls: document.querySelector('.cover-editor-stage .identity-card')?.className, color: n ? getComputedStyle(n).color : '' };
  });
  check(manualLight.cls.includes('is-cover-light') && manualLight.color === 'rgb(255, 255, 255)', 'manual white ink really renders white in preview: ' + manualLight.color);
  await p.getByRole('button', { name: '黑字', exact: true }).click();
  await p.waitForTimeout(200);
  const manualDark = await p.evaluate(() => {
    const n = document.querySelector('.cover-editor-stage .identity-card-name');
    return { cls: document.querySelector('.cover-editor-stage .identity-card')?.className, color: n ? getComputedStyle(n).color : '' };
  });
  check(manualDark.cls.includes('is-cover-dark') && manualDark.color.match(/\d+/g)?.every(v => Number(v) < 40), 'manual black ink really renders black in preview: ' + manualDark.color);
  await p.getByRole('button', { name: '自动', exact: true }).click();
  await p.waitForTimeout(200);
  const coverZoom = p.getByRole('slider', { name: '卡面缩放' });
  await coverZoom.press('Home');
  for (let i = 0; i < 12; i++) await coverZoom.press('ArrowRight');
  await p.getByRole('button', { name: '保存卡面', exact: true }).click();
  await p.waitForTimeout(800);
  const withCover = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.cards.v1')).personal.cover);
  check(withCover?.src?.startsWith('data:image/jpeg') && withCover.ink === 'dark', 'card cover saved with auto ink (white image -> dark ink)');
  check(withCover.zoom === 1.6 && withCover.focusX >= 0 && withCover.focusY >= 0, 'card cover keeps focus/zoom');
  check(await p.locator('.identity-panel .identity-card.has-cover.is-cover-dark').count() === 1, 'identity card renders the custom cover with contrast class');
  /* 卡面「存到云盘」：异步上传后名片里记 cloud 引用，云盘里真有这个文件 */
  await p.waitForFunction(() => Boolean(JSON.parse(localStorage.getItem('onethu.cards.v1')).personal.cover?.cloud?.repoId), null, { timeout: 10000 });
  const coverCloud = await p.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('onethu.cards.v1')).personal.cover.cloud;
    return { ...c, exists: Boolean(window.__cloud.fs[c.repoId]?.[c.path]) };
  });
  check(/^\/Cards\/cover-.*\.jpg$/.test(coverCloud.path) && coverCloud.exists, 'card cover is uploaded to the cloud drive (/Cards/...)');
  await p.screenshot({ path: 'docs/onegui/experience-mode/card-cover-editor.png' });
  /* 深色照片 → 自动换成白字（对比度反向） */
  await p.getByRole('button', { name: '换卡面', exact: true }).click();
  await p.getByRole('dialog', { name: '自定义卡面' }).waitFor();
  const chooser2 = p.waitForEvent('filechooser');
  await p.getByRole('button', { name: '换一张照片', exact: true }).click();
  const fc2 = await chooser2;
  await fc2.setFiles({ name: 'black.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAgElEQVR4nNXOMREAIBDAsNKRY8S/VkT8wDUKsva5lEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxPk7MPUAK44AqoR+gzgAAAAASUVORK5CYII=', 'base64') });
  await p.locator('.cover-editor-stage .identity-card.has-cover').waitFor({ timeout: 8000 });
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: '保存卡面', exact: true }).click();
  await p.waitForTimeout(600);
  const darkCover = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.cards.v1')).personal.cover);
  check(darkCover?.ink === 'light', 'dark image flips the card text to white automatically');
  /* 「上亮下暗」的照片：整图平均不暗，但文字区（下半）黑 → 仍应白字 */
  await p.getByRole('button', { name: '换卡面', exact: true }).click();
  await p.getByRole('dialog', { name: '自定义卡面' }).waitFor();
  const chooser3 = p.waitForEvent('filechooser');
  await p.getByRole('button', { name: '换一张照片', exact: true }).click();
  const fc3 = await chooser3;
  await fc3.setFiles({ name: 'split.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGAAAAA8CAIAAAAWtijjAAAAmElEQVR4nO3SsRHAIBAEMXDEuP9qiVwBbAGW0v9o5+bee3D2XG4I1CwoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAw13rr59csKAgUBAoCBYGCQEGgIFAQKAgUBAoCBYGCQEGgIFAQaNx9lywDf5A/dsMAAAAASUVORK5CYII=', 'base64') });
  await p.locator('.cover-editor-stage .identity-card.has-cover').waitFor({ timeout: 8000 });
  await p.getByRole('button', { name: '保存卡面', exact: true }).click();
  await p.waitForTimeout(600);
  const splitCover = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.cards.v1')).personal.cover);
  check(splitCover?.ink === 'light', 'bright-top/dark-bottom photo still gets white text (name band wins)');
  check(await p.locator('.identity-panel .identity-card.has-cover.is-cover-light').count() === 1, 'identity card uses light-ink contrast class on dark cover');

  await p.getByRole('button', { name: '放进暂存箱' }).first().click();
  await p.waitForTimeout(600);
  const inVault = await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('onethu.vaults.v1'));
    return d.boxes.flatMap((b) => b.items).find((x) => x.payload?.kind === 'namecard');
  });
  check(inVault?.title?.includes('张三') && inVault?.payload?.card?.name === '张三', 'name card can be put into vault as payload');

  await call('/src/state/explorer.ts', 'closeSettings', []);
  await call('/src/state/explorer.ts', 'explorerNavigate', ['vault']);
  await p.waitForTimeout(700);
  await p.getByText('名片 · 张三').first().click();
  await p.waitForTimeout(600);
  const ownContacts = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.cards.v1')).contacts.length);
  check(ownContacts === 0, 'own card is not added to contacts (self rejected)');
  const model = await p.evaluate(async () => {
    const m = await import('/src/state/nameCard.ts');
    m.savePersonalCard({ name: '我', phone: '13800000000', bio: '' });
    const card = { name: '李四', avatar: '', website: '', social: '', phone: '13900000000', bio: '同学', updatedAt: Date.now() };
    const first = m.addContact('personal', card);
    const dup = m.addContact('personal', card);
    return { first: first.ok, dup: dup.reason, n: m.cardsSnapshot().contacts.length };
  });
  check(model.first && model.dup === 'duplicate' && model.n === 1, 'contacts dedupe by name+phone');

  /* 通讯录直接收名片（用户 2026-10-19 点名）：「粘贴名片口令 / 扫码收名片」就在名片夹工具条上，不用先绕暂存箱 */
  await call('/src/state/explorer.ts', 'explorerNavigate', ['contacts']);
  await p.waitForTimeout(800);
  await p.locator('.contact-toolbar').first().waitFor();
  const toolbar = await p.locator('.contact-toolbar button').allTextContents();
  /* 收名片入口收成一个「接收名片」，工具条不再三颗按钮并排（用户 2026-10-19「太拥挤」） */
  check(toolbar.includes('接收名片') && !toolbar.includes('粘贴名片口令') && toolbar.length <= 8, 'contacts toolbar keeps a single 接收名片 entry');
  /* 名片夹要能看到自己创建的组织（用户 2026-10-19 点名「为什么名片夹里没有自己创建的组织」） */
  await call('/src/state/org.ts', 'createOrg', [{ name: '测试组织' }]);
  await p.waitForTimeout(600);
  check(await p.locator('.contact-deck .contact-slot').count() >= 2, 'own organization card shares the 名片夹 deck');
  check(await p.getByRole('button', { name: '打开测试组织的组织主页' }).count() === 1, 'own organization card appears in 名片夹 deck');
  /* 组织卡现在直接进组织完整页面（不再弹卡片详情） */
  await p.getByRole('button', { name: '打开测试组织的组织主页' }).click();
  await p.getByRole('heading', { name: '测试组织', exact: true }).waitFor({ timeout: 10000 });
  check(await p.getByRole('radio', { name: '资料库', exact: true }).count() === 1, 'org card opens the full organization page');
  await call('/src/state/explorer.ts', 'explorerNavigate', ['contacts']);
  await p.waitForTimeout(800);
  await p.locator('.contact-toolbar').getByRole('button', { name: '接收名片' }).click();
  const recvPanel = p.getByRole('dialog', { name: '接收名片' });
  await recvPanel.waitFor();
  check(
    await recvPanel.getByRole('button', { name: '粘贴口令' }).count() === 1
    && await recvPanel.getByRole('button', { name: '识别二维码' }).count() === 1
    && await recvPanel.getByRole('button', { name: '从暂存箱收' }).count() === 1,
    'receive panel offers 粘贴/扫码/从暂存箱 三选',
  );
  await recvPanel.getByRole('button', { name: '粘贴口令' }).click();
  const friendCode = await call('/src/lib/contentExchange.ts', 'personalShareCode', [
    { name: '外部朋友', avatar: '', website: '', social: '', phone: '', bio: '走廊认识的', cloudEmail: '' },
  ]);
  check(/^ON(-[0-9A-Z]{4}){4}$/.test(friendCode), 'fake friend card code is a short code: ' + friendCode);
  await p.waitForSelector('.plg-form-modal');
  await p.locator('.plg-form-modal textarea').fill(friendCode);
  await p.getByRole('button', { name: '提交' }).click();
  await p.waitForTimeout(900);
  const received = await call('/src/state/nameCard.ts', 'cardsSnapshot');
  check(received.contacts.some((c) => c.name === '外部朋友'), 'pasting a card code in contacts adds the contact (no vault detour)');
  check(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.join(';') : ''));
  console.log(checks + ' name card assertions passed');
} finally {
  await browser.close();
}
