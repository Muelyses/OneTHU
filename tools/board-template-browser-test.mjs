/** Real template controls, populated preview components and persisted free gestures.
 * No school requests; preview data + isolated fake cloud, screenshots/report in /tmp.
 * Run: node tools/board-template-browser-test.mjs
 */
import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { installFakeCloud } from "./lib/fake-cloud.mjs";
import { closeTestBrowser } from "./lib/onboarding-browser-steps.mjs";

const base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180";
const out = process.env.ONETHU_TEST_OUT ?? "/tmp/onethu-pr57-board";
const widths = (process.env.ONETHU_TEST_WIDTHS ?? "1280,900,390").split(",").map(Number);
const engines = (process.env.ONETHU_TEST_ENGINES ?? "chromium,webkit").split(",");
mkdirSync(out, { recursive: true });
const report = {
  scope: "Real template ActionSheet and real card renderers with built-in preview data, isolated storage/fake cloud. Chromium and available Playwright WebKit at 1280/900/390 CSS px. Browser viewport emulation, not a physical phone/macOS application claim.",
  checks: [], geometries: [], engines: [], screenshots: [], errors: [], passed: false,
};
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
const check = (condition, message) => { assert.ok(condition, message); report.checks.push(message); console.log("✓ " + message); };
const templates = [["tpl-home", "默认首页", 7], ["tpl-today", "今日速览", 5], ["tpl-learn", "学习为主", 4], ["tpl-min", "极简", 3]];
const call = (page, path, name, args = []) => page.evaluate(async ({ path, name, args }) => {
  const url = performance.getEntriesByType("resource").map(r => r.name).findLast(u => new URL(u).pathname === path);
  if (!url) throw Error("Application module was not loaded: " + path);
  return (await import(url))[name](...args);
}, { path, name, args });
const board = page => page.evaluate(() => JSON.parse(localStorage.getItem("onethu.board.v1")));
const homeItems = async page => (await board(page)).boards.find(b => b.id === "board.today").cells.portrait;
const zoom = page => page.locator(".board-viewport-tools").getByRole("button", { name: /^\d+%$/ });
const currentGeometry = page => page.locator(".freeboard-wrap:visible").evaluate(wrap => {
  const root = wrap.querySelector(".freeboard"), rootRect = root.getBoundingClientRect();
  const items = [...wrap.querySelectorAll(".free-item")].map(el => {
    const r = el.getBoundingClientRect(), style = getComputedStyle(el);
    const card = el.querySelector(":scope > .wg-card") ?? el.firstElementChild;
    return {
      id: el.dataset.itemId, rect: r.toJSON(), authored: { x: parseFloat(style.left), y: parseFloat(style.top), w: parseFloat(style.width), h: parseFloat(style.height) },
      card: card ? { rect: card.getBoundingClientRect().toJSON(), clientWidth: card.clientWidth, scrollWidth: card.scrollWidth,
        clientHeight: card.clientHeight, scrollHeight: card.scrollHeight, overflowY: getComputedStyle(card).overflowY } : null,
    };
  });
  const first = [...wrap.querySelectorAll(".free-item")].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
  const firstRect = first?.getBoundingClientRect();
  const topReachable = firstRect && first.contains(document.elementFromPoint(firstRect.left + 26, firstRect.top + 30));
  return { reading: wrap.classList.contains("is-reading"), host: rootRect.toJSON(), viewport: { w: innerWidth, h: innerHeight }, topReachable, items };
});

async function shot(page, name) {
  const path = `${out}/${name}.png`;
  await page.screenshot({ path, animations: "disabled" });
  report.screenshots.push(path);
}
async function setup(browser, width, label) {
  const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390, isMobile: width === 390 });
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => report.errors.push({ label, error: error.message }));
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:5180|localhost:5180)/, route => route.abort());
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem("onethu.onboarded.phone", "1");
    localStorage.setItem("onethu.experience.v1", "full");
    localStorage.setItem("onethu.chatdock.open", "0");
    window.__boardInput = [];
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"])
      addEventListener(type, e => window.__boardInput.push({ type, trusted: e.isTrusted, pointerType: e.pointerType }), true);
  });
  await installFakeCloud(page);
  await page.goto(base + "/?explorer-preview=onboarding");
  await page.locator('[data-item-id="home.clock"]').waitFor();
  await page.locator(".workbench-board-actions").getByRole("button", { name: "模板", exact: true }).waitFor();
  return page;
}

async function apply(page, name, count) {
  await page.locator(".workbench-board-actions").getByRole("button", { name: "模板", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "套用模板", exact: true });
  await menu.waitFor();
  await menu.getByRole("menuitem", { name: new RegExp("^" + name + " · ") }).click();
  await menu.waitFor({ state: "hidden" });
  await page.waitForFunction(count => document.querySelectorAll(".freeboard-wrap .free-item").length === count, count);
  await page.waitForTimeout(350); // finish the real card entry animation and content-fit measurement
}

