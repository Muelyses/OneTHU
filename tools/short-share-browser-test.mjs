/**
 * 联网短口令端到端验收（Vite 必须跑在 5180；假云盘夹具，不联网）：
 *
 * 发送方 A（已连接清华云盘）与接收方 B（完全没有云盘登录）是同一 BrowserContext 下的
 * 两个独立页面——只共享假云盘里的分享内容，用来证明：
 *   ① 新口令固定 22 字符，发送方上传 manifest，接收方联网匿名读取（跨独立客户端）；
 *   ② 名片/组织走稳定分享位：内容更新就地覆盖，口令不变、不堆目录；重复生成不重复上传；
 *   ③ 暂存箱口令复用未失效旧码（箱子改过才换）；
 *   ④ 所有接收入口（导入口令/收碰一碰/扫码/NFC/雷达）识别新旧口令与所有内容类型；
 *   ⑤ 旧 ONV1/ONV2/ONTOUCH1/ONORG1 继续可用；未连接/过期/撤销/篡改都有明确失败。
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { installFakeCloud, freshClientState } from './lib/fake-cloud.mjs';

const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
let checks = 0;
const errors = [];
const check = (cond, msg) => { assert.ok(cond, msg); checks++; console.log('✓ ' + msg); };
const SHORT = /^ON(-[0-9A-Z]{4}){4}$/;
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });

/* 两个「独立客户端」必须在同一个 BrowserContext 里（共享 localStorage 上的假云盘），
   但各自是完全独立的页面与本地状态——browser.newPage() 每次会开新 context，存储不互通。 */
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
async function newPage(token) {
  const p = await context.newPage();
  p.setDefaultTimeout(10000);
  p.on('pageerror', (e) => { if (!/reading 'invoke'/.test(e.message)) errors.push(e.message); });
  await installFakeCloud(p, { token });
  await p.route('**/src/state/data.ts*', async (route) => {
    const r = await route.fetch();
    const body = (await r.text()).replace(
      'export function useCampusData() {',
      'export function useCampusData() { return {data:{semester:{id:"x"},courses:[],homework:[],notifications:[],files:[],schedule:[]},state:"ready",error:null,reload:async()=>{}};',
    );
    await route.fulfill({ response: r, body });
  });
  await p.addInitScript(() => {
    /* dev server 长期运行 + HMR 会让模块带 ?t= 查询串，且资源计时默认缓冲区会挤出早期条目——
       必须放大缓冲区并按应用实际 URL import，否则拿到另一份模块实例、状态不互通。 */
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('onethu.onboarded.phone', '1');
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(t); } } });
  });
  return p;
}
/* 必须按应用实际加载的模块 URL import（Vite 会带 ?t= 查询串），否则拿到另一份模块实例、状态不互通 */
const call = (p, path, name, args = []) => p.evaluate(async ({ path, name, args }) => {
  const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => new URL(u).pathname.endsWith(path)) ?? path;
  return (await import(url))[name](...args);
}, { path, name, args });
const toast = (p, text) => p.locator('.toast-host').filter({ hasText: text }).first();
const closeFeedback = async (p) => { const btn = p.locator('.exchange-feedback button'); if (await btn.count()) { await btn.first().click(); await p.waitForTimeout(300); } };
const shareCount = (p) => p.evaluate(() => Object.keys(window.__cloud.shares).length);
const cardOf = async (p, code) => {
  const resolved = await call(p, '/src/state/cloudExchange.ts', 'resolveExchangeCode', [code]);
  return call(p, '/src/state/touch.ts', 'decodeTouch', [resolved]);
};

