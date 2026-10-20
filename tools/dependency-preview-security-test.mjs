/**
 * Isolated installed-library checks. No real files, accounts, or remote document URLs.
 * This verifies our reachable parser/editor contracts; it does not replace upstream CVE tests.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import ts from "typescript";
import { chromium } from "playwright";
import { closeTestBrowser } from "./lib/onboarding-browser-steps.mjs";

const desktop = path.resolve("apps/desktop");
const requireDesktop = createRequire(path.join(desktop, "package.json"));
const requireVite = createRequire(requireDesktop.resolve("vite"));
const { build } = requireVite("esbuild");
const XLSX = requireDesktop("xlsx");
const requireMammoth = createRequire(requireDesktop.resolve("mammoth"));
const JSZip = requireMammoth("jszip");
let count = 0;
const check = (condition, label) => { assert.ok(condition, label); count++; console.log("✓ " + label); };

check(XLSX.version === "0.20.3", "Installed SheetJS is the pinned upstream security-fixed release");
const manifest = JSON.parse(await fs.readFile(path.join(desktop, "package.json"), "utf8"));
check(manifest.dependencies.xlsx === "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz", "SheetJS comes from the documented official distribution");
const wb = XLSX.utils.book_new();
const sourceRows = [["课程", "数值", "原文"], ["线性代数", 0, '<img src=x onerror="fixture">'], ["A & B", 42.5, "中文 / English"]];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sourceRows), "课程");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["第二页"], ["保留"]]), "第二页");
const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" });
const loaded = XLSX.read(new Uint8Array(bytes), { type: "array" });
check(loaded.SheetNames.join("/") === "课程/第二页", "Preview parser preserves multiple sheets and Chinese names");
const rows = XLSX.utils.sheet_to_json(loaded.Sheets["课程"], { header: 1, defval: "", raw: false });
check(rows[1][1] === "0" && rows[2][1] === "42.5", "Preview formatting retains zero and numeric values");
check(rows[1][2] === sourceRows[1][2] && rows[2][0] === "A & B", "Spreadsheet markup stays a string, matching React cell rendering");

function formatsFromSource(source, filename) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let values;
  for (const statement of file.statements) if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(file) !== "FORMATS") continue;
      assert.ok(declaration.initializer && ts.isArrayLiteralExpression(declaration.initializer), "Explicit editor formats");
      values = declaration.initializer.elements.map(element => {
        assert.ok(ts.isStringLiteral(element), "Formats must be stable protocol strings");
        return element.text;
      });
    }
  }
  assert.ok(values?.length, "Editor formats found");
  return values;
}
const editorPaths = ["src/components/RichEditor.tsx", "src/components/exthw/YktSubjectiveEditor.tsx"];
const editorFormats = await Promise.all(editorPaths.map(async filename => ({
  filename, formats: formatsFromSource(await fs.readFile(path.join(desktop, filename), "utf8"), filename),
})));
for (const editor of editorFormats) check(!editor.formats.includes("formula") && !editor.formats.includes("video"), editor.filename + " excludes vulnerable semantic-export blots");

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "onethu-dependency-preview-"));
let browser;
try {
  // Resolve the wrapper's actual Quill dependency instead of assuming hoisting.
  const requireQuill = createRequire(requireDesktop.resolve("react-quill-new"));
  const result = await build({
    stdin: {
      contents: `import Quill from ${JSON.stringify(requireQuill.resolve("quill"))};
import mammoth from "mammoth";
import {sanitizeDisplayHtml} from "./src/lib/safeHtml.ts";
export {Quill,mammoth,sanitizeDisplayHtml};`,
      resolveDir: desktop, sourcefile: "dependency-fixture.ts",
    },
    bundle: true, write: false, format: "iife", globalName: "DependencyFixture", platform: "browser", metafile: true,
  });
  const modules = Object.keys(result.metafile.inputs);
  check(!modules.some(name => /[/\\](?:argparse|sprintf-js)[/\\]/.test(name)), "Actual browser conversion/editor bundle excludes Mammoth CLI argparse and sprintf-js");
  const scriptPath = path.join(temp, "libraries.js");
  await fs.writeFile(scriptPath, result.outputFiles[0].contents);

  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>课程 &amp; fixture</w:t></w:r></w:p></w:body></w:document>`);
  const docx = [...await zip.generateAsync({ type: "uint8array" })];
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true, args: ["--disable-updater-scheduler"],
  });
  const page = await browser.newPage();
  await page.route("**/*", route => route.abort());
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ path: scriptPath });
  const evidence = await page.evaluate(async ({ editorFormats, docx }) => {
    const { Quill, mammoth, sanitizeDisplayHtml } = window.DependencyFixture;
    const make = formats => {
      const node = document.createElement("div"); document.body.append(node);
      return new Quill(node, { modules: { toolbar: false }, ...(formats ? { formats } : {}) });
    };
    const payload = 'https://example.invalid/" onmouseover="window.__dependencyAttack=1';
    const unrestricted = make();
    unrestricted.insertEmbed(0, "video", payload);
    const vulnerableExport = unrestricted.getSemanticHTML();
    const cleaned = sanitizeDisplayHtml(vulnerableExport);
    const parsed = new DOMParser().parseFromString(cleaned, "text/html");
    const editors = editorFormats.map(({ filename, formats }) => {
      const q = make(formats);
      for (const kind of ["video", "formula"]) try { q.insertEmbed(0, kind, payload); } catch { /* rejected unknown format */ }
      q.clipboard.dangerouslyPasteHTML('<p>保留文本</p><iframe class="ql-video" src="https://example.invalid/"></iframe><span class="ql-formula" data-value="fixture">公式</span>');
      const delta = q.getContents();
      return { filename, exports: q.getSemanticHTML(), forbidden: delta.ops.some(op => op.insert && typeof op.insert === "object" && ("video" in op.insert || "formula" in op.insert)) };
    });
    const converted = await mammoth.convertToHtml({ arrayBuffer: new Uint8Array(docx).buffer });
    return { vulnerableExport, cleanHasHandlers: [...parsed.querySelectorAll("*")].some(el => [...el.attributes].some(attr => /^on/i.test(attr.name))), editors, converted: converted.value };
  }, { editorFormats, docx });
  check(evidence.vulnerableExport.includes('onmouseover="window.__dependencyAttack'), "Installed Quill advisory is genuinely reproducible outside the app allowlist");
  check(!evidence.cleanHasHandlers, "Actual shared display sanitizer removes malicious attributes from Quill export");
  for (const editor of evidence.editors) check(!editor.forbidden && editor.exports.includes("保留文本"), editor.filename + " rejects formula/video embeds while preserving text");
  check(evidence.converted === "<p>课程 &amp; fixture</p>", "Installed browser Mammoth converts a real minimal DOCX through the app arrayBuffer API");
  console.log(`Dependency preview security: ${count} checks passed; Quill and sprintf-js advisories remain in the dependency graph.`);
} finally {
  if (browser) await closeTestBrowser(browser);
  await fs.rm(temp, { recursive: true, force: true });
}