async function seedContent(page) {
  await call(page, "/src/state/cache.ts", "setPreviewMode", [true]);
  await call(page, "/src/state/data.ts", "seedPreviewData");
}

async function inspectTemplate(page, label, id, count, width) {
  const saved = await homeItems(page), g = await currentGeometry(page);
  report.geometries.push({ label, template: id, saved, ...g });
  check(saved.length === count && g.items.length === count, `${label} ${id}: real ActionSheet replaces the current layout`);
  check(saved.every(it => it.rect?.w >= 280) && Math.max(...saved.map(it => it.rect.x + it.rect.w)) === 1104,
    `${label} ${id}: persisted authored width uses 1104px with readable cards`);
  const actualZoom = width === 390
    ? (await call(page, "/src/state/boardView.ts", "viewOf", ["board.today|portrait|phone"])).z
    : Number((await zoom(page).innerText()).replace("%", "")) / 100;
  check(actualZoom === 1, `${label} ${id}: explicit template resets viewport zoom`);
  check(g.topReachable, `${label} ${id}: first card stays below fixed chrome and is hit-testable`);
  const intersections = g.items.flatMap((a, i) => g.items.slice(i + 1).filter(b =>
    a.rect.left < b.rect.right - 1 && b.rect.left < a.rect.right - 1 &&
    a.rect.top < b.rect.bottom - 1 && b.rect.top < a.rect.bottom - 1).map(b => [a.id, b.id]));
  check(!intersections.length, `${label} ${id}: rendered card bodies do not overlap`);
  check(g.items.every(it => it.rect.left >= g.host.left - 1 && it.rect.right <= g.host.right + 1 &&
    it.rect.top >= g.host.top - 1 && it.rect.bottom <= g.host.bottom + 1), `${label} ${id}: canvas contains the entire rendered layout`);
  check(g.items.every(it => !it.card || it.card.rect.left >= it.rect.left - 1 && it.card.rect.right <= it.rect.right + 1),
    `${label} ${id}: each actual card fits its component width`);
  const classes = saved.find(it => it.spec.kind === "custom" && it.spec.id === "classes");
  check(classes && (await page.locator(`[data-item-id="${classes.id}"]`).innerText()).includes("高等数学"),
    `${label} ${id}: populated real course component, not empty placeholders`);
  if (width === 390) {
    check(g.reading, `${label} ${id}: mobile stays in reading order`);
    check(g.items.every(it => it.rect.width >= 300 && it.rect.left >= -1 && it.rect.right <= 391),
      `${label} ${id}: mobile projects to full-width readable cards, not scaled miniature tiles`);
    const order = [...saved].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x).map(it => it.id);
    const readingOrder = [...g.items].sort((a, b) => a.rect.top - b.rect.top).map(it => it.id);
    check(JSON.stringify(order) === JSON.stringify(readingOrder), `${label} ${id}: reading order follows authored rows`);
    check(g.items.every(it => it.card.scrollWidth <= it.card.clientWidth + 2), `${label} ${id}: no horizontal card-body clipping on mobile`);
  } else {
    check(!g.reading, `${label} ${id}: desktop keeps independent canvas coordinates`);
    check(g.items.every(it => {
      const expected = saved.find(x => x.id === it.id).rect;
      return Math.abs(it.authored.x - expected.x) < 1 && Math.abs(it.authored.y - expected.y) < 1 &&
        Math.abs(it.authored.w - expected.w) < 1 && Math.abs(it.authored.h - expected.h) < 1;
    }), `${label} ${id}: rendered geometry matches saved free coordinates`);
    const list = g.items.find(it => saved.find(s => s.id === it.id).rect.w >= 540);
    check(list.rect.width >= (width === 1280 ? 480 : 360), `${label} ${id}: previous oversized board does not shrink new layout`);
  }
  await shot(page, `${label}-${id}-top`);
  if (width === 390) {
    await page.locator(`[data-item-id="${g.items.at(-1).id}"]`).scrollIntoViewIfNeeded();
    await shot(page, `${label}-${id}-bottom`);
  }
}

async function bodyPoint(locator) {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    for (let y = Math.min(innerHeight - 160, r.bottom - 24); y > Math.max(100, r.top + 16); y -= 14) {
      for (let x = Math.max(24, r.left + 24); x < Math.min(innerWidth - 24, r.right - 24); x += 22) {
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest(".free-item") === el && !hit.closest("button,a,input,textarea,.free-toolbar,.free-handle,[role=button]")) return { x, y };
      }
    }
    throw Error("Component has no reachable body point");
  });
}

