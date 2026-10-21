import fs from "node:fs";
import ts from "typescript";
import {execFileSync} from "node:child_process";

const files=fs.readdirSync("apps/desktop/src",{recursive:true}).filter(f=>/\.tsx?$/.test(f)&&!f.startsWith("i18n/")&&!f.split("/").some(p=>p.startsWith("._")));
const all=JSON.parse(fs.readFileSync("docs/i18n/extracted.json","utf8"));
const texts=new Map(all.map(r=>[r.key,r.source]));
// Native calendar identity and the school's named agent are wire/persisted metadata.
const rawConstants=new Set(["CALENDAR_TITLE","AGENT_NAME","DEFAULT_AGENT_NAME"]);
const lazyConstants=new Set(["YKT_SMS_DISABLED_NOTE","YKT_WEB_FALLBACK_HINT","PAGE_HINT","LOGIN_HINT","LOGIN_HINT_2","SUBMIT_HINT","CONFIRM_TITLE","PAGE_NOTE","PAGE_NOTE_2"]);
for(const file of files){
  const full=`apps/desktop/src/${file}`,s=fs.readFileSync(full,"utf8"),a=ts.createSourceFile(full,s,99,true),edits=[];
  const local=new Set();
  for(const st of a.statements)if(ts.isVariableStatement(st))for(const d of st.declarationList.declarations)if(ts.isIdentifier(d.name)&&lazyConstants.has(d.name.text)&&ts.isCallExpression(d.initializer)&&d.initializer.expression.getText(a)==="i18n")local.add(d.name.text);
  for(const st of a.statements)if(ts.isImportDeclaration(st)){
    const b=st.importClause?.namedBindings;if(b&&ts.isNamedImports(b))for(const x of b.elements)if(x.name.text==="YKT_WEB_FALLBACK_HINT")local.add(x.name.text);
  }
  function visit(n){
    if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&rawConstants.has(n.name.text)&&n.initializer&&ts.isCallExpression(n.initializer)&&n.initializer.expression.getText(a)==="i18n"){
      const k=n.initializer.arguments[0];edits.push({start:n.initializer.getStart(a),end:n.initializer.end,text:JSON.stringify(texts.get(k.text))});return;
    }
    if(ts.isIdentifier(n)&&local.has(n.text)){
      if(ts.isVariableDeclaration(n.parent)&&n.parent.name===n)edits.push({start:n.parent.initializer.getStart(a),end:n.parent.initializer.getStart(a),text:"() => "});
      else if(!ts.isImportSpecifier(n.parent)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n)&&!(ts.isPropertyAssignment(n.parent)&&n.parent.name===n))edits.push({start:n.getStart(a),end:n.end,text:n.text+"()"});
    }ts.forEachChild(n,visit);
  }visit(a);
  if(edits.length){let out=s;for(const e of edits.sort((a,b)=>b.start-a.start))out=out.slice(0,e.start)+e.text+out.slice(e.end);fs.writeFileSync(full,out);}
}
// Detail field names come from the school's HTML parser. Translation cannot sort
// external data by translated identifiers.
{
  const file="apps/desktop/src/pages/zhjwxk/Courses.tsx";
  const original=execFileSync("git",["show",`HEAD:${file}`]).toString();
  const order=/const order = \[[^\n]+\];/.exec(original)?.[0];
  let current=fs.readFileSync(file,"utf8");if(order)current=current.replace(/const order = \[[^\n]+\];/,order);
  fs.writeFileSync(file,current);
}
