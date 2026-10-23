/** Executes production transport/session bridge functions with IPC fixtures only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../apps/desktop/src/lib/transport.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('transport.ts', source, ts.ScriptTarget.Latest, true);
const names = ['nativeSessionChanged', 'normalizeNativeSessionError', 'nativeSessionEpoch', 'assertNativeSessionEpoch', 'nativeSeedCookies', 'nativeFetch', 'guardNativeResponse'];
const functions = names.map(name => ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name).getText(ast)).join('\n');
const code = ts.transpileModule(functions, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const deferred = () => { let resolve; const promise = new Promise(r=>resolve=r); return {promise,resolve}; };
function fixture({hold,holdSerialize}={}) {
  let epoch=4; const calls=[]; const exports={};
  const invoke=async(command,args)=>{
    calls.push({command,args});
    if(command==='http_native_epoch') return epoch;
    if(command==='http_native_seed') { if(args.epoch!==epoch) throw 'AUTH_SESSION_CHANGED'; return; }
    if(command==='http_native') { if(hold) await hold.promise; return {status:200,status_text:'OK',headers:{'content-type':'text/plain'},set_cookies:['sid=fixture; Path=/'],url:args.input.url,body:'old payload'}; }
    throw Error(command);
  };
  new Function('exports','require','isTauri','serializeFetchBody','webvpnWrap','i18n','networkLogUrl',code)(exports,(path)=>{
    assert.equal(path,'@tauri-apps/api/core'); return {invoke};
  },true,async()=>{if(holdSerialize)await holdSerialize.promise;return{bodyStr:null,bodyB64:null};},u=>u,k=>k,u=>u);
  return {...exports,calls,switchAccount:()=>epoch++,epoch:()=>epoch};
}
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS '+name)}
const changed=e=>e?.code==='AUTH_SESSION_CHANGED';
await test('response arriving after account switch is rejected before JS cookies are exposed',async()=>{
  const hold=deferred(),h=fixture({hold}); const pending=h.nativeFetch('https://learn.tsinghua.edu.cn/');
  while(!h.calls.some(c=>c.command==='http_native')) await new Promise(r=>setTimeout(r,0));
  h.switchAccount();hold.resolve();await assert.rejects(pending,changed);
});
await test('async body serialization retains original account epoch',async()=>{
  const holdSerialize=deferred(),h=fixture({holdSerialize});const pending=h.nativeFetch('https://learn.tsinghua.edu.cn/');
  await new Promise(r=>setTimeout(r,0));h.switchAccount();holdSerialize.resolve();await assert.rejects(pending,changed);
  assert.equal(h.calls.find(c=>c.command==='http_native').args.epoch,4);
});
await test('body read after switch rejects credentials from an already received response',async()=>{
  const h=fixture(),response=await h.nativeFetch('https://learn.tsinghua.edu.cn/');h.switchAccount();
  await assert.rejects(response.text(),changed);await assert.rejects(response.assertNativeSession(),changed);
});
await test('cloned responses retain the original epoch guard for later body reads',async()=>{
  const h=fixture(),response=await h.nativeFetch('https://learn.tsinghua.edu.cn/');
  const clone=response.clone();h.switchAccount();await assert.rejects(clone.text(),changed);
});
await test('current response carries epoch for derived cookie seed and reads normally',async()=>{
  const h=fixture(),response=await h.nativeFetch('https://learn.tsinghua.edu.cn/');
  assert.equal(response.headers.get('x-onethu-cookie-epoch'),'4');assert.equal(await response.text(),'old payload');
});
await test('unprovenanced seed is rejected; captured old seed cannot choose the new epoch',async()=>{
  const h=fixture();await assert.rejects(h.nativeSeedCookies('https://school.example/',['sid=old']),changed);
  const epoch=await h.nativeSessionEpoch();h.switchAccount();
  await assert.rejects(h.nativeSeedCookies('https://school.example/',['sid=old'],epoch),changed);
  await h.nativeSeedCookies('https://school.example/',['sid=current'],await h.nativeSessionEpoch());
  assert.deepEqual(h.calls.filter(c=>c.command==='http_native_seed').map(c=>c.args.epoch),[4,5]);
});
const cloudSource=fs.readFileSync(new URL('../apps/desktop/src/lib/cloudTokenWebview.ts',import.meta.url),'utf8');
const cloudAst=ts.createSourceFile('cloudTokenWebview.ts',cloudSource,ts.ScriptTarget.Latest,true);
const cloudCode=ts.transpileModule(['mergeReturnedCookies','acceptPayload'].map(name=>cloudAst.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text===name).getText(cloudAst)).join('\n')+'\nexports.acceptPayload=acceptPayload;', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function cloudFixture(){
  let epoch=4;const cookies=[];const exports={};const changed=()=>Object.assign(new Error('AUTH_SESSION_CHANGED'),{code:'AUTH_SESSION_CHANGED'});
  const ensure=async(value)=>{if(value!==epoch)throw changed()};
  new Function('exports','TOKEN_RE','ALLOWED_COOKIE_HOSTS','http','nativeSessionChanged','assertNativeSessionEpoch','nativeSeedCookies','i18n',cloudCode)(exports,/^[0-9a-f]{40}$/i,new Set(['cloud.tsinghua.edu.cn']),{jar:{setRaw:(url,line)=>cookies.push(line)}},changed,ensure,async(url,lines,value)=>ensure(value),k=>k);
  return{...exports,cookies,switchAccount:()=>epoch++};
}
await test('old cloud token payload never writes cookies or exposes token to new account',async()=>{
  const h=cloudFixture();h.switchAccount();
  await assert.rejects(h.acceptPayload({epoch:4,token:'a'.repeat(40),cookieSeeds:[{url:'https://cloud.tsinghua.edu.cn/',cookies:['sid=old']}]},4),changed);
  assert.deepEqual(h.cookies,[]);
});
await test('current cloud payload validates epoch and allowed origins before merging',async()=>{
  const h=cloudFixture();const token='b'.repeat(40);
  assert.equal(await h.acceptPayload({epoch:4,token,cookieSeeds:[{url:'https://evil.example/',cookies:['sid=evil']},{url:'https://cloud.tsinghua.edu.cn/',cookies:['sid=current']}]},4),token);
  assert.deepEqual(h.cookies,['sid=current']);
  await assert.rejects(h.acceptPayload({epoch:3,token},4),changed);
});
console.log(`${count} native session epoch checks passed (mock IPC; no network)`);
