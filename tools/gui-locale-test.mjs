/** Library locale contract using real React components and a source-only TSX loader. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const loaded = new Map();
function load(path) {
  path = resolve(path);
  if (!existsSync(path) && path.endsWith(".js")) {
    path = [path.slice(0, -3) + ".ts", path.slice(0, -3) + ".tsx"].find(existsSync);
  }
  assert.ok(path, "resolvable library import");
  if (loaded.has(path)) return loaded.get(path).exports;
  const module = { exports: {} };
  loaded.set(path, module);
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: path,
  }).outputText;
  const localRequire = name => name.startsWith(".") ? load(resolve(dirname(path), name)) : require(name);
  new Function("require", "module", "exports", js)(localRequire, module, module.exports);
  return module.exports;
}

const locale = load("packages/gui/src/locale.tsx");
const { OneGUILocaleProvider: Provider, useOneGUILocale, ONE_GUI_MESSAGE_KEYS: keys, ONE_GUI_ZH_CN: zh, ONE_GUI_EN_US: en } = locale;
const form = load("packages/gui/src/components/form.tsx");
const display = load("packages/gui/src/components/display.tsx");
const patterns = load("packages/gui/src/components/patterns.tsx");
const shell = load("packages/gui/src/components/shell.tsx");
const chip = load("packages/gui/src/components/chip.tsx");
const h = React.createElement;
let count = 0;
const check = (condition, message) => { assert.ok(condition, message); count++; };
function Probe() {
  const { locale: current, t } = useOneGUILocale();
  return h("div", { lang: current }, keys.map(key => h("span", { key, "data-key": key }, t(key))));
}
const render = (props, children = h(Probe)) => renderToStaticMarkup(h(Provider, props, children));

check(keys.length === 26 && new Set(keys).size === keys.length, "26 unique library message keys");
check(JSON.stringify(Object.keys(en).sort()) === JSON.stringify([...keys].sort()), "English includes every Chinese library default");
for (const key of keys) {
  check(typeof en[key] === "string" && en[key].trim() && !/\p{Script=Han}/u.test(en[key]), key + ": complete English default");
}
check(renderToStaticMarkup(h(Probe)).includes('lang="zh-CN"') && renderToStaticMarkup(h(Probe)).includes("关闭"), "No host provider preserves Chinese defaults");
check(render({ locale: "en-US" }).includes(">Close<") && !render({ locale: "en-US" }).includes("关闭"), "Locale alone selects complete English defaults");
check(render({ locale: "en-US", messages: { "gui.action.close": "Dismiss" } }).includes(">Dismiss<"), "External host message overrides library default");
check(render({ locale: "en-US", messages: { "gui.action.close": "" } }).includes(">Close<"), "Empty host message cannot erase accessible labels");
check(render({ locale: "fr-FR", messages: { "gui.action.close": "Fermer" } }).includes(">Fermer<"), "Hosts can inject another locale without a desktop dependency");
check(render({ locale: "en-US", messages: { "gui.action.close": "Dismiss" } }, h(Provider, null, h(Probe))).includes(">Dismiss<"), "Nested scopes inherit same-language messages");
check(render({ locale: "zh-CN", messages: { "gui.action.close": "自定义关闭" } }, h(Provider, { locale: "en-US" }, h(Probe))).includes(">Close<"), "Nested locale switch does not retain previous-language overrides");
check(render({ locale: "en-US", messages: { "gui.action.close": "<img onerror=alert(1)>" } }).includes("&lt;img"), "Host message remains escaped text");

const components = h(React.Fragment, null,
  h(form.SearchField, { defaultValue: "用户原文" }),
  h(form.SearchField, { placeholder: "用户指定占位" }),
  h(form.NumberField, { defaultValue: 2 }),
  h(form.RangeSlider, { defaultValue: [2, 8] }),
  h(display.Spinner),
  h(display.Breadcrumb, { items: [{ label: "用户路径" }] }),
  h(display.Pagination, { page: 2, pageCount: 3, onChange() {} }),
  h(display.CodeBlock, { code: "用户代码" }),
  h(patterns.PageHead, { onBack() {}, title: "用户标题" }),
  h(patterns.Banner, { onDismiss() {} }, "用户状态"),
  h(chip.Chip, { onRemove() {} }, "用户标签"),
  h(shell.NavRail, { tabs: [{ id: "user", label: "用户标签页", onClose() {} }], activeTab: "user", onSelect() {} }),
  h(shell.TabStrip, { tabs: [{ id: "user", label: "用户标签页", onClose() {} }], activeTab: "user", onSelect() {}, onMore() {} }),
  h(shell.AppShell, { tabs: [], activeTab: "", onSelectTab() {}, platform: "mobile" }),
);
const english = render({ locale: "en-US" }, components);
for (const text of ["Search", "Clear", "Decrease", "Increase", "Lower bound", "Upper bound", "Loading", "Breadcrumb", "Previous page", "Next page", "Copy", "Back", "Close", "Remove", "Tabs", "Close tab", "All tabs", "Home"]) {
  check(english.includes(text), "Real component renders: " + text);
}
for (const text of ["用户原文", "用户指定占位", "用户路径", "用户代码", "用户标题", "用户状态", "用户标签", "用户标签页"]) {
  check(english.includes(text), "Caller-owned content stays unchanged: " + text);
}

const referenced = new Set();
const leftovers = [];
for (const file of readdirSync("packages/gui/src/components").filter(file => /\.tsx?$/.test(file))) {
  const path = "packages/gui/src/components/" + file;
  const source = readFileSync(path, "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function walk(node) {
    if ((ts.isStringLiteralLike(node) || ts.isJsxText(node)) && /\p{Script=Han}/u.test(node.text)) leftovers.push(file + ": " + node.text);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "guiText" && ts.isStringLiteral(node.arguments[0])) referenced.add(node.arguments[0].text);
    ts.forEachChild(node, walk);
  }
  walk(ast);
}
check(leftovers.length === 0, "No hard-coded Chinese defaults left in GUI components: " + leftovers.join("; "));
check(JSON.stringify([...referenced].sort()) === JSON.stringify([...keys].sort()), "Every library key is actually consumed, with no missing references");
check(!/\b(?:from|import)\s*(?:\(|)\s*["'][^"']*desktop/.test(readFileSync("packages/gui/src/locale.tsx", "utf8")), "Locale provider never imports desktop");
console.log(`OneGUI locale: ${count} checks passed.`);
