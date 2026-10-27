/** Execute production hotfix parsing and comparison, including old-client discovery. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
async function functions(path, names) {
  const ast=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
  const code=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
  const js=ts.transpileModule(code+'\nexport {'+names.join(',')+'};',{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
}
const {isNewer}=await functions('apps/desktop/src/lib/update.ts',['toTuple','isNewer']);
const {parseManifest,versionFromName}=await functions('apps/desktop/src/lib/updater.ts',['parseManifest','versionFromName']);
for(const [latest,current,want] of [
  ['0.11.4-fix-1','0.11.4',true],['0.11.4-fix-1','0.11.4-fix-1',false],
  ['0.11.4-fix-2','0.11.4-fix-1',true],['0.11.5','0.11.4-fix-1',true],
  ['0.11.4','0.11.4-fix-1',false],['0.11.4-fix-10','0.11.4-fix-2',true],
]) assert.equal(isNewer(latest,current),want,latest+' vs '+current);
const published={version:'0.11.5',displayVersion:'0.11.4-fix-1',assets:{windows:{url:'OneTHU_0.11.4-fix-1_x64-setup.exe'}}};
const parsed=parseManifest(JSON.stringify(published)).manifest;
assert.equal(parsed.version,'0.11.4-fix-1');
assert.equal(isNewer(parsed.version,'0.11.4'),true);
assert.equal(isNewer(parsed.version,'0.11.4-fix-1'),false);
// The shipped 0.11.4 comparison only examines the first three numeric parts.
const oldTuple=v=>v.replace(/^[vV]/,'').split(/[.\-+]/).slice(0,3).map(x=>parseInt(x,10)||0);
assert.ok(oldTuple(published.version)[2]>oldTuple('0.11.4')[2]);
assert.equal(versionFromName('OneTHU_0.11.4-fix-1_arm64.apk'),'0.11.4-fix-1');
assert.equal(parseManifest(JSON.stringify({version:'0.11.5'})).manifest.version,'0.11.5');
console.log('✓ hotfix order, manifest actual version, legacy discovery and no repeated reminder');
