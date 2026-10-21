/**
 * THUBook 目录解析护栏（Vite 必须跑在 5180）。
 *
 * 2026-10-17 用户实录：目录标题重复、层级混乱。根因是旧实现把「每个分组页的整站侧边栏」
 * 合并进每个组。现在只认首页 navbar 的下拉菜单（完整两级目录），本测试用最小 fixture
 * 钉住：分组=组、根页=根页、跨组重复路径只留一次、外链/侧边栏干扰不进来。
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const base = process.argv[2] ?? 'http://127.0.0.1:5180';
let checks = 0;
const errors = [];
const check = (cond, msg) => { assert.ok(cond, msg); checks++; console.log('✓ ' + msg); };

const CHILD = `<!doctype html><html><head><title>清华校历</title></head><body>
<main class="theme-hope-content"><h1>清华校历</h1><p>已完成加载</p></main></body></html>`;

const FIXTURE = `<!doctype html><html><head><title>🍺THU手册 - 测试站</title></head><body>
<nav class="navbar"><div class="navbar-items">
  <div class="nav-item"><a class="nav-link" href="/thubook/">🍺THU手册</a></div>
  <div class="nav-item"><a class="nav-link" href="/thubook/words.html">📕新生词典</a></div>
  <div class="nav-item"><div class="dropdown-wrapper">
    <button class="dropdown-title" aria-label="专题"><span class="title">专题</span>
      <ul class="nav-dropdown">
        <li class="dropdown-item"><a class="nav-link" href="/thubook/%E4%B8%93%E9%A2%98/xiaoli.html">清华校历</a></li>
        <li class="dropdown-item"><a class="nav-link" href="/thubook/%E4%B8%93%E9%A2%98/lib.html#top">图书馆</a></li>
        <li class="dropdown-item"><a class="nav-link" href="/thubook/words.html">重复页</a></li>
      </ul>
    </button>
  </div></div>
  <div class="nav-item"><div class="dropdown-wrapper">
    <button class="dropdown-title" aria-label="其他"><span class="title">其他</span>
      <ul class="nav-dropdown">
        <li class="dropdown-item"><a class="nav-link" href="/thubook/%E5%85%B6%E4%BB%96/park.html">北京公园推荐</a></li>
      </ul>
    </button>
  </div></div>
  <div class="nav-item"><a class="nav-link" href="https://thubook.help/admin">✏️贡献内容</a></div>
</div></nav>
<aside class="sidebar"><ul class="sidebar-links">
  <li><a class="sidebar-link sidebar-page" href="/thubook/">手册</a></li>
  <li><section class="sidebar-group"><button class="sidebar-heading"><span class="title">专题</span></button>
    <ul class="sidebar-links"><li><a class="sidebar-link sidebar-page" href="/thubook/专题/all.html">全站干扰链接</a></li></ul>
  </section></li>
</ul></aside>
<main class="theme-hope-content"><h1>首页正文</h1></main></body></html>`;

const browser = await chromium.launch({executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true});
try {
  /* ① 纯解析：navbar 优先、去重、规范化、过滤外链/侧边栏干扰 */
  const p = await browser.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '/', {waitUntil: 'domcontentloaded'});
  const toc = await p.evaluate(async (html) => {
    const m = await import('/src/lib/thubookToc.ts');
    return m.parseThubookToc(html);
  }, FIXTURE);
  check(toc.title === '🍺THU手册', 'title parsed');
  check(toc.pages.length === 2 && toc.pages[0].path === '/thubook/' && toc.pages[1].path === '/thubook/words', 'root pages keep nav order and normalize .html');
  check(toc.groups.length === 2 && toc.groups[0].label === '专题' && toc.groups[1].label === '其他', 'groups follow nav order');
  check(toc.groups[0].items.length === 2 && toc.groups[0].items[0].path === '/thubook/专题/xiaoli', 'group children decoded, hash stripped');
  check(!toc.groups[0].items.some((x) => x.path === '/thubook/words'), 'duplicate page across root/group kept once');
  check(!JSON.stringify(toc).includes('全站干扰链接'), 'sidebar copy is not merged into groups');
  check(!JSON.stringify(toc).includes('/admin') && !JSON.stringify(toc).includes('贡献内容'), 'external nav link excluded');

  /* ② 端到端：首页一次请求渲染完整两级目录；搜索/翻页照常 */
  const m = await browser.newPage({viewport: {width: 1280, height: 840}});
  m.on('pageerror', (e) => errors.push(e.message));
  await m.route('https://thubook.help/**', async (route) => {
    const u = route.request().url();
    if (u.startsWith('https://thubook.help/thubook/') && !u.replace(/\?.*$/, '').endsWith('/thubook/')) {
      return route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: CHILD});
    }
    return route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE});
  });
  await m.goto(base + '/?explorer-preview=page&page=thubook', {waitUntil: 'domcontentloaded'});
  await m.waitForSelector('.thubook-shell', {timeout: 20000});
  await m.waitForTimeout(900);
  const tocInfo = await m.evaluate(() => ({
    pages: document.querySelectorAll('.thubook-toc-list > .thubook-toc-page').length,
    groups: [...document.querySelectorAll('.thubook-toc-group-label')].map((e) => e.textContent),
    children: [...document.querySelectorAll('.thubook-toc-group .is-child')].map((e) => e.textContent),
    labels: [...document.querySelectorAll('.thubook-toc-page')].map((e) => e.textContent),
    meta: document.querySelector('.workbench-board-head, .page-head')?.textContent?.slice(0, 120) ?? '',
  }));
  check(tocInfo.pages === 2 && tocInfo.groups.join('|') === '专题|其他', 'rendered TOC mirrors parsed hierarchy');
  check(tocInfo.children.length === 3 && tocInfo.labels.length === new Set(tocInfo.labels).size, 'rendered TOC has no duplicate titles');
  /* 搜索：只留命中的页面按钮（组标题跟着结果走） */
  await m.locator('.thubook-toc input').first().fill('校历');
  await m.waitForTimeout(250);
  const hits = await m.locator('.thubook-toc-list .thubook-toc-page').allInnerTexts();
  check(hits.length === 1 && hits[0] === '清华校历', 'TOC search filters by title');
  /* 点开子页：路径规范化后真的能取到正文 */
  await m.locator('.thubook-toc-list .thubook-toc-page').first().click();
  await m.waitForTimeout(700);
  check((await m.locator('.thubook-body').innerText()).includes('已完成加载'), 'loading a group child works');
  check(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.join(';') : ''));
  console.log(checks + ' thubook toc assertions passed');
} finally {
  await browser.close();
}
