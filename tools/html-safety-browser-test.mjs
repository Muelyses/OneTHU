/** Execute production HTML transforms in isolated Chromium/WebKit documents.
 * Remote network is blocked. Payloads only set a harmless local window marker. */
import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180";
const out = process.env.ONETHU_TEST_OUT ?? "/tmp/onethu-html-safety";
const engines = (process.env.HTML_SAFETY_ENGINES ?? "chromium,webkit").split(",");
assert.ok(engines.length && engines.every(engine => ["chromium", "webkit"].includes(engine)), "valid engines required");
mkdirSync(out, { recursive: true });
const paths = {
  userext: "apps/desktop/src/state/userext.ts",
  rich: "apps/desktop/src/pages/learn/shared.tsx",
  docx: "apps/desktop/src/components/FilePreview.tsx",
  thubook: "apps/desktop/src/pages/ThubookPage.tsx",
};
const sources = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, readFileSync(path, "utf8")]));
function sourceFunction(name, functionName) {
  const ast = ts.createSourceFile(paths[name], sources[name], ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === functionName);
  assert.ok(node, functionName + " exists in production source");
  return ts.transpileModule(node.getText(ast).replace(/^export\s+/, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const functionSources = {
  userext: sourceFunction("userext", "sanitizeUserHtml"),
  docx: sourceFunction("docx", "sanitizeDocxHtml"),
  thubook: sourceFunction("thubook", "extractMain"),
};
const richAst = ts.createSourceFile(paths.rich, sources.rich, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let richExpression;
function findRich(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(richAst) === "__html") richExpression = node.initializer.getText(richAst);
  ts.forEachChild(node, findRich);
}
findRich(richAst);
assert.ok(richExpression?.includes("sanitizeDisplayHtml"), "RichContent sanitizes its actual innerHTML expression");
for (const [name, source] of Object.entries(functionSources)) assert.ok(source.includes("sanitizeDisplayHtml"), name + ": production entry uses shared sanitizer");

const payloads = [
  ["unquoted image event", '<img src="data:,broken" onerror=globalThis.__htmlProof=1>'],
  ["quoted image event", '<img src="data:,broken" onerror="globalThis.__htmlProof=1">'],
  ["newline event", '<img src="data:,broken"\nonerror=globalThis.__htmlProof=1>'],
  ["SVG event", '<svg/onload=globalThis.__htmlProof=1></svg>'],
  ["encoded tab scheme", '<a href="java&#x09;script:globalThis.__htmlProof=1">Open</a>'],
  ["encoded newline scheme", '<a href="java&#x0a;script:globalThis.__htmlProof=1">Open</a>'],
  ["encoded scheme letters", '<a href="&#106;avascript:globalThis.__htmlProof=1">Open</a>'],
  ["nested document", '<iframe srcdoc="<img src=x onerror=parent.__htmlProof=1>"></iframe>'],
  ["form and named props", '<form id="location" action="javascript:globalThis.__htmlProof=1"><input name="href"><button>Go</button></form>'],
  ["active metadata", '<meta http-equiv="refresh" content="0;url=javascript:globalThis.__htmlProof=1"><base href="https://invalid.example/"><object data="data:text/html,active"></object>'],
  ["style document", '<style>body{position:fixed}</style><b>保留文字</b>'],
  ["SVG foreign document", '<svg><foreignObject><iframe srcdoc="<script>parent.__htmlProof=1</script>"></iframe></foreignObject></svg>'],
];
const report = {
  passed: false, checks: [], errors: [], engines,
  dependency: JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).dependencies.dompurify,
  sources: Object.fromEntries(Object.entries(sources).map(([name, source]) => [paths[name], createHash("sha256").update(source).digest("hex")])),
  boundary: "Actual production transforms and innerHTML expression; isolated DOM host, no user accounts, no school requests, no native APIs.",
};
const check = (value, label) => { assert.ok(value, label); report.checks.push(label); };

for (const engine of engines) {
  const browser = await (engine === "webkit" ? webkit : chromium).launch({
    headless: true,
    ...(engine === "chromium" ? { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } : {}),
  });
  try {
    const page = await browser.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    await page.routeWebSocket(/(?:localhost|127\.0\.0\.1):5180/, () => {});
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:5180|localhost:5180)/, route => route.abort());
    await page.route(base + "/__test/html-safety", route => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta charset="utf-8"></head><body><main id="preview"></main></body></html>',
    }));
    await page.goto(base + "/__test/html-safety");
    await page.evaluate(async ({ functionSources, richExpression }) => {
      const { sanitizeDisplayHtml } = await import("/src/lib/safeHtml.ts");
      const { stripInlineColors } = await import("/src/lib/htmlTheme.ts");
      const instantiate = (source, name) => new Function("sanitizeDisplayHtml", "stripInlineColors", "BASE", source + ";return " + name)(sanitizeDisplayHtml, stripInlineColors, "https://thubook.help");
      window.__htmlTransforms = {
        userext: instantiate(functionSources.userext, "sanitizeUserHtml"),
        docx: instantiate(functionSources.docx, "sanitizeDocxHtml"),
        thubook: html => instantiate(functionSources.thubook, "extractMain")("<main>" + html + "</main>").html,
        rich: new Function("sanitizeDisplayHtml", "stripInlineColors", "html", "return " + richExpression),
        shared: sanitizeDisplayHtml,
      };
      const rich = window.__htmlTransforms.rich;
      window.__htmlTransforms.rich = html => rich(sanitizeDisplayHtml, stripInlineColors, html);
    }, { functionSources, richExpression });
    for (const name of Object.keys(paths)) {
      for (const [label, payload] of payloads) {
        await page.evaluate(({ name, payload }) => {
          window.__htmlProof = 0;
          document.getElementById("preview").innerHTML = window.__htmlTransforms[name](payload);
        }, { name, payload });
        const links = page.locator("#preview a");
        for (let index = 0; index < await links.count(); index++) await links.nth(index).click();
        await page.waitForTimeout(35);
        const result = await page.evaluate(() => ({
          executed: window.__htmlProof !== 0,
          containers: document.querySelectorAll("#preview script,#preview iframe,#preview object,#preview embed,#preview style,#preview form,#preview input,#preview button,#preview meta,#preview base").length,
          eventAttributes: [...document.querySelectorAll("#preview *")].some(el => [...el.attributes].some(attr => /^on/i.test(attr.name))),
        }));
        check(!result.executed, `${engine} ${name} ${label}: no execution`);
        check(result.containers === 0 && !result.eventAttributes, `${engine} ${name} ${label}: active content removed`);
      }
      const preserved = await page.evaluate(name => {
        const payload = '<h2>原始标题 &amp; 内容</h2><p style="font-weight:bold">段落 <em>强调</em></p><table><tr><td>单元格</td></tr></table><a href="https://example.invalid/guide">文档链接</a><img src="https://example.invalid/image.png" alt="说明"><span data-vault-catch="untrusted">标签</span>';
        document.getElementById("preview").innerHTML = window.__htmlTransforms[name](payload);
        const root = document.getElementById("preview");
        return {
          text: root.textContent, table: root.querySelector("table td")?.textContent,
          href: root.querySelector("a")?.getAttribute("href"), image: root.querySelector("img")?.getAttribute("src"),
          metadata: !!root.querySelector("[data-vault-catch]"),
        };
      }, name);
      check(preserved.text.includes("原始标题 & 内容") && preserved.text.includes("强调") && preserved.table === "单元格", `${engine} ${name}: normal document structure and original text retained`);
      check(preserved.href === "https://example.invalid/guide" && preserved.image === "https://example.invalid/image.png", `${engine} ${name}: safe links and images retained`);
      check(!preserved.metadata, `${engine} ${name}: document cannot impersonate application data hooks`);
    }
    const fallback = await page.evaluate(async () => {
      const mod = await import("/src/lib/safeHtml.ts");
      const resources = performance.getEntriesByType("resource").map(entry => entry.name);
      const url = resources.find(url => /\/dompurify(?:\.js|\?)/.test(url));
      if (!url) throw Error("Actual DOMPurify module was not loaded");
      const { default: purifier } = await import(url);
      const original = purifier.sanitize, supported = purifier.isSupported;
      try {
        const source = '<img src="data:,broken" onerror=globalThis.__htmlProof=1><b>保留</b>';
        purifier.isSupported = false;
        const unsupported = mod.sanitizeDisplayHtml(source);
        purifier.isSupported = true;
        purifier.sanitize = () => { throw Error("fixture parser failure"); };
        const failed = mod.sanitizeDisplayHtml(source);
        return { unsupported, failed };
      } finally { purifier.sanitize = original; purifier.isSupported = supported; }
    });
    check(fallback.unsupported.startsWith("&lt;img") && !fallback.unsupported.includes("<img"), engine + ": unsupported sanitizer fails closed as text");
    check(fallback.failed === fallback.unsupported, engine + ": parser failure never restores raw markup");
    console.log(engine + ": HTML transforms passed.");
  } catch (error) {
    report.failure = String(error);
    writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
    throw error;
  } finally { await browser.close(); }
}
check(report.errors.length === 0, "No browser runtime errors: " + report.errors.join("; "));
report.passed = true;
writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
console.log(`HTML safety: ${report.checks.length} checks passed.`);
