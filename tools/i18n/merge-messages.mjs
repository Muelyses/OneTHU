/**
 * Reviewed migration helper: combine adjacent translated string fragments.
 * Only a full string-concatenation tree of literal strings / bound t() calls
 * qualifies; arithmetic, coercions, conditionals and user values are untouched.
 */
import fs from "node:fs";
import ts from "typescript";
import crypto from "node:crypto";
import { readDataFile, slots } from "./dictionary.mjs";
const root = "apps/desktop/src";
const messages = readDataFile(`${root}/i18n/locales/zh-CN.ts`).messages;
const catalog = JSON.parse(fs.readFileSync("docs/i18n/extracted.json", "utf8"));
const write = process.argv.includes("--write");
let merged = 0;
for (const file of fs.readdirSync(root, { recursive: true }).filter(f => /\.tsx?$/.test(f) && !f.startsWith("i18n/") && !f.split("/").some(p => p.startsWith("._")))) {
  const path = `${root}/${file}`, source = fs.readFileSync(path, "utf8"), ast = ts.createSourceFile(path, source, 99, true), edits = [], bindings = new Set();
  let importPath, hasMsg = false;
  for (const st of ast.statements) if (ts.isImportDeclaration(st) && /i18n\/index\.js$/.test(st.moduleSpecifier.text ?? "")) {
    importPath = st.moduleSpecifier.text;
    const b = st.importClause?.namedBindings;
    if (b && ts.isNamedImports(b)) for (const el of b.elements) {
      if ((el.propertyName?.text ?? el.name.text) === "t") bindings.add(el.name.text);
      if (el.name.text === "i18nMsg") hasMsg = true;
    }
  }
  let needsMsg = false;
  function leaf(n) {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const a = leaf(n.left), b = leaf(n.right);
      return a && b ? [...a, ...b] : null;
    }
    if (ts.isStringLiteral(n)) return [{ text: n.text, params: [], call: false }];
    if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || !bindings.has(n.expression.text)) return null;
    const key = n.arguments[0], values = n.arguments[1];
    if (!key || !ts.isStringLiteral(key) || !Object.hasOwn(messages, key.text)) return null;
    if (values && !ts.isObjectLiteralExpression(values)) return null;
    const params = [];
    for (const p of values?.properties ?? []) {
      if (!ts.isPropertyAssignment(p) || ts.isComputedPropertyName(p.name)) return null;
      params.push({ name: p.name.text, expression: p.initializer.getText(ast) });
    }
    if (slots(messages[key.text]).some(name => !params.some(p => p.name === name))) return null;
    return [{ text: messages[key.text], params, call: true }];
  }
  function visit(n) {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const pieces = leaf(n);
      if (pieces && pieces.filter(p => p.call).length >= 2) {
        const params = [], used = new Set();
        const text = pieces.map(piece => {
          const names = new Map();
          for (const p of piece.params) {
            let name = p.name, i = 2;
            while (used.has(name)) name = p.name + i++;
            used.add(name); names.set(p.name, name); params.push({ ...p, name });
          }
          return piece.text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k) => names.has(k) ? `{${names.get(k)}}` : m);
        }).join("");
        const prefix = file.replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, ".").toLowerCase();
        const key = `${prefix}.${crypto.createHash("sha256").update(text).digest("hex").slice(0, 12)}`;
        const descriptor = ts.isCallExpression(n.parent) && /^(confirmOk|confirmDanger|confirmChoice|promptText|showToast)$/.test(n.parent.expression.getText(ast));
        if (descriptor) needsMsg = true;
        const name = descriptor ? "i18nMsg" : [...bindings][0];
        edits.push({ start: n.getStart(ast), end: n.end, text: `${name}(${JSON.stringify(key)}${params.length ? `, { ${params.map(p => `${p.name}: ${p.expression}`).join(", ")} }` : ""})` });
        if (!catalog.some(row => row.key === key)) catalog.push({ key, source: text, kind: "text", parameters: params, locations: [{ file: path, line: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1, context: n.parent.getText(ast).slice(0, 1000) }] });
        merged++; return;
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(ast);
  if (write && edits.length) {
    let output = source;
    for (const e of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, e.start) + e.text + output.slice(e.end);
    if (needsMsg && !hasMsg) output = `import { msg as i18nMsg } from ${JSON.stringify(importPath)};\n` + output;
    fs.writeFileSync(path, output);
  }
}
if (write) fs.writeFileSync("docs/i18n/extracted.json", JSON.stringify(catalog, null, 2) + "\n");
console.log({ merged, write });
