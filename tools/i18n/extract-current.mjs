/**
 * One-time, reviewed migration of the CURRENT source, never PR57's business code.
 * Run with --write only on an unextracted tree. The catalog is preserved afterwards.
 * This is deliberately conservative about wire values, matching strings and types.
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = "apps/desktop/src";
const write = process.argv.includes("--write");
const incremental = process.argv.includes("--residual");
const only = process.argv.find(a=>a.startsWith("--only="))?.slice(7).split(",");
// Explicitly reviewed display-only helpers, never inferred from arbitrary names.
const displayFunctions = new Set(process.argv.find(a=>a.startsWith("--display-functions="))?.slice(20).split(",") ?? []);
const cjk = /[\u3400-\u9fff]/u;
const skip = /^(i18n\/|gallery\/|main\.tsx$|lib\/(?:confirm|formModal|hotUpdateHealth)\.tsx?$|state\/toast\.ts$)|(?:ExplorerPreview|\.test)\./;
const uiProps = /^(?:label|title|name|note|description|desc|hint|placeholder|aria-label|aria-description|ariaLabel|alt|tooltip|emptyText|loadingText|text|subtitle|caption|confirmText|cancelText|buttonText|message|why|detail|summary|sub|titleAttr|aside|searchHint|meta|dimLabel|cap|error|unit|trailing|foot|fallback|badge|lead|full|short|before|after|eyebrow)$/;
const wireProps = /^(?:id|key|type|kind|source|category|group|tag|value|status|action|code|method|url|href|path|fileName|filename|mime|target|command|body|prompt|content|initial|defaultValue|query|pattern|keywords|tags|aliases|search|searchTerms|scope|page|schema|field)$/;
const wireCalls = /(?:\.(?:includes|startsWith|endsWith|indexOf|lastIndexOf|match|matchAll|replace|replaceAll|split|test|search|setItem|getItem)|(?:^|\.)(?:onSend|send|sendMessage|invoke|fetch|request|emit|navigate|nav|setAttribute|append|delete|has))$/;
const displayCalls = /(?:showToast|setToast|setProgress|setErr|setError|setMsg|setMessage|setStatusText|setHint|confirmOk|confirmDanger|confirmChoice|promptText|notify|Error|alert|needUi|fail)$/;
const descriptors = /^(?:confirmOk|confirmDanger|confirmChoice|promptText|showToast)$/;
const held = new Set(["pages/Settings.tsx", "components/Layout.tsx", "state/settingsMode.ts", "state/searchRows.ts", "components/SimpleSettings.tsx", "components/FilePreview.tsx", "pages/learn/shared.tsx", "pages/ThubookPage.tsx", "state/userext.ts", "lib/safeHtml.ts"]);
const files = fs.readdirSync(root, { recursive: true }).filter(f => /\.tsx?$/.test(f) && !f.split("/").some(p=>p.startsWith("._")) && !skip.test(f) && (only?only.includes(f):(!incremental || !held.has(f))));
const catalog = [];
const deferred = [];
let changed = 0;

for (const file of files) {
  const full = `${root}/${file}`;
  const src = fs.readFileSync(full, "utf8");
  const ast = ts.createSourceFile(full, src, ts.ScriptTarget.Latest, true);
  const edits = [];
  const imports = new Set();
  const entries = new Map();
  const starts = n => n.getStart(ast);
  function within(n) {
    const a = starts(n), b = n.end;
    return edits.filter(e => e.start >= a && e.end <= b);
  }
  function rendered(n) {
    let s = src.slice(starts(n), n.end), a = starts(n);
    for (const e of within(n).sort((x,y) => y.start-x.start)) s = s.slice(0,e.start-a)+e.text+s.slice(e.end-a);
    return s;
  }
  function edit(a,b,text) {
    for (let i=edits.length-1;i>=0;i--) if(edits[i].start>=a && edits[i].end<=b) edits.splice(i,1);
    if(edits.some(e=>e.start<a&&e.end>b)) return;
    edits.push({start:a,end:b,text});
  }
  function replace(n,text) { edit(starts(n),n.end,text); }
  function ancestors(n) { const out=[]; for(let p=n.parent;p;p=p.parent)out.push(p);return out; }
  function inFunction(n) { return ancestors(n).some(p=>ts.isFunctionLike(p)); }
  function prop(n) {
    const p=n.parent;
    return (ts.isPropertyAssignment(p)||ts.isJsxAttribute(p))&&p.initializer===n ? p.name.getText(ast).replace(/["']/g,"") : null;
  }
  function containerVar(n) {
    const v=ancestors(n).find(p=>ts.isVariableDeclaration(p));
    return v?.name.getText(ast)??"";
  }
  function excluded(n) {
    const p=n.parent, ps=ancestors(n);
    if(/^(CALENDAR_TITLE|AGENT_NAME|DEFAULT_AGENT_NAME)$/.test(containerVar(n)))return "persisted/external identity";
    if(ps.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(ast)==="infoNewsQuery"))return "school search query";
    if(ps.some(p=>ts.isTypeNode(p)||ts.isImportDeclaration(p)||ts.isExportDeclaration(p)))return "type/import";
    if((ts.isPropertyAssignment(p)&&p.name===n)||ts.isPropertySignature(p)||ts.isElementAccessExpression(p)||ts.isCaseClause(p))return "identity/key";
    if(ts.isBinaryExpression(p)&&[ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken,ts.SyntaxKind.EqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind))return "comparison";
    if(ts.isCallExpression(p)&&wireCalls.test(p.expression.getText(ast)))return "protocol/matching";
    const pr=prop(n);
    if(ts.isJsxAttribute(p)&&uiProps.test(pr??""))return null;
    if(file==="lib/onboardingLessons.ts"&&pr==="action")return null;
    if(pr&&wireProps.test(pr))return "protocol/data field";
    if(ps.some(p=>ts.isPropertyAssignment(p)&&/^(keywords|tags|aliases|searchTerms|prompt|systemPrompt|schema)$/.test(p.name.getText(ast))))return "protocol/search metadata";
    if(ps.some(p=>ts.isCallExpression(p)&&/^(?:console\.|debug|logger\.)/.test(p.expression.getText(ast))))return "diagnostic";
    if(ts.isStringLiteral(n)&& /(?:^https?:\/\/\S+$|^data:|^#[a-z]|^\/|^\.\.?\/|\.(?:ics|json|html|png|zip|txt)$)/i.test(n.text))return "path/data";
    if(/<!doctype|<html\b/i.test(n.getText(ast)))return "HTML document structure";
    return null;
  }
  function selected(n) {
    if(ts.isJsxText(n))return true;
    if(excluded(n))return false;
    if(ancestors(n).some(p=>ts.isFunctionDeclaration(p)&&p.name&&displayFunctions.has(p.name.text)))return true;
    const p=n.parent, pr=prop(n);
    if(ts.isJsxAttribute(p))return uiProps.test(pr??"");
    if(pr&&uiProps.test(pr))return true;
    if((ts.isCallExpression(p)||ts.isNewExpression(p))&&displayCalls.test(p.expression.getText(ast)))return true;
    if(incremental){
      if(/^(?:components\/(?:vault\/vaultItemPresentation|tourStudioModels)|state\/(?:tabTitles|notifyDoctor|widgetDetail|cardWarn|quickAccess|explorer)|lib\/(?:dateText|attachActions|updater|onboardingLessons))\.ts$/.test(file))return true;
      if(file==="im/registry.ts"&&ancestors(n).some(p=>ts.isCallExpression(p)&&/replyTo$/.test(p.expression.getText(ast))))return true;
      if(!inFunction(n)&&/(?:LABEL|TITLE|NAME|DESCRIPTION|COPY|HINT|NOTE|LESSON|TOUR|DAY|WEEK|SLOT)/i.test(containerVar(n)))return true;
      return false;
    }
    if(file.endsWith(".tsx")&&inFunction(n))return true;
    if(!inFunction(n)&&/(?:LABEL|TITLE|NAME|DESCRIPTION|COPY|HINT|NOTE|LESSON|TOUR)/i.test(containerVar(n)))return true;
    return false;
  }
  function record(message,n,params=[],kind="text") {
    const prefix=file.replace(/\.[^.]+$/,"").replace(/[^a-z0-9]+/gi,".").replace(/^\.+|\.+$/g,"").toLowerCase();
    const digest=crypto.createHash("sha256").update(message).digest("hex").slice(0,12);
    const key=`${prefix}.${digest}`;
    const location={file:full,line:ast.getLineAndCharacterOfPosition(starts(n)).line+1,context:n.parent?.getText(ast).slice(0,500)};
    const prior=entries.get(key);
    if(prior)prior.locations.push(location);
    else entries.set(key,{key,source:message,kind,parameters:params,locations:[location]});
    return key;
  }
  function call(key,params=[],descriptor=false,rich=false) {
    const fn=rich?"i18nRich":descriptor?"i18nMsg":"i18n";
    imports.add(fn);
    return `${fn}(${JSON.stringify(key)}${params.length?`, { ${params.map(p=>`${p.name}: ${p.expression}`).join(", ")} }`:""})`;
  }
  function paramName(expr,used) {
    let candidate = (ts.isIdentifier(expr)?expr.text:ts.isPropertyAccessExpression(expr)?expr.name.text:"value").replace(/[^A-Za-z0-9_]/g,"");
    if(!/^[A-Za-z_]/.test(candidate))candidate="value";
    let result=candidate, i=2;while(used.has(result))result=candidate+i++;
    used.add(result);return result;
  }
  function isDescriptor(n) {
    for(let p=n.parent;p;p=p.parent){
      if(ts.isCallExpression(p))return descriptors.test(p.expression.getText(ast));
      if(ts.isFunctionLike(p)||ts.isJsxElement(p)||ts.isJsxAttribute(p)||ts.isTemplateExpression(p)||ts.isBinaryExpression(p))break;
    }
    return false;
  }
  // React's JSX whitespace normalization (literal spaces inside a line remain).
  function jsxText(text) {
    const lines=text.replace(/\r/g,"").split("\n");let out="";
    let last=0;lines.forEach((s,i)=>{if(/[^ \t]/.test(s))last=i;});
    lines.forEach((s,i)=>{s=s.replace(/\t/g," ");if(i!==0)s=s.replace(/^ +/,"");if(i!==lines.length-1)s=s.replace(/ +$/,"");if(s){out+=s;if(i!==last)out+=" ";}});
    return out.replace(/&nbsp;/g,"\u00a0").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  }
  function visit(n) {
    ts.forEachChild(n,visit);
    if(incremental&&ts.isArrayLiteralExpression(n)&&!inFunction(n)&&n.elements.length&&n.elements.every(ts.isStringLiteral)&&n.elements.some(e=>cjk.test(e.text))){
      const context=containerVar(n),p=n.parent;
      if(/(?:LABEL|TITLE|NAME|COPY|HINT|NOTE|LESSON|TOUR|DAY|WEEK|SLOT)/i.test(context)||(ts.isPropertyAssignment(p)&&/^(bullets|lines|steps|tips)$/.test(p.name.getText(ast)))){
        const keys=n.elements.map(e=>record(e.text,e));
        imports.add("i18nList");replace(n,`i18nList(${JSON.stringify(keys)})`);return;
      }
    }
    if(incremental&&ts.isPropertyAssignment(n)&&!inFunction(n)&&within(n.initializer).length&&ts.isArrayLiteralExpression(n.initializer)){
      replace(n,`get ${n.name.getText(ast)}() { return ${rendered(n.initializer)}; }`);return;
    }
    // Complete adjacent JSX sentence: parameters remain trusted React nodes.
    if(ts.isJsxElement(n)||ts.isJsxFragment(n)){
      let group=[];
      const flush=()=>{
        if(!group.length)return;
        const hasText=group.some(c=>ts.isJsxText(c)&&cjk.test(c.text));
        if(hasText){
          const used=new Set(),params=[];let message="";
          for(const c of group){
            if(ts.isJsxText(c))message+=jsxText(c.text);
            else if(c.expression){
              const expr=c.expression;
              if(ts.isStringLiteral(expr)&&!cjk.test(expr.text))message+=expr.text;
              else {const name=paramName(expr,used);message+=`{${name}}`;params.push({name,expression:rendered(expr)});}
            }
          }
          const key=record(message,group[0],params.map(p=>({name:p.name,expression:p.expression})),params.length?"rich":"text");
          edit(group[0].pos,group.at(-1).end,`{${call(key,params,false,params.length>0)}}`);
        }
        group=[];
      };
      for(const child of n.children){
        if(ts.isJsxText(child)||(ts.isJsxExpression(child)&&child.expression&&!ts.isSpreadElement(child.expression)))group.push(child);
        else flush();
      }flush();
    }
    if(!(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateExpression(n)))return;
    const raw=ts.isTemplateExpression(n)?n.head.text+n.templateSpans.map(s=>s.literal.text).join(""):n.text;
    if(!cjk.test(raw))return;
    if(!selected(n)){deferred.push({file:full,line:ast.getLineAndCharacterOfPosition(starts(n)).line+1,text:raw,reason:excluded(n)??"review display boundary",context:n.parent.getText(ast).slice(0,500)});return;}
    // Module array primitives need explicit delayed access, handled in the next pass.
    if(!inFunction(n)&&ts.isArrayLiteralExpression(n.parent)&&!incremental)return;
    const params=[],used=new Set();let message;
    if(ts.isTemplateExpression(n)){
      message=n.head.text;
      for(const span of n.templateSpans){
        const name=paramName(span.expression,used);
        message+=`{${name}}${span.literal.text}`;
        params.push({name,expression:`String(${rendered(span.expression)})`});
      }
    }else message=n.text;
    const key=record(message,n,params.map(p=>({name:p.name,expression:p.expression})));
    let result=call(key,params,isDescriptor(n));
    if(ts.isJsxAttribute(n.parent))result=`{${result}}`;
    if(!inFunction(n)&&ts.isPropertyAssignment(n.parent)&&n.parent.initializer===n){
      // Registry labels must resolve lazily, without changing stable IDs.
      replace(n.parent,`get ${n.parent.name.getText(ast)}() { return ${result}; }`);
    }else replace(n,result);
  }
  visit(ast);
  // All actual component render functions subscribe, including those displaying registries.
  function hookPass(n) {
    ts.forEachChild(n,hookPass);
    if(!ts.isFunctionLike(n)||!n.body)return;
    let name=ts.isFunctionDeclaration(n)?n.name?.text:ts.isVariableDeclaration(n.parent)?n.parent.name.getText(ast):"";
    if(!/^[A-Z][A-Za-z0-9]*$/.test(name??""))return;
    let jsx=false;
    function scan(c){if(c!==n&&ts.isFunctionLike(c))return;if(ts.isJsxElement(c)||ts.isJsxSelfClosingElement(c)||ts.isJsxFragment(c))jsx=true;ts.forEachChild(c,scan);}
    scan(n);if(!jsx)return;
    if(n.body.getText(ast).includes("useUiLocale("))return;
    imports.add("useUiLocale");
    // A stable locale value invalidates derived labels, without remounting state.
    function deps(c){
      // t() resolves the live locale when a callback runs. Recreating every
      // callback on language changes would retrigger effects doing network work.
      if(ts.isCallExpression(c)&&/^(?:React\.)?useMemo$/.test(c.expression.getText(ast))){
        const d=c.arguments[1];if(d&&ts.isArrayLiteralExpression(d))replace(d,`[uiLocale${d.elements.length?", "+d.elements.map(rendered).join(", "):""}]`);
      }
      ts.forEachChild(c,deps);
    }deps(n.body);
    if(ts.isBlock(n.body))edit(n.body.getStart(ast)+1,n.body.getStart(ast)+1,"\n  const uiLocale = useUiLocale();\n");
    else replace(n.body,`{ const uiLocale = useUiLocale(); return (${rendered(n.body)}); }`);
  }
  if(file.endsWith(".tsx")&&!src.includes("useLocale as useUiLocale"))hookPass(ast);
  if(edits.length){
    let result=src;
    for(const e of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,e.start)+e.text+result.slice(e.end);
    const rel=path.posix.relative(path.posix.dirname(file),"i18n/index.js");
    const names={i18n:"t as i18n",i18nMsg:"msg as i18nMsg",i18nRich:"rich as i18nRich",useUiLocale:"useLocale as useUiLocale",i18nList:"localizedList as i18nList"};
    const missing=[...imports].filter(n=>!new RegExp(`\\bas ${n}\\b`).test(src));
    if(missing.length)result=`import { ${missing.map(n=>names[n]).join(", ")} } from ${JSON.stringify(rel.startsWith(".")?rel:`./${rel}`)};\n${result}`;
    if(write)fs.writeFileSync(full,result);
    changed++;
  }
  catalog.push(...entries.values());
}
fs.mkdirSync("docs/i18n",{recursive:true});
let previous=[];
if(incremental||only)previous=JSON.parse(fs.readFileSync("docs/i18n/extracted.json","utf8"));
fs.writeFileSync("docs/i18n/extracted.json",JSON.stringify([...new Map([...previous,...catalog].map(row=>[row.key,row])).values()],null,2)+"\n");
// A scoped migration pass is not an inventory of every remaining Chinese string.
fs.writeFileSync("/tmp/onethu-i18n-migration-review.json",JSON.stringify({files:files.length,only:only??null,deferred},null,2)+"\n");
console.log(JSON.stringify({changed,messages:catalog.length,deferred:deferred.length,write}));
