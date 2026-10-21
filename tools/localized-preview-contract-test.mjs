/** Provenance and language isolation for every English guide and public capture. */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const root='apps/desktop/src/assets/tour/real-ui',pub='docs/assets/0.11/en-US';
const source=readFileSync('apps/desktop/src/components/tourStudioScreens.ts','utf8');
const keys=[...source.split('export const STUDIO_SCREEN_KEYS = [')[1].split('] as const')[0].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
for(const key of keys){assert.ok(existsSync(root+'/'+key+'.png'),'Chinese source retained: '+key);assert.ok(existsSync(root+'/en-US/'+key+'.png'),'English source exists: '+key);assert.notEqual(digest(root+'/'+key+'.png'),digest(root+'/en-US/'+key+'.png'),'English capture must be distinct: '+key);}
for(const [file,entriesKey] of [['manifest.json','entries'],['manifest-vault-drag.json','files']]){
 const report=JSON.parse(readFileSync(pub+'/'+file,'utf8'));assert.ok(report.passed,file);assert.equal(report.locale,'en-US');
 for(const entry of report[entriesKey]){const path=file==='manifest-vault-drag.json'&&entry.file.endsWith('.png')?root+'/en-US/'+entry.file:pub+'/'+entry.file;assert.equal(digest(path),entry.sha256,entry.file);}
}
const guide=JSON.parse(readFileSync(root+'/en-US/manifest-localized.json','utf8'));assert.ok(guide.passed&&guide.naturalCleanup);assert.equal(guide.externalRequestsSent,0);
for(const entry of guide.entries){assert.equal(digest(root+'/en-US/'+entry.file),entry.sha256);if(entry.visibleText)assert.doesNotMatch(entry.visibleText.replaceAll('简体中文',''),/[\u3400-\u9fff]/);}
assert.notEqual(digest(root+'/vault-drag.mp4'),digest(root+'/en-US/vault-drag.mp4'));
assert.match(readFileSync('README.en.md','utf8'),/assets\/0.11\/en-US\//);
console.log('✓ '+keys.length+' distinct English guide screens, actual English recording, hashes, isolated fixtures and retained Chinese assets');
