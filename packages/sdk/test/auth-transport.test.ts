import test from 'node:test';
import assert from 'node:assert/strict';
import { webvpnWrap } from '@onethu/core';
import { createNodeTransport } from '../src/node/transport.js';
import { authError } from '../src/node/storage.js';
function fixture(fetch:any,extra:Record<string,unknown>={}){let epoch=0;const transport=createNodeTransport({fetch,epoch:()=>epoch,assertCurrent(value){if(value!==epoch)throw authError('AUTH_SESSION_CHANGED');},...extra});return{...transport,bump(){epoch++;transport.rotate();}};}

test('manual redirect preserves status, Location, final URL and does not fetch its target',async()=>{
  const calls:string[]=[];const f=fixture(async(url:string)=>{calls.push(url);return new Response('redirect',{status:302,headers:{location:'https://elsewhere.test/next','set-cookie':'session=fixture; Path=/; Secure'}});});
  const r=await f.fetch('https://source.test/start',{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'https://elsewhere.test/next');assert.equal(r.url,'https://source.test/start');assert.equal(r.headers.get('x-onethu-final-url'),r.url);assert.equal(r.headers.get('set-cookie'),null);assert.equal(await r.text(),'redirect');assert.equal(calls.length,1);f.close();
});
test('redirect:error stops before the next request',async()=>{let n=0;const f=fixture(async()=>{n++;return new Response('',{status:302,headers:{location:'/next'}});});await assert.rejects(f.fetch('https://source.test/start',{redirect:'error'}),{code:'NETWORK_REDIRECT_REJECTED'});assert.equal(n,1);f.close();});
test('redirect strips authorization, private headers and cookies across hosts',async()=>{
  const calls:{url:string;headers:Headers}[]=[];const f=fixture(async(url:string,init:RequestInit)=>{calls.push({url,headers:new Headers(init.headers)});return calls.length===1?new Response('',{status:302,headers:{location:'https://target.test/end','set-cookie':'sid=private; Path=/; Secure'}}):new Response('done');});
  const r=await f.fetch('https://source.test/start',{headers:{authorization:'Bearer fixture','x-api-key':'fixture',cookie:'caller=bad',accept:'text/plain'}});assert.equal(await r.text(),'done');assert.equal(r.url,'https://target.test/end');assert.equal(calls[0].headers.has('cookie'),false);assert.equal(calls[1].headers.get('authorization'),null);assert.equal(calls[1].headers.get('x-api-key'),null);assert.equal(calls[1].headers.get('cookie'),null);assert.equal(calls[1].headers.get('accept'),'text/plain');f.close();
});
test('cross-origin 307 never replays a credential-bearing body',async()=>{let n=0;const f=fixture(async()=>{n++;return new Response('',{status:307,headers:{location:'https://target.test/'}});});await assert.rejects(f.fetch('https://source.test/',{method:'POST',body:'password=fixture'}),{code:'NETWORK_REDIRECT_BODY_REJECTED'});assert.equal(n,1);f.close();});
test('303 changes POST to GET and HTTPS downgrade is rejected',async()=>{
  const methods:string[]=[];const f=fixture(async(_url:string,init:RequestInit)=>{methods.push(init.method!);return methods.length===1?new Response('',{status:303,headers:{location:'https://target.test/'}}):new Response('ok');});await(await f.fetch('https://source.test/',{method:'POST',body:'fixture'})).text();assert.deepEqual(methods,['POST','GET']);f.close();
  const down=fixture(async()=>new Response('',{status:302,headers:{location:'http://source.test/'}}));await assert.rejects(down.fetch('https://source.test/'),{code:'NETWORK_REDIRECT_REJECTED'});down.close();
});
test('gateway cookies remain scoped to their decoded application',async()=>{
  const seen:Headers[]=[];let n=0;const learn=webvpnWrap('https://learn.tsinghua.edu.cn/path'),other=webvpnWrap('https://info.tsinghua.edu.cn/path');
  const f=fixture(async(_u:string,init:RequestInit)=>{seen.push(new Headers(init.headers));n++;return new Response('ok',{headers:n===1?{'set-cookie':'JSESSIONID=learn-only; Path=/; Secure'}:{}});});
  await(await f.fetch(learn)).text();await(await f.fetch(other)).text();await(await f.fetch(learn)).text();assert.equal(seen[1].get('cookie'),null);assert.equal(seen[2].get('cookie'),'JSESSIONID=learn-only');f.close();
});
test('gateway logical cross-origin redirect strips secrets and retains campus routing',async()=>{
  const seen:{url:string;headers:Headers}[]=[];const f=fixture(async(url:string,init:RequestInit)=>{seen.push({url,headers:new Headers(init.headers)});return seen.length===1?new Response('',{status:302,headers:{location:'https://info.tsinghua.edu.cn/end'}}):new Response('ok');});
  await(await f.fetch(webvpnWrap('https://learn.tsinghua.edu.cn/path'),{headers:{authorization:'fixture'}})).text();assert.equal(seen[1].url,webvpnWrap('https://info.tsinghua.edu.cn/end'));assert.equal(seen[1].headers.get('authorization'),null);f.close();
});
test('foreign/public-suffix cookie injection is rejected',async()=>{
  const h=new Headers();h.append('set-cookie','wrong=secret; Domain=target.test; Path=/');h.append('set-cookie','broad=secret; Domain=test; Path=/');const f=fixture(async()=>new Response('ok',{headers:h}));await(await f.fetch('https://source.test/')).text();assert.equal(f.jar.serialize(),'[]');f.close();
});
test('account rotation before response prevents stale cookie insertion',async()=>{
  let release!:(r:Response)=>void;const f=fixture(()=>new Promise<Response>(resolve=>{release=resolve;}));const pending=f.fetch('https://source.test/');f.bump();release(new Response('old',{headers:{'set-cookie':'sid=old; Path=/'}}));await assert.rejects(pending,{code:'AUTH_SESSION_CHANGED'});assert.equal(f.jar.serialize(),'[]');f.close();
});
test('body size limit is per call and accepts the downloader 4 GiB bound',async()=>{
  const f=fixture(async()=>new Response('12345'),{maxResponseBytes:4});await assert.rejects((await f.fetch('https://source.test/')).text(),{code:'NETWORK_RESPONSE_TOO_LARGE'});
  assert.equal(await(await f.fetch('https://source.test/',{maxResponseBytes:4*1024**3} as RequestInit)).text(),'12345');f.close();
});
test('known legacy charset is decoded without exposing raw response errors',async()=>{
  const f=fixture(async()=>new Response(new Uint8Array([0xd6,0xd0,0xce,0xc4]),{headers:{'content-type':'text/html; charset=gbk'}}));const r=await f.fetch('https://source.test/');assert.equal(await r.text(),'中文');assert.equal(r.url,'https://source.test/');f.close();
});
test('archive responses retain original bytes even when a legacy charset is advertised',async()=>{
  const original=new Uint8Array([0xd6,0xd0,0xce,0xc4]);const f=fixture(async()=>new Response(original,{headers:{'content-type':'text/html; charset=gbk'}}));const r=await f.fetch('https://source.test/',{preserveResponseBytes:true} as RequestInit);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),original);f.close();
});
test('gateway control cookies retain server values and only reach their physical gateway scope',async()=>{
  const seen:Headers[]=[];const headers=new Headers();headers.append('set-cookie','wengine_vpn_ticket=wrdvpn1-authenticated-fixture; Path=/');headers.append('set-cookie','heartbeat=fixture-heartbeat; Path=/');headers.append('set-cookie','JSESSIONID=valid-app; Path=/');let n=0;
  const f=fixture(async(_u:string,init:RequestInit)=>{seen.push(new Headers(init.headers));return new Response('ok',{headers:n++===0?headers:{}});});
  const url=webvpnWrap('https://info.tsinghua.edu.cn/path');
  await(await f.fetch(url)).text();await(await f.fetch(url)).text();
  assert.equal(seen[1].get('cookie'),'JSESSIONID=valid-app; wengine_vpn_ticket=wrdvpn1-authenticated-fixture; heartbeat=fixture-heartbeat');
  await(await f.fetch('https://webvpn.tsinghua.edu.cn/wengine-vpn/cookie?method=get&host=info.tsinghua.edu.cn')).text();
  assert.equal(seen[2].get('cookie'),'wengine_vpn_ticket=wrdvpn1-authenticated-fixture; heartbeat=fixture-heartbeat');
  await(await f.fetch('https://info.tsinghua.edu.cn/path')).text();
  assert.equal(seen[3].get('cookie'),'JSESSIONID=valid-app');f.close();
});
test('trusted physical ticket wins over a misleading control cookie in an application bucket',async()=>{
  const f=fixture(async()=>new Response('ok'));
  f.jar.setRaw(new URL('https://info.tsinghua.edu.cn/'),'wengine_vpn_ticket=wrong-app-ticket; Path=/');
  f.jar.setRaw(new URL('https://webvpn.tsinghua.edu.cn/'),'wengine_vpn_ticket=wrdvpn1-trusted-fixture; Path=/; Secure');
  assert.equal(f.cookieHeader(new URL(webvpnWrap('https://info.tsinghua.edu.cn/'))),'wengine_vpn_ticket=wrdvpn1-trusted-fixture');
  assert.equal(f.cookieHeader(new URL('https://info.tsinghua.edu.cn/')),'');
  assert.equal(f.cookieHeader(new URL('https://unrelated.test/')),'');f.close();
});
test('HTTP gateway ticket rotation and expiry preserve server semantics',async()=>{
  const tickets=['wengine_vpn_ticket=wrdvpn1-first; Path=/','wengine_vpn_ticket=wrdvpn1-next; Path=/','wengine_vpn_ticket=; Path=/; Max-Age=0'];let n=0;
  const f=fixture(async()=>new Response('ok',{headers:{'set-cookie':tickets[n++]!}}));
  const url=new URL('https://webvpn.tsinghua.edu.cn/login');
  await(await f.fetch(url.href)).text();assert.equal(f.cookieHeader(url),'wengine_vpn_ticket=wrdvpn1-first');
  await(await f.fetch(url.href)).text();assert.equal(f.cookieHeader(url),'wengine_vpn_ticket=wrdvpn1-next');
  await(await f.fetch(url.href)).text();assert.equal(f.cookieHeader(url),'');f.close();
});
test('wrapped application cookies retain native-compatible physical copies without crossing app paths',async()=>{
  const learn=new URL(webvpnWrap('https://learn.tsinghua.edu.cn/path'));
  const info=new URL(webvpnWrap('https://info.tsinghua.edu.cn/path'));
  const f=fixture(async(url:string)=>new Response('ok',{headers:{'set-cookie':`JSESSIONID=${url===learn.href?'learn-fixture':'info-fixture'}; Domain=webvpn.tsinghua.edu.cn; Path=/; Secure`}}));
  await(await f.fetch(learn.href)).text();await(await f.fetch(info.href)).text();
  const restored=fixture(async()=>new Response('ok'));restored.jar.hydrate(f.jar.serialize());
  assert.deepEqual(restored.jar.getCookies(learn).map(c=>[c.domain,c.path,c.value]),[[learn.hostname,learn.pathname.slice(0,learn.pathname.lastIndexOf('/')+1),'learn-fixture']]);
  assert.deepEqual(restored.jar.getCookies(info).map(c=>[c.domain,c.path,c.value]),[[info.hostname,info.pathname.slice(0,info.pathname.lastIndexOf('/')+1),'info-fixture']]);
  assert.equal(restored.cookieHeader(learn),'JSESSIONID=learn-fixture');assert.equal(restored.cookieHeader(info),'JSESSIONID=info-fixture');
  assert.equal(restored.jar.getCookies(new URL('https://webvpn.tsinghua.edu.cn/wengine-vpn/cookie')).length,0);
  assert.equal(restored.cookieHeader(new URL('https://learn.tsinghua.edu.cn/path')),'JSESSIONID=learn-fixture');
  f.close();restored.close();
});
test('timeout and caller abort are bounded and carry safe codes',async()=>{
  const f=fixture(async(_u:string,init:RequestInit)=>new Promise((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(new Error('https://private.test/token?secret=fixture')))),{timeoutMs:5});await assert.rejects(f.fetch('https://source.test/'),{code:'NETWORK_TIMEOUT'});f.close();
  const aborted=new AbortController();aborted.abort();const a=fixture(async()=>{throw new Error('must not call');});await assert.rejects(a.fetch('https://source.test/',{signal:aborted.signal}),{code:'NETWORK_ABORTED'});a.close();
});
