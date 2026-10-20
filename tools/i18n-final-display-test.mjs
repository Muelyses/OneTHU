/** Final non-JSX display boundaries: actual iframe program + stable identities/status. */
import './ts-resolve-register.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const { localeTable, getLocale, setLocale } = await import('../apps/desktop/src/i18n/index.ts');
const { buildYktProblemDoc } = await import('../apps/desktop/src/lib/yktBody.ts');
const { memoryBlacklist } = await import('../apps/desktop/src/memory/format.ts');
let passed=0;
const check=(value,label)=>{assert.ok(value,label);passed++;console.log('✓ '+label);};
const source=path=>ts.createSourceFile(path,fs.readFileSync('apps/desktop/src/'+path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function find(ast,predicate){const result=[];function walk(n){if(predicate(n))result.push(n);ts.forEachChild(n,walk);}walk(ast);return result;}
const evaluate=(code,scope={})=>vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,scope);
const originalLocale=getLocale(), saved=[];
function override(locale,key,value){const messages=localeTable(locale);saved.push({messages,key,had:Object.hasOwn(messages,key),value:messages[key]});messages[key]=value;}
try {
  const seed=JSON.parse(fs.readFileSync('docs/i18n/final-completion-seed.json','utf8')).messages;
  const image=Object.values(seed).find(row=>row.key.startsWith('lib.yktbody.')&&row.source==='图片').key;
  const failedImage=Object.values(seed).find(row=>row.key.startsWith('lib.yktbody.')&&row.source==='{name}（图片加载失败）').key;
  for(const locale of ['zh-CN','en-US']){
    const injected='</script><script>globalThis.__injected=1</script>"\u2028\u2029$&';
    const imageLabel=locale+' image '+injected;
    const failureLabel=locale+' failed {name} '+injected;
    override(locale,image,imageLabel);override(locale,failedImage,failureLabel);setLocale(locale);
    const doc=buildYktProblemDoc({html:'<p>School original 学校原文</p><img src="data:">'});
    check(doc.includes('<p>School original 学校原文</p>'),`${locale}: original school text is retained`);
    check((doc.match(/<script>/g)||[]).length===1&&(doc.match(/<\/script>/g)||[]).length===1,`${locale}: translation cannot break out of the iframe script`);
    check(doc.includes('\\u003c/script>')&&!doc.includes('\u2028')&&!doc.includes('\u2029'),`${locale}: script delimiters and Unicode separators are escaped`);
    const handlers={},events={},rendered=[];
    const img={dataset:{},getAttribute:key=>key==='src'?'data:':null,addEventListener:(name,fn)=>{handlers[name]=fn;},parentNode:{replaceChild:node=>rendered.push(node)}};
    const document={readyState:'complete',documentElement:{scrollHeight:1},body:{scrollHeight:1},querySelectorAll:selector=>selector==='img'?[img]:[],addEventListener(){},createElement:()=>({className:'',textContent:''})};
    const context={URL,document,location:{href:'about:blank'},window:{addEventListener:(name,fn)=>{events[name]=fn;}},parent:{postMessage(){}},setTimeout(){},globalThis:{}};
    const script=doc.match(/<script>([\s\S]*?)<\/script>/)[1];
    vm.runInNewContext(script,context);handlers.error();
    check(rendered.length===1&&rendered[0].className==='ykt-img-fallback',`${locale}: actual iframe error handler renders a fallback`);
    check(rendered[0].textContent==='🖼 '+failureLabel.replace('{name}',()=>imageLabel.slice(0,48)),`${locale}: unsafe-looking translated content is exact inert text`);
    check(!context.globalThis.__injected,`${locale}: no translated script executes`);
  }
  const key=Object.values(seed).find(row=>row.source==='疑似 LLM API Key（sk-…）').key;
  override('zh-CN',key,'ZH warning');override('en-US',key,'EN warning');setLocale('zh-CN');
  check(memoryBlacklist('sk-'+'x'.repeat(24))==='ZH warning','memory privacy rule matches before language switching');
  setLocale('en-US');
  check(memoryBlacklist('sk-'+'x'.repeat(24))==='EN warning','already-loaded privacy registry translates its description after switching');
  check(memoryBlacklist('ordinary safe note')===null,'privacy matching does not depend on translated text');
} finally {
  for(const x of saved.reverse()){if(x.had)x.messages[x.key]=x.value;else delete x.messages[x.key];}
  setLocale(originalLocale);
}
const plugins=source('pages/Plugins.tsx');
const calls=find(plugins,n=>ts.isCallExpression(n)&&n.expression.getText(plugins)==='setMsg'&&n.arguments[0]?.kind!==ts.SyntaxKind.NullKeyword);
const successes=new Set(['pages.plugins.53edebb99ee7','pages.plugins.19c2811cc125','pages.plugins.54d56dd165af']);
check(calls.length===12,'all plugin installation/market result branches remain covered');
for(const call of calls){
 const arg=call.arguments[0];assert.ok(ts.isObjectLiteralExpression(arg));
 const text=arg.properties.find(p=>p.name?.getText(plugins)==='text').initializer;
 const expected=ts.isCallExpression(text)&&text.expression.getText(plugins)==='i18n'&&successes.has(text.arguments[0].text)?'success':'error';
 const result=evaluate(`(${arg.getText(plugins)})`,{i18n:()=>expected==='success'?'Failure-looking translated product name':'Installed-looking upstream error',m:{name:'x',version:'1'},out:{manifest:{name:'x',version:'1'}},manifest:{name:'x',version:'1'},e:new Error('x'),e2:new Error('x'),String,Error});
 check(result.tone===expected,`plugin result at line ${plugins.getLineAndCharacterOfPosition(call.pos).line+1} uses semantic ${expected} status`);
}
const board=source('state/boardCore.ts');
const boardWriters=find(board,n=>ts.isFunctionDeclaration(n)&&['buildSystemBoard','purgeGridResidue'].includes(n.name?.text));
const names=boardWriters.flatMap(fn=>find(fn,n=>ts.isPropertyAssignment(n)&&n.name.getText(board)==='name'));
check(names.length===2&&names.every(n=>evaluate(`(${n.initializer.getText(board)})`,{i18n:()=>"Changed by locale"})==='首页'),'fresh and migrated system-board names keep their persisted identity');
const pptx=source('lib/pptxRender.ts');
const unsupported=find(pptx,n=>ts.isObjectLiteralExpression(n)&&n.properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(pptx)==='kind'&&p.initializer.getText(pptx)==='"unsupported"'));
assert.equal(unsupported.length,3);
for(const object of unsupported){
 let locale='zh';
 const shape=evaluate(`(${object.getText(pptx)})`,{place:()=>({}),box:{},known:true,isChart:true,isDgm:false,i18n:key=>`${locale}:${key}`});
 const old=shape.label;locale='en';
 check(old.startsWith('zh:')&&shape.label.startsWith('en:'),'already-loaded PPTX placeholder follows the active display language');
}
const problem=source('components/exthw/ProblemBody.tsx');
const rebuild=find(problem,n=>ts.isVariableDeclaration(n)&&n.name.getText(problem)==='rebuild')[0];
check(rebuild.initializer.arguments[1].elements.some(n=>n.getText(problem)==='uiLocale'),'inline problem document rebuilds after language switching');
console.log(`i18n final display: ${passed} checks passed`);
