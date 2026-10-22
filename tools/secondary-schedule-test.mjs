/** Exercise the production parser and merge with synthetic school pages. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import './ts-resolve-register.mjs';
import { parseCellAnchor } from '../packages/core/src/zhjwxk/anchor.ts';

class AuthRequiredError extends Error {}
const source = fs.readFileSync(new URL('../apps/desktop/src/lib/infoLib.ts', import.meta.url), 'utf8');
const start = source.indexOf('export const getSecondaryEntries =');
const end = source.indexOf('/** 强制完整重登', start);
assert.ok(start >= 0 && end > start);
const exports = {};
vm.runInNewContext(ts.transpileModule(source.slice(start, end), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, parseCellAnchor, AuthRequiredError, i18n: key => key, log: async () => {} });
const parse = (html, firstDay = '2026-09-14', from = '2026-09-14', to = '2026-12-31') =>
  exports.getSecondaryEntries({ text: async url => { assert.match(url, /^http:\/\/zhjw\.cic\.tsinghua\.edu\.cn\/portal3rd\.do\?m=bks_ejkbSearch$/); return html; } }, firstDay, from, to);
const entry = (title, weeks = '第4周', anchor = 'a4_5') =>
  `strHTML = "<span onmouseover=\\"return overlib('04_54( 测试教室，${weeks})');\\" onmouseout='return nd();'>${title}</span>"; document.getElementById('${anchor}').innerHTML += strHTML+"<br>";`;
const page = body => `<html><script>function setInitValue() {\n${body}\n}</script></html>`;
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('✓ ' + name); }

await test('real setInitValue shape resolves teaching week, Friday and fourth session', async () => {
  const rows = await parse(page(entry('测试实验课')));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-10-09');
  assert.equal(rows[0].dayOfWeek, 5);
  assert.equal(rows[0].startTime, '15:20');
  assert.equal(rows[0].endTime, '16:55');
  assert.equal(rows[0].location, '测试教室');
});
await test('window clipping retains only matching occurrences', async () => {
  const rows = await parse(page(entry('多周实验课', '第3-5周')), '2026-09-14', '2026-10-05', '2026-10-11');
  assert.deepEqual(Array.from(rows, r => r.date), ['2026-10-09']);
});
await test('tilde week range expands every week', async () => {
  assert.equal((await parse(page(entry('范围实验课', '第3~5周')))).length, 3);
});
await test('genuinely empty secondary page succeeds', async () => {
  assert.equal((await parse(page(''))).length, 0);
});
await test('login and unknown pages reject instead of reporting an empty timetable', async () => {
  await assert.rejects(parse('<html>登录超时</html>'), AuthRequiredError);
  await assert.rejects(parse('<html>service unavailable</html>'), /schedule.secondary.unavailable/);
});
await test('a changed populated page is a parse failure, not a successful empty schedule', async () => {
  await assert.rejects(parse(page('document.getElementById("a4_5").innerHTML += changedMarkup;')), /schedule.secondary.unavailable/);
  await assert.rejects(parse('function setInitValue() {'), /schedule.secondary.unavailable/);
});
await test('invalid semester is rejected before date expansion', async () => {
  await assert.rejects(parse(page(entry('测试实验课')), ''), /schedule.secondary.invalidSemester/);
});
await test('shared merge deduplicates primary rows and preserves source snapshots', async () => {
  const mergeSource = fs.readFileSync(new URL('../apps/desktop/src/lib/scheduleSecondary.ts', import.meta.url), 'utf8');
  const mergedExports = {};
  const primary = [{ courseName: '测试实验课', date: '2026-10-09', startTime: '15:20' }];
  const secondary = await parse(page(entry('测试实验课') + '\n' + entry('另一门实验课', '第4周', 'a3_4')));
  const imports = { './infoLib.js': { getSecondaryEntries: async () => secondary }, './clients.js': { http: {} } };
  vm.runInNewContext(ts.transpileModule(mergeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: mergedExports, require: id => { assert.ok(id in imports); return imports[id]; } });
  const rows = await mergedExports.appendSecondarySchedule(primary, '2026-09-14', '2026-10-05', '2026-10-11');
  assert.equal(rows.length, 2);
  assert.equal(primary.length, 1);
  assert.equal(rows[1].raw.source, 'secondary');
});
console.log(`\n${checks} secondary timetable checks passed`);
