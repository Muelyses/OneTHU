/** Real TS snapshots/rendering plus the production runtime with native/data I/O mocks.
 * node --import ./tools/ts-resolve-register.mjs tools/widget-i18n-test.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as i18n from '../apps/desktop/src/i18n/index.ts';
import * as text from '../apps/desktop/src/state/widgetText.ts';
import * as snapshot from '../apps/desktop/src/state/widgetSnapshot.ts';
import { nativeRender } from '../apps/desktop/src/state/widgetNativeRender.ts';
import { createSyncer } from '../apps/desktop/src/state/displaySyncer.ts';
let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); checks++; console.log('✓ ' + label); };
const seed = JSON.parse(fs.readFileSync('docs/i18n/native-widget-seed.json', 'utf8')).messages;
const legacy = JSON.parse(fs.readFileSync('apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/assets/onethu-widget-zh.json', 'utf8'));
check(Object.keys(legacy).length === 62 && text.WIDGET_TEXT_KEYS.length === 62, 'Only the 62 widget templates cross the native boundary');
for (const key of text.WIDGET_TEXT_KEYS) {
  assert.equal(legacy[key], seed['native.widget.' + key]['zh-CN']);
  assert.equal(legacy[key], i18n.localeTable('zh-CN')['native.widget.' + key]);
}
check(true, 'Generated native legacy fallback equals the translation source and merged Chinese catalog');
const now = new Date(2026, 9, 20, 9).getTime();
const input = { now, remind: { default: 120, items: {} }, schedule: [{ date: '2026-10-20', startTime: '10:00', endTime: '11:35', courseName: '真实课程', location: '六教' }], homework: [{ id: 'h1', title: '原作业', deadline: '2026-10-20 12:00:00', submitted: false }], events: [{ uid: 'unchanged', summary: '原日程', start: now + 4 * 3600000, inWidget: true }] };
const lang = { locale: 'en-US', widgetText: { ...legacy, title: 'Today {month}/{day}', today: 'Today', ongoing: 'In class', 'hours.one': '{count} hour left', 'hours.other': '{count} hours left', 'minutes.one': '{count} minute left', 'minutes.other': '{count} minutes left', 'classes.one': '{count} class', 'classes.other': '{count} classes', 'ddls.one': '{count} deadline', 'events.one': '{count} event', eventRow: 'Event {title}', empty: 'No classes or deadlines today', completed: 'Classes finished', 'more.other': '{count} more' } };
const zh = snapshot.buildWidgetSnapshot(input);
const en = snapshot.buildWidgetSnapshot({ ...input, language: lang });
check(en.title === 'Today 10/20' && en.rows[0].sub === '六教 · 1 hour left', 'Captured locale controls the actual snapshot, including singular time');
check(en.footer === '1 class · 1 deadline · 1 event', 'Native count templates select each semantic count independently');
check(en.rows[2].text === 'Event 原日程', 'Event wrapper translates while original event text remains intact');
check(JSON.stringify(en.rows.map(({ at, until, rel, loc }) => ({ at, until, rel, loc }))) === JSON.stringify(zh.rows.map(({ at, until, rel, loc }) => ({ at, until, rel, loc }))) && en.target === zh.target, 'Locale changes never modify event times, relation keys, locations, or targets');
i18n.setLocale('zh-CN');
const ongoing = nativeRender({ ...en, now: now + 90 * 60000 });
check(ongoing.rows[0].sub === 'In class · 六教' && ongoing.title === 'Today 10/20', 'Saved English snapshot stays English when the application locale is Chinese');
i18n.setLocale('en-US');
const old = nativeRender({ rows: zh.rows, counts: zh.counts, titleAt: now, now: now + 90 * 60000 });
check(old.rows[0].sub === '正在上课 · 六教' && old.title === '今天 10月20日', 'Missing locale fields retain legacy Chinese regardless of active locale');
check(text.widgetText(lang).left(2 * 3600000) === '2 hours left', 'Plural branch changes at two hours');
check(text.widgetText({ locale: 'en-US', widgetText: { 'hours.other': '{count} hours' } }).left(3600000) === '1 hours', 'Incomplete incoming dictionaries use their own other branch');
check(text.widgetText({ locale: 'invalid_locale', widgetText: {} }).left(3600000) === '还有 1 小时', 'Malformed locale never crashes background refresh');
check(text.widgetText(lang).text('eventRow', { title: '$& {count} <b>原文</b>' }) === 'Event $& {count} <b>原文</b>', 'Placeholder values are literal text and never recursively interpolated');
const detail = snapshot.buildDetailSnapshot({ language: en, title: '用户原始标题', rows: [{ text: '原文' }], footer: '用户备注', target: 'learn-course', now });
check(detail.titleAt === 0 && !('counts' in detail) && nativeRender({ ...detail, now }).title === detail.title, 'Detail widgets keep their own title instead of becoming Today');
const grid = snapshot.buildGridSnapshot({ language: en, title: '收藏原名', items: [{ label: '原子名', target: 'learn' }], target: 'folder', now });
check(!('counts' in grid) && !('rows' in grid) && grid.locale === 'en-US' && grid.items[0].target === 'learn', 'Passing snapshot language cannot leak Today rows/counts into grid widgets');

const exported = {};
const imports = {
  '../i18n/index.js': i18n, './widgetText.js': text, './widgetSnapshot.js': snapshot, './displaySyncer.js': { createSyncer },
  './hwRemind.js': { getHwRemindState: () => input.remind },
  '../plugins/pluginWidgets.js': { collectWidgetSlots: () => [{ slot: '1', title: '插件原名', rows: [{ text: '用户文字' }], target: 'plugins' }] },
  './userext.js': { phoneWidgetSnapshot: () => null }, './widgetIcon.js': { atomIconPng: async () => null },
  './widgetInstances.js': { bindingOf: () => ({ kind: 'today' }), loadWidgetInstances: () => ({}), pruneWidgetInstances: () => {} },
};
const code = ts.transpileModule(fs.readFileSync('apps/desktop/src/state/widgetRuntime.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext(code, { exports: exported, require: name => { assert.ok(imports[name], name); return imports[name]; }, setTimeout, clearTimeout, setInterval, clearInterval });
const wait = async fn => { const end = Date.now() + 2000; while (!fn()) { assert.ok(Date.now() < end, 'bounded runtime convergence'); await new Promise(r => setTimeout(r, 5)); } };
let release;
let reads = 0;
let writes = [];
i18n.setLocale('zh-CN');
const runtime = exported.createWidgetRuntime({
  backendAvailable: true, collect: () => input, subscribe: () => () => {}, tickMs: 999999,
  listInstances: async () => { reads++; if (reads === 1) await new Promise(r => { release = r; }); return [{ id: 7, w: 200, h: 200 }]; },
  invoke: async (command, args) => { assert.equal(command, 'widget_push'); writes.push(JSON.parse(args.snapshot)); return { ok: true }; },
});
await wait(() => !!release);
i18n.setLocale('en-US'); release();
await wait(() => writes.length === 1);
check(writes.every(p => p.locale === 'en-US' && p.instances['7'].locale === p.locale), 'Locale changes during collection discard stale language and actively push the latest snapshot');
check(writes[0].slots['1'].rows[0].text === '用户文字' && writes[0].slots['1'].locale === 'en-US', 'Plugin content remains verbatim and receives only native rendering metadata');
check(writes[0].prune === true && Object.keys(writes[0].instances).join() === '7', 'Translation preserves instance IDs and successful discovery pruning');
runtime.stop(); const written = writes.length; i18n.setLocale('zh-CN'); await new Promise(r => setTimeout(r, 20));
check(writes.length === written, 'Stopping runtime unsubscribes language changes');
writes = [];
const unavailable = exported.createWidgetRuntime({ backendAvailable: true, collect: () => input, subscribe: () => () => {}, tickMs: 999999, listInstances: async () => null, invoke: async (_cmd, args) => { writes.push(JSON.parse(args.snapshot)); return { ok: true }; } });
await wait(() => writes.length === 1); unavailable.stop();
check(writes[0].prune === false && Object.keys(writes[0].instances).length === 0, 'Failed native discovery sends prune=false rather than deleting saved instances');
let unblockWrite;
let activeWrites = 0;
let maxWrites = 0;
const order = [];
i18n.setLocale('zh-CN');
const serial = exported.createWidgetRuntime({ backendAvailable: true, collect: () => input, subscribe: () => () => {}, tickMs: 999999,
  listInstances: async () => [{ id: 9, w: 200, h: 200 }],
  invoke: async (_cmd, args) => {
    activeWrites++; maxWrites = Math.max(maxWrites, activeWrites);
    const payload = JSON.parse(args.snapshot);
    if (payload.locale === 'zh-CN') await new Promise(resolve => { unblockWrite = resolve; });
    order.push(payload.locale); activeWrites--; return { ok: true };
  },
});
await wait(() => !!unblockWrite);
i18n.setLocale('en-US');
await new Promise(resolve => setTimeout(resolve, 20));
check(activeWrites === 1 && order.length === 0, 'New locale cannot race a still-running native write');
unblockWrite(); await wait(() => order.length === 2);
check(maxWrites === 1 && order.join() === 'zh-CN,en-US' && serial.snapshot().locale === 'en-US', 'Serialized native writes finish with the latest language');
serial.stop();
let unblockRead;
let lateWrites = 0;
const stopped = exported.createWidgetRuntime({ backendAvailable: true, collect: () => input, subscribe: () => () => {}, tickMs: 999999,
  listInstances: async () => { await new Promise(resolve => { unblockRead = resolve; }); return [{ id: 10, w: 200, h: 200 }]; },
  invoke: async () => { lateWrites++; return { ok: true }; },
});
await wait(() => !!unblockRead); stopped.stop(); unblockRead();
await new Promise(resolve => setTimeout(resolve, 20));
check(lateWrites === 0, 'Stopping during asynchronous collection prevents a late native write');
i18n.setLocale('zh-CN');
console.log(`widget i18n: ${checks} checks passed`);
