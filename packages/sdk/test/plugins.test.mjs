import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm, access, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deflateRawSync } from 'node:zlib';
import { createPluginHost } from '../src/plugins/index.mjs';
import { crc32 } from '../src/plugins/archive.mjs';

const execute=promisify(execFile);
const base={id:'fixture.example',name:'Fixture',version:'1.0.0',permissions:['learn:read','storage'],entry:'plugin.js'};
async function fixture(t,manifest=base,body=`ctx.registerCommand({id:'courses',title:'Courses'},async input=>({input,courses:await ctx.onethu.learn.courses()}));`) {
  const dir=await mkdtemp(path.join(await realpath(os.tmpdir()),'onethu-sdk-plugin-'));
  const source=path.join(dir,'source');await mkdir(source);
  await writeFile(path.join(source,'manifest.json'),JSON.stringify(manifest));
  if(manifest.kind!=='wasm')await writeFile(path.join(source,manifest.entry??'plugin.js'),`export const manifest=${JSON.stringify(manifest)};export default async function(ctx){${body}}`);
  const calls=[];
  const options={rootDir:path.join(dir,'plugins'),getSession:()=>({status:'ready',username:'fixture-user'}),
    resolveOperation:operation=>operation==='learn.courses'?{permission:'learn:read'}:operation==='mail.send'?{permission:'mail:write',mutation:true}:undefined,
    dispatch:async(operation,args,context)=>{calls.push({operation,args,context});return[{id:'course-1',name:'Fixture Course'}];}};
  const host=createPluginHost(options);
  t.after(async()=>{await host.close();await rm(dir,{recursive:true,force:true});});
  return{dir,source,host,calls,options};
}
function zip(entries) {
  const locals=[],centrals=[];let offset=0;
  for(const [name,text,mode=0o100600,compression=0]of entries){
    const body=Buffer.from(text),nameBytes=Buffer.from(name),crc=crc32(body),compressed=compression===8?deflateRawSync(body):body;
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(nameBytes.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(0x314,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt32LE(crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(nameBytes.length,28);central.writeUInt32LE((mode*65536)>>>0,38);central.writeUInt32LE(offset,42);
    local.writeUInt16LE(compression,8);local.writeUInt32LE(compressed.length,18);central.writeUInt16LE(compression,10);central.writeUInt32LE(compressed.length,20);
    locals.push(local,nameBytes,compressed);centrals.push(central,nameBytes);offset+=local.length+nameBytes.length+compressed.length;
  }
  const central=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,central,end]);
}
const reject=(promise,code)=>assert.rejects(promise,error=>error.code===code);

test('inspection and install do not execute JS; enable and call run existing ctx API independently',async t=>{
  const f=await fixture(t,base,`ctx.registerCommand({id:'courses',title:'Courses'},async input=>({input,session:ctx.onethu.session.status(),courses:await ctx.onethu.learn.courses()}));`);
  const marker=path.join(f.dir,'executed');
  await writeFile(path.join(f.source,'plugin.js'),`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'yes');`+await readFile(path.join(f.source,'plugin.js'),'utf8'));
  assert.equal((await f.host.inspect(f.source)).manifest.id,base.id);
  await reject(f.host.install(f.source),'PLUGIN_CONFIRMATION_REQUIRED');
  await f.host.install(f.source,{confirm:true});await assert.rejects(access(marker));
  assert.equal((await f.host.list())[0].enabled,false);
  await reject(f.host.enable(base.id),'PLUGIN_CONFIRMATION_REQUIRED');
  await f.host.enable(base.id,{confirm:true});assert.equal(await readFile(marker,'utf8'),'yes');
  assert.equal((await f.host.commands(base.id)).commands[0].id,'courses');
  const result=await f.host.call(base.id,'courses','query');assert.equal(result.session,'ready');assert.equal(result.courses[0].id,'course-1');
  assert.equal(f.calls[0].operation,'learn.courses');assert.equal(f.calls[0].context.pluginId,base.id);
  await f.host.disable(base.id);await reject(f.host.call(base.id,'courses'),'PLUGIN_DISABLED');
  await reject(f.host.uninstall(base.id),'PLUGIN_CONFIRMATION_REQUIRED');
  await f.host.uninstall(base.id,{confirm:true});assert.deepEqual(await f.host.list(),[]);
});

test('synchronous JS storage persists through close and restart; listing never activates',async t=>{
  const f=await fixture(t,base,`ctx.registerCommand({id:'count',title:'Count'},()=>{const n=(ctx.onethu.storage.get('n')??0)+1;ctx.onethu.storage.set('n',n);return n;});`);
  await f.host.install(f.source,{confirm:true});await f.host.enable(base.id,{confirm:true});assert.equal(await f.host.call(base.id,'count'),1);
  await f.host.close();
  const next=createPluginHost(f.options);
  try{
    assert.equal((await next.list())[0].running,false);assert.equal((await next.commands(base.id)).running,false);
    assert.equal(await next.call(base.id,'count'),2);
  }finally{await next.close();}
});

test('disable, uninstall and host close wait for actual worker and stdio close',async t=>{
  const f=await fixture(t);await f.host.install(f.source,{confirm:true});
  for(const action of ['disable','uninstall','close']){
    await f.host.enable(base.id,{confirm:true});
    const worker=f.host.processes.get(base.id).process;let closed=false;worker.child.once('close',()=>{closed=true;});
    if(action==='close')await f.host.close();else await f.host[action](base.id,{confirm:true});
    assert.equal(closed,true,action+' must await actual close');assert.equal(worker.didClose,true);
    if(action==='uninstall')await f.host.install(f.source,{confirm:true});
  }
});

test('headless permissions, mutation confirmation and GUI capabilities are explicit',async t=>{
  const manifest={...base,permissions:['learn:read','mail:write','ui']};
  const f=await fixture(t,manifest,`ctx.registerCommand({id:'mail',title:'Mail'},()=>ctx.onethu.mail.send('to','subject','body'));ctx.registerCommand({id:'gui',title:'GUI'},()=>ctx.onethu.ui.toast('hello'));ctx.registerCommand({id:'storage',title:'Storage'},()=>ctx.onethu.storage.keys());`);
  await f.host.install(f.source,{confirm:true});await f.host.enable(base.id,{confirm:true});
  await reject(f.host.call(base.id,'mail'),'PLUGIN_CONFIRMATION_REQUIRED');assert.equal(f.calls.length,0);
  await f.host.call(base.id,'mail','',{confirm:true});assert.equal(f.calls[0].context.confirm,true);
  await reject(f.host.call(base.id,'gui'),'PLUGIN_CAPABILITY_UNAVAILABLE');
  await reject(f.host.call(base.id,'storage'),'PLUGIN_PERMISSION_DENIED');
});

test('undeclared school permission and missing router descriptor are denied',async t=>{
  const f=await fixture(t,{...base,permissions:[]});
  await f.host.install(f.source,{confirm:true});await f.host.enable(base.id,{confirm:true});
  await reject(f.host.call(base.id,'courses'),'PLUGIN_PERMISSION_DENIED');assert.equal(f.calls.length,0);
  f.host.resolveOperation=undefined;await reject(f.host.call(base.id,'courses'),'PLUGIN_OPERATION_UNAVAILABLE');
});

test('GUI-only activation and WASM without an ABI are reported unavailable',async t=>{
  const f=await fixture(t,{...base,permissions:['ui']},`ctx.registerTab({id:'ui',title:'GUI'});`);
  await f.host.install(f.source,{confirm:true});await reject(f.host.enable(base.id,{confirm:true}),'PLUGIN_CAPABILITY_UNAVAILABLE');
  assert.equal((await f.host.list())[0].enabled,false);
  const w=await fixture(t,{...base,id:'fixture.wasm',kind:'wasm',entry:undefined});
  assert.equal((await w.host.inspect(w.source)).compatibility.reason,'WASM_PLUGIN_ABI_UNAVAILABLE');
  await w.host.install(w.source,{confirm:true});await reject(w.host.enable('fixture.wasm',{confirm:true}),'WASM_PLUGIN_ABI_UNAVAILABLE');
});

test('timeout terminates a stuck worker and aborts in-flight host operations on disable',async t=>{
  const f=await fixture(t,base,`ctx.registerCommand({id:'hang',title:'Hang'},()=>{while(true){}});ctx.registerCommand({id:'courses',title:'Courses'},()=>ctx.onethu.learn.courses());`);
  await f.host.install(f.source,{confirm:true});await f.host.enable(base.id,{confirm:true});
  await reject(f.host.call(base.id,'hang','',{timeoutMs:50}),'PLUGIN_TIMEOUT');
  await f.host.enable(base.id,{confirm:true});
  let entered;const enteredPromise=new Promise(resolve=>{entered=resolve;});
  let observedSignal;
  f.host.dispatch=async(_op,_args,context)=>{observedSignal=context.signal;entered();await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));throw Object.assign(new Error('stopped'),{code:'STOPPED'});};
  const pending=f.host.call(base.id,'courses');const rejected=reject(pending,'PLUGIN_STOPPED');await enteredPromise;await f.host.disable(base.id);await rejected;
  assert.equal(observedSignal.aborted,true);
});