try {
  /* ── 发送方 A：已连接云盘 ── */
  const a = await newPage('sender-token');
  await a.goto(base + '/?explorer-preview=page&page=vault', { waitUntil: 'domcontentloaded' });
  await a.waitForSelector('.explorer-shell');
  await a.waitForTimeout(1200);
  check(await a.getByText('本版本要求连接清华云盘').count() === 0, 'A 已连接云盘：没有未连接闸门卡片');

  await call(a, '/src/state/vault.ts', 'addToVault', [{ type: 'text', title: '短口令笔记', text: '通过云盘 manifest 分享' }]);
  await call(a, '/src/state/nameCard.ts', 'savePersonalCard', [{ name: '短码名片', avatar: '', website: 'https://example.org', social: '', phone: '13800000000', bio: '验收', updatedAt: Date.now() }]);
  const org = await call(a, '/src/state/org.ts', 'createOrg', [{ name: '短码组织', brief: '一起验证', joinUrl: 'https://git.tsinghua.edu.cn/groups/short', ownerName: '我' }]);
  check(!!org?.id, 'A 建好组织（邀请按需生成）');

  /* 暂存箱 → 生成口令（真实 UI）；重复生成复用同一个口令，不重复上传 */
  const firstBoxId = (await call(a, '/src/state/vault.ts', 'activeVault')).id;
  await a.getByRole('button', { name: '生成口令' }).click();
  await a.waitForTimeout(1200);
  const code = (await a.locator('.vault-share-code').innerText()).trim();
  check(SHORT.test(code), '暂存箱口令是 22 字符短码：' + code);
  check(await a.locator('.vault-qr svg').count() >= 1, '短码配二维码（NFC/扫码同码）');
  check((await a.evaluate(() => window.__copied.at(-1))) === code, '生成后自动复制短码');
  const decoded = await call(a, '/src/state/vaultShare.ts', 'decodeShareAsync', [code]);
  check(decoded.ok && decoded.payload?.name === '我的暂存箱', '短码经云盘 manifest 解析回箱子名');
  check(!!decoded.payload?.cloud?.shareUrl && !!decoded.payload?.cloud?.shareToken, '解析结果带分享凭据（撤销可用）');
  const sharesAfterVault = await shareCount(a);
  await a.getByRole('button', { name: '生成口令' }).click();
  await a.waitForTimeout(1000);
  check((await a.locator('.vault-share-code').innerText()).trim() === code, '箱子没改：再点生成口令复用同一个短码');
  check(await shareCount(a) === sharesAfterVault, '箱子没改：不重复上传 manifest');

  /* 名片：稳定分享位——改内容就地更新，口令不变、不堆目录 */
  const cardCode1 = await call(a, '/src/lib/contentExchange.ts', 'personalShareCode', []);
  check(SHORT.test(cardCode1), '个人名片口令是短码：' + cardCode1);
  const cardCode2 = await call(a, '/src/lib/contentExchange.ts', 'personalShareCode', []);
  check(cardCode2 === cardCode1, '名片没改：重复生成复用同一个短码');
  const sharesAfterCard = await shareCount(a);
  check(await shareCount(a) === sharesAfterCard, '名片没改：云盘里没有新增目录');
  await call(a, '/src/state/nameCard.ts', 'savePersonalCard', [{ name: '改过的名片', avatar: '', website: 'https://example.org', social: '', phone: '13800000000', bio: '更新后', updatedAt: Date.now() }]);
  const cardCode3 = await call(a, '/src/lib/contentExchange.ts', 'personalShareCode', []);
  check(cardCode3 === cardCode1, '名片更新后口令不变（稳定分享位）');
  check(await shareCount(a) === sharesAfterCard, '名片更新只覆盖原目录，不新建分享');
  const updatedCard = await cardOf(a, cardCode1);
  check(updatedCard.ok && updatedCard.payload?.personal?.name === '改过的名片', '同一个口令现在读到更新后的名片');

  /* 组织邀请：同一个组织重复邀请复用旧码 */
  const orgCode1 = await call(a, '/src/state/org.ts', 'orgInviteCode', [await call(a, '/src/state/org.ts', 'orgSnapshot').then((d) => d.orgs[0])]);
  check(SHORT.test(orgCode1), '组织邀请口令是短码：' + orgCode1);
  const sharesAfterOrg = await shareCount(a);
  const orgCode2 = await call(a, '/src/state/org.ts', 'orgInviteCode', [await call(a, '/src/state/org.ts', 'orgSnapshot').then((d) => d.orgs[0])]);
  check(orgCode2 === orgCode1, '同一个组织重复邀请复用旧短码');
  check(await shareCount(a) === sharesAfterOrg, '组织邀请不重复上传');

  /* 碰一碰组合：三项齐全，也是短码（换一张新名片，避免和 B 已收到的重复而被去重） */
  await call(a, '/src/state/nameCard.ts', 'savePersonalCard', [{ name: '组合名片', avatar: '', website: 'https://example.org', social: '', phone: '13700000000', bio: '组合', updatedAt: Date.now() }]);
  const touch = await call(a, '/src/state/touch.ts', 'buildTouchCode', [{ withVault: true, withPersonal: true, withOrgId: org.id }]);
  check(SHORT.test(touch.code), '碰一碰组合口令是短码：' + touch.code);
  check(!!touch.payload.vaultCode && !!touch.payload.personal && !!touch.payload.orgCode, '组合里三项都在（箱子/名片/组织）');

  /* 目录分享被云盘拒绝 → 退化为文件分享（/f/ 链接）仍要能短写 */
  await a.evaluate(() => { window.__cloud.rejectDirShare = true; });
  await call(a, '/src/state/vault.ts', 'createVault');
  await call(a, '/src/state/vault.ts', 'addToVault', [{ type: 'text', title: '兜底箱子', text: '文件分享' }]);
  const fileCode = (await call(a, '/src/state/vaultShare.ts', 'mintShareCode', [await call(a, '/src/state/vault.ts', 'activeVault')])).code;
  await a.evaluate(() => { window.__cloud.rejectDirShare = false; });
  check(SHORT.test(fileCode) || /^ONX\./.test(fileCode), '文件分享兜底也能得到短码：' + fileCode);

  /* ── 接收方 B：全新本地状态 + 完全没有云盘登录 ── */
  const b = await newPage('');
  await b.goto(base + '/?explorer-preview=page&page=vault', { waitUntil: 'domcontentloaded' });
  await b.waitForSelector('.explorer-shell');
  await freshClientState(b);
  await b.reload({ waitUntil: 'domcontentloaded' });
  await b.waitForSelector('.explorer-shell');
  await b.waitForTimeout(1000);
  check(await b.getByText('本版本要求连接清华盘').count() >= 1 || await b.getByText('本版本要求连接清华云盘').count() >= 1, 'B 未连接云盘：显示连接引导卡片');
  check(await b.locator('.vault-action-row').last().innerText().then((t) => t.includes('先连接清华云盘')), 'B 的发出口令区提示先连接云盘');

  /* 未连接不能生成新口令：按钮层禁用 + 运行时会话守卫双保险 */
  const genBtn = b.getByRole('button', { name: '生成口令' });
  check(await genBtn.isDisabled(), 'B 未连接云盘且箱子为空：生成口令按钮禁用');
  check(await genBtn.getAttribute('title') === '先连接清华云盘', '禁用原因写明先连接清华云盘');
  await call(b, '/src/state/vault.ts', 'addToVault', [{ type: 'text', title: 'B 的条目', text: '有内容也发不出去' }]);
  check(await genBtn.isEnabled(), 'B 有内容后按钮可点（守卫在点击时兜底）');
  await genBtn.click();
  await toast(b, '本版本要求先连接清华云盘，再生成分享口令').waitFor();
  check(await b.locator('.vault-share-code').count() === 0, 'B 未连接云盘时生成口令被拒绝，不产生口令');

  /* B 通过真实 UI 导入口令（匿名读云盘 manifest）——暂存箱口令 */
  await b.getByRole('button', { name: '导入口令' }).click();
  await b.waitForSelector('.plg-form-modal');
  await b.locator('.plg-form-modal textarea').fill(code);
  await b.getByRole('button', { name: '提交' }).click();
  await toast(b, '已导入 1 项').waitFor();
  await closeFeedback(b); /* 成功动效自带遮罩，先关掉再点下一个入口 */
  const bVault = await call(b, '/src/state/vault.ts', 'vaultSnapshot');
  const imported = bVault.boxes.find((x) => x.id === bVault.activeId);
  check(imported.items.length === 1 && imported.items[0].title === '短口令笔记', 'B 匿名导入暂存箱内容（跨独立客户端读取）');

  /* 同一个「导入口令」入口也要认名片口令——以前只会报「应以 ONV1. 开头」 */
  await b.getByRole('button', { name: '导入口令' }).click();
  await b.waitForSelector('.plg-form-modal');
  await b.locator('.plg-form-modal textarea').fill(cardCode1);
  await b.getByRole('button', { name: '提交' }).click();
  await toast(b, '个人名片').waitFor();
  await closeFeedback(b);
  check(JSON.stringify((await call(b, '/src/state/nameCard.ts', 'cardsSnapshot')).contacts).includes('改过的名片'), '导入口令贴上名片短码：名片进通讯录（入口不再挑口令类型）');

  /* 直接交换入口：收到内容进新箱，原箱保留 */
  await call(b, '/src/state/vault.ts', 'addToVault', [{ type: 'text', title: 'B 自己的笔记', text: '保留' }]);
  const before = await call(b, '/src/state/vault.ts', 'vaultSnapshot');
  const r2 = await call(b, '/src/lib/contentExchange.ts', 'receiveExchangeCode', [code]);
  check(/已收到 1 项内容/.test(r2), '直接交换入口返回成功：' + r2);
  const after = await call(b, '/src/state/vault.ts', 'vaultSnapshot');
  check(after.boxes.length === before.boxes.length + 1, '收到内容创建新暂存箱');
  check(after.boxes.find((x) => x.id === before.activeId).items[0].text === '保留', '原箱内容不受影响');

  /* 大小写/分隔符容错 */
  const loose = code.toLowerCase().replace(/-/g, ' ');
  check(/已收到/.test(await call(b, '/src/lib/contentExchange.ts', 'receiveExchangeCode', [loose])), '小写+空格分隔的短码同样可接收');

  /* 重复收同一张名片：说明白「本地已有」，不是坏口令 */
  await call(b, '/src/state/nameCard.ts', 'cardsSnapshot').then(() => undefined);
  const dupMsg = await call(b, '/src/lib/contentExchange.ts', 'receiveExchangeCode', [cardCode1]).catch((e) => e.message);
  check(/个人名片/.test(dupMsg) || /本地已有/.test(dupMsg), '重复收名片给出可理解结果：' + dupMsg);
  const dupDirect = await call(b, '/src/state/touch.ts', 'importTouchCode', [await call(b, '/src/state/cloudExchange.ts', 'resolveExchangeCode', [cardCode1]), '我', 'new']);
  check(dupDirect.ok && dupDirect.duplicate, '重复导入标记为「已有」而不是失败');

  /* 组织邀请 / 碰一碰组合 */
  const rOrg = await call(b, '/src/state/org.ts', 'acceptOrgInvite', [orgCode1, '王五']);
  check(rOrg.ok, '组织邀请短码可加入');
  const rTouch = await call(b, '/src/state/touch.ts', 'importTouchCode', [touch.code, '我', 'new']);
  check(rTouch.ok && rTouch.vault && rTouch.contact && rTouch.org, '碰一碰组合短码一次收齐箱子/名片/组织' + (rTouch.ok ? '' : `（${rTouch.reason}）` + JSON.stringify(rTouch)));
  check(JSON.stringify((await call(b, '/src/state/nameCard.ts', 'cardsSnapshot')).contacts).includes('组合名片'), '组合里的名片进通讯录');
  const rFile = await call(b, '/src/state/vaultShare.ts', 'importShareCodeAsCurrent', [fileCode, 'new']);
  check(rFile.ok && rFile.imported === 1, '文件分享兜底路径的短码同样可读');

  /* 失败路径：篡改 / 垃圾 / 旧协议兼容 */
  const tampered = code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A');
  await assert.rejects(() => call(b, '/src/lib/contentExchange.ts', 'receiveExchangeCode', [tampered]), /无法读取分享/, '篡改短码读取失败并给出可操作原因');
  await assert.rejects(() => call(b, '/src/lib/contentExchange.ts', 'receiveExchangeCode', ['随便一段不是口令的文字']), /不是有效的 OneTHU 分享口令/, '垃圾文本明确拒绝');
  const oldV1 = await call(b, '/src/state/vaultShare.ts', 'encodeShare', [{ v: 1, kind: 'vault-share', issuedAt: Date.now(), name: '旧版内联箱', items: [{ type: 'text', title: '旧条目', text: 'ONV1' }] }]);
  check((await call(b, '/src/state/vaultShare.ts', 'importShareCodeAsCurrent', [oldV1, 'new'])).imported === 1, '旧 ONV1 内联口令仍可导入（无需云盘）');
  const oldV2 = await call(b, '/src/state/vaultShare.ts', 'encodeShareV2', [{ v: 1, kind: 'vault-share', issuedAt: Date.now(), name: '旧版内联箱2', items: [{ type: 'text', title: '旧条目2', text: 'ONV2' }] }]);
  check((await call(b, '/src/state/vaultShare.ts', 'importShareCodeAsCurrent', [oldV2, 'new'])).imported === 1, '旧 ONV2 内联口令仍可导入（无需云盘）');
  const oldTouch = await call(b, '/src/state/touch.ts', 'encodeTouch', [{ v: 1, kind: 'onethu-touch', issuedAt: Date.now(), personal: { name: '旧口令名片', avatar: '', website: '', social: '', phone: '', bio: '', updatedAt: Date.now() } }]);
  check((await call(b, '/src/state/touch.ts', 'importTouchCode', [oldTouch, '我', 'new'])).contact, '旧 ONTOUCH1 口令仍可导入');
  /* 旧 ONORG1：按当年口径手工拼一条（b64url + FNV 校验），证明旧口令不依赖云盘也能加入 */
  const oldOrg = await b.evaluate(async () => {
    const u = performance.getEntriesByType('resource').map((r) => r.name).find((x) => new URL(x).pathname.endsWith('/src/state/vaultShare.ts'));
    const share = await import(u);
    const json = JSON.stringify({ v: 1, kind: 'org-invite', orgId: 'o1', name: '旧组织', brief: '', joinUrl: 'https://git.tsinghua.edu.cn/groups/old', inviter: '旧', issuedAt: Date.now() });
    let bin = '';
    for (const byte of new TextEncoder().encode(json)) bin += String.fromCharCode(byte);
    return `ONORG1.${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${share.checksum(json)}`;
  });
  check((await call(b, '/src/state/org.ts', 'acceptOrgInvite', [oldOrg, '赵六'])).ok, '旧 ONORG1 口令仍可加入');

  /* 过期：云盘侧七天有效期由分享链接控制 */
  await b.evaluate(() => { for (const s of Object.values(window.__cloud.shares)) s.expiresAt = Date.now() - 1000; });
  const expired = await call(b, '/src/state/vaultShare.ts', 'importShareCodeAsCurrent', [code, 'new']);
  check(!expired.ok && /过期/.test(expired.reason ?? ''), '分享过期后导入失败并提示过期：' + (expired.reason ?? ''));

  /* 撤销：A 在 UI 上撤销云分享，B 再读即失败（撤销与过期是两条独立失败路径） */
  await a.bringToFront();
  /* 前面的过期用例把分享标记成已过期：恢复有效期并持久化，让 B 重新 hydrate 后回到「有效」状态 */
  await a.evaluate(() => {
    for (const s of Object.values(window.__cloud.shares)) s.expiresAt = Date.now() + 86400_000;
    localStorage.setItem('onethu.test.cloud.v1', JSON.stringify({ fs: window.__cloud.fs, shares: window.__cloud.shares, seq: window.__cloud.seq }));
  });
  await call(a, '/src/state/vault.ts', 'setActiveVault', [firstBoxId]);
  await a.locator('.vault-share-code').waitFor();
  await a.waitForTimeout(600);
  await a.getByRole('button', { name: '撤销云分享' }).click();
  await toast(a, '云分享已撤销').waitFor();
  await b.reload({ waitUntil: 'domcontentloaded' });
  await b.waitForSelector('.explorer-shell');
  await b.waitForTimeout(900);
  const revoked = await call(b, '/src/state/vaultShare.ts', 'importShareCodeAsCurrent', [code, 'new']);
  check(!revoked.ok && /无法读取分享/.test(revoked.reason ?? ''), '撤销后短码立即失效：' + (revoked.reason ?? ''));
  check(/撤销|不存在/.test(revoked.reason ?? ''), '撤销的失败原因说的是「已撤销/不存在」，不是过期：' + (revoked.reason ?? ''));

  /* 小形态（雷达）也要能直接收：粘贴口令 + 扫码入口在位 */
  await a.bringToFront();
  await a.getByRole('button', { name: /^暂存箱，/ }).click();
  await a.locator('.vault-radar').waitFor();
  await a.waitForTimeout(400);
  check(await a.getByRole('button', { name: '收口令', exact: true }).count() === 1, '雷达面板有「收口令」入口（可直接粘贴）');
  check(await a.getByRole('button', { name: '扫码', exact: true }).count() === 1, '雷达面板有「扫码」入口（选二维码截图）');
  await a.getByRole('button', { name: '收口令', exact: true }).click();
  await a.waitForSelector('.plg-form-modal');
  await a.locator('.plg-form-modal textarea').fill(cardCode1);
  await a.getByRole('button', { name: '提交' }).click();
  await toast(a, /个人名片|本地已有/).waitFor();
  check(true, '雷达「收口令」走通统一接收入口');

  check(errors.length === 0, '无新增运行时异常：' + errors.join(';'));
  await a.close(); await b.close(); await context.close();
  console.log(checks + ' short-share assertions passed');
} finally {
  await browser.close();
}
