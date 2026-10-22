/** Actual three-mode Schedule/Agenda + real secondary parser; isolated, gated calendar. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.ONETHU_PLAYWRIGHT_PATH
  ? pathToFileURL(process.env.ONETHU_PLAYWRIGHT_PATH).href : 'playwright');
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = process.env.ONETHU_TEST_OUT ?? '/tmp/onethu-secondary-schedule';
mkdirSync(out, { recursive: true });
const report = { checks: [], errors: [], screenshots: [] };
const check = (ok, name) => { assert.ok(ok, name); report.checks.push(name); console.log('✓ ' + name); };
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  for (const width of [1280, 390]) for (const mode of ['full', 'simple', 'practical']) {
    const label = `${width} ${mode}`;
    const p = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 }, timezoneId: 'Asia/Shanghai', hasTouch: width < 600, isMobile: width < 600 });
    p.setDefaultTimeout(15000);
    p.on('pageerror', e => report.errors.push(`${label}: ${e.message}`));
    await p.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
    await p.route(/^https?:\/\/(?!127\.0\.0\.1:5180|localhost:5180)/, r => r.abort());
    await p.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      localStorage.setItem('onethu.onboarded.phone', '1');
      localStorage.setItem('onethu.experience.v1', 'full');
      localStorage.setItem('onethu.privacy.v1', JSON.stringify({ acknowledged: true, cloud: true, oh: false }));
    });
    await p.goto(base + '/?explorer-preview=onboarding');
    await p.locator('.explorer-shell').waitFor();
    await p.evaluate(async ({ mode }) => {
      const mod = async path => {
        const url = performance.getEntriesByType('resource').map(r => r.name).findLast(u => new URL(u).pathname === path);
        if (!url) throw Error('Missing module: ' + path);
        return import(url);
      };
      window.__scheduleModule = mod;
      const data = await mod('/src/state/data.ts'), cache = await mod('/src/state/cache.ts');
      cache.setPreviewMode(true); data.seedPreviewData();
      cache.cacheInvalidate('calendar');
      const clients = await mod('/src/lib/clients.ts');
      const now = new Date(), monday = new Date(now); monday.setDate(now.getDate() - (now.getDay() + 6) % 7);
      const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      window.__today = ymd(now);
      let resolveCalendar;
      const calendar = new Promise(r => { resolveCalendar = r; });
      window.__resolveCalendar = () => resolveCalendar({ firstDay: ymd(monday), weekCount: 20, semesterId: 'test-secondary', semesterName: '测试学期', nextSemesterList: [] });
      clients.learn.getCalendarData = async () => calendar;
      clients.info.getSchedule = async () => { window.__primaryRequests = (window.__primaryRequests ?? 0) + 1; return []; };
      window.__secondaryRequests = 0;
      clients.http.text = async url => {
        if (!String(url).includes('bks_ejkbSearch')) throw Error('Unexpected network request');
        window.__secondaryRequests++;
        if (window.__secondaryFailure) return '<html>service unavailable</html>';
        const day = now.getDay() || 7;
        return `function setInitValue() {\nstrHTML = "<span onmouseover=\\"return overlib('04_54( 测试教室，第1周)');\\" onmouseout='return nd();'>二级选课浏览器验收</span>"; document.getElementById('a4_${day}').innerHTML += strHTML+"<br>";\n}`;
      };
      const experience = await mod('/src/state/experienceMode.ts'); experience.setExperienceMode(mode);
      if (mode === 'full') (await mod('/src/state/explorer.ts')).openTab('schedule', undefined, { forceNew: true });
      else experience.navigateSimple('schedule');
    }, { mode });
    const page = p.locator('.schedule-workspace:visible');
    await page.waitFor();
    await p.waitForFunction(() => window.__primaryRequests > 0);
    check(await p.evaluate(() => window.__secondaryRequests === 0), label + ': primary can load while calendar is pending');
    await p.evaluate(() => window.__resolveCalendar());
    const block = page.locator('.schedule-block').filter({ hasText: '二级选课浏览器验收' });
    await block.waitFor();
    check(await block.isVisible(), label + ': late calendar automatically adds the secondary course');
    const title = await block.getAttribute('title');
    check(title.includes('15:20') && title.includes('16:55'), label + ': actual parser retains session times');
    const settings = page.getByRole('button', { name: '日程设置', exact: true });
    const tap = async locator => width < 600 ? locator.tap() : locator.click();
    await tap(settings);
    const panel = p.locator('.schedule-panel:visible');
    await panel.waitFor();
    await tap(panel.getByRole('button', { name: '列表', exact: true }));
    await p.keyboard.press('Escape');
    const row = page.locator('[data-agenda-kind="course"]').filter({ hasText: '二级选课浏览器验收' });
    await row.waitFor();
    check((await row.innerText()).includes('15:20'), label + ': selected-day agenda includes the secondary course');
    check(await p.evaluate(() => window.__secondaryRequests >= 2), label + ': month window fetches secondary data');
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ': viewport remains within screen');
    await tap(row);
    await p.getByRole('dialog').filter({ hasText: '二级选课浏览器验收' }).waitFor();
    check(await p.getByRole('button', { name: '前往', exact: true }).isVisible(), label + ': secondary course opens an actionable detail');
    await p.keyboard.press('Escape');
    const shot = `${out}/${width}-${mode}.png`; await p.screenshot({ path: shot }); report.screenshots.push(shot);
    await p.close();
  }
  check(report.errors.length === 0, 'No browser runtime errors: ' + report.errors.join('; '));
  report.passed = true;
} catch (error) {
  for (const context of browser.contexts()) for (const p of context.pages()) {
    await p.screenshot({ path: out + '/failure.png' }).catch(() => {});
    console.log('Failure state:', await p.evaluate(() => ({
      text: document.body.innerText.slice(-5000), primary: window.__primaryRequests,
      secondary: window.__secondaryRequests,
    })).catch(() => null));
  }
  throw error;
} finally {
  writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
  await browser.close();
}
