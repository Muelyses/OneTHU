/**
 * 手机端文字/排布统一策略回归（2026-10-19 用户点名）：
 *  「手机版很多文字省略号回来了」+「很多文字在左边挤成一堆，右边单独放一个组件」
 *
 * 覆盖：
 *  ① 390 / 320 两档下，通讯录、云盘、暂存箱、组织页都不横向溢出；
 *  ② 有内容的文字不再「单行省略号」硬裁（text-overflow:ellipsis 且实际被裁）；
 *  ③ 键值对（组织概况 / 名片信息）手机端改为上下排、左对齐，不再把值挤到右边缘；
 *  ④ 列表行（Row）文字与右件同行时，文字至少拿到行宽的一半；
 *  ⑤ 名片按钮组是等宽网格（手机两列、桌面四列），不再参差。
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { installFakeCloud } from './lib/fake-cloud.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5180';
let checks = 0;
const errors = [];
const check = (c, m) => { assert.ok(c, m); checks++; console.log('✓ ' + m); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });

const now = Date.now();

function seedScript(now) {
  performance.setResourceTimingBufferSize(10000);
  localStorage.setItem('onethu.onboarded.phone', '1');
  localStorage.setItem('onethu.cards.v1', JSON.stringify({ v: 1,
    personal: { name: '欧阳修远·计算机系', avatar: '', website: 'https://example.com/very/long/path/that/keeps/going/on', social: '@ouyang', phone: '13800000000', bio: '清华大学计算机科学与技术系博士研究生，研究方向是分布式系统与存储', updatedAt: now },
    orgs: [],
    contacts: [],
  }));
  localStorage.setItem('onethu.orgs.v1', JSON.stringify({ v: 1, orgs: [{ id: 'org.1', name: '学生开源软件协会清华大学分会', brief: '开源爱好者的组织', ownerEmail: 'tester@mails.tsinghua.edu.cn',
    members: [
      { id: 'm1', name: '欧阳修远', email: 'tester@mails.tsinghua.edu.cn', role: 'owner', joinedAt: now },
      { id: 'm2', name: '司马相如', email: 'simaxiangru@mails.tsinghua.edu.cn', role: 'member', joinedAt: now },
      { id: 'm3', name: '诸葛孔明', email: 'zhugekongming@mails.tsinghua.edu.cn', role: 'guest', joinedAt: now },
    ],
    libraries: [{ repoId: 'r1', name: '协会共享资料库（会议记录、设计稿、往期活动照片）', addedAt: now }],
    gitlabRepos: [], projects: [], announcements: [], createdAt: now }] }));
}

async function setup(width) {
  const p = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
  p.setDefaultTimeout(12000);
  p.on('pageerror', (e) => errors.push(e.message));
  await installFakeCloud(p, { token: 'test-token' });
  await p.addInitScript(seedScript, now);
  await p.route('**/src/state/data.ts*', async (route) => {
    const r = await route.fetch();
    let body = await r.text();
    for (const n of ['useLearnData', 'useCampusData']) body = body.replace(`export function ${n}() {`, `export function ${n}() { return {data:{semester:{id:'x'},courses:[],homework:[],notifications:[],files:[],schedule:[]},state:'ready',error:null,reload:async()=>{}};`);
    await route.fulfill({ response: r, body });
  });
  await p.goto(`${base}/?explorer-preview=page&page=contacts`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.explorer-shell');
  await p.waitForTimeout(900);
  return p;
}

/** 页面里可见的「单行省略」文字（text-overflow 真的在裁） */
async function singleLineTruncated(p) {
  return await p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
      if (el.children.length) continue;
      const cs = getComputedStyle(el);
      if (cs.textOverflow !== 'ellipsis') continue;
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      out.push({ cls: String(el.className).slice(0, 60), text: (el.textContent ?? '').slice(0, 30) });
    }
    return out;
  });
}

async function noOverflow(p, label) {
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(over <= 1, `${label} 无横向溢出（溢出 ${over}px）`);
}

