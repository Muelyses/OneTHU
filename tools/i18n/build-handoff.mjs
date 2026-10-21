import fs from "node:fs";
import crypto from "node:crypto";
import ts from "typescript";
import {execFileSync} from "node:child_process";
import {readDataFile,sourceCalls,slots} from "./dictionary.mjs";

const base="apps/desktop/src/i18n/locales";
const rows=JSON.parse(fs.readFileSync("docs/i18n/extracted.json","utf8"));
const known=new Map(rows.map(row=>[row.key,row]));
const zh={},en={};
function add(key,source,translation="",context="runtime"){
  zh[key]=source;en[key]=translation;
  if(!known.has(key))known.set(key,{key,source,kind:"text",parameters:slots(source).map(name=>({name})),locations:[{file:context,line:1}]});
}
// Only re-use reviewed old translations whose complete Chinese source matches.
const previous=new Map();
try{
  for(const locale of ["zh-CN","en-US"])fs.writeFileSync(`/tmp/onethu-pr57-${locale}.ts`,execFileSync("git",["show",`review/pr57:apps/desktop/src/i18n/locales/${locale}.ts`]));
  const z=readDataFile("/tmp/onethu-pr57-zh-CN.ts"),e=readDataFile("/tmp/onethu-pr57-en-US.ts");
  for(const [key,text]of Object.entries(e.messages))if(z.messages[key]&&text&&slots(text).join()===slots(z.messages[key]).join())previous.set(z.messages[key],text);
}catch(e){console.warn("Old translation reuse unavailable:",e.message)}
let saved={},savedSource={};
try{saved=readDataFile(`${base}/en-US.ts`).messages;savedSource=readDataFile(`${base}/zh-CN.ts`).messages;}catch{}
const savedTranslation=(key,source)=>savedSource[key]===source?saved[key]:"";
for(const row of rows)add(row.key,row.source,savedTranslation(row.key,row.source)||previous.get(row.source)||"",row.locations[0]?.file);
for(const file of fs.readdirSync("docs/i18n").filter(f=>!f.startsWith("._")&&f.endsWith("seed.json"))){
  const seed=JSON.parse(fs.readFileSync(`docs/i18n/${file}`,"utf8"));
  for(const [key,v]of Object.entries(seed.messages??seed)){
    if(typeof v==="object"&&v){
      const source=v["zh-CN"]??v.zh??v.source;
      if(v.locations)known.set(key,{key,source,kind:v.kind??"text",parameters:v.parameters??slots(source).map(name=>({name})),locations:v.locations});
      add(key,source,savedTranslation(key,source)||v["en-US"]||v.en||"",`docs/i18n/${file}`);
    }
  }
}
// GUI has functions as well as pure data; read ONLY the literal table nodes.
const guiFile="packages/gui/src/locale.tsx",guiSource=fs.readFileSync(guiFile,"utf8"),guiAst=ts.createSourceFile(guiFile,guiSource,99,true);
const gui={};
for(const st of guiAst.statements)if(ts.isVariableStatement(st))for(const d of st.declarationList.declarations){
  if(/^ONE_GUI_(ZH_CN|EN_US)$/.test(d.name.getText(guiAst))){
    let n=d.initializer;while(ts.isAsExpression(n)||ts.isSatisfiesExpression(n))n=n.expression;
    const obj={};for(const p of n.properties)obj[p.name.text]=p.initializer.text;
    gui[d.name.getText(guiAst)]=obj;
  }
}
for(const [key,value]of Object.entries(gui.ONE_GUI_ZH_CN))add(key,value,gui.ONE_GUI_EN_US[key],guiFile);
const calls=sourceCalls();
const used=new Set(calls.map(x=>x.key).filter(Boolean));
for(const row of known.values()){
  const locations=calls.filter(call=>call.key===row.key).map(({file,line,context})=>({file,line,...(context?{context}:{})}));
  if(locations.length)row.locations=locations;
}
// Runtime and explicit registry family entries are also referenced by data, not calls.
for(const key of Object.keys(zh))if(!used.has(key)&&!key.startsWith("gui.")&&!key.startsWith("common.")&&!key.startsWith("dialog.")&&!key.startsWith("form.")&&!key.startsWith("language.")&&!key.startsWith("enum.")){
  if(rows.some(r=>r.key===key)){delete zh[key];delete en[key];}
}
for(const locale of ["zh-CN","en-US"]){
  const data=locale==="zh-CN"?zh:en,label=locale==="zh-CN"?"简体中文":"English";
  const sorted=Object.fromEntries(Object.entries(data).sort(([a],[b])=>a.localeCompare(b)));
  fs.writeFileSync(`${base}/${locale}.ts`,`// Translation data only. See docs/i18n/TRANSLATOR_GUIDE.md.\nimport type { LocaleDef } from "../types.js";\nconst locale = ${JSON.stringify({label,messages:sorted},null,2)} satisfies LocaleDef;\nexport default locale;\n`);
}
const catalog=[...known.values()].filter(row=>Object.hasOwn(zh,row.key)).sort((a,b)=>a.key.localeCompare(b.key));
const sourceHash=crypto.createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(zh).sort(([a],[b])=>a.localeCompare(b))))).digest("hex");
fs.writeFileSync("docs/i18n/catalog.json",JSON.stringify({sourceHash,count:catalog.length,messages:catalog},null,2)+"\n");
fs.mkdirSync("docs/i18n/batches",{recursive:true});
for(const f of fs.readdirSync("docs/i18n/batches"))if(/^\d+\.json$/.test(f))fs.unlinkSync(`docs/i18n/batches/${f}`);
for(let i=0;i<catalog.length;i+=80){
  const messages=catalog.slice(i,i+80).map(r=>({...r,translation:en[r.key],status:en[r.key]?"prefilled-review":"pending",limitHint:/title|label|button/i.test(r.locations[0]?.context??"")?"Keep concise; button/card label may wrap.":"Preserve meaning; do not truncate."}));
  fs.writeFileSync(`docs/i18n/batches/${String(i/80+1).padStart(3,"0")}.json`,JSON.stringify({sourceHash,targetFile:`${base}/en-US.ts`,messages},null,2)+"\n");
}
execFileSync(process.execPath,["tools/i18n/widget-fallback.mjs","--write"],{stdio:"inherit"});
console.log(JSON.stringify({messages:Object.keys(zh).length,translated:Object.values(en).filter(Boolean).length,sourceHash}));