test('installed contents and runtime manifest must match approved package',async t=>{
  const f=await fixture(t);
  await f.host.install(f.source,{confirm:true});await writeFile(path.join(f.dir,'plugins/packages',base.id,'plugin.js'),'throw new Error("changed")');
  await reject(f.host.enable(base.id,{confirm:true}),'PLUGIN_PACKAGE_CHANGED');
  await f.host.uninstall(base.id,{confirm:true});
  await writeFile(path.join(f.source,'plugin.js'),`export const manifest={...${JSON.stringify(base)},permissions:['mail:write']};export default function(){}`);
  await f.host.install(f.source,{confirm:true});await reject(f.host.enable(base.id,{confirm:true}),'PLUGIN_MANIFEST_MISMATCH');
});

test('local ZIP install validates every entry before writing',async t=>{
  const f=await fixture(t);
  const manifest=JSON.stringify(base),code=await readFile(path.join(f.source,'plugin.js'));
  const good=[['manifest.json',manifest],['plugin.js',code]];
  const archive=path.join(f.dir,'bundle.zip');await writeFile(archive,zip(good));
  await f.host.install(archive,{confirm:true});await f.host.enable(base.id,{confirm:true});assert.equal((await f.host.call(base.id,'courses')).courses[0].id,'course-1');
  await f.host.uninstall(base.id,{confirm:true});
  for(const [extra,expected]of [[['../outside','bad'],'PLUGIN_UNSAFE_PATH'],[['C:/outside','bad'],'PLUGIN_UNSAFE_PATH'],[['path\\escape','bad'],'PLUGIN_UNSAFE_PATH'],[['CON.txt','bad'],'PLUGIN_UNSAFE_PATH'],[['Plugin.js','bad'],'PLUGIN_DUPLICATE_PATH'],[['link','../outside',0o120777],'PLUGIN_SYMLINK_REFUSED']]){
    await writeFile(archive,zip([...good,extra]));await reject(f.host.install(archive,{confirm:true}),expected);assert.deepEqual(await f.host.list(),[]);
  }
  const corrupted=zip(good);corrupted[40]^=1;await writeFile(archive,corrupted);await reject(f.host.install(archive,{confirm:true}),'PLUGIN_INVALID_ZIP');
});

