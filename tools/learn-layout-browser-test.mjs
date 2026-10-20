/** Actual Learn page layout and navigation, using isolated demo data.
 * Run with Vite: node tools/learn-layout-browser-test.mjs
 * OH, school requests and the user's persistent profile are not used.
 * Chromium exercises the Windows engine family, not a native Windows machine.
 */
import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180";
const out = process.env.ONETHU_TEST_OUTPUT ?? "/tmp/onethu-pr57-layout";
mkdirSync(out, { recursive: true });
const requestedEngines = process.env.LAYOUT_ENGINES?.split(",").map((value) => value.trim());
const hasWebKit = existsSync(webkit.executablePath());
if (requestedEngines) {
  assert.ok(requestedEngines.every((name) => name === "chromium" || name === "webkit"), "LAYOUT_ENGINES must name chromium or webkit");
  assert.ok(!requestedEngines.includes("webkit") || hasWebKit, "WebKit was requested but its browser executable is unavailable");
}
const engines = [
  ["chromium", chromium, { executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }],
  ...(hasWebKit ? [["webkit", webkit, {}]] : []),
].filter(([name]) => !requestedEngines || requestedEngines.includes(name));
assert.ok(engines.length > 0, "At least one browser engine must be selected");
const supportedWidths = [[1920,1],[1536,1.25],[1280,1.5],[900,1],[780,1],[390,1]];
const requestedWidths = process.env.LAYOUT_WIDTHS?.split(",").map((value) => Number(value.trim()));
if (requestedWidths) {
  assert.ok(requestedWidths.every((width) => supportedWidths.some(([supported]) => supported === width)), "LAYOUT_WIDTHS contains an unsupported or empty width");
}
const widths = supportedWidths.filter(([width]) => !requestedWidths || requestedWidths.includes(width));
assert.ok(widths.length > 0, "At least one viewport width must be selected");
let count = 0;
const results = [];
const check = (value, label) => { assert.ok(value, label); count++; };
async function setup(browser, width, scale = 1) {
  const page = await browser.newPage({ viewport:{width, height:900}, deviceScaleFactor:scale, hasTouch:width < 600 });
  page.setDefaultTimeout(12000);
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.addInitScript(() => {
    localStorage.setItem("onethu.onboarded.phone", "1");
    localStorage.setItem("onethu.experience.v1", "full");
    localStorage.setItem("onethu.overlay.closed", "1");
  });
  await page.goto(base + "/?explorer-preview=onboarding");
  await page.locator(".explorer-shell").waitFor();
  await page.evaluate(async () => {
    // Match the module URLs used by the mounted application, including Vite's
    // HMR version query. Importing the bare path can create a second store.
    const loadedModule = (path) => performance.getEntriesByType("resource")
      .filter((entry) => new URL(entry.name).pathname === path).at(-1)?.name
      ?? new URL(path, location.href).href;
    window.__learnFixtureSources = Object.fromEntries(["cache", "data", "exthw", "explorer"]
      .map((name) => [name, loadedModule(`/src/state/${name}.ts`)]));
    const cache = await import(window.__learnFixtureSources.cache);
    cache.setPreviewMode(true);
    const data = await import(window.__learnFixtureSources.data);
    data.seedPreviewData();
    const bundle = data.getLearnSnapshot();
    bundle.courses = Array.from({length:9}, (_, i) => ({
      id:`fixture-${i}`,
      name:i === 2 ? "现代工程系统设计与跨学科研究方法（国际联合培养专题课程）" : ["高等数学A(1)", "大学物理B(1)", "程序设计基础", "线性代数"][i % 4] + ` · ${i + 1}`,
      englishName:"Course " + i, courseNumber:"1234000" + i, courseIndex:1,
      teacherName:i === 2 ? "示例教师甲、示例教师乙、示例教师丙（联合授课）" : "示例教师",
      timeAndLocation:i === 2 ? ["周一 08:00–09:35 第六教学楼 6A101", "周三 13:30–15:05 实验教学中心 二层"] : i % 2 ? ["周二 08:00–09:35 六教 6A101"] : [],
      url:"",
    }));
    bundle.homework = [{id:"fixture-hw",courseId:"fixture-0",title:"测试作业",deadline:"2099-10-20 23:59",submitted:false}];
    bundle.notifications = [{id:"fixture-notice",courseId:"fixture-0",title:"测试通知",publishTime:"2026-10-20 08:00",publisher:"示例教师"}];
    bundle.files = [{id:"fixture-file",courseId:"fixture-0",title:"测试课件",uploadTime:"2026-10-20 08:00",size:128}];
    const ext = await import(window.__learnFixtureSources.exthw);
    const snapshot = ext.getExtHwSnapshot();
    snapshot.state = "ready";
    snapshot.items = [];
    snapshot.contents = [];
    snapshot.courses = [
      {id:"fixture-ykt-match",source:"yuketang",name:"秋季课堂",title:bundle.courses[0].name,teacher:"示例教师"},
      {id:"fixture-ykt-only",source:"yuketang",name:"跨学科实践 · 旁听班",title:"跨学科实践",teacher:"示例教师",audited:true},
    ];
    (await import(window.__learnFixtureSources.explorer)).openTab("learn");
  });
  await page.locator(".learn-course-list:visible").waitFor();
  await page.waitForFunction(() => {
    let el = document.querySelector(".learn-course-list");
    for (; el; el = el.parentElement) if (Number(getComputedStyle(el).opacity) < 0.999) return false;
    return true;
  });
  return page;
}
async function returnToLearn(page) {
  await page.evaluate(async () => { (await import(window.__learnFixtureSources.explorer)).openTab("learn"); });
  await page.locator(".learn-course-list:visible").waitFor();
}
for (const [engine, kind, options] of engines) {
  const browser = await kind.launch({headless:true, ...options});
  try {
    // 1920 physical pixels at 100/125/150%, plus narrow desktop and phone.
    for (const [width, scale] of widths) {
      const page = await setup(browser, width, scale);
      try {
        const list = page.locator(".learn-course-list:visible");
        const cards = list.locator(".learn-course-card");
        check(await cards.count() === 10, `${engine}/${width}: merged course appears once and unmatched classroom remains`);
        const geometry = await list.evaluate((el) => {
          const box = e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}; };
          return {
            list:box(el), content:box(document.querySelector(".explorer-content")),
            cards:[...el.children].map(box),
            clipping:[...el.querySelectorAll(".learn-course-title,.learn-course-details,.learn-course-schedule")].filter(e=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1).map(e=>e.textContent),
            overflow:document.documentElement.scrollWidth>innerWidth+1,
          };
        });
        if (width >= 840) check(geometry.content.w >= width - 40, `${engine}/${width}: course content occupies the available window`);
        check(!geometry.overflow && geometry.clipping.length === 0, `${engine}/${width}: long title, teachers and locations remain readable`);
        const byRow = new Map();
        for (const card of geometry.cards) {
          const key = Math.round(card.y);
          const row = byRow.get(key) ?? [];
          row.push(card); byRow.set(key,row);
          check(card.x >= geometry.list.x-1 && card.right <= geometry.list.right+1, `${engine}/${width}: card contained`);
        }
        for (const row of byRow.values()) {
          check(Math.max(...row.map(c=>c.h))-Math.min(...row.map(c=>c.h)) < 1, `${engine}/${width}: row cards have equal height`);
          if (width >= 840 && row.length > 1) check(row.every(c=>c.w >= 280), `${engine}/${width}: readable desktop columns`);
        }
        check(await cards.locator("button button").count() === 0, `${engine}/${width}: independent actions are never nested buttons`);
        check(await cards.locator(".chip, .chip-blue, .course-card-btn").count() === 0, `${engine}/${width}: retired styles are absent`);
        if (width < 600) {
          const statsRows = await page.locator(".learn-page > .stats").evaluate((el) => {
            const rows = new Map();
            for (const card of el.children) {
              const y = Math.round(card.getBoundingClientRect().y);
              rows.set(y, (rows.get(y) ?? 0) + 1);
            }
            return [...rows.values()];
          });
          check(JSON.stringify(statsRows) === "[2,2]", `${engine}/${width}: four overview shortcuts form two balanced rows`);
        }
        await page.screenshot({path:`${out}/${engine}-learn-${width}.png`});
        results.push({engine,width,scale,geometry});
        if (width === 1280 || width === 390) {
          const course = (id = "fixture-0") => page.locator(`[data-learn-course-id="${id}"]:visible`);
          const activate = async (button) => width < 600 ? button.tap() : button.click();
          const verifyRoute = async (target, courseId, section) => {
            await page.locator(`.explorer-panel[data-tab-page="${target}"]:visible`).waitFor();
            await page.waitForFunction(async ({ target, courseId, section }) => {
              const active = (await import(window.__learnFixtureSources.explorer)).activeTab();
              return active?.page === target
                && (target === "learn-course" ? active.params?.courseId : active.params?.extCourseId) === courseId
                && (!section || active.params?.courseTab === section);
            }, { target, courseId, section });
            const active = await page.evaluate(async () => (await import(window.__learnFixtureSources.explorer)).activeTab());
            check(active.page === target, `${engine}/${width}: actual mounted store and visible ${target} agree`);
            if (section) {
              check(active.params?.courseTab === section, `${engine}/${width}: shortcut carries ${section}`);
              const panel = page.locator(`.explorer-panel[data-tab-page="${target}"]:visible`);
              const labels = {assignments:"作业",notices:"通知",files:"文件"};
              const selected = target === "learn-ykt-course"
                ? panel.getByRole("radio", { name: new RegExp(`^${labels[section]} 0$`), checked:true })
                : panel.getByRole("tab", { name:new RegExp(`^${labels[section]}`), selected:true });
              await selected.waitFor();
              check(await selected.count() === 1, `${engine}/${width}: ${section} is visibly selected, including empty classroom sections`);
            }
          };
          for (const action of ["网络学堂","雨课堂","作业","通知","文件"]) {
            const name = action === "网络学堂" || action === "雨课堂"
              ? new RegExp(`^打开${action}课程 `)
              : new RegExp(`的${action}$`);
            await activate(course().getByRole("button", { name }));
            await verifyRoute(action === "雨课堂" ? "learn-ykt-course" : "learn-course",
              action === "雨课堂" ? "fixture-ykt-match" : "fixture-0",
              ({作业:"assignments",通知:"notices",文件:"files"})[action]);
            await returnToLearn(page);
          }
          for (const [label, section] of [["作业","assignments"],["通知","notices"],["文件","files"]]) {
            // This unmatched classroom is the final card. Reach it using native
            // scrolling, and prove the fixed OneShot controls do not cover its action.
            const button = course("fixture-ykt-only").getByRole("button", {name:new RegExp(`的${label}$`)});
            await button.scrollIntoViewIfNeeded();
            await button.click({ trial:true });
            const hit = await button.evaluate((el) => {
              const box = el.getBoundingClientRect();
              const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              return {reachable:el.contains(target), y:box.y, bottom:box.bottom, height:innerHeight};
            });
            check(hit.reachable && hit.y >= 0 && hit.bottom <= hit.height,
              `${engine}/${width}: final classroom ${label} can be reached without fixed controls covering it`);
            if (label === "文件") await page.screenshot({path:`${out}/${engine}-learn-${width}-last-action.png`});
            await activate(button);
            await verifyRoute("learn-ykt-course", "fixture-ykt-only", section);
            await returnToLearn(page);
          }
          if (width === 1280) {
            for (const [name,key,target,courseId,section] of [
              [/^打开雨课堂课程 /,"Enter","learn-ykt-course","fixture-ykt-match",undefined],
              [/的文件$/,"Space","learn-course","fixture-0","files"],
            ]) {
              await course().getByRole("button",{name}).focus();
              await page.keyboard.press(key);
              await verifyRoute(target, courseId, section);
              check(true, `${engine}: ${key} activates the independent course shortcut`);
              await returnToLearn(page);
            }
          }
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}
writeFileSync(out + "/learn-report.json", JSON.stringify({assertions:count,results},null,2));
console.log(`PASS ${count} actual-browser learning layout and navigation assertions (${engines.map(x=>x[0]).join(", ")})`);
