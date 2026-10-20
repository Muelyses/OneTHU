/** Execute actual memo builders against React-style dependency caching; no network. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let passed=0,locale='zh';const check=(v,label)=>{assert.ok(v,label);passed++;console.log('✓ '+label);};
const source=p=>ts.createSourceFile(p,fs.readFileSync('apps/desktop/src/'+p,'utf8'),99,true,ts.ScriptKind.TSX);
function find(node,p){const list=[];function walk(n){if(p(n))list.push(n);ts.forEachChild(n,walk);}walk(node);return list;}
function hooks(){let cursor=0;const slots=[];return {render(fn){cursor=0;return fn();},useMemo(fn,deps){const i=cursor++,old=slots[i];if(old&&deps.length===old.deps.length&&deps.every((d,j)=>Object.is(d,old.deps[j])))return old.value;const value=fn();slots[i]={deps,value};return value;},useUiLocale:()=>locale};}
const i18n=(key,params={})=>`${locale}:${key}:${Object.values(params).join('|')}`;
function evaluate(code,scope){return vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,{i18n,...scope});}
const data=source('state/data.ts'),hook=find(data,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='useXkWorkbench')[0];
const variable=name=>find(hook,n=>ts.isVariableDeclaration(n)&&n.name.getText(data)===name)[0];
const localeVar=variable('uiLocale');check(localeVar?.initializer.getText(data)==='useUiLocale()','workbench subscribes to display locale');
const memo=variable('semesterOptions');assert.ok(memo);
const env=hooks();
const build=evaluate(`()=>{const ${localeVar.getText(data)};const ${memo.getText(data)};return semesterOptions;}`,{...env,semester:'2026-2027-1',semesterFromDate:()=>{throw Error('must use actual semester');}});
const zh=env.render(build),same=env.render(build);check(same===zh,'unchanged locale and semester reuse the same options');
locale='en';const en=env.render(build);
check(en!==zh&&en.every(x=>x.label.startsWith('en:')),'every cached semester display label updates without changing the semester');
check(JSON.stringify(en.map(x=>x.value))===JSON.stringify(zh.map(x=>x.value)),'language switching preserves every selection value');
check(en.map(x=>x.value).join('|')==='2026-2027-1|2026-2027-2|2026-2027-3|2025-2026-3|2025-2026-2|2025-2026-1|2024-2025-3|2024-2025-2|2024-2025-1','cross-year future and historic semester IDs remain unchanged');
locale='zh';check(env.render(build).every(x=>x.label.startsWith('zh:')),'switching back refreshes cached semester labels again');
const report=source('pages/info/reportParts.tsx'),reportHook=find(report,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='useReportStats')[0];
const reportEnv=hooks(),rows=[{semester:'',credit:2,point:4},{semester:'2025-2026秋',credit:1,point:3}];
const stats=evaluate(`${reportHook.getText(report).replace(/^export /,'')}\nuseReportStats;`,{...reportEnv,useReport:()=>({data:rows,state:'ready'}),weightedAverage:xs=>xs.reduce((sum,x)=>sum+x.credit*x.point,0)/xs.reduce((sum,x)=>sum+x.credit,0)});
const rzh=reportEnv.render(stats),rzh2=reportEnv.render(stats);check(rzh.groups===rzh2.groups,'stable report data and locale keep group memo');
locale='en';const ren=reportEnv.render(stats);
check(ren.groups!==rzh.groups&&ren.groups.some(([name])=>name.startsWith('en:')),'missing-semester display updates on the already-loaded report');
check(ren.groups.some(([name])=>name==='2025-2026秋'),'school-provided semester text is not translated');
check(ren.rows===rows&&ren.overall===rzh.overall&&ren.totalCredits===rzh.totalCredits,'language switching preserves source rows, grade points and credits');
console.log(`i18n display memo: ${passed} checks passed`);