test('source symlinks, unsafe IDs and code-only manifests are rejected without executing',async t=>{
  const f=await fixture(t);const link=path.join(f.source,'link');await symlink(path.join(f.source,'plugin.js'),link);
  await reject(f.host.inspect(f.source),'PLUGIN_SYMLINK_REFUSED');await rm(link);
  await writeFile(path.join(f.source,'manifest.json'),JSON.stringify({...base,id:'../outside'}));await reject(f.host.inspect(f.source),'PLUGIN_INVALID_ID');
  await reject(f.host.inspect(path.join(f.source,'plugin.js')),'PLUGIN_MANIFEST_REQUIRED');
});

test('deflated single-folder packages work and conflicting paths or oversized entries fail before extraction',async t=>{
  const f=await fixture(t);const archive=path.join(f.dir,'compressed.zip');
  const entries=[['bundle/manifest.json',JSON.stringify(base),0o100600,8],['bundle/plugin.js',await readFile(path.join(f.source,'plugin.js')),0o100600,8]];
  await writeFile(archive,zip(entries));assert.equal((await f.host.inspect(archive)).manifest.id,base.id);
  await f.host.install(archive,{confirm:true});await f.host.enable(base.id,{confirm:true});assert.equal((await f.host.call(base.id,'courses')).courses[0].id,'course-1');
  await f.host.uninstall(base.id,{confirm:true});
  await writeFile(archive,zip([...entries,['bundle/a','x'],['bundle/a/b','y']]));await reject(f.host.install(archive,{confirm:true}),'PLUGIN_DUPLICATE_PATH');
  const tooLarge=zip(entries);const central=tooLarge.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));tooLarge.writeUInt32LE(65*1024*1024,central+24);
  await writeFile(archive,tooLarge);await reject(f.host.install(archive,{confirm:true}),'PLUGIN_INVALID_ZIP');assert.deepEqual(await f.host.list(),[]);
});