async function gestures(page, label) {
  await apply(page, "默认首页", 7);
  const item = page.locator('[data-item-id="home.clock"]');
  const p = await bodyPoint(item), before = (await homeItems(page)).find(x => x.id === "home.clock").rect;
  const scale = (await item.boundingBox()).width / before.w;
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + 73, p.y + 37, { steps: 8 }); await page.mouse.up();
  const moved = (await homeItems(page)).find(x => x.id === "home.clock").rect;
  check(Math.abs(moved.x - before.x - 73 / scale) <= 1 && Math.abs(moved.y - before.y - 37 / scale) <= 1,
    `${label}: real mouse drag follows arbitrary displacement without snapping`);
  const handle = item.locator(".fh-se");
  const h = await handle.boundingBox();
  check(!!h, `${label}: selecting exposes the real resize handle`);
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 43, h.y + h.height / 2 + 31, { steps: 8 }); await page.mouse.up();
  const resized = (await homeItems(page)).find(x => x.id === "home.clock");
  check(Math.abs(resized.rect.w - moved.w - 43 / scale) <= 1 && Math.abs(resized.rect.h - moved.h - 31 / scale) <= 1,
    `${label}: real corner drag changes both dimensions freely`);
  check(resized.manual === true, `${label}: explicit resizing takes ownership of component size`);
  await page.locator(".board-viewport-tools").getByRole("button", { name: "放大", exact: true }).click();
  check(await zoom(page).innerText() === "125%", `${label}: user can freely change canvas zoom after template`);
  const expected = (await homeItems(page)).find(x => x.id === "home.clock").rect;
  const events = await page.evaluate(() => window.__boardInput);
  check(events.length > 8 && events.every(e => e.trusted) && !events.some(e => e.type === "pointercancel"),
    `${label}: drag and resize used trusted browser pointer events`);
  await page.reload(); await item.waitFor();
  check(JSON.stringify((await homeItems(page)).find(x => x.id === "home.clock").rect) === JSON.stringify(expected),
    `${label}: arbitrary moved/resized geometry persists after reload`);
  check(await zoom(page).innerText() === "125%", `${label}: reload preserves user-selected zoom`);
  // Verify new keyboard activation remains available after restoring the saved canvas.
  await zoom(page).focus(); await page.keyboard.press("Enter");
  check(await zoom(page).innerText() === "100%", `${label}: keyboard activates viewport reset`);
  await shot(page, `${label}-free-drag-resize`);
}

try {
  for (const name of engines) {
    if (name === "webkit" && !existsSync(webkit.executablePath())) {
      report.engines.push({ name, skipped: "Playwright WebKit is not installed" }); continue;
    }
    const browser = await (name === "webkit" ? webkit.launch({ headless: true }) :
      chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--disable-updater-scheduler"] }));
    const run = { name, naturalCleanup: false }; report.engines.push(run);
    let page;
    try {
      for (const width of widths) {
        const label = `${name}-${width}`;
        page = await setup(browser, width, label);
        // A saved oversized home and independent OnePage exercise explicit-reset boundaries.
        const doc = await board(page);
        const initialItems = doc.boards.find(b => b.id === "board.today").cells.portrait;
        initialItems[0].rect.x = 3200;
        // Distinct old IDs ensure the first true template application mounts components
        // against the built-in preview cache, as subsequent template changes do.
        initialItems.forEach(item => { item.id = "fixture." + item.id; });
        doc.boards.push({ id: "fixture-onepage", name: "保持原样", icon: "fist", kind: "user", cells: {
          portrait: [{ id: "fixture-note", spec: { kind: "text", text: "自定义布局保持原样" }, cell: { x: 0, y: 0, w: 2, h: 2 }, rect: { x: 531, y: 817, w: 319, h: 217 }, manual: true }],
        } });
        await call(page, "/src/state/board.ts", "saveBoard", [doc]);
        await call(page, "/src/state/boardView.ts", "setView", ["board.today|portrait" + (width === 390 ? "|phone" : ""), { z: 5 }]);
        await page.reload(); await page.locator(".free-item").first().waitFor();
        await seedContent(page);
        const independent = (await board(page)).boards.find(b => b.id === "fixture-onepage");
        for (const [id, title, count] of templates) {
          await apply(page, title, count);
          await inspectTemplate(page, label, id, count, width);
          check(JSON.stringify((await board(page)).boards.find(b => b.id === "fixture-onepage")) === JSON.stringify(independent),
            `${label} ${id}: applying home template preserves independent OnePage`);
        }
        if (width === 1280) await gestures(page, label);
        // Fake-cloud routes read response bodies after route.fetch resolves. Wait for
        // those handlers before disposing the request context, or a late body read fails.
        await page.unrouteAll({ behavior: "wait" }); await page.context().request.dispose(); await page.context().close();
      }
    } catch (error) {
      run.failure = error.stack;
      if (page && !page.isClosed()) {
        report.failureGeometry = await currentGeometry(page).catch(() => null);
        await shot(page, `${name}-failure`).catch(() => {});
      }
      throw error;
    } finally {
      for (const context of browser.contexts()) for (const openPage of context.pages())
        await openPage.unrouteAll({ behavior: "wait" });
      await closeTestBrowser(browser); run.naturalCleanup = true;
    }
  }
  check(report.errors.length === 0, "No browser page errors across both rendering engines");
  report.passed = true;
} finally { writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n"); }
console.log(`${report.checks.length} template/browser checks passed; all browsers naturally closed`);
