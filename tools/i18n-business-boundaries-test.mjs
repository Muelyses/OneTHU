/** Evaluate the actual boundary expressions under deliberately different UI strings.
 * No school requests, application storage, or native commands are invoked.
 * Run: node tools/i18n-business-boundaries-test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let locale = 'zh';
const i18n = (key, params = {}) => `${locale}:${key}:${Object.values(params).join('|')}`;
let passed = 0;
function check(condition, label) { assert.ok(condition, label); passed++; console.log('✓ ' + label); }
const source = path => ts.createSourceFile(path, fs.readFileSync('apps/desktop/src/' + path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(ast, predicate) { const found = []; function walk(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, walk); } walk(ast); return found; }
const variable = (ast, name) => find(ast, n => ts.isVariableDeclaration(n) && n.name.getText(ast) === name)[0];
const declaration = (ast, name) => { const n = variable(ast, name); assert.ok(n, name); return `const ${n.getText(ast)};`; };
function evaluate(code, scope = {}) { return vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, { i18n, ...scope }); }
const thos = source('pages/info/ThosPage.tsx');
const statusFn = find(thos, n => ts.isFunctionDeclaration(n) && n.name?.text === 'statusLabel')[0];
const statusLabel = evaluate(`${declaration(thos, 'STATUS_LABEL')}\n${statusFn.getText(thos)}\nstatusLabel;`);
const statusPredicate = find(thos, n => ts.isArrowFunction(n) && n.body.getText(thos).includes('.includes(x.status)'))[0];
for (const language of ['zh', 'en']) {
  locale = language;
  check(statusLabel('任务已被张三办理').endsWith(':张三'), `${language}: raw school status delimiters parse the assignee`);
  check(statusLabel('待我处理').startsWith(language + ':'), `${language}: display status translates only after protocol matching`);
  const pending = evaluate(`(${statusPredicate.getText(thos)})`, { rows: [{ id: 'duplicate' }] });
  check(pending({ id: 'returned', status: '退回修改' }) && pending({ id: 'todo', status: '待我处理' }), `${language}: server pending tasks remain visible`);
  check(!pending({ id: 'duplicate', status: '待我处理' }) && !pending({ id: 'done', status: '已办结' }), `${language}: pending merge still excludes duplicates and completed tasks`);
}
const washer = source('pages/info/WasherTab.tsx'), live = source('components/LiveTiles.tsx');
const fallbackTitle = find(washer, n => ts.isVariableDeclaration(n) && n.name.getText(washer) === 'title' && n.initializer?.getText(washer).startsWith('w.name'))[0];
const collectKey = find(washer, n => ts.isCallExpression(n) && n.expression.getText(washer) === 'enc' && n.arguments.length === 4 && n.arguments[3].getText(washer) === 'deviceKey')[0];
check(Boolean(collectKey), 'Washer collectible encodes the stable device identity');
const devAttribute = find(washer, n => ts.isJsxAttribute(n) && n.name.getText(washer) === 'data-dev')[0];
check(devAttribute.initializer.expression.getText(washer) === 'deviceKey', 'Washer deep-link DOM target uses the same stable identity');
const lookup = find(live, n => ts.isArrowFunction(n) && n.parameters.length === 1 && n.parameters[0].name.getText(live) === 'x' && n.body.getText(live).includes('x.name || x.location || x.type'))[0];
for (const w of [{}, { name: '一号机' }, { location: '二楼' }, { type: '烘干机' }]) {
  const keys = [];
  for (const language of ['zh', 'en']) {
    locale = language;
    const result = evaluate(`${declaration(washer, 'deviceKey')}\nconst ${fallbackTitle.getText(washer)};\n({deviceKey,title});`, { w });
    keys.push(result.deviceKey);
    const findDevice = evaluate(`(${lookup.getText(live)})`, { dev: result.deviceKey });
    check(findDevice(w), `${language}: persisted washer key resolves ${w.name || w.location || w.type || 'unnamed device'}`);
    if (!Object.keys(w).length) check(result.title.startsWith(language + ':'), `${language}: unnamed device display remains translated`);
  }
  check(keys[0] === keys[1], 'Locale switch does not change a washer AtomRef identity');
}
for (const [path, name, raw] of [['state/systemCal.ts', 'CALENDAR_TITLE', 'OneTHU 日程'], ['plugins/XiaodaPane.tsx', 'AGENT_NAME', '清小搭'], ['pages/xiaoda/XiaodaPage.tsx', 'DEFAULT_AGENT_ID', '9999']]) {
  const ast = source(path);
  for (const language of ['zh', 'en']) { locale = language; check(evaluate(`${declaration(ast, name)}\n${name};`) === raw, `${language}: ${name} remains stable wire/native metadata`); }
}
const agentDisplay = source('pages/xiaoda/XiaodaPage.tsx');
for (const language of ['zh','en']) { locale=language; check(evaluate(`${declaration(agentDisplay,'DEFAULT_AGENT_NAME')}\nDEFAULT_AGENT_NAME();`).startsWith(language+':'), `${language}: default agent display name follows locale while its ID remains stable`); }
const courses = source('pages/zhjwxk/Courses.tsx');
const queries = find(courses, n => ts.isPropertyAssignment(n) && n.name.getText(courses) === 'infoNewsQuery');
check(queries.length === 3, 'All three external university notice links are covered');
for (const language of ['zh', 'en']) {
  locale = language;
  const values = queries.map(n => evaluate(`(${n.initializer.getText(courses)})`, { o: '北大研' }));
  check(values.join('|') === '北京大学 北京外国语大学|北京大学 研究生|北京大学 研究生', `${language}: Chinese school search terms remain server-compatible`);
  check(evaluate(`(${queries[2].initializer.getText(courses)})`, { o: '北大' }) === '北京大学 北京外国语大学', `${language}: undergraduate notice route retains its original query`);
}
const dock = source('plugins/ChatDock.tsx'), focus = [];
const openOwnApi = evaluate(`(${variable(dock, 'openOwnApi').initializer.getText(dock)})`, { uiLocale: 'en', useCallback: fn => fn, openSettings: family => focus.push(family), goOhRow: (...args) => focus.push(args) });
openOwnApi();
check(focus[0] === 'oh' && focus[1][0] === '模型MCP日志' && focus[1][1] === 'advanced', '429 action opens the fixed real advanced-section anchor');
const preview = source('components/FilePreview.tsx');
const previewNote = evaluate(`${declaration(preview, 'winPreviewNote')}\nwinPreviewNote;`);
locale = 'zh'; const oldNote = previewNote(); locale = 'en';
check(oldNote.startsWith('zh:') && previewNote().startsWith('en:'), 'Windows preview hint is resolved on display rather than module load');
const login = source('components/ExtHwLoginModal.tsx');
const channels = evaluate(`${declaration(login, 'YKT_SMS_DISABLED_NOTE')}\n${declaration(login, 'YKT_CHANNELS')}\nYKT_CHANNELS;`, { YKT_WEB_LOGIN_AVAILABLE: true });
locale = 'zh'; const oldHint = channels.find(c => c.key === 'sms').hint; locale = 'en';
check(oldHint.startsWith('zh:') && channels.find(c => c.key === 'sms').hint.startsWith('en:'), 'Already-created SMS channel resolves its hint after a language switch');
check(channels.map(c => c.key).join('|') === 'qr|web|sms' && channels[2].disabled, 'Locale display fixes preserve login channel identifiers and availability');
console.log(`i18n business boundaries: ${passed} checks passed`);