test('closing or disabling during asynchronous startup prevents late execution',async t=>{
  const f=await fixture(t);await f.host.install(f.source,{confirm:true});
  let ready,release;const waiting=new Promise(resolve=>{ready=resolve;});
  f.host.getSession=async()=>{ready();await new Promise(resolve=>{release=resolve;});return{status:'ready'};};
  const pending=f.host.enable(base.id,{confirm:true});const rejected=reject(pending,'PLUGIN_STOPPED');
  await waiting;const disabled=f.host.disable(base.id);release();await rejected;await disabled;
  assert.equal((await f.host.list())[0].enabled,false);assert.equal((await f.host.list())[0].running,false);
});

test('actual Rust stdio fixture registers commands and calls the headless SDK bridge',async t=>{
  const f=await fixture(t,{...base,kind:'rust',bin:process.platform==='win32'?'fixture.exe':'fixture'});
  const code=String.raw`use std::io::{self,BufRead,Write};
fn send(s:&str){println!("{}",s);io::stdout().flush().unwrap();}
fn main(){let stdin=io::stdin();let mut lines=stdin.lock().lines();while let Some(Ok(line))=lines.next(){
 let id=line.split("\"id\":\"").nth(1).unwrap_or("").split('"').next().unwrap_or("");
 if line.contains("\"activate\""){send(&format!("{{\"jsonrpc\":\"2.0\",\"id\":\"{}\",\"result\":{{\"commands\":[{{\"id\":\"courses\",\"title\":\"Courses\"}}]}}}}",id));}
 else if line.contains("\"run\""){send(r#"{"jsonrpc":"2.0","id":100,"method":"onethu.call","params":{"ns":"learn","method":"courses","args":[]}}"#);
 let reply=lines.next().unwrap().unwrap();let ok=reply.contains("course-1");send(&format!("{{\"jsonrpc\":\"2.0\",\"id\":\"{}\",\"result\":{{\"bridgeWorked\":{}}}}}",id,ok));}
}}`;
  const rust=path.join(f.dir,'fixture.rs');await writeFile(rust,code);
  await execute('rustc',['--edition=2021',rust,'-o',path.join(f.source,process.platform==='win32'?'fixture.exe':'fixture')]);
  await f.host.install(f.source,{confirm:true});await f.host.enable(base.id,{confirm:true});
  assert.equal((await f.host.call(base.id,'courses')).bridgeWorked,true);assert.equal(f.calls.length,1);
});

test('per-call final guard reaches asynchronous plugin SDK dispatch and rejects an account change',async t=>{
  const f=await fixture(t);await f.host.install(f.source,{confirm:true});await f.host.enable(base.id,{confirm:true});
  let owner='first',entered,release,writes=0;
  const ready=new Promise(resolve=>{entered=resolve;});const blocked=new Promise(resolve=>{release=resolve;});
  const guard=async()=>{if(owner!=='first')throw Object.assign(new Error('changed'),{code:'SESSION_CHANGED'});};
  f.host.dispatch=async(_op,_args,context)=>{assert.equal(context.beforeWrite,guard);entered();await blocked;await context.beforeWrite();writes++;return[];};
  const running=f.host.call(base.id,'courses','',{beforeWrite:guard});const rejected=reject(running,'SESSION_CHANGED');
  await ready;owner='second';release();await rejected;assert.equal(writes,0);
});

test('external caller cancellation stops a running plugin and aborts reverse calls',async t=>{
  const f=await fixture(t);await f.host.install(f.source,{confirm:true});await f.host.enable(base.id,{confirm:true});
  let entered,observed;const ready=new Promise(resolve=>{entered=resolve;});
  f.host.dispatch=async(_op,_args,context)=>{observed=context.signal;entered();await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));return[];};
  const controller=new AbortController();const running=f.host.call(base.id,'courses','',{signal:controller.signal});const rejected=reject(running,'PLUGIN_STOPPED');
  await ready;controller.abort();await rejected;assert.equal(observed.aborted,true);assert.equal((await f.host.list())[0].running,false);
});
