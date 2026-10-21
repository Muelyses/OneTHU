/** Real React login controls with an entirely simulated Tauri authentication transport.
 * Run against an isolated dev server: ONETHU_TEST_URL=http://127.0.0.1:5199 node tools/login-recovery-browser-test.mjs
 * Desktop/mobile Chromium on macOS; this is not an Android WebView hardware test.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5199";
const origin = new URL(base).origin;
const out = process.env.ONETHU_TEST_ARTIFACTS ?? "/Volumes/OneTHUBuild/artifacts/login-recovery";
mkdirSync(out, { recursive: true });
const require = createRequire(new URL("../packages/info-lib/package.json", import.meta.url));
const { sm2 } = require("sm-crypto");
const keyHtml = `<input id="sm2publicKey" value="${sm2.generateKeyPairHex().publicKey}">`;
const successHtml = '登录成功。正在重定向到<a href="https://oauth.tsinghua.edu.cn/fixture-callback">继续</a>';
const checks = [], errors = [], blocked = [], summaries = [];
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); console.log("PASS " + label); };
async function waitUntil(condition) {
  const deadline = Date.now() + 20_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for simulated native request");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
let passed = false;
let activePage = null;

const layouts = {
  phone: { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Fixture) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36" },
  desktop: { viewport: { width: 1280, height: 850 }, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36" },
};
const response = (url, body, status = 200, finalUrl = url) => ({
  status, status_text: status === 429 ? "Too Many Requests" : "OK",
  headers: { "content-type": body.startsWith("{") ? "application/json" : "text/html; charset=utf-8" },
  set_cookies: [], set_cookie_hops: [], url: finalUrl, body,
});

async function setup(layout, scenario, locale = "zh-CN") {
  const context = await browser.newContext(layouts[layout]);
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(20_000);
  const requests = [], logs = [], files = new Map();
  let releaseEntry;
  const entryBarrier = new Promise((resolve) => { releaseEntry = resolve; });
  const holdEntry = scenario === "unknown";
  page.on("pageerror", (error) => errors.push(`${layout}/${scenario}: ${error.message}`));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    blocked.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.exposeFunction("__loginRecoveryInvoke", async (command, args) => {
    if (command === "log_debug") { logs.push(args.line); return null; }
    if (command === "state_read") return files.get(args.name) ?? null;
    if (command === "state_write") { files.set(args.name, args.content); return null; }
    if (command === "state_delete") { files.delete(args.name); return null; }
    if (command !== "http_native") return null;
    const input = args.input;
    const url = new URL(input.url);
    const method = input.method ?? "GET";
    const fields = new URLSearchParams(input.body ?? "");
    const isAuth = ["id.tsinghua.edu.cn", "oauth.tsinghua.edu.cn"].includes(url.hostname)
      || (url.hostname === "webvpn.tsinghua.edu.cn" && url.pathname === "/login");
    if (isAuth) requests.push({ method, path: url.pathname, action: fields.get("action"), at: Date.now() });
    if (url.hostname === "webvpn.tsinghua.edu.cn" && url.pathname === "/login") {
      if (holdEntry) await entryBarrier;
      if (scenario === "rate-limit") return response(input.url, "Too many requests", 429);
      if (scenario === "trust-limit") return response(input.url, '<p id="msg_note">信任设备数量已达上限</p>');
      if (scenario.startsWith("two-factor")) return response(input.url, keyHtml, 200, "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/fixture/0");
      return response(input.url, "<main>Unexpected portal fixture</main>", 200, "https://id.tsinghua.edu.cn/fixture-unexpected");
    }
    if (url.pathname === "/do/off/ui/auth/login/check") return response(input.url, '<html><head><title>二次认证</title></head><body><div id="root"></div><script src="/v2/dist/doubleauth/doubleAuth.bundle.js"></script></body></html>');
    if (url.pathname === "/b/doubleAuth/login") {
      const action = fields.get("action");
      if (action === "FIND_APPROACHES") return response(input.url, JSON.stringify({ result: "success", object: { hasWeChatBool: scenario !== "two-factor-totp", phone: null, hasTotp: scenario === "two-factor-totp" } }));
      if (action === "SEND_CODE") {
        if (scenario === "two-factor-send-failed") return response(input.url, "Too many requests", 429);
        // Ensure a directly entered TOTP arrives before the code hook exists.
        if (scenario === "two-factor-totp") await new Promise((resolve) => setTimeout(resolve, 180));
        return response(input.url, JSON.stringify({ result: "success", object: {} }));
      }
      if (action === "VERITY_CODE" || action === "VERITY_TOTP_CODE") return response(input.url, JSON.stringify({ result: "success", object: { redirectUrl: "/fixture-finish" } }));
      throw new Error("Unexpected fixture 2FA action: " + action);
    }
    if (url.pathname === "/b/doubleAuth/personal/saveFinger") return response(input.url, JSON.stringify({ result: "fail", msg: "受信设备数量已达上限" }));
    if (url.pathname === "/fixture-finish" || url.pathname.startsWith("/do/off/ui/auth/login/form/")) return response(input.url, successHtml);
    if (url.hostname === "oauth.tsinghua.edu.cn") return response(input.url, "<main>Fixture session ready</main>", 200, "https://webvpn.tsinghua.edu.cn/");
    // Background services have no data in this isolated fixture. No request leaves this process.
    return response(input.url, "{}");
  });
  await page.addInitScript(({ locale, layout }) => {
    if (!localStorage.getItem("onethu.locale")) localStorage.setItem("onethu.locale", locale);
    Object.defineProperty(navigator, "platform", { value: layout === "phone" ? "Linux armv8l" : "Win32" });
    window.__TAURI_INTERNALS__ = {
      invoke: (command, args) => window.__loginRecoveryInvoke(command, args),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => 1,
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text) => {
        if (layout === "phone") throw new Error("Fixture clipboard unavailable");
        window.__fixtureClipboard = text;
      },
    } });
  }, { locale, layout });
  await page.goto(base);
  await page.locator("#username").fill("2099000000");
  await page.locator("#password").fill("fixture-only-password");
  return { page, context, requests, logs, releaseEntry };
}

try {
  for (const layout of Object.keys(layouts)) {
    for (const scenario of ["unknown", "rate-limit", "trust-limit"]) {
      const fixture = await setup(layout, scenario);
      const { page, context, requests, logs } = fixture;
      if (scenario === "unknown") {
        const language = page.getByRole("combobox", { name: "语言 / Language", exact: true });
        check(await language.locator("option").count() >= 2, `${layout}: language can be selected before signing in`);
        await language.selectOption("en-US");
        await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
        check(await page.locator("#username").inputValue() === "2099000000" && await page.locator("#password").inputValue() === "fixture-only-password", `${layout}: changing language preserves credential drafts`);
        await language.selectOption("zh-CN");
        // Two synchronous native form submissions test the React ref gate before rerender.
        await page.locator("form").evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
        await page.waitForFunction(() => document.querySelector("form button[type=submit]")?.disabled);
        await waitUntil(() => requests.some((item) => item.path === "/login"));
        await page.locator("#password").press("Enter");
        check(requests.filter((item) => item.path === "/login").length === 1, `${layout}: synchronous double submit plus Enter starts one chain`);
        fixture.releaseEntry();
      } else await page.locator("form button[type=submit]").click();
      const expected = scenario === "unknown" ? "没有返回可用的登录表单" : scenario === "rate-limit" ? "暂时限制了请求" : "信任设备数量已达上限";
      await page.locator(".login-error").filter({ hasText: expected }).waitFor();
      check((await page.locator(".login-error").innerText()).includes(expected), `${layout}/${scenario}: actionable Chinese error is rendered`);
      check(!(await page.locator(".login-error").innerText()).includes("Failed to get public key"), `${layout}/${scenario}: generic English public-key error is absent`);
      check(requests.filter((item) => item.path === "/login").length === 1, `${layout}/${scenario}: no automatic full-login replay`);
      check(requests.every((item) => item.method !== "POST"), `${layout}/${scenario}: no credentials submitted for unusable entry`);
      check(await page.locator("form button[type=submit]").isEnabled(), `${layout}/${scenario}: login UI leaves the busy state`);
      check(!logs.some((line) => /2099000000|fixture-only-password/.test(line)), `${layout}/${scenario}: diagnostics do not contain entered credentials`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      check(!overflow, `${layout}/${scenario}: error text stays within viewport`);
      await page.screenshot({ path: `${out}/${layout}-${scenario}.png`, fullPage: true });
      if (scenario === "unknown") {
        const language = page.getByRole("combobox", { name: "语言 / Language", exact: true });
        const postCount = requests.filter(item => item.method === "POST").length;
        await language.selectOption("en-US");
        await page.locator(".login-error").filter({ hasText: "did not return a usable sign-in form" }).waitFor();
        check(await page.locator("#password").inputValue() === "fixture-only-password" && requests.filter(item => item.method === "POST").length === postCount, `${layout}: existing errors change language without resubmitting credentials`);
        if (layout === "phone") await page.setViewportSize({ width: 320, height: 720 });
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${layout}: language control and English error fit the viewport`);
        await page.screenshot({ path: `${out}/${layout}-login-language-en.png`, fullPage: true });
        if (layout === "phone") await page.setViewportSize(layouts.phone.viewport);
        await language.selectOption("zh-CN");
        await page.getByRole("button", { name: "复制诊断信息", exact: true }).click();
        let diagnostic;
        if (layout === "phone") {
          await page.locator(".login-error textarea").waitFor();
          diagnostic = await page.locator(".login-error textarea").inputValue();
          check(await page.locator(".login-error textarea").getAttribute("readonly") !== null, "phone: unavailable clipboard exposes a selectable read-only diagnostic");
        } else {
          await page.getByRole("button", { name: "已复制到剪贴板", exact: true }).waitFor();
          diagnostic = await page.evaluate(() => window.__fixtureClipboard);
        }
        check(diagnostic.includes("AUTH-FAIL reason=unexpected-page") && !/2099000000|fixture-only-password/.test(diagnostic), `${layout}: diagnostic copy identifies the failure without credentials`);
        // OH startup separately probes an ID entry. Count only the main login
        // handshake and credential submissions; the probe is retained in the report.
        const mainAuthCount = () => requests.filter((item) => item.path === "/login" || (item.method === "POST" && item.path === "/do/off/ui/auth/login/check")).length;
        const before = mainAuthCount();
        await language.selectOption("en-US");
        await Promise.all([page.waitForEvent("load"), page.locator(".hard-refresh-fab").click()]);
        await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
        check(await language.inputValue() === "en-US", `${layout}: login language persists after reloading`);
        await language.selectOption("zh-CN");
        await page.locator("#username").fill("2099000000");
        await page.locator("#password").fill("fixture-only-password");
        await page.locator("form button[type=submit]").click();
        await page.locator(".login-error").filter({ hasText: "刷新不会缩短等待时间" }).waitFor();
        check(mainAuthCount() === before, `${layout}: actual refresh retains cooldown and sends no additional main-login request`);
        await page.screenshot({ path: `${out}/${layout}-refresh-cooldown.png`, fullPage: true });
      }
      summaries.push({ layout, scenario, requests });
      await context.close();
    }
  }

  for (const layout of ["phone", "desktop"]) for (const scenario of ["two-factor", "two-factor-totp"]) {
    const { page, context, requests, logs } = await setup(layout, scenario);
    await page.locator("form button[type=submit]").click();
    await page.locator(".method-item").first().click();
    const language = page.getByRole("combobox", { name: "语言 / Language", exact: true });
    await language.selectOption("en-US");
    check(await page.locator(".login-title").innerText() === "Two-factor authentication" && await page.locator(".method-item input").first().isChecked(), `${layout}/${scenario}: method selection stays intact when switching language`);
    await language.selectOption("zh-CN");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    if (scenario !== "two-factor-totp") await page.getByRole("button", { name: "发送验证码", exact: true }).click();
    await page.locator("#code").fill("123456");
    await language.selectOption("en-US");
    await page.getByRole("button", { name: "Verify and sign in", exact: true }).waitFor();
    check(await page.locator("#code").inputValue() === "123456", `${layout}/${scenario}: language switch preserves entered verification code`);
    await page.screenshot({ path: `${out}/${layout}-${scenario}-code-entry-en.png`, fullPage: true });
    await language.selectOption("zh-CN");
    await page.getByRole("button", { name: "验证并登录", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#code"), null, { timeout: 20_000 });
    await page.waitForFunction(() => !document.querySelector(".login-wrap"), null, { timeout: 20_000 });
    check(requests.filter((item) => item.path === "/login").length === 1, `${layout}/${scenario}: one login chain covers selection, sending and verification`);
    check(requests.filter((item) => item.path === "/do/off/ui/auth/login/check").length === 1, `${layout}/${scenario}: credentials are submitted once`);
    const actions = requests.filter((item) => item.action).map((item) => item.action);
    const verifyAction = scenario === "two-factor-totp" ? "VERITY_TOTP_CODE" : "VERITY_CODE";
    check(JSON.stringify(actions) === JSON.stringify(["FIND_APPROACHES", "SEND_CODE", verifyAction]), `${layout}/${scenario}: verification reaches the code hook and is not rejected by the login cooldown`);
    const verify = requests.find((item) => item.action === verifyAction);
    const loginStart = requests.find((item) => item.path === "/login");
    check(verify.at - loginStart.at < 20_000, `${layout}/${scenario}: verification completed inside the 20-second full-login cooldown`);
    check(logs.some((line) => line.includes("受信设备数达上限")) && logs.some((line) => line.includes("VERIFY-OK")), `${layout}/${scenario}: trust limit skips device saving while allowing this login to finish`);
    check(!logs.some((line) => /2099000000|fixture-only-password/.test(line)), `${layout}/${scenario}: logs omit credentials`);
    const trustNotice = page.locator(".toast-host.is-center").filter({ hasText: "受信设备数已达上限" });
    await trustNotice.waitFor();
    check(await trustNotice.evaluate((node) => getComputedStyle(node).whiteSpace !== "nowrap" && node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1), `${layout}/${scenario}: trust-limit instructions wrap without clipping`);
    check(!(await page.locator("body").innerText()).includes("本页出现问题"), `${layout}/${scenario}: completed login does not fall into the React error boundary`);
    await page.screenshot({ path: `${out}/${layout}-${scenario}-trust-limit.png`, fullPage: true, animations: "disabled" });
    summaries.push({ layout, scenario, requests });
    await context.close();
  }
  {
    const { page, context, requests } = await setup("phone", "two-factor-send-failed");
    await page.locator("form button[type=submit]").click();
    await page.locator(".method-item").first().click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("button", { name: "发送验证码", exact: true }).click();
    await page.locator(".login-error").filter({ hasText: "暂时限制了请求" }).waitFor();
    check(await page.getByRole("button", { name: "发送验证码", exact: true }).isEnabled(), "phone/send-failed: rejected SEND_CODE is not displayed as successfully sent");
    await page.locator("#code").fill("123456");
    check(await page.getByRole("button", { name: "验证并登录", exact: true }).isDisabled(), "phone/send-failed: an unsent code cannot be submitted");
    check(requests.filter((item) => item.action === "SEND_CODE").length === 1 && !requests.some((item) => item.action === "VERITY_CODE"), "phone/send-failed: one failed send is not silently retried or verified");
    await page.screenshot({ path: `${out}/phone-two-factor-send-failed.png`, fullPage: true });
    summaries.push({ layout: "phone", scenario: "two-factor-send-failed", requests });
    await context.close();
  }
  check(errors.length === 0, "No React/browser runtime errors: " + errors.join("; "));
  passed = true;
} finally {
  if (!passed && activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {});
    writeFileSync(`${out}/failure.txt`, await activePage.locator("body").innerText().catch(() => "Page closed"));
  }
  writeFileSync(`${out}/browser-report.json`, JSON.stringify({
    passed, checks, errors, blockedOrigins: [...new Set(blocked)], scenarios: summaries,
    scope: "Real React desktop/mobile login UI, simulated native responses, macOS Chromium. All non-local browser requests blocked. No real credentials, school traffic, Android hardware or Windows WebView2.",
  }, null, 2));
  await browser.close();
}
console.log(`login-recovery-browser-test: ${checks.length} checks passed`);
