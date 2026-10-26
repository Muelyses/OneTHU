/** Execute the real bounded recovery client; all responses are synthetic. */
import assert from 'node:assert/strict';
import {probeLearnSession} from '../apps/desktop/src/lib/learnRecovery.ts';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
const page=csrf=>new Response(`<input name="_csrf" value="${csrf}">`);
await test('the isolated candidate reads CSRF with GET only and forwards its deadline and signal',async()=>{
  const calls=[];
  const result=await probeLearnSession({timeoutMs:250,fetch:async(url,init)=>{calls.push({url,init});return page('candidate-B');}});
  assert.equal(result.ready,true);assert.equal(result.csrf,'candidate-B');assert.equal(calls.length,1);
  assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.timeoutMs,250);assert.equal(calls[0].init.signal.aborted,true);
});
await test('an ignored abort cannot continue a late WebVPN bootstrap or seed cookies after the deadline',async()=>{
  let release,requests=0,seeds=0,signal;
  const late=new Promise(resolve=>{release=resolve;});
  await assert.rejects(probeLearnSession({timeoutMs:15,seed:async()=>{seeds++;},fetch:async(_url,init)=>{requests++;signal=init.signal;return late;}}),{code:'LEARN_PROBE_TIMEOUT'});
  assert.equal(signal.aborted,true);
  const current=await probeLearnSession({fetch:async()=>page('current-B')});assert.equal(current.csrf,'current-B');
  release(new Response('<script>var __vpn_hostname_data="webvpn.tsinghua.edu.cn";var __vpn_app_hostname_data="fixture-app";</script>'));
  await sleep(20);assert.equal(requests,1);assert.equal(seeds,0);assert.equal(current.csrf,'current-B');
});
await test('authentication pages can use the GET-only SSO entry without a password or host login hook',async()=>{
  const calls=[];let pages=0;
  const result=await probeLearnSession({fetch:async(url,init)=>{
    calls.push({url,method:init.method});
    if(url.includes('/f/login'))return new Response('SSO redirected');
    return ++pages===1?new Response('<form><input name="i_pass"></form>'):page('SSO-csrf');
  }});
  assert.equal(result.csrf,'SSO-csrf');assert.equal(calls.length,3);assert(calls.every(c=>c.method==='GET'));
});
await test('a rejected service response remains a service failure and cannot submit credentials',async()=>{
  let calls=0;
  await assert.rejects(probeLearnSession({fetch:async(_url,init)=>{calls++;assert.equal(init.method,'GET');return new Response('Forbidden',{status:403});}}),/HTTP 403/);
  assert.equal(calls,1);
});
await test('account change during the response prevents publishing a candidate CSRF',async()=>{
  let current=true;
  await assert.rejects(probeLearnSession({check:()=>{if(!current)throw Object.assign(Error('changed'),{code:'AUTH_SESSION_CHANGED'});},fetch:async()=>{current=false;return page('old-A');}}),{code:'AUTH_SESSION_CHANGED'});
});
console.log(`${passed} bounded read-only Learn recovery scenarios passed`);
