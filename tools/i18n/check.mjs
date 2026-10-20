import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import {readDataFile,slots,sourceCalls} from "./dictionary.mjs";
import {inspectBatch} from "./batch.mjs";

const dir="apps/desktop/src/i18n/locales";
const source=readDataFile(`${dir}/zh-CN.ts`);
const errors=[];
const argument=name=>{const at=process.argv.indexOf(name);return at>=0?process.argv[at+1]:undefined;};
const localeFiles=fs.readdirSync(dir).filter(f=>!f.startsWith("._")&&f.endsWith(".ts"));
const requestedLocale=argument("--locale");
if(process.argv.includes("--locale")&&(!requestedLocale||!localeFiles.includes(`${requestedLocale}.ts`))){
  errors.push(`Unknown or missing --locale: ${requestedLocale??"(missing)"}`);
}
export function checkDictionary(def,baseline,{complete=false}={}){
  const problems=[];
  if(!def||typeof def.label!=="string"||!def.label.trim()||!def.messages||typeof def.messages!=="object")return ["Expected { label: string, messages: literal object }"];
  if(Object.keys(def).some(k=>!["label","messages"].includes(k)))problems.push("Unexpected root property");
  const actual=Object.keys(def.messages),expected=Object.keys(baseline.messages);
  for(const key of expected){
    if(!Object.hasOwn(def.messages,key)){problems.push(`Missing key: ${key}`);continue;}
    const v=def.messages[key],raw=baseline.messages[key];
    if(typeof v!=="string"){problems.push(`${key}: string required`);continue;}
    if(v===""&&!complete)continue;
    if(!v.trim()){problems.push(`${key}: empty translation`);continue;}
    if(slots(v).join("\0")!==slots(raw).join("\0"))problems.push(`${key}: placeholder set/count differs`);
  }
  for(const key of actual)if(!Object.hasOwn(baseline.messages,key))problems.push(`Unknown key: ${key}`);
  return problems;
}
const coverage=[];
for(const file of localeFiles){
  try{
    const def=readDataFile(`${dir}/${file}`),locale=file.slice(0,-3);
    new Intl.DateTimeFormat(locale);
    errors.push(...checkDictionary(def,source,{complete:(process.argv.includes("--complete")&&(!argument("--locale")||argument("--locale")===locale))||locale==="zh-CN"}).map(x=>`${locale}: ${x}`));
    coverage.push({locale,keys:Object.keys(def.messages).length,translated:Object.values(def.messages).filter(v=>typeof v==="string"&&v.trim()).length});
  }catch(e){errors.push(`${file}: ${e.message}`)}
}
const dynamic={
  "apps/desktop/src/lib/confirm.tsx":new Set(["shown?.danger ? \"confirm.dangerTitle\" : \"confirm.title\"","shown?.danger ? \"confirm.execute\" : \"common.confirm\""]),
  "apps/desktop/src/state/settingsMode.ts":new Set(["key"]),
};
for(const call of sourceCalls()){
  if(call.key){
    if(!Object.hasOwn(source.messages,call.key))errors.push(`${call.file}:${call.line}: undefined key ${call.key}`);
    else if(call.params&&!call.computedParams){
      const required=new Set(slots(source.messages[call.key]));
      const provided=new Set(call.params);
      const missing=[...required].filter(k=>!provided.has(k)),extra=[...provided].filter(k=>!required.has(k));
      if(missing.length||extra.length)errors.push(`${call.file}:${call.line}: ${call.key} call parameters missing=[${missing}] extra=[${extra}]`);
    }
  }
  else if(!dynamic[call.file]?.has(call.expression))errors.push(`${call.file}:${call.line}: undeclared dynamic message ${call.expression}`);
}
// Regression mutations: deleting a real key or changing interpolation MUST fail.
const keys=Object.keys(source.messages);
assert(keys.length>100);
const deleted={...source,messages:{...source.messages}};delete deleted.messages[keys[0]];
assert(checkDictionary(deleted,source).some(x=>x.includes("Missing key")));
const paramKey=keys.find(k=>slots(source.messages[k]).length);
const changed={...source,messages:{...source.messages,[paramKey]:"bad {unexpected}"}};
assert(checkDictionary(changed,source).some(x=>x.includes("placeholder")));
assert(checkDictionary({...source,messages:{...source.messages,unregistered:"oops"}},source).some(x=>x.includes("Unknown key")));
// The translator file is parsed before execution; even valid TS cannot run.
const tempDir=fs.mkdtempSync(join(tmpdir(), "onethu-i18n-check-"));
const tmp=join(tempDir, "malicious.ts");
try{
  for(const syntax of [
    'export default {label:"x",messages:{a: (() => "executed")()}};',
    'export default {label:"x",messages:{"a":"one","a":"two"}};',
    'import fs from "node:fs"; export default {label:"x",messages:{}};',
    'export default {label:"x",messages:{get a(){return "executed"}}};',
  ]){fs.writeFileSync(tmp,syntax);assert.throws(()=>readDataFile(tmp));}
}finally{fs.rmSync(tempDir,{recursive:true,force:true})}
if(argument("--batch")){
  try{errors.push(...inspectBatch({path:argument("--batch"),locale:argument("--locale"),base:argument("--base"),source}));}
  catch(e){errors.push(e.message);}
}
console.log(JSON.stringify({coverage,errors:errors.length},null,2));
if(errors.length){console.error(errors.join("\n"));process.exitCode=1;}
