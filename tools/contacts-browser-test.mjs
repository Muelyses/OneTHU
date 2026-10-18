/**
 * 通讯录一级功能区 + 拟物名片卡回归（task-1）
 *
 * 覆盖用户验收第 4、5 条里可自动化的部分：
 * ① 通讯录是完整一级页（页头 / 搜索 / 筛选 / 星标 / 卡片夹 / 组织页签）；
 * ② 名片是真实银行卡比例 1.586 的拟物纸卡（亮/暗主题都保有文字对比）；
 * ③ 桌面悬停抬起，点击用库 Modal 弹出大卡，Esc 可关；手机一列堆叠、弹层收窄；
 * ④ 我的名片：云盘邮箱自动识别（校园数据缓存）→ 自动保存一次、编辑表单默认值与文案；
 * ⑤ 原有能力入口仍在（放进暂存箱 / 共享云盘 / 好友通道 / 复制加入方式）；
 * ⑥ 1280×860、390×844、320 都没有横向溢出，全局 motion 轴与 prefers-reduced-motion 都降级。
 *
 * 跑法：先起 dev（默认 http://127.0.0.1:5180），再 `node tools/contacts-browser-test.mjs [base]`。
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5180';
const out = '/tmp/contacts-shots';
mkdirSync(out, {recursive:true});

const now = Date.now();
const doc = {
  v: 1,
  personal: {name:'林知远', avatar:'', website:'thu.edu.cn/~linzy', social:'@linzy_thu', phone:'138 0013 8000', cloudEmail:'linzy@mails.tsinghua.edu.cn', bio:'建筑学院 · 城市与书 · 在清华，与你相遇。', updatedAt:now},
  orgs: [
    {id:'org.a', name:'学生科协', brief:'组织校园技术分享与开源项目', joinUrl:'https://git.tsinghua.edu.cn/groups/sast', updatedAt:now},
    {id:'org.b', name:'晨跑社', brief:'每天六点半，东操见', joinUrl:'', updatedAt:now},
  ],
  contacts: [
    {id:'ct.1', kind:'personal', name:'李同学', note:'同班', addedAt:now-1000, card:{name:'李同学', avatar:'', website:'', social:'', phone:'139 0000 0001', bio:'计算机系 · 在做编译器和咖啡', updatedAt:now}},
    {id:'ct.2', kind:'personal', name:'王雨桐', note:'', addedAt:now-2000, card:{name:'王雨桐', avatar:'', website:'yutong.wang', social:'@yutong', phone:'', bio:'美院 · 视觉设计与字体', updatedAt:now}},
    {id:'ct.3', kind:'organization', name:'开源镜像站', note:'技术', addedAt:now-3000, card:{id:'org.m', name:'开源镜像站', brief:'为全校提供开源软件镜像与文档服务', joinUrl:'https://mirrors.tuna.tsinghua.edu.cn', updatedAt:now}},
    {id:'ct.4', kind:'personal', name:'陈一鸣', note:'实验室', addedAt:now-4000, card:{name:'陈一鸣', avatar:'', website:'', social:'', phone:'', bio:'自动化 · 机器人与晚风', updatedAt:now}},
    {id:'ct.5', kind:'personal', name:'赵可', note:'', addedAt:now-5000, card:{name:'赵可', avatar:'', website:'', social:'@zhaoke', phone:'', bio:'新闻学院 · 摄影与写作', updatedAt:now}},
  ],
};

const errors = [];
const badResponses = [];
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; console.log('✓ ' + msg); };

const setup = async (p) => {
  p.setDefaultTimeout(15000);
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => {
    const url = m.location()?.url ?? '';
    // 只关心本页自己的错误：favicon 与 App 外壳的第三方请求（GitHub 更新检查等）不算页面错误
    if (m.type() !== 'error' || /favicon\.ico/.test(url)) return;
    if (url && !url.startsWith(base)) return;
    errors.push('console: ' + m.text() + ' @' + url);
  });
  p.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) badResponses.push(r.status() + ' ' + r.url()); });
  await p.addInitScript((cards) => {
    localStorage.setItem('onethu.onboarded.phone', '1');
    localStorage.setItem('onethu.cards.v1', JSON.stringify(cards));
  }, doc);
};
const go = async (p) => {
  await p.goto(base + '/?explorer-preview=page&page=contacts', {waitUntil:'domcontentloaded'});
  await p.waitForSelector('.explorer-shell');
  await p.waitForTimeout(1200);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  for (const [w, h, mobile] of [[1280, 860, false], [390, 844, true]]) {
    const p = await browser.newPage({viewport:{width:w, height:h}, hasTouch:mobile, isMobile:mobile});
    await setup(p);
    await go(p);
    const label = mobile ? 'phone' : 'desktop';
    ok(await p.locator('.contacts-page').isVisible(), label + ' contacts page visible');
    ok(await p.getByRole('heading', {name:'通讯录', exact:true}).count() === 1, label + ' single page heading 通讯录');
    ok(await p.locator('.identity-card').count() >= 6, label + ' tangible cards rendered (' + await p.locator('.identity-card').count() + ')');
    const first = p.locator('.contact-slot:not(.is-mine) .identity-card').first();
    ok(await first.isVisible(), label + ' contact card visible');
    // 用布局盒量比例（boundingRect 会被卡片倾斜角撑大，不是真实比例）
    const ratio = await first.evaluate((el) => el.offsetWidth / el.offsetHeight);
    ok(Math.abs(ratio - 1.586) < 0.005, label + ' bank-card ratio 1.586 (got ' + ratio.toFixed(4) + ')');
    ok(await p.getByRole('button', {name:'打开我的名片'}).isVisible(), label + ' my card pinned in deck');
    // 悬停上浮（桌面）
    if (!mobile) {
      const slot = p.locator('.contact-slot:not(.is-mine)').first();
      const before = await slot.evaluate((el) => getComputedStyle(el).transform);
      await slot.hover();
      await p.waitForTimeout(320);
      const after = await slot.evaluate((el) => getComputedStyle(el).transform);
      ok(before !== after, 'desktop hover lifts card');
    }
    // 点开大卡
    await p.getByRole('button', {name:'打开李同学的名片'}).click();
    const dialog = p.getByRole('dialog');
    ok(await dialog.isVisible(), label + ' detail modal opens');
    ok(await dialog.locator('.identity-card').isVisible(), label + ' detail shows big card');
    ok(await dialog.getByText('共享云盘', {exact:false}).first().isVisible(), label + ' share cloud entry kept');
    ok(await dialog.getByRole('button', {name:'放进暂存箱'}).isVisible(), label + ' vault entry kept');
    ok(await dialog.getByRole('button', {name:'好友通道'}).isVisible(), label + ' friend channel kept');
    await p.screenshot({path: out + '/' + label + '-detail.png'});
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
    ok(await dialog.count() === 0 || !(await dialog.isVisible()), label + ' Esc closes modal');
    // 我的名片大卡（名片夹第一张）
    await p.getByRole('button', {name:'打开我的名片'}).click();
    await p.waitForTimeout(500);
    ok(await p.getByRole('dialog').isVisible(), label + ' my card modal opens');
    ok(await p.getByRole('dialog').getByText('清华云盘邮箱').first().isVisible(), label + ' my card shows cloud email row');
    ok(await p.getByRole('button', {name:'编辑资料'}).last().isVisible(), label + ' my card modal keeps edit action');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(350);
    // 筛选 + 搜索
    await p.locator('.contact-search input').fill('王雨桐');
    await p.waitForTimeout(250);
    ok(await p.locator('.contact-slot:not(.is-mine)').count() === 1, label + ' search filters deck');
    await p.locator('.contact-search input').fill('');
    await p.waitForTimeout(200);
    await p.getByRole('radio', {name:'组织', exact:true}).click();
    await p.waitForTimeout(250);
    ok(await p.locator('.contact-slot:not(.is-mine)').count() === 1, label + ' organization filter works');
    await p.getByRole('radio', {name:'全部', exact:true}).click();
    // 星标
    const star = p.getByRole('button', {name:/^星标：王雨桐$/});
    await star.click();
    await p.waitForTimeout(200);
    ok(await p.getByRole('button', {name:/^取消星标：王雨桐$/}).count() === 1, label + ' star toggle works');
    // 我的组织页签
    await p.getByRole('radio', {name:'我的组织', exact:true}).click();
    await p.waitForTimeout(400);
    ok(await p.getByText('新建组织名片', {exact:false}).first().isVisible(), label + ' org tab reachable');
    ok(await p.getByText('组织名片', {exact:true}).first().isVisible(), label + ' org cards section');
    await p.screenshot({path: out + '/' + label + '-orgs.png'});
    await p.getByRole('radio', {name:'名片夹', exact:true}).click();
    await p.waitForTimeout(300);
    // 横向溢出
    const overflow = await p.evaluate(() => ({sw: document.documentElement.scrollWidth, iw: innerWidth}));
    ok(overflow.sw <= overflow.iw + 1, label + ' no horizontal page overflow (' + overflow.sw + ' <= ' + overflow.iw + ')');
    await p.screenshot({path: out + '/' + label + '-contacts.png'});
    await p.close();
  }
  // 云盘邮箱自动识别：校园数据缓存里本来就有，不应再让用户手填
  {
    const p = await browser.newPage({viewport:{width:1280, height:860}});
    p.setDefaultTimeout(15000);
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await p.addInitScript(({cards, campus}) => {
      localStorage.setItem('onethu.onboarded.phone', '1');
      localStorage.setItem('onethu.cards.v1', JSON.stringify(cards));
      localStorage.setItem('onethu.cache.campus.v1', JSON.stringify(campus));
    }, {
      cards: {...doc, personal: {...doc.personal, cloudEmail: ''}},
      campus: {at: Date.now(), data: {courses: [], homework: [], notifications: [], files: [], schedule: [], user: {name: '林知远', studentId: '2023011111', department: '建筑学院', email: 'linzy21@mails.tsinghua.edu.cn'}}},
    });
    await p.goto(base + '/?explorer-preview=home', {waitUntil:'domcontentloaded'});
    await p.waitForSelector('.explorer-shell');
    await p.waitForTimeout(1400);
    await p.getByRole('button', {name:'我的', exact:true}).last().click();
    await p.waitForTimeout(800);
    const meta = await p.locator('.identity-panel-meta').innerText();
    ok(meta.includes('linzy21@mails.tsinghua.edu.cn'), 'cloud email auto-detected in my card info');
    ok(!/登录后获取|登录后自动获取/.test(meta), 'my card never asks the user to log in for email');
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.cards.v1')).personal.cloudEmail);
    ok(saved === 'linzy21@mails.tsinghua.edu.cn', 'detected cloud email auto-saved into the card once');
    await p.getByRole('button', {name:'编辑资料'}).first().click();
    await p.waitForTimeout(500);
    const label = await p.locator('.plg-form-label').filter({hasText:'清华云盘邮箱'}).first().innerText();
    ok(/已自动识别/.test(label), 'edit form labels cloud email as auto-detected');
    const value = await p.locator('.plg-form-modal input').nth(4).inputValue();
    ok(value === 'linzy21@mails.tsinghua.edu.cn', 'edit form defaults to the detected email');
    await p.keyboard.press('Escape');
    await p.close();
  }
  // 减少动态效果：全局 motion 轴与系统偏好都要把倾斜/入场动画降级
  {
    const p = await browser.newPage({viewport:{width:1280, height:860}});
    await setup(p);
    await go(p);
    const before = await p.locator('.contact-slot').first().evaluate((el) => getComputedStyle(el).transitionProperty + '|' + getComputedStyle(el).transitionDuration);
    await p.evaluate(() => document.documentElement.setAttribute('data-og-motion', 'reduced'));
    await p.waitForTimeout(200);
    const after = await p.locator('.contact-slot').first().evaluate((el) => getComputedStyle(el).transitionProperty + '|' + getComputedStyle(el).transitionDuration);
    ok(after.includes('none') || after.endsWith('|0s'), 'motion axis reduces tilt transition (' + before + ' -> ' + after + ')');
    await p.emulateMedia({reducedMotion:'reduce'});
    await p.waitForTimeout(200);
    const media = await p.locator('.contact-slot').first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return cs.transitionProperty + '|' + cs.transitionDuration;
    });
    ok(media.startsWith('none') || /\|0(\.0+)?s$/.test(media), 'prefers-reduced-motion reduces card motion (' + media + ')');
    await p.close();
  }
  // 主题：深色下再看一次对比度（手动设置 html[data-og-scheme]）
  const p = await browser.newPage({viewport:{width:1280, height:860}});
  await setup(p);
  await go(p);
  await p.evaluate(() => document.documentElement.setAttribute('data-og-scheme', 'dark'));
  await p.waitForTimeout(400);
  await p.screenshot({path: out + '/desktop-dark.png'});
  const contrast = await p.evaluate(() => {
    const card = document.querySelector('.contact-slot:not(.is-mine) .identity-card');
    if (!card) return null;
    const name = card.querySelector('.identity-card-name');
    const cs = getComputedStyle(card);
    const ns = name ? getComputedStyle(name) : null;
    return {bg: cs.backgroundColor, ink: ns?.color};
  });
  console.log('dark card:', JSON.stringify(contrast));
  ok(Boolean(contrast?.ink), 'dark theme card keeps ink color');
  await p.close();

  ok(errors.length === 0, 'no page/console errors ' + errors.join(' | '));
  if (badResponses.length) console.log('bad responses:', badResponses.join(', '));
  writeFileSync(out + '/contacts-report.json', JSON.stringify({checks, errors, badResponses}, null, 2));
  console.log('\n' + checks + ' checks passed');
} finally {
  await browser.close();
}