for (const width of [390, 320]) {
  const p = await setup(width);
  try {
    /* 通讯录（名片夹）：名片信息键值对上下排 */
    const card = await p.evaluate(() => {
      const kv = document.querySelector('.og-kv');
      return { cov: kv ? getComputedStyle(kv).gridTemplateColumns : '', cols: kv ? getComputedStyle(kv).gridTemplateColumns.split(' ').length : -1 };
    });
    if (card.cov) check(card.cols === 1, `${width} 通讯录名片信息是单列（上下排）`);
    await noOverflow(p, `${width} 通讯录`);

    /* 云盘：页头标题/元信息/按钮上下排，不横向溢出 */
    await p.goto(`${base}/?explorer-preview=page&page=cloud`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.explorer-shell'); await p.waitForTimeout(800);
    await noOverflow(p, `${width} 云盘`);
    const head = await p.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((x) => (x.textContent ?? '').includes('清华云盘'));
      const row = h?.closest('.og-inline');
      if (!row) return null;
      const items = [...row.children].filter((c) => c instanceof HTMLElement && c.getBoundingClientRect().height > 0);
      return { display: getComputedStyle(row).display, items: items.length };
    });
    check(head?.display === 'grid', `${width} 云盘页头在手机上上下排`);

    /* 暂存箱：不横向溢出 */
    await p.goto(`${base}/?explorer-preview=page&page=vault`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.explorer-shell'); await p.waitForTimeout(700);
    await noOverflow(p, `${width} 暂存箱`);

    /* 组织页：概况键值对单列、成员行文字不被右件挤成窄条 */
    await p.goto(`${base}/?explorer-preview=page&page=contacts`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.explorer-shell'); await p.waitForTimeout(800);
    await p.getByRole('radio', { name: '我的组织', exact: true }).click();
    await p.waitForTimeout(600);
    const orgEntry = p.getByRole('button', { name: /管理组织|打开.*的组织主页/ }).first();
    if (await orgEntry.count()) await orgEntry.click();
    else await p.locator('.og-row--interactive').first().click();
    await p.waitForTimeout(900);
    check(await p.locator('.org-tabs').count() > 0, `${width} 组织页可从通讯录进入`);
    const orgKv = await p.evaluate(() => {
      const kv = document.querySelector('.og-kv');
      return kv ? getComputedStyle(kv).gridTemplateColumns.split(' ').length : -1;
    });
    if (orgKv !== -1) check(orgKv === 1, `${width} 组织概况键值对单列`);
    const overs = await singleLineTruncated(p);
    check(overs.length === 0, `${width} 组织页没有内容文字被单行省略号裁掉${overs.length ? '：' + JSON.stringify(overs.slice(0, 3)) : ''}`);
    /* 成员页：文字 + 右件同行时，文字至少占行宽一半 */
    await p.getByRole('radio', { name: '成员', exact: true }).click();
    await p.waitForTimeout(500);
    const squeezed = await p.evaluate(() => {
      const bad = [];
      for (const row of document.querySelectorAll('.og-row')) {
        const main = row.querySelector('.og-row-main');
        const trail = row.querySelector('.og-row-trailing');
        if (!main || !trail) continue;
        const rr = row.getBoundingClientRect(), mr = main.getBoundingClientRect(), tr = trail.getBoundingClientRect();
        if (rr.width < 100) continue;
        const sameLine = Math.abs(mr.top - tr.top) < 8;
        if (sameLine && mr.width < rr.width * 0.5 && tr.width > 40) bad.push({ row: (row.textContent ?? '').slice(0, 40), mw: Math.round(mr.width), tw: Math.round(tr.width) });
      }
      return bad;
    });
    check(squeezed.length === 0, `${width} 成员行文字没有被右件挤成窄条${squeezed.length ? '：' + JSON.stringify(squeezed.slice(0, 2)) : ''}`);
  } finally {
    await p.close();
  }
}

/* 名片按钮组：手机两列等宽、桌面四列等宽 */
{
  const p = await setup(390);
  try {
    await p.getByRole('button', { name: '我的' }).first().click();
    await p.waitForTimeout(400);
    await p.locator('.settings-seg-item').filter({ hasText: '我的名片' }).first().click();
    await p.waitForTimeout(600);
    const grid = await p.evaluate(() => {
      const g = document.querySelector('.identity-panel-actions');
      const cs = g ? getComputedStyle(g) : null;
      const widths = [...(g?.querySelectorAll(':scope > .og-btn') ?? [])].map((b) => Math.round(b.getBoundingClientRect().width));
      return { cols: cs ? cs.gridTemplateColumns.split(' ').length : -1, widths };
    });
    check(grid.cols === 2 && grid.widths.every((w) => Math.abs(w - grid.widths[0]) <= 1), '390 名片按钮组两列等宽');
    /* 设置：「使用模式」默认收起；栏目切换用下拉，不再是横向小 segment */
    await p.locator('.settings-seg-item').filter({ hasText: '个人设置' }).first().click();
    await p.waitForTimeout(700);
    const modeBox = await p.evaluate(() => ({
      picker: Boolean(document.querySelector('.experience-mode-picker')),
      summary: Boolean(document.querySelector('.experience-mode-control')),
      text: document.querySelector('.experience-mode-control')?.textContent?.slice(0, 40) ?? '',
    }));
    check(modeBox.summary && !modeBox.picker && modeBox.text.includes('当前：'), '390 设置的「使用模式」默认收起为一行摘要');
    const navBox = await p.evaluate(() => ({
      select: Boolean(document.querySelector('.workbench-settings-phone-nav select')),
      desktopNav: Boolean(document.querySelector('.workbench-settings-nav')),
    }));
    check(navBox.select && !navBox.desktopNav, '390 设置栏目用下拉选择（不再横向 segment）');
    await p.locator('.workbench-settings-phone-nav select').selectOption('外观');
    await p.waitForTimeout(500);
    check((await p.locator('.workbench-settings-title h2').innerText()) === '外观', '390 设置栏目下拉可切换内容');
  } finally { await p.close(); }
}
{
  const p = await setup(1280);
  try {
    await p.getByRole('button', { name: '我的' }).first().click();
    await p.waitForTimeout(400);
    await p.locator('.settings-seg-item').filter({ hasText: '我的名片' }).first().click();
    await p.waitForTimeout(600);
    const grid = await p.evaluate(() => {
      const g = document.querySelector('.identity-panel-actions');
      const cs = g ? getComputedStyle(g) : null;
      const widths = [...(g?.querySelectorAll(':scope > .og-btn') ?? [])].map((b) => Math.round(b.getBoundingClientRect().width));
      return { cols: cs ? cs.gridTemplateColumns.split(' ').length : -1, widths };
    });
    check(grid.cols === 4 && grid.widths.every((w) => Math.abs(w - grid.widths[0]) <= 1), '桌面名片按钮组四列等宽');
  } finally { await p.close(); }
}

check(errors.length === 0, '无运行时错误 ' + JSON.stringify(errors.slice(0, 3)));
await browser.close();
console.log(`\n${checks} phone layout assertions passed`);
