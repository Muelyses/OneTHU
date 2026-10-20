/** Real state modules; only navigation effects are mocked. No account or network I/O. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as locale from '../apps/desktop/src/i18n/index.ts';
import * as settings from '../apps/desktop/src/state/settingsMode.ts';
const calls=[];
const source=fs.readFileSync('apps/desktop/src/state/searchRows.ts','utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};
const imports={
  './settingsMode.js':settings,
  '../components/Layout.js':{goEntry:entry=>calls.push(['entry',entry])},
  '../plugins/bridges.js':{navGo:page=>calls.push(['page',page])},
  './pluginsFocus.js':{requestPluginsFocus:spec=>calls.push(['focus',spec])},
};
vm.runInNewContext(code,{exports,require:id=>{assert.ok(id in imports,id);return imports[id]}},{filename:'searchRows.fixture.cjs'});
let passed=0;const check=(condition,label)=>{assert.ok(condition,label);passed++;console.log('✓ '+label)};
const row={id:'test-stable-id',tab:'外观与布局',section:'外观',breadcrumb:['设置','外观与布局','外观','永久路由标题'],get title(){return locale.t('common.confirm')},get desc(){return locale.t('common.cancel')}};
exports.defineSearchRows([row]);
check(exports.allSearchRows()[0]===row&&typeof Object.getOwnPropertyDescriptor(row,'title').get==='function','Registration preserves lazy title getter rather than spreading a snapshot');
locale.setLocale('en-US');
check(exports.matchSearchRows('Confirm')[0].row.id==='test-stable-id','Search reads the current translated title');
check(exports.displayBreadcrumb(row).join('|')==='Settings|Appearance & layout|Appearance|Confirm','Displayed breadcrumb translates separately from route metadata');
check(exports.familyOf(row)==='settings'&&exports.familyGroup(row)==='settings','Translated breadcrumb never changes the navigation family');
check(settings.SETTINGS_TAB_ORDER[0]==='账号'&&settings.settingsLabel('账号')==='Account','Persisted category IDs remain unchanged in English');
exports.goSearchRow(row);
check(settings.consumeSettingsTabRequest()==='外观与布局'&&settings.consumeSettingsSectionRequest()==='test-stable-id','English search dispatches stable category and row IDs');
check(calls.at(-1)[0]==='page'&&calls.at(-1)[1]==='settings','Search still opens the real settings family');
const route=exports.ohRouteTable()[0];
check(route.id==='test-stable-id'&&route.tab==='外观与布局'&&route.section==='外观'&&route.title==='Confirm','OH route protocol stays stable while its display title translates');
locale.setLocale('zh-CN');
check(exports.matchSearchRows('确定')[0].row.id==='test-stable-id'&&exports.allSearchRows()[0].title==='确定','Second language switch updates the same registered row');
exports.goSearchRow({...row,visible:()=>false,fallbackNote:'fixture reason'});
check(settings.consumeSettingsSectionRequest()==='外观','Hidden row falls back to its stable section instead of claiming a row hit');
const plugin={id:'test-oh-id',tab:'OneTHU Harness',section:'基础设置',breadcrumb:['插件','OneTHU Harness','基础设置','title'],displayRoot:'设置',get title(){return locale.t('common.confirm')}};
exports.defineSearchRow(plugin);locale.setLocale('en-US');
check(exports.familyGroup(plugin)==='mixed','OH display family remains separate from plugin routing in English');
exports.goSearchRow(plugin);
check(calls.at(-2)[1]==='oh'&&calls.at(-1)[1].target==='test-oh-id','OH default row requests the stable plugin focus target');
locale.setLocale('zh-CN');
console.log(`i18n settings routing: ${passed} checks passed`);
