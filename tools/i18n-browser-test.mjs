/** Actual App/Settings/Schedule language switching. Isolated preview data, no user accounts. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, webkit } from "playwright";
import { installFakeCloud } from "./lib/fake-cloud.mjs";
import { closeTestBrowser } from "./lib/onboarding-browser-steps.mjs";

const base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180";
const out = process.env.ONETHU_TEST_OUT ?? "/tmp/onethu-i18n-app";
const engines = (process.env.I18N_TEST_ENGINES ?? "chromium,webkit").split(",");
const widths = (process.env.I18N_TEST_WIDTHS ?? "1280,390").split(",").map(Number);
const modes = (process.env.I18N_TEST_MODES ?? "full,simple,practical").split(",");
assert.ok(engines.length && engines.every(e => ["chromium", "webkit"].includes(e)));
assert.ok(widths.length && widths.every(w => Number.isFinite(w) && w >= 320));
assert.ok(modes.length && modes.every(m => ["full", "simple", "practical"].includes(m)));
mkdirSync(out, { recursive: true });
const report = {
  passed: false, checks: [], screenshots: [], errors: [], engines, widths, modes,
  boundary: "Real App, language Select, Schedule editor and Settings. Browser viewport/touch emulation, not native devices. Only translated public labels are asserted; untranslated catalogue content still falls back to Chinese.",
};
const check = (value, label) => { assert.ok(value, label); report.checks.push(label); console.log("✓ " + label); };
const call = (page, path, name, args = []) => page.evaluate(async ({ path, name, args }) => {
  const url = performance.getEntriesByType("resource").map(r => r.name).findLast(u => new URL(u).pathname === path);
  if (!url) throw Error("Module not loaded: " + path);
  return (await import(url))[name](...args);
}, { path, name, args });
const text = (page, key) => call(page, "/src/i18n/index.ts", "t", [key]);
const activate = (page, locator, width) => width < 600 ? locator.tap() : locator.click();
async function prepare(context, mode) {
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => report.errors.push(error.message));
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:5180|localhost:5180)/, route => route.abort());
  await installFakeCloud(page);
  await page.addInitScript(() => { performance.setResourceTimingBufferSize(20000); localStorage.setItem("onethu.onboarded.phone", "1"); });
  await page.goto(base + "/?explorer-preview=onboarding");
  await page.locator(".explorer-shell").waitFor();
  await call(page, "/src/state/cache.ts", "setPreviewMode", [true]);
  await call(page, "/src/state/data.ts", "seedPreviewData");
  await call(page, "/src/state/experienceMode.ts", "setExperienceMode", [mode]);
  return page;
}
async function openSettings(page, mode, width) {
  if (mode === "full") {
    await activate(page, page.locator(".explorer-topbar").getByRole("button", { name: await text(page, "components.layout.7f1d9dd04cd1"), exact: true }), width);
    await activate(page, page.locator(".settings-seg").getByRole("button", { name: await text(page, "components.explorer.settingsoverlay.c2952a5ffcc3"), exact: true }), width);
  } else {
    await activate(page, page.locator(".simple-header button").last(), width);
  }
  await page.locator("[data-language-control] select").waitFor();
}
async function setLanguage(page, locale) {
  await page.locator("[data-language-control] select").selectOption(locale);
  await page.waitForFunction(locale => document.documentElement.lang === locale, locale);
}
async function activeRoute(page, mode) {
  return mode === "full"
    ? call(page, "/src/state/explorer.ts", "activeTab")
    : call(page, "/src/state/experienceMode.ts", "simpleRoute");
}
async function routeSchedule(page, mode) {
  if (mode === "full") await call(page, "/src/state/explorer.ts", "openTab", ["schedule", null, { forceNew: true }]);
  else await call(page, "/src/state/experienceMode.ts", "navigateSimple", ["schedule"]);
  await page.locator(".schedule-workspace:visible").waitFor();
}
async function controlGeometry(page) {
  return page.locator("[data-language-control] select").evaluate(el => {
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { rect: r.toJSON(), within: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, hit: hit === el || el.contains(hit), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
}
for (const engine of engines) {
  const browser = await (engine === "webkit" ? webkit : chromium).launch({
    headless: true,
    ...(engine === "chromium" ? { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } : {}),
  });
  try {
    for (const width of widths) for (const mode of modes) {
      const label = `${engine} ${width} ${mode}`;
      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, hasTouch: width < 600, isMobile: width < 600, timezoneId: "Asia/Shanghai" });
      try {
        const page = await prepare(context, mode);
        await routeSchedule(page, mode);
        const route = JSON.stringify(await activeRoute(page, mode));
        await openSettings(page, mode, width);
        let draft;
        if (mode === "full") {
          if (width < 600) await page.locator(".workbench-settings-phone-nav select").selectOption("外观与布局");
          else await activate(page, page.getByRole("tab", { name: await text(page, "settings.label.appearance"), exact: true }), width);
          await activate(page, page.locator('[data-settings-section="收藏夹"]').getByRole("button", { name: await text(page, "pages.settings.576d81bb0631"), exact: true }), width);
          draft = page.locator('[data-settings-section="收藏夹"] textarea');
        } else draft = page.locator('.simple-settings input[aria-label="API Key"]');
        await draft.fill("Unsent draft 用户内容 & <keep>");
        const draftNode = await draft.elementHandle();
        await page.locator("[data-language-control] select").scrollIntoViewIfNeeded();
        await setLanguage(page, "en-US");
        check(await page.locator("[data-language-control] select").getAttribute("aria-label") === "Language", label + ": real language control and document language update");
        check(await draft.inputValue() === "Unsent draft 用户内容 & <keep>" && await draftNode.evaluate(el => el.isConnected), label + ": settings draft and actual input instance survive");
        check(JSON.stringify(await activeRoute(page, mode)) === route, label + ": route remains unchanged after language switch");
        check(await page.evaluate(() => localStorage.getItem("onethu.locale")) === "en-US", label + ": selected locale persisted");
        const geometry = await controlGeometry(page);
        check(geometry.within && geometry.hit && !geometry.overflow, label + ": language control remains visible and hittable");
        const settingsShot = `${out}/${engine}-${width}-${mode}-settings-en.png`;
        await page.screenshot({ path: settingsShot }); report.screenshots.push(settingsShot);
        if (mode === "full") {
          await call(page, "/src/state/settingsMode.ts", "requestSettingsTab", ["外观与布局"]);
          await call(page, "/src/state/settingsMode.ts", "requestSettingsSection", ["set-glass-level"]);
          await page.locator("#row-set-glass-level.row-focus, [data-set-id='row-set-glass-level'].row-focus").waitFor();
          check(await draftNode.evaluate(el => el.isConnected), label + ": stable settings anchor resolves in English without remounting another section's draft");
          await page.locator("[data-language-control] select").scrollIntoViewIfNeeded();
        }
        await setLanguage(page, "zh-CN");
        check(await draft.inputValue() === "Unsent draft 用户内容 & <keep>", label + ": switching back preserves draft exactly");
        await activate(page, page.locator(".settings-head").getByRole("button", { name: await text(page, "components.explorer.settingsoverlay.77b17fc4a52a"), exact: true }), width);
        await page.locator(".settings-panel").waitFor({ state: "hidden" });
        // A second actual App settings surface changes the locale while this real editor stays open.
        const controller = await prepare(context, mode);
        await openSettings(controller, mode, width);
        await page.bringToFront();
        await activate(page, page.locator(".schedule-workspace:visible .schedule-dock > button"), width);
        await activate(page, page.locator(".schedule-panel:visible").getByRole("button", { name: await text(page, "pages.schedule.5e6a5170f6ac"), exact: true }), width);
        const editor = page.getByRole("dialog", { name: await text(page, "pages.schedule.5090d53a1cce"), exact: true });
        await editor.waitFor();
        const title = editor.locator('input[type="text"]').first();
        await title.fill("未提交会议 Original title");
        const titleNode = await title.elementHandle(), dialogNode = await editor.elementHandle();
        const beforeEvents = await call(page, "/src/state/cloudCal.ts", "getLocalEvents");
        await setLanguage(controller, "en-US");
        await page.waitForFunction(() => document.documentElement.lang === "en-US");
        check(await titleNode.evaluate(el => el.isConnected && el.value === "未提交会议 Original title") && await dialogNode.evaluate(el => el.isConnected), label + ": open real schedule editor and edited text survive live switch");
        check(JSON.stringify(await call(page, "/src/state/cloudCal.ts", "getLocalEvents")) === JSON.stringify(beforeEvents), label + ": language change does not submit editor data");
        check(JSON.stringify(await activeRoute(page, mode)) === route, label + ": cross-window language update preserves active route");
        const editorShot = `${out}/${engine}-${width}-${mode}-editor-en.png`;
        await page.screenshot({ path: editorShot }); report.screenshots.push(editorShot);
        await setLanguage(controller, "zh-CN");
        await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
        check(await titleNode.evaluate(el => el.isConnected && el.value === "未提交会议 Original title"), label + ": open editor retains input when switching back");
        await activate(page, page.getByRole("dialog").filter({ has: page.locator('input[value="未提交会议 Original title"]') }).getByRole("button", { name: await text(page, "pages.schedule.2cd0f3be8738"), exact: true }), width);
        await page.locator('[role="dialog"]').waitFor({ state: "hidden" });
        check(JSON.stringify(await call(page, "/src/state/cloudCal.ts", "getLocalEvents")) === JSON.stringify(beforeEvents), label + ": actual Cancel leaves persisted calendar untouched");
        await controller.reload();
        await controller.locator(".explorer-shell").waitFor();
        check(await controller.evaluate(() => document.documentElement.lang) === "zh-CN", label + ": new document restores persisted language");
      } catch (error) {
        report.failure = String(error);
        for (const page of context.pages()) await page.screenshot({ path: out + "/failure.png" }).catch(() => {});
        writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
        throw error;
      } finally { await context.close(); }
    }
    if (widths.includes(390) && modes.includes("practical")) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      try {
        // Only the dictionary response is lengthened; the actual UI/component tree is unchanged.
        await context.route("**/src/i18n/locales/en-US.ts*", async route => {
          const response = await route.fetch();
          const body = (await response.text())
            .replace(/"settings\.language\.title":\s*"(?:[^"\\]|\\.)*"/, '"settings.language.title": "Interface language and display preferences"')
            .replace(/"settings\.language\.description":\s*"(?:[^"\\]|\\.)*"/, '"settings.language.description": "Choose the language used across settings, navigation, dialogs and controls while preserving every unsaved draft and your current page. This longer translation exercises narrow-screen wrapping."');
          await route.fulfill({ response, body });
        });
        const page = await prepare(context, "practical");
        await openSettings(page, "practical", 390);
        await setLanguage(page, "en-US");
        await page.locator("[data-language-control] select").scrollIntoViewIfNeeded();
        const geometry = await controlGeometry(page);
        check(geometry.within && geometry.hit && !geometry.overflow, engine + " 390: long translated SettingsRow remains usable without horizontal overflow (dictionary fixture)");
        check(await page.locator("[data-language-control]").innerText().then(t => t.includes("Interface language and display preferences")), engine + " 390: actual long translation fixture reached the rendered control");
        const screenshot = `${out}/${engine}-390-long-label-fixture.png`;
        await page.screenshot({ path: screenshot }); report.screenshots.push(screenshot);
      } finally { await context.close(); }
    }
  } catch (error) {
    report.failure = String(error);
    for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: out + "/failure.png" }).catch(() => {});
    writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
    throw error;
  } finally { await closeTestBrowser(browser); }
}
check(report.errors.length === 0, "No browser runtime errors: " + report.errors.join("; "));
report.passed = true;
writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
console.log(`Actual App i18n: ${report.checks.length} checks passed.`);
