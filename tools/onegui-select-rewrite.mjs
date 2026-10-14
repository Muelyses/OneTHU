#!/usr/bin/env node
/* AST 级把 <select className="input|field"> 改成 OneGUI <Select>：
 *  - 只动属性：丢 className（外观交 variant）、丢 style（库组件不接受）、type；
 *  - onChange 由 (e) => …e.target.value… 改成 (value) => …value…（用 AST 取到箭头函数的精确文本再改写）；
 *  - 保留 children（<option> 原样）。
 * 用法：node tools/onegui-select-rewrite.mjs [--apply]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const APP = join(ROOT, "apps/desktop/src");
const APPLY = process.argv.includes("--apply");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith("._")) continue;
    const p = join(dir, name);
    statSync(p).isDirectory() ? walk(p, out) : name.endsWith(".tsx") && out.push(p);
  }
  return out;
}

function rewriteArrow(text, param) {
  let out = text.replace(/^\s*\(?\s*[\w,\s]*\s*\)?\s*=>/, "(value) =>");
  out = out.replaceAll(`${param}.target.value`, "value");
  return out;
}

/** Input/TextArea 允许的属性白名单：不在表里的一律不转换（保证编译干净） */
const INPUT_OK = new Set([
  "className", "style", "type", "value", "defaultValue", "onChange", "placeholder", "name", "disabled",
  "readOnly", "autoFocus", "maxLength", "inputMode", "autoComplete", "spellCheck", "onKeyDown",
  "onEnter", "onEscape", "aria-label", "title", "invalid", "size", "id",
]);

const isTextField = (tag, attrs, sf) => {
  const cls = attrs.find((a) => a.name?.getText(sf) === "className");
  const clsText = cls?.initializer?.getText(sf) ?? "";
  if (!/\b(input|field)\b/.test(clsText)) return null;
  const typeAttr = attrs.find((a) => a.name?.getText(sf) === "type");
  if (typeAttr) {
    const t = typeAttr.initializer?.getText(sf) ?? "";
    if (!/"(text|email|tel|url|search|password|number)"/.test(t)) return null;
  }
  for (const a of attrs) {
    const name = a.name?.getText(sf) ?? "";
    if (name === "ref" || name === "key") return null;
    if (name === "style") {
      // 带 width/maxWidth 的输入框：宽度是布局语义，交给人工迁移（不许丢观感）
      const inline = a.initializer?.getText(sf) ?? "";
      if (/width|maxWidth|flex/.test(inline)) return null;
    }
    if (!INPUT_OK.has(name)) return null;
  }
  return tag === "textarea" ? "TextArea" : "Input";
};

function buildAttrs(attrs, sf) {
  const kept = [];
  for (const a of attrs) {
    const name = a.name?.getText(sf) ?? "";
    if (name === "className" || name === "id") continue;
    let text = a.getText(sf);
    if (name === "style") continue;   // OneGUI 组件不接受 style：带尺寸的输入框整只跳过（见 isTextField）
    if (name === "title") text = "titleAttr" + text.slice(5);
    if (name === "onChange") {
      const init = a.initializer;
      if (init && ts.isJsxExpression(init) && init.expression && ts.isArrowFunction(init.expression)) {
        const arrow = init.expression;
        const param = arrow.parameters[0]?.name?.getText(sf) ?? "e";
        text = `onChange={${rewriteArrow(arrow.getText(sf), param)}}`;
      }
    }
    kept.push(text);
  }
  return kept;
}

let files = 0, count = 0, textCount = 0;
for (const file of walk(APP)) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const visit = (node) => {
    // <input … /> 与 <textarea>…</textarea>
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) {
      const open = ts.isJsxElement(node) ? node.openingElement : node;
      const tagName = open.tagName.getText(sf);
      if (tagName === "input" || tagName === "textarea") {
        const attrs = open.attributes.properties;
        const comp = isTextField(tagName, attrs, sf);
        if (comp) {
          const kept = buildAttrs(attrs, sf);
          const selfClose = ts.isJsxSelfClosingElement(node);
          const children = selfClose ? "" : node.children.map((c) => c.getText(sf)).join("");
          const next = selfClose
            ? `<${comp}${kept.length ? " " + kept.join(" ") : ""} />`
            : `<${comp}${kept.length ? " " + kept.join(" ") : ""}>${children}</${comp}>`;
          edits.push([node.getStart(sf), node.getEnd(), next, comp]);
        }
      }
    }
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(sf);
      if (tag === "select") {
        const attrs = node.openingElement.attributes.properties;
        const cls = attrs.find((a) => a.name?.getText(sf) === "className");
        const clsText = cls?.initializer?.getText(sf) ?? "";
        if (/\b(input|field)\b/.test(clsText)) {
          const kept = [];
          for (const a of attrs) {
            const name = a.name?.getText(sf) ?? "";
            if (name === "className" || name === "style" || name === "type") continue;
            let text = a.getText(sf);
            if (name === "title") text = "titleAttr" + text.slice(5);
            if (name === "onChange") {
              const init = a.initializer;
              if (init && ts.isJsxExpression(init) && init.expression && ts.isArrowFunction(init.expression)) {
                const arrow = init.expression;
                const param = arrow.parameters[0]?.name?.getText(sf) ?? "e";
                text = `onChange={${rewriteArrow(arrow.getText(sf), param)}}`;
              }
            }
            kept.push(text);
          }
          const children = node.children.map((c) => c.getText(sf)).join("");
          const next = `<Select${kept.length ? " " + kept.join(" ") : ""}>${children}</Select>`;
          edits.push([node.getStart(sf), node.getEnd(), next, "Select"]);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) continue;
  let out = src;
  for (const [a, b, text] of edits.reverse()) out = out.slice(0, a) + text + out.slice(b);
  const comps = [...new Set(edits.map((e) => e[3]))];
  const missing = comps.filter((c) => !new RegExp(`import\\s*\\{[^}]*\\b${c}\\b[^}]*\\}\\s*from\\s*"@onethu/gui"`).test(out));
  if (missing.length) out = `import { ${missing.join(", ")} } from "@onethu/gui";\n` + out;
  if (APPLY) writeFileSync(file, out);
  files += 1;
  count += edits.filter((e) => e[3] === "Select").length;
  textCount += edits.filter((e) => e[3] !== "Select").length;
}
console.log(`${APPLY ? "已改写" : "可改写"}：<select> ${count} 个，<input>/<textarea> ${textCount} 个 / ${files} 个文件`);
