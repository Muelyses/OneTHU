/** Round 2: real UI/layout + an explicit NFC bridge fixture, never hardware evidence. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = 'docs/onegui/feedback-round2';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [], errors = [], geometry = [];
const check = (ok, name) => { assert.ok(ok, name); results.push(name); console.log('✓ ' + name); };
const call = (p, path, name, args = []) => p.evaluate(async ({ path, name, args }) => {
  const url = performance.getEntriesByType('resource').map(x => x.name).find(x => new URL(x).pathname.endsWith(path));
  if (!url) throw Error('Module not loaded: ' + path);
  return (await import(url))[name](...args);
}, { path, name, args });
const fixture = { semester: { id: 'x' }, courses: [], homework: [], notifications: [], files: [], schedule: [
  { courseName: '数据结构', dayOfWeek: 1, startTime: '10:00', endTime: '11:30', location: '六教 6A205', teacher: '张老师' },
  { courseName: '计算机网络', dayOfWeek: 3, startTime: '14:00', endTime: '15:30', location: '三教 3200', teacher: '王老师' },
  { courseName: '冲突课程 A', dayOfWeek: 1, startTime: '10:00', endTime: '11:00', location: '一教' },
  ...['A', 'B', 'C'].map(n => ({ courseName: '重叠课程 ' + n, dayOfWeek: 5, startTime: '09:00', endTime: '10:30', location: '六教' })),
] };
async function page(width = 1280, height = 860, bridge = false) {
  const p = await browser.newPage({ viewport: { width, height }, hasTouch: width < 600, isMobile: width < 600 });
  p.setDefaultTimeout(10000);
  p.on('pageerror', e => { if (!/reading 'invoke'/.test(e.message)) errors.push(e.message); });
  await installFakeCloud(p, { token: 'test-token' }); /* 名片口令走云盘发布（短码） */
  await p.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('onethu.onboarded.phone', '1');
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied.push(text); } } });
    window.__nfc = { available: true, enabled: true, sent: [], reads: 0, text: '', error: '' };
    window.__nfcInvoke = async (cmd, args) => {
      if (cmd === 'nfc_available') return { available: window.__nfc.available, enabled: window.__nfc.enabled };
      await new Promise(resolve => setTimeout(resolve, 100));
      if (window.__nfc.error) throw new Error(window.__nfc.error);
      if (cmd === 'nfc_share_text') window.__nfc.sent.push(args.text);
      if (cmd === 'nfc_read_tag') { window.__nfc.reads++; return window.__nfc.text; }
    };
  });
  if (bridge) await p.route('**/src/lib/nfc.ts*', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/import \{ invoke \} from [^;]+;/, 'const invoke = window.__nfcInvoke;');
    await route.fulfill({ response, body });
  });
  await p.route('**/src/state/data.ts*', async route => {
    const response = await route.fetch(); let body = await response.text();
    for (const n of ['useLearnData', 'useCampusData']) body = body.replace(`export function ${n}() {`, `export function ${n}() {return {data:${JSON.stringify(fixture)},state:'ready',error:null,reload:async()=>{}};`);
    await route.fulfill({ response, body });
  });
  return p;
}
async function go(p, query = 'page&page=schedule') {
  await p.goto(base + '/?explorer-preview=' + query);
  await p.waitForSelector('.explorer-shell');
  await p.waitForTimeout(1100);
}
async function measure(p, label, expectedLeft = 0) {
  const m = await p.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect().toJSON();
    const t = document.querySelector('.schedule-timeline');
    return { viewport: [innerWidth, innerHeight], timeline: r('.schedule-timeline'), canvas: r('.schedule-canvas'), content: r('.explorer-content'), chrome: r(document.documentElement.classList.contains('is-phone') ? '.explorer-topbar' : '.onego-bookmarks'), columns: [...document.querySelectorAll('.schedule-col')].map(e => e.getBoundingClientRect().toJSON()), scroll: t.scrollHeight - t.clientHeight, rootScroll: document.documentElement.scrollWidth - innerWidth, padBottom: parseFloat(getComputedStyle(document.querySelector('.explorer-content')).paddingBottom) || 0 };
  });
  geometry.push({ label, ...m });
  check(Math.abs(m.timeline.top - m.chrome.bottom) <= 1, label + ': 表头紧接导航，没有空标题或额外顶边');
  check(Math.abs(m.timeline.left - expectedLeft) <= 1 && Math.abs(m.timeline.right - m.viewport[0]) <= 1, label + ': 日程左右到内容区边缘');
  // 手机档给底栏留了净空（schedule.css 的 is-phone.is-schedule-page padding-bottom，
  // 让最后一节课不被底栏盖住），所以「撑满」的终点是内容盒底部，不是窗口底部。
  const bottomEdge = m.content.bottom - m.padBottom;
  check(Math.abs(m.timeline.bottom - bottomEdge) <= 1 && Math.abs(m.canvas.bottom - bottomEdge) <= 2, label + ': 行高撑满到窗口底边');
  check(m.columns.length === 7 && m.columns.every(c => Math.abs(c.width - m.canvas.width / 7) <= 1), label + ': 七列均分画布');
  check(m.scroll <= 1 && m.rootScroll <= 1, label + ': 没有溢出与伪滚动');
}
async function white(p, label) {
  await p.waitForTimeout(500);
  const texts = await p.locator('.schedule-block, .schedule-block *').evaluateAll(es => es.filter(e => e.textContent.trim()).map(e => ({ text: e.textContent, color: getComputedStyle(e).color, opacity: getComputedStyle(e).opacity })));
  check(texts.length > 5 && texts.every(t => t.color === 'rgb(255, 255, 255)' && +t.opacity === 1), label + ': 包括重叠块和详情小字在内全部纯白');
  check(await p.locator('.schedule-block[data-tx="keep"]').count() === await p.locator('.schedule-block').count(), label + ': 日程块明确豁免自动文字取色');
}
const card = name => ({ name, avatar: '', website: 'https://example.org', social: '', phone: '123', bio: '交换测试', updatedAt: Date.now() });
async function openRadar(p) { for(const title of ['接收内容',/^分享「/]){const dialog=p.getByRole('dialog',{name:title});if(await dialog.isVisible()){await p.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});}} if (!await p.locator('.vault-radar').isVisible()) await p.getByRole('button', { name: /^暂存箱，/ }).click(); await p.locator('.vault-radar').waitFor(); await p.waitForTimeout(400); }
async function receiveRadar(p) { await openRadar(p);await p.locator('.vault-radar').getByRole('button',{name:'接收',exact:true}).click();await p.getByRole('dialog',{name:'接收内容'}).waitFor(); }
async function closeFeedback(p) { await p.locator('.exchange-feedback button').click(); await p.waitForTimeout(350); }
try {
  for (const [w,h,label] of [[1280,860,'desktop'], [390,844,'phone'], [320,700,'phone-small'], [844,390,'landscape']]) {
    const p = await page(w,h); await go(p);
    await measure(p,label); await white(p,label);
    check(await p.locator('.schedule-block').count() >= 4, label + ': 不同课程、冲突与簇块均已渲染');
    await p.screenshot({ path: `${out}/schedule-${label}.png` });
    if (label === 'desktop') {
      await p.evaluate(() => { document.documentElement.dataset.ogScheme = 'dark'; document.documentElement.classList.add('dark'); });
      await white(p,'dark');
      await p.evaluate(() => {document.documentElement.style.setProperty('--og-content-on-accent','#000');document.querySelector('.schedule-block').classList.add('is-done')});
      await white(p,'主题覆盖/已完成块');
      await call(p,'/src/state/tabLayout.ts','setTabLayoutMode',['v']); await p.waitForTimeout(500);
      await measure(p,'vertical',232);
      await p.locator('.ex-rail-width').click(); await p.mouse.move(1000,300); await p.waitForTimeout(500);
      await measure(p,'vertical-narrow',56);
      await p.screenshot({ path: `${out}/schedule-vertical.png` });
      await p.locator('.schedule-dock button').first().click();
      await p.locator('.schedule-panel').waitFor();
      check(await p.locator('.schedule-panel').isVisible(),'日程筛选/周切换等设置仍可打开');
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
      await p.locator('.schedule-block').filter({hasText:'计算机网络'}).click();
      check(await p.getByRole('button',{name:'前往',exact:true}).isVisible() && await p.getByRole('button',{name:'寻迹',exact:true}).isVisible(),'课程前往与寻迹入口保留');
    }
    await p.close();
  }
  const p = await page(1280,860,true); await go(p,'home');
  await call(p,'/src/state/nameCard.ts','savePersonalCard',[card('测试名片')]);
  await p.getByRole('button',{name:'我的',exact:true}).last().click();
  await p.getByRole('button',{name:'NFC 分享',exact:true}).click();
  await p.locator('.exchange-feedback.is-ready').waitFor();
  const sent = await p.evaluate(() => window.__nfc.sent);
  check(/^ON(-[0-9A-Z]{4}){4}$/.test(sent[0]),'名片 NFC 只带 22 字符短码：'+sent[0]);
  const payload = await call(p,'/src/state/touch.ts','decodeTouch',[await call(p,'/src/state/cloudExchange.ts','resolveExchangeCode',[sent[0]])]);
  check(payload.payload.personal.name === '测试名片' && !payload.payload.vaultCode,'名片按钮直接发送当前名片，不混入暂存箱');
  check((await p.locator('.exchange-feedback').innerText()).includes('尚未收到对方确认'),'发送就绪不会误报对方已收到');
  await p.screenshot({path:`${out}/personal-nfc-ready.png`});
  await closeFeedback(p); await p.getByRole('button',{name:'复制名片口令',exact:true}).click();
  check(/^ON(-[0-9A-Z]{4}){4}$/.test(await p.evaluate(() => window.__copied.at(-1))),'名片同时提供可用的短口令替代入口');
  const avatar = await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 240;
    const ctx=c.getContext('2d'), image=ctx.createImageData(240,240);
    for(let i=0;i<image.data.length;i+=4){image.data[i]=(i*37)%251;image.data[i+1]=(i*71)%233;image.data[i+2]=(i*17)%197;image.data[i+3]=255}
    ctx.putImageData(image,0,0); return c.toDataURL('image/png');
  });
  check(avatar.length>30000,'大头像夹具超过 NFC 原始容量');
  await call(p,'/src/state/nameCard.ts','savePersonalCard',[{avatar}]);
  await p.getByRole('button',{name:'NFC 分享',exact:true}).click(); await p.locator('.exchange-feedback.is-ready').waitFor();
  const compact=await p.evaluate(()=>window.__nfc.sent.at(-1));
  check(/^ON(-[0-9A-Z]{4}){4}$/.test(compact),'大头像也只发 22 字符短码（内容在云盘，不在口令里）');
  const compactCard=await call(p,'/src/state/touch.ts','decodeTouch',[await call(p,'/src/state/cloudExchange.ts','resolveExchangeCode',[compact])]);
  check(compactCard.ok && compactCard.payload.personal.avatar===avatar,'大头像经云盘 manifest 完整送达，不再需要缩图');
  check((await call(p,'/src/state/nameCard.ts','cardsSnapshot')).personal.avatar===avatar,'NFC 发送不修改本机原名片');
  await closeFeedback(p);
  const oversized=await p.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').map(x=>x.name).find(x=>new URL(x).pathname.endsWith('/src/lib/nfc.ts'));
    try{await(await import(url)).nfcShareText('x'.repeat(30001));return false}catch(e){return e.message.includes('内容太大')}
  });
  check(oversized,'超大内联内容在桥接前拒绝，避免原生截断坏口令');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await call(p,'/src/state/vault.ts','addToVault',[{type:'text',title:'原有笔记',text:'保留我的内容'}]);
  const original = await call(p,'/src/state/vault.ts','activeVault');
  await openRadar(p);
  /* 清空剪贴板记录再点：否则上一段名片口令的短码还留在 __copied 里，会把失败蒙混过关 */
  await p.evaluate(() => { window.__copied.length = 0; });
  await p.locator('.vault-radar').getByRole('button',{name:'分享口令',exact:true}).click();
  await p.locator('.vault-share-code').waitFor();
  await p.waitForFunction(() => /^ON(-[0-9A-Z]{4}){4}$/.test(window.__copied.at(-1) ?? ''));
  check(await p.evaluate(() => window.__copied.length === 1), '雷达第一次分享就生成口令（适配器在小形态也会装）');
  const code = await p.evaluate(() => window.__copied.at(-1));
  await p.getByRole('button',{name:'复制口令',exact:true}).click(); await p.waitForTimeout(200);
  check(await p.evaluate(code => window.__copied.at(-1)===code,code),'雷达复制已有口令原样复用');
  const tabs = await p.locator('.ex-tab').count();
  await p.getByRole('button',{name:'NFC 传送',exact:true}).click();
  await p.locator('.exchange-feedback.is-ready').waitFor();
  check(await p.evaluate(code=>window.__nfc.sent.at(-1)===code,code),'雷达直接开启 NFC 传送');
  check(await p.locator('.ex-tab').count()===tabs,'交换过程无需打开暂存箱二级页面');
  await closeFeedback(p); await receiveRadar(p);
  const incoming = await call(p,'/src/lib/contentExchange.ts','personalShareCode',[card('新朋友')]);
  await p.evaluate(t=>window.__nfc.text=t,incoming);
  await p.getByRole('button',{name:'NFC 接收',exact:true}).click();
  await p.locator('.exchange-feedback.is-success').waitFor();
  const cards = await call(p,'/src/state/nameCard.ts','cardsSnapshot');
  check(JSON.stringify(cards.contacts).includes('新朋友'),'雷达直接接收名片并保存进通讯录');
  await closeFeedback(p); await receiveRadar(p);
  await p.evaluate(t=>window.__nfc.text=t,code);
  await p.getByRole('button',{name:'NFC 接收',exact:true}).click();
  await p.locator('.exchange-feedback.is-success').waitFor();
  const boxes = await call(p,'/src/state/vault.ts','vaultSnapshot');
  check(boxes.activeId!==original.id && boxes.boxes.find(b=>b.id===original.id).items[0].text==='保留我的内容','收到内容放入新箱，原箱及笔记仍完整保留');
  await closeFeedback(p); await receiveRadar(p);
  await p.evaluate(()=>window.__nfc.text='invalid');
  await p.getByRole('button',{name:'NFC 接收',exact:true}).click(); await p.locator('.exchange-feedback.is-error').waitFor();
  check((await call(p,'/src/state/vault.ts','vaultSnapshot')).boxes.length===boxes.boxes.length,'无效 NFC 内容显示失败，不新增空箱');
  await closeFeedback(p); await receiveRadar(p);
  await p.evaluate(()=>{window.__nfc.error='超时：10 秒内没有读到 NFC 内容'});
  await p.getByRole('button',{name:'NFC 接收',exact:true}).click(); await p.locator('.exchange-feedback.is-error').waitFor();
  check((await p.locator('.exchange-feedback').innerText()).includes('超时'),'桥接超时显示真实错误，可重试');
  await closeFeedback(p); await receiveRadar(p);
  await p.evaluate(()=>{window.__nfc.error='';window.__nfc.enabled=false;window.dispatchEvent(new Event('focus'))}); await p.waitForTimeout(200);
  check(await p.getByRole('button',{name:'NFC 接收',exact:true}).isDisabled() && (await p.getByRole('dialog',{name:'接收内容'}).innerText()).includes('系统设置开启 NFC'),'NFC 未开启有明确提示');
  await p.screenshot({path:`${out}/radar-desktop.png`});
  await call(p,'/src/state/vault.ts','addToVault',[{type:'text',title:'更新',text:'新的内容'}]);
  check(!(await call(p,'/src/state/vault.ts','activeVault')).lastShareCode,'编辑箱子后旧口令失效，避免发送旧快照');
  await p.close();
  const m=await page(390,844);await go(m,'home');await receiveRadar(m);
  check(await m.getByRole('button',{name:'NFC 接收',exact:true}).isDisabled() && (await m.getByRole('dialog',{name:'接收内容'}).innerText()).includes('此设备不支持 NFC'),'无 NFC 的真实浏览器保留入口并解释复制替代方式');
  const radar=await m.locator('.vault-radar').boundingBox();
  check(radar.x>=0&&radar.x+radar.width<=390&&radar.y+radar.height<=844,'手机雷达与新增操作完整在屏内');
  await m.screenshot({path:`${out}/radar-phone.png`});await m.close();
  check(errors.length===0,'无新增运行时异常：'+errors.join(';'));
} finally {
  writeFileSync(`${out}/report.json`,JSON.stringify({checks:results.length,results,errors,geometry,nfc:'NFC 桥接夹具，不代表真机互传验收'},null,2));
  await browser.close();
}
