/** Real encryption/file roundtrip, no personal files, credentials or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
function fixture(){
 const files=new Map(),storage=new Map();
 const exports={};
 const source=readFileSync(new URL('../apps/desktop/src/im/imStorage.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const imports={'../i18n/index.js':{t:k=>k},react:{},'../lib/clients.js':{fileRead:async name=>files.get(name)??null,fileWrite:async(name,body)=>files.set(name,body),fileDelete:async name=>files.delete(name)}};
 new Function('exports','require','crypto','localStorage',code)(exports,id=>{assert.ok(id in imports,id);return imports[id]},webcrypto,{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)});
 const main=()=>new exports.ImStorage('onethu.im.v1','onethu.im.salt.v1','main-fixture-key',120000,()=>({}));
 const context=()=>new exports.ImStorage('onethu.im.taskcontext.v1','onethu.im.taskcontext.salt.v1','context-fixture-key',120000,()=>({}));
 return {files,main,context};
}
test('remembering reply context preserves saved bot credentials across a restart',async()=>{
 const f=fixture(),cfg={channels:{wechat:{botToken:'fixture-token'}},enabled:{wechat:true}};
 await f.main().save(cfg);const original=f.files.get('im.cfg');
 await f.context().save({contextToken:'fixture-context',recipient:'fixture-user'});
 assert.equal(f.files.get('im.cfg'),original);assert.equal(f.files.size,2);
 assert.deepEqual(await f.main().load(),cfg);
 assert.deepEqual(await f.context().load(),{contextToken:'fixture-context',recipient:'fixture-user'});
 await f.context().clear();assert.equal(f.files.get('im.cfg'),original);assert.deepEqual(await f.main().load(),cfg);
});

test('unreadable credentials remain on disk and can be replaced by an explicit reconnect',async()=>{
 const f=fixture();f.files.set('im.cfg',JSON.stringify({salt:'ZmFrZS1zYWx0LXNhbHQ=',env:{v:1,iv:'AAAAAAAAAAAAAAAA',ct:'invalid'}}));
 const config=f.main();assert.deepEqual(await config.load(),{});assert.equal(config.readable(),false);assert.ok(f.files.has('im.cfg'));
 await config.save({channels:{wechat:{botToken:'new-fixture'}}});assert.equal(config.readable(),true);assert.deepEqual(await f.main().load(),{channels:{wechat:{botToken:'new-fixture'}}});
});
