/** Produce an installable SDK without publishing or modifying workspace exports. */
import ts from 'typescript';
import path from 'node:path';
import os from 'node:os';
import { builtinModules, createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, cp, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import fs from 'node:fs';
const sdk=fileURLToPath(new URL('..',import.meta.url)),repo=path.resolve(sdk,'../..'),packages=path.dirname(sdk);
const argv=process.argv.slice(2);let out=path.join(sdk,'artifacts'),skipBuild=false;
for(let i=0;i<argv.length;i++){if(argv[i]==='--out'&&argv[i+1])out=path.resolve(argv[++i]);else if(argv[i]==='--skip-build')skipBuild=true;else throw new Error('Usage: node scripts/pack.mjs [--out directory] [--skip-build]');}
if(!skipBuild)execFileSync(process.execPath,[path.join(sdk,'scripts/build.mjs')],{stdio:'inherit'});
const temporary=await mkdtemp(path.join(os.tmpdir(),'onethu-sdk-pack-')),stage=path.join(temporary,'package');
const require=createRequire(import.meta.url);
const cleanFile=name=>!path.basename(name).startsWith('._')&&!name.split(path.sep).includes('.DS_Store');
const canonical=name=>{try{return fs.realpathSync(name);}catch{return path.resolve(name);}};
const builtins=new Set([...builtinModules,...builtinModules.map(n=>'node:'+n)]);
const outputForSource=new Map(),declarations=new Map(),compileOptions=new Map(),vendorPackages=new Map();
const typeRoot=path.join(stage,'types');
function diagnosticsError(items,label){const errors=items.filter(d=>d.category===ts.DiagnosticCategory.Error);if(errors.length)throw new Error(label+':\n'+errors.slice(0,20).map(d=>`${d.file?path.relative(repo,d.file.fileName)+': ':''}TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`).join('\n'));}
async function emitPackage(name){
  const root=path.join(packages,name),configPath=path.join(root,'tsconfig.json');
  const config=ts.readConfigFile(configPath,ts.sys.readFile);diagnosticsError(config.error?[config.error]:[],name);
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);diagnosticsError(parsed.errors,name);
  const options={...parsed.options,noEmit:false,declaration:true,declarationMap:false,emitDeclarationOnly:true,noEmitOnError:true,incremental:false,composite:false,rootDir:root,outDir:path.join(typeRoot,name)};
  const names=parsed.fileNames.filter(cleanFile);const program=ts.createProgram(names,options);
  diagnosticsError(ts.getPreEmitDiagnostics(program),name);
  const emitted=program.emit(undefined,(filename,text,_bom,_error,sources)=>{
    if(!/\.d\.(?:ts|mts|cts)$/.test(filename))return;
    const original=sources?.[0]?.fileName;if(!original)throw new Error('DECLARATION_SOURCE_MISSING:'+filename);
    declarations.set(filename,{text,original,options});outputForSource.set(canonical(original),filename);
  });
  diagnosticsError(emitted.diagnostics,name);compileOptions.set(name,options);
}
function jsSpecifier(from,to){let value=path.relative(path.dirname(from),to).split(path.sep).join('/').replace(/\.d\.mts$/,'.mjs').replace(/\.d\.cts$/,'.cjs').replace(/\.d\.ts$/,'.js');return value.startsWith('.')?value:'./'+value;}
async function externalDeclaration(file,options){
  const original=canonical(file);if(outputForSource.has(original))return outputForSource.get(original);
  if(!/\.d\.(?:ts|mts|cts)$/.test(original))throw new Error('SDK_TYPE_DEPENDENCY_NOT_DECLARED:'+original);
  let root=path.dirname(original),pkg;
  while(root!==path.dirname(root)){try{const value=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));if(value.name&&value.version){pkg=value;break;}}catch{}root=path.dirname(root);}
  if(!pkg)throw new Error('SDK_TYPE_PACKAGE_MISSING:'+original);
  if(pkg.name==='@types/node')return null;
  const key=`${pkg.name.replace(/[^A-Za-z0-9_.-]/g,'_')}-${pkg.version}`;
  const target=path.join(typeRoot,'vendor',key,path.relative(root,original));
  outputForSource.set(original,target);declarations.set(target,{text:await readFile(original,'utf8'),original,options});
  if(!vendorPackages.has(root)){
    vendorPackages.set(root,{pkg,key});const dest=path.join(typeRoot,'vendor',key);await mkdir(dest,{recursive:true});
    await writeFile(path.join(dest,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,type:pkg.type??'commonjs',license:pkg.license},null,2)+'\n');
    for(const name of await readdir(root)){if(/^(?:licen[sc]e|copying|notice)(?:[._-]|$)/i.test(name)&&(await stat(path.join(root,name))).isFile())await cp(path.join(root,name),path.join(dest,name));}
  }
  // Preserve nested CommonJS/ESM declaration scopes (e.g. cheerio's esm/commonjs).
  let parent=path.dirname(original);while(parent!==root){try{const text=await readFile(path.join(parent,'package.json'),'utf8'),scope=JSON.parse(text);await mkdir(path.join(typeRoot,'vendor',key,path.relative(root,parent)),{recursive:true});await writeFile(path.join(typeRoot,'vendor',key,path.relative(root,parent),'package.json'),JSON.stringify({type:scope.type??'commonjs'})+'\n');}catch{}parent=path.dirname(parent);}
  return target;
}
async function resolveDeclaration(specifier,entry){
  if(builtins.has(specifier)||specifier.startsWith('node:'))return null;
  const alias=specifier==='@onethu/core'?path.join(packages,'core/src/index.ts'):specifier==='@onethu/info-lib'?path.join(packages,'info-lib/src/index.ts'):specifier==='@onethu/info-lib/network'?path.join(packages,'info-lib/src/utils/network.ts'):null;
  const resolved=alias??ts.resolveModuleName(specifier,entry.original,entry.options,ts.sys).resolvedModule?.resolvedFileName;
  if(!resolved)throw new Error(`SDK_TYPE_IMPORT_UNRESOLVED: ${specifier} in ${path.relative(repo,entry.original)}`);
  return outputForSource.get(canonical(resolved))??await externalDeclaration(resolved,entry.options);
}
async function writeDeclarations(){
  // The map grows as reachable third-party declarations are encountered.
  for(const [target,entry] of declarations){
    // checkJs=false can infer only defaulted members of a destructured object,
    // then emit bindings absent from that inferred type. Preserve those public
    // bindings as unknown instead of publishing an invalid declaration or any.
    const source=ts.createSourceFile(target,entry.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
    const transformed=ts.transform(source,[context=>root=>{
      const visit=node=>{
        if(ts.isParameter(node)&&ts.isObjectBindingPattern(node.name)&&node.type&&ts.isTypeLiteralNode(node.type)){
          const existing=new Set(node.type.members.map(m=>m.name&&('text'in m.name?m.name.text:undefined)));
          const missing=node.name.elements.filter(e=>!e.dotDotDotToken).map(e=>e.propertyName??e.name).filter(n=>ts.isIdentifier(n)||ts.isStringLiteral(n)).filter(n=>!existing.has(n.text));
          if(missing.length)return context.factory.updateParameterDeclaration(node,node.modifiers,node.dotDotDotToken,node.name,node.questionToken,context.factory.updateTypeLiteralNode(node.type,[...node.type.members,...missing.map(n=>context.factory.createPropertySignature(undefined,n,context.factory.createToken(ts.SyntaxKind.QuestionToken),context.factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)))]),node.initializer);
        }
        return ts.visitEachChild(node,visit,context);
      };return ts.visitNode(root,visit);
    }]);
    entry.text=ts.createPrinter().printFile(transformed.transformed[0]);transformed.dispose();
    const ast=ts.createSourceFile(target,entry.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),refs=[],parsed=ts.preProcessFile(entry.text,true,true),edits=[];
    const visit=node=>{
      if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))refs.push({literal:node.moduleSpecifier,node});
      if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument)&&ts.isStringLiteral(node.argument.literal))refs.push({literal:node.argument.literal,node});
      if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference)&&node.moduleReference.expression&&ts.isStringLiteral(node.moduleReference.expression))refs.push({literal:node.moduleReference.expression,node});
      ts.forEachChild(node,visit);
    };visit(ast);
    for(const {literal,node} of refs){
      const dest=await resolveDeclaration(literal.text,entry);if(!dest)continue;const value=jsSpecifier(target,dest);
      let parent=node.parent,ambient=false;while(parent){if(ts.isModuleDeclaration(parent)&&ts.isStringLiteral(parent.name)){ambient=true;break;}parent=parent.parent;}
      if(ambient&&ts.isImportDeclaration(node)){
        const named=node.importClause?.namedBindings;
        // Node's worker_threads declaration imports a type from undici inside
        // its ambient module; relative import declarations are forbidden there.
        if(!named||!ts.isNamedImports(named)||node.importClause?.name)throw new Error('SDK_AMBIENT_TYPE_IMPORT_UNSUPPORTED');
        edits.push({start:node.getStart(ast),end:node.end,value:named.elements.map(e=>`type ${e.name.text} = import(${JSON.stringify(value)}).${e.propertyName?.text??e.name.text};`).join('\n')});
      }else edits.push({start:literal.getStart(ast)+1,end:literal.end-1,value});
    }
    for(const ref of parsed.referencedFiles){const original=path.resolve(path.dirname(entry.original),ref.fileName),dest=outputForSource.get(canonical(original))??await externalDeclaration(original,entry.options);if(dest){let value=path.relative(path.dirname(target),dest).split(path.sep).join('/');if(!value.startsWith('.'))value='./'+value;edits.push({start:ref.pos,end:ref.end,value});}}
    let text=entry.text;for(const edit of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,edit.start)+edit.value+text.slice(edit.end);
    await mkdir(path.dirname(target),{recursive:true});await writeFile(target,text);
  }
}
try{
  await mkdir(stage,{recursive:true});await cp(path.join(sdk,'dist'),path.join(stage,'dist'),{recursive:true,filter:source=>cleanFile(source)});
  for(const name of ['sdk','core','info-lib'])await emitPackage(name);
  await writeDeclarations();
  const source=JSON.parse(await readFile(path.join(sdk,'package.json'),'utf8'));
  const exports={};
  for(const [subpath,value] of Object.entries(source.exports)){
    if(subpath==='./catalog'){await cp(path.join(sdk,'src/catalog.json'),path.join(stage,'catalog.json'));exports[subpath]='./catalog.json';continue;}
    const src=typeof value==='object'?value.types:null;if(!src)throw new Error('SDK_EXPORT_TYPES_MISSING:'+subpath);
    const target=outputForSource.get(canonical(path.join(sdk,src)));if(!target)throw new Error('SDK_EXPORT_DECLARATION_MISSING:'+subpath);
    await writeFile(target,'/// <reference types="node" />\n'+await readFile(target,'utf8'));
    exports[subpath]={types:'./'+path.relative(stage,target).split(path.sep).join('/'),import:value.import};
    // Workspace browser conditions remain in the original package.json. The
    // installable Node package intentionally exposes the bundled Node entries.
  }
  // Bundle standard Node declarations as normal npm packages. This keeps npm /
  // TypeScript package identities intact and deduplicates a consumer's existing
  // Node types; copying them under a private types/ path duplicates globals.
  const nodeTypesRoot=path.dirname(require.resolve('@types/node/package.json'));
  const nodeTypes=JSON.parse(await readFile(path.join(nodeTypesRoot,'package.json'),'utf8'));
  await mkdir(path.join(stage,'node_modules/@types'),{recursive:true});await cp(nodeTypesRoot,path.join(stage,'node_modules/@types/node'),{recursive:true,filter:source=>cleanFile(source)});
  const nodeRequire=createRequire(path.join(nodeTypesRoot,'package.json'));
  await cp(path.dirname(nodeRequire.resolve('undici-types/package.json')),path.join(stage,'node_modules/undici-types'),{recursive:true,filter:source=>cleanFile(source)});
  const manifest={name:source.name,version:source.version,description:source.description,type:'module',license:source.license,engines:source.engines,main:'./dist/index.mjs',types:exports['.'].types,exports,files:['dist','types','catalog.json','LICENSE','LICENSES','README.md','README.en.md'],dependencies:{'@types/node':nodeTypes.version},bundledDependencies:['@types/node']};
  await writeFile(path.join(stage,'package.json'),JSON.stringify(manifest,null,2)+'\n');
  await cp(path.join(repo,'LICENSE'),path.join(stage,'LICENSE'));await cp(path.join(repo,'LICENSES'),path.join(stage,'LICENSES'),{recursive:true,filter:source=>cleanFile(source)});
  for(const name of ['README.md','README.en.md'])await cp(path.join(sdk,name),path.join(stage,name));
  await mkdir(out,{recursive:true});
  // The shell is needed for npm.cmd on Windows. All command arguments are fixed;
  // user-selected output paths are handled through fs and never shell-expanded.
  const packed=JSON.parse(execFileSync(process.platform==='win32'?'npm.cmd':'npm',['pack','--json','--ignore-scripts'],{cwd:stage,encoding:'utf8',maxBuffer:8*1024*1024,shell:process.platform==='win32'}));
  const file=path.join(out,packed[0].filename);await cp(path.join(stage,packed[0].filename),file);
  const sha256=createHash('sha256').update(await readFile(file)).digest('hex');
  await writeFile(file+'.sha256',`${sha256}  ${path.basename(file)}\n`);
  process.stdout.write(JSON.stringify({file,sha256,declarationFiles:declarations.size,externalRuntimeDependencies:[],externalTypeDependencies:[]})+'\n');
}finally{await rm(temporary,{recursive:true,force:true});}
