/** Actual OrganizationSection/OrgPicker -> FormModalHost, with live cross-window locale changes.
 * No school traffic. Only still-untranslated dictionary entries are supplied by this fixture.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { chromium, webkit } from "playwright";
import { installFakeCloud } from "./lib/fake-cloud.mjs";
import { closeTestBrowser } from "./lib/onboarding-browser-steps.mjs";

const base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180";
const out = process.env.ONETHU_TEST_OUT ?? "/tmp/onethu-i18n-business-forms";
mkdirSync(out, { recursive: true });
const report = { passed: false, checks: [], errors: [], screenshots: [], boundary: "Real App and actual organization form entry handlers; English dictionary-only fixture where catalogue is not yet translated. Chromium desktop and WebKit touch emulation, not native devices. All form operations cancel; no organization created or joined." };
const check = (value, label) => { assert.ok(value, label); report.checks.push(label); console.log("✓ " + label); };

// Audit every business caller, including separately constructed fields/options.
const files = execFileSync("rg", ["-l", "openFormModal", "apps/desktop/src", "-g", "*.ts", "-g", "*.tsx"], { encoding: "utf8" }).trim().split("\n").filter(f => !f.endsWith("/lib/formModal.tsx"));
let callCount = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  const visit = (node, fn) => { fn(node); ts.forEachChild(node, child => visit(child, fn)); };
  visit(ast, node => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer); });
  const assertDeferred = node => visit(node, child => {
    assert.ok(!(ts.isCallExpression(child) && child.expression.getText(ast) === "i18n"), `${file}: fixed form text must be a descriptor: ${child.getText(ast)}`);
  });
  const auditFields = (node, seen = new Set()) => {
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return;
      seen.add(node.text);
      const value = declarations.get(node.text);
      if (value) auditFields(value, seen);
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      const key = node.name.getText(ast);
      if (["label", "placeholder"].includes(key)) { assertDeferred(node.initializer); return; }
      if (key === "default") return; // User/default values are deliberately materialized once.
      if (key === "options") { auditFields(node.initializer, seen); return; }
    }
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === "options") auditFields(node.name, seen);
    ts.forEachChild(node, child => auditFields(child, seen));
  };
  visit(ast, node => {
    if (!ts.isCallExpression(node) || node.expression.getText(ast) !== "openFormModal") return;
    callCount++;
    if (node.arguments[0]) assertDeferred(node.arguments[0]);
    if (node.arguments[1]) auditFields(node.arguments[1]);
  });
}
check(callCount === 29, "All 28 business calls plus plugin facade audited: display descriptors, values untouched");
for (const path of ["apps/desktop/src/pages/Organization.tsx", "apps/desktop/src/components/OrganizationSection.tsx"]) {
  const source = readFileSync(path, "utf8");
  check(/default:\s*"我"/.test(source) && /f\.name\s*\|\|\s*"我"/.test(source), path + ": persisted default member name stays original");
}

const translations = Object.fromEntries(["components.organizationsection", "pages.organization"].flatMap(prefix => [
  [`${prefix}.d045f8d60a45`, "Create organization"],
  [`${prefix}.3f38e493103b`, "Organization name"],
  [`${prefix}.d2e163c18cd9`, "Description"],
  [`${prefix}.aa2ed8e463b7`, "Join link"],
]));
const call = (page, path, name, args = []) => page.evaluate(async ({ path, name, args }) => {
  const url = performance.getEntriesByType("resource").map(r => r.name).findLast(u => new URL(u).pathname === path);
  if (!url) throw Error("Module not loaded: " + path);
  return (await import(url))[name](...args);
}, { path, name, args });
async function prepare(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(14000);
  page.on("pageerror", e => report.errors.push(e.message));
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:5180|localhost:5180)/, route => route.abort());
  await installFakeCloud(page);
  await page.addInitScript(() => { performance.setResourceTimingBufferSize(20000); localStorage.setItem("onethu.onboarded.phone", "1"); });
  await page.goto(base + "/?explorer-preview=onboarding");
  await page.locator(".explorer-shell").waitFor();
  await call(page, "/src/state/cache.ts", "setPreviewMode", [true]);
  await call(page, "/src/state/data.ts", "seedPreviewData");
  await call(page, "/src/state/experienceMode.ts", "setExperienceMode", ["full"]);
  return page;
}
const activate = (locator, touch) => touch ? locator.tap() : locator.click();
for (const [engine, width] of [["chromium", 1280], ["webkit", 390]]) {
  const browser = await (engine === "webkit" ? webkit : chromium).launch({ headless: true, ...(engine === "chromium" ? { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390, isMobile: width === 390 });
    await context.route("**/src/i18n/locales/en-US.ts*", async route => {
      const response = await route.fetch(); let body = await response.text();
      for (const [key, value] of Object.entries(translations)) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        body = body.replace(new RegExp(`"${escaped}":\\s*"(?:[^"\\\\]|\\\\.)*"`), `"${key}": ${JSON.stringify(value)}`);
      }
      await route.fulfill({ response, body });
    });
    const page = await prepare(context), controller = await prepare(context);
    const t = key => call(controller, "/src/i18n/index.ts", "t", [key]);
    await activate(controller.locator(".explorer-topbar").getByRole("button", { name: await t("components.layout.7f1d9dd04cd1"), exact: true }), width === 390);
    await activate(controller.locator(".settings-seg").getByRole("button", { name: await t("components.explorer.settingsoverlay.c2952a5ffcc3"), exact: true }), width === 390);
    const language = controller.locator("[data-language-control] select");
    await language.waitFor();
    for (const entry of ["contacts", "org"]) {
      await language.selectOption("zh-CN");
      await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
      await call(page, "/src/state/explorer.ts", "openTab", [entry, entry === "contacts" ? { section: "orgs" } : null, { forceNew: true }]);
      const root = entry === "contacts" ? page.locator(".contacts-orgs:visible") : page.locator(".org-page:visible");
      await root.waitFor();
      const before = await call(page, "/src/state/org.ts", "orgSnapshot");
      await activate(root.getByRole("button", { name: "新建组织", exact: true }).first(), width === 390);
      const form = page.locator(".plg-form-modal");
      await form.waitFor();
      const dialog = await form.elementHandle(), input = await form.locator("input").first().elementHandle();
      await form.locator("input").first().fill("Unsent 原始组织名");
      await form.locator("textarea").fill("Unsent description\n原始简介");
      await form.locator("input").nth(1).fill("https://example.invalid/join");
      const beforeLabels = await form.locator(".plg-form-label").allTextContents();
      await language.selectOption("en-US");
      await page.waitForFunction(() => document.documentElement.lang === "en-US");
      await page.waitForFunction(() => document.querySelector(".plg-form-modal .og-panel-title")?.textContent === "Create organization");
      const labels = await form.locator(".plg-form-label").allTextContents();
      check(labels.join("|").includes("Organization name") && labels.join("|").includes("Description") && labels.join("|") !== beforeLabels.join("|"), `${engine} ${entry}: actual form title and field labels update while open`);
      check(await dialog.evaluate(el => el.isConnected) && await input.evaluate(el => el.isConnected && el.value === "Unsent 原始组织名"), `${engine} ${entry}: same dialog/input DOM and name draft survive`);
      check(await form.locator("textarea").inputValue() === "Unsent description\n原始简介" && await form.locator("input").nth(1).inputValue() === "https://example.invalid/join", `${engine} ${entry}: textarea and URL drafts survive`);
      check(JSON.stringify(await call(page, "/src/state/org.ts", "orgSnapshot")) === JSON.stringify(before), `${engine} ${entry}: language change does not resolve or submit organization form`);
      const shot = `${out}/${engine}-${entry}-en.png`;
      // Allow WebKit's modal/compositor transition to finish before saving visual evidence.
      await page.waitForTimeout(350);
      await page.screenshot({ path: shot }); report.screenshots.push(shot);
      await language.selectOption("zh-CN");
      await page.waitForFunction(() => document.querySelector(".plg-form-modal .og-panel-title")?.textContent === "新建组织");
      check(await input.evaluate(el => el.isConnected && el.value === "Unsent 原始组织名"), `${engine} ${entry}: switching back does not reset fields`);
      await activate(form.getByRole("button", { name: "取消", exact: true }), width === 390);
      await form.waitFor({ state: "hidden" });
      check(JSON.stringify(await call(page, "/src/state/org.ts", "orgSnapshot")) === JSON.stringify(before), `${engine} ${entry}: actual cancel leaves organization storage unchanged`);
    }
    await context.close();
  } catch (e) {
    report.failure = String(e);
    for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: out + "/failure.png" }).catch(() => {});
    throw e;
  } finally { await closeTestBrowser(browser); writeFileSync(out + "/report.json", JSON.stringify(report, null, 2)); }
}
check(report.errors.length === 0, "No browser runtime errors: " + report.errors.join("; "));
report.passed = true;
writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
console.log(`Business forms i18n: ${report.checks.length} checks passed.`);
