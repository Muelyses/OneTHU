import { chromium } from 'playwright';
import { installFakeCloud } from './lib/fake-cloud.mjs';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await browser.newPage({ viewport: { width: 1280, height: 860 } });
p.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0, 200)));
p.on('console', m => { if (m.text().startsWith('BODYPROBE')) console.log(m.text()); });
await installFakeCloud(p);
await p.addInitScript(() => { performance.setResourceTimingBufferSize(10000); localStorage.setItem('onethu.onboarded.phone', '1'); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copied = t; } } }); });
await p.route('**/src/state/data.ts*', async route => {
  const r = await route.fetch(); let body = await r.text();
  for (const n of ['useLearnData', 'useCampusData']) body = body.replace(`export function ${n}() {`, `export function ${n}() {return {data:{semester:{id:'x'},courses:[],homework:[],notifications:[],files:[],schedule:[]},state:'ready',error:null,reload:async()=>{}};`);
  await route.fulfill({ response: r, body });
});
const call = (path, name, args = []) => p.evaluate(async ({ path, name, args }) => {
  const url = performance.getEntriesByType('resource').map(x => x.name).find(x => new URL(x).pathname.endsWith(path));
  return (await import(url))[name](...args);
}, { path, name, args });
await p.goto('http://127.0.0.1:5180/?explorer-preview=home');
await p.locator('.explorer-shell').waitFor(); await p.waitForTimeout(800);
await call('/src/state/explorer.ts', 'openTab', ['contacts', { section: 'orgs' }]);
await p.waitForTimeout(700);
await p.getByRole('button', { name: '新建组织', exact: true }).click();
await p.waitForSelector('.plg-form-modal');
await p.locator('.plg-form-modal input').first().fill('测试组织');
await p.getByRole('button', { name: '提交', exact: true }).click();
const dialog = p.getByRole('dialog', { name: '测试组织', exact: true });
await dialog.waitFor(); await p.waitForTimeout(500);
await dialog.getByRole('button', { name: '添加成员', exact: true }).click();
await p.waitForSelector('.plg-form-modal');
await p.locator('.plg-form-modal input').first().fill('小明');
const wobble = await p.evaluate(async () => {
  await new Promise(r => setTimeout(r, 1200)); /* 等超过动画时长再看是否还在动 */
  const btn = [...document.querySelectorAll('.plg-form-modal button')].find(b => b.textContent?.trim() === '提交');
  const samples = [];
  for (let i = 0; i < 8; i++) {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = btn.getBoundingClientRect();
    samples.push([Math.round(r.x * 100) / 100, Math.round(r.y * 100) / 100, Math.round(r.width * 100) / 100]);
  }
  const anim = btn.getAnimations({ subtree: false }).map(a => ({ name: (a.animationName ?? a.transitionProperty ?? '?'), state: a.playState, iterations: a.effect?.getComputedTiming?.().iterations }));
  const ancestors = [];
  let el = btn.parentElement;
  while (el && ancestors.length < 5) { ancestors.push({ cls: (el.className || el.tagName).toString().slice(0, 40), anims: el.getAnimations({ subtree: false }).map(a => (a.animationName ?? a.transitionProperty ?? '?') + ':' + a.playState) }); el = el.parentElement; }
  return { samples, anim, ancestors };
});
console.log('提交按钮采样:', JSON.stringify(wobble.samples));
console.log('自身动画:', JSON.stringify(wobble.anim));
console.log('祖先动画:', JSON.stringify(wobble.ancestors));
await p.getByRole('button', { name: '提交', exact: true }).click();
await p.waitForTimeout(800);
await p.screenshot({ path: 'tools/.dbg-org-fail.png' });
const probe = await p.evaluate(() => {
  {
    const body = document.querySelector('.og-panel-body');
    const seg2 = [...document.querySelectorAll('[role="radio"]')].find(e => e.textContent === '项目');
    const hint2 = [...document.querySelectorAll('.og-text--t-faint')].find(e => (e.textContent || '').includes('本机组织名册'));
    if (body) console.log('BODYPROBE ' + JSON.stringify({ bodyRect: body.getBoundingClientRect().toJSON(), scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, overflowY: getComputedStyle(body).overflowY, segRect: seg2.getBoundingClientRect().toJSON(), hintRect: hint2?.getBoundingClientRect().toJSON() }));
  }
  const seg = [...document.querySelectorAll('[role="radio"]')].find(e => e.textContent === '项目');
  const r = seg.getBoundingClientRect();
  const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const chain = [];
  let el = top;
  while (el && chain.length < 6) { chain.push((el.className || el.tagName).toString().slice(0, 46)); el = el.parentElement; }
  return { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, topChain: chain };
});
console.log('项目 radio:', JSON.stringify(probe.rect));
console.log('中心点最顶层链:', probe.topChain.join(' ← '));
await browser.close();
