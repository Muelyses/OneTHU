import ts from "typescript";
import fs from "node:fs";

/** Parse data, never import/evaluate a translator-owned file. */
export function readDataFile(file, exportName) {
  const source=fs.readFileSync(file,"utf8");
  return readDataSource(source,file,exportName);
}
export function readDataSource(source,file="locale.ts",exportName) {
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  if(ast.parseDiagnostics.length)throw new Error(`${file}: invalid TypeScript data syntax`);
  const vars=new Map();
  function value(n){
    if(!n)throw new Error(`${file}: missing data`);
    if(ts.isAsExpression(n)||ts.isSatisfiesExpression(n)||ts.isParenthesizedExpression(n))return value(n.expression);
    if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))return n.text;
    if(ts.isNumericLiteral(n))return Number(n.text);
    if(n.kind===ts.SyntaxKind.TrueKeyword)return true;
    if(n.kind===ts.SyntaxKind.FalseKeyword)return false;
    if(n.kind===ts.SyntaxKind.NullKeyword)return null;
    if(ts.isIdentifier(n)&&vars.has(n.text))return vars.get(n.text);
    if(ts.isArrayLiteralExpression(n))return n.elements.map(value);
    if(ts.isObjectLiteralExpression(n)){
      const out=Object.create(null);
      for(const p of n.properties){
        if(!ts.isPropertyAssignment(p)||p.name.kind===ts.SyntaxKind.ComputedPropertyName)throw new Error(`${file}: only literal data properties are allowed`);
        const k=ts.isIdentifier(p.name)||ts.isStringLiteral(p.name)?p.name.text:null;
        if(k===null||Object.hasOwn(out,k))throw new Error(`${file}: duplicate or invalid key ${k}`);
        out[k]=value(p.initializer);
      }return out;
    }
    throw new Error(`${file}: executable syntax ${ts.SyntaxKind[n.kind]} is forbidden`);
  }
  let result;
  for(const s of ast.statements){
    if(ts.isImportDeclaration(s)){if(!s.importClause?.isTypeOnly)throw new Error(`${file}: only type imports allowed`);continue;}
    if(ts.isVariableStatement(s)){for(const d of s.declarationList.declarations){if(!ts.isIdentifier(d.name))throw new Error(`${file}: literal binding required`);vars.set(d.name.text,value(d.initializer));}continue;}
    if(ts.isExportAssignment(s)){result=value(s.expression);continue;}
    if(ts.isEmptyStatement(s))continue;
    throw new Error(`${file}: unexpected ${ts.SyntaxKind[s.kind]}`);
  }
  return exportName?vars.get(exportName):result;
}
export const slots=text=>[...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(m=>m[1]).sort();
export function sourceCalls(root="apps/desktop/src"){
  const out=[];
  for(const f of fs.readdirSync(root,{recursive:true}).map(f=>f.replaceAll("\\","/")).filter(f=>/\.tsx?$/.test(f)&&!f.startsWith("._")&&!f.startsWith("i18n/locales/"))){
    const path=`${root}/${f}`,s=fs.readFileSync(path,"utf8"),a=ts.createSourceFile(path,s,99,true);
    const binds=new Set();
    for(const st of a.statements){
      if(ts.isImportDeclaration(st)&&ts.isStringLiteral(st.moduleSpecifier)&&(/i18n\/index\.js$/.test(st.moduleSpecifier.text)||(f.startsWith("i18n/")&&st.moduleSpecifier.text==="./index.js"))){
        const b=st.importClause?.namedBindings;
        if(b&&ts.isNamedImports(b))for(const el of b.elements)if(/^(t|typedT|msg|rich|tOr|message|localizedList)$/.test(el.propertyName?.text??el.name.text))binds.add(el.name.text);
      }
    }
    function scan(n){if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&binds.has(n.expression.text)){
      const k=n.arguments[0];
      if(k&&ts.isArrayLiteralExpression(k)){
        for(const key of k.elements)if(!ts.isStringLiteral(key)||key.text)out.push({file:path,line:a.getLineAndCharacterOfPosition(key.getStart(a)).line+1,key:ts.isStringLiteral(key)?key.text:null,expression:key.getText(a)});
        ts.forEachChild(n,scan);return;
      }
      let params=[],computedParams=false;
      // rich accepts React slots and optional scalar params; ordinary messages
      // accept only the second argument. Imported aliases are resolved above.
      for(const arg of n.arguments.slice(1)){
        if(ts.isObjectLiteralExpression(arg)){
          for(const property of arg.properties){
            if((ts.isPropertyAssignment(property)||ts.isShorthandPropertyAssignment(property))&&!ts.isComputedPropertyName(property.name))params.push(property.name.text);
            else computedParams=true;
          }
        }else computedParams=true;
      }
      out.push({file:path,line:a.getLineAndCharacterOfPosition(n.getStart(a)).line+1,key:k&&ts.isStringLiteral(k)?k.text:null,expression:k?.getText(a),params,computedParams,context:n.parent.getText(a).slice(0,700)});
    }ts.forEachChild(n,scan)}scan(a);
  }return out;
}
