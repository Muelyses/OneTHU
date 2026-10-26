import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthFlow } from '../src/auth/flow.js';

function fixture(options:{twoFactor?:boolean;gate?:Promise<void>}={}){
  let sends=0,ready=0,failed=0,cancelled=0,logins=0,trust:boolean|undefined;
  const helper:any={async login(){logins++;if(options.twoFactor){const type=await helper.twoFactorMethodHook(true,'12340001',true);if(type!=='totp')sends++;const code=await helper.twoFactorAuthHook();assert.equal(code,'123456');trust=await helper.trustFingerprintHook();}}};
  const flow=createAuthFlow({helper,async prepare(){await options.gate;},async ready(){ready++;},failed(){failed++;},cancel(){cancelled++;},async resend(){sends++;}});
  return{flow,stats:()=>({sends,ready,failed,cancelled,logins,trust})};
}
const credentials={username:'12345678',password:'fixture-password'};
test('successful login does not invent a 2FA or trust operation',async()=>{const f=fixture();assert.deepEqual(await f.flow.login(credentials),{state:'ready'});assert.equal(f.stats().ready,1);assert.equal(f.stats().trust,undefined);assert.equal(f.flow.status().pending,false);});
test('2FA runs in one process, sends only after choice and trusts only on explicit request',async()=>{
  const f=fixture({twoFactor:true});const challenge=await f.flow.login(credentials);assert.equal(challenge.state,'need-2fa');assert.equal(f.stats().sends,0);
  assert.equal(f.flow.status().methods.find(m=>m.type==='mobile')?.detail,'***0001');
  await f.flow.chooseMethod('mobile');assert.equal(f.stats().sends,1);
  await assert.rejects(f.flow.sendCode('mobile'),{code:'AUTH_2FA_SEND_COOLDOWN'});assert.equal(f.stats().sends,1);
  await assert.rejects(f.flow.chooseMethod('wechat'),{code:'AUTH_2FA_METHOD'});
  await assert.rejects(f.flow.verify('mobile','letters'),{code:'AUTH_2FA_CODE_INVALID'});
  assert.deepEqual(await f.flow.verify('mobile','123456',true),{state:'ready'});assert.equal(f.stats().trust,true);
});
test('TOTP avoids send and defaults to no trusted browser',async()=>{const f=fixture({twoFactor:true});await f.flow.login(credentials);await f.flow.verify('totp','123456');assert.equal(f.stats().sends,0);assert.equal(f.stats().trust,false);});
test('concurrent login is rejected and cancellation fences delayed preparation',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const f=fixture({gate});const pending=f.flow.login(credentials);
  await assert.rejects(f.flow.login(credentials),{code:'AUTH_IN_PROGRESS'});f.flow.cancel();release();await assert.rejects(pending,{code:'AUTH_SESSION_CHANGED'});assert.equal(f.stats().logins,0);
});
test('cancelled challenge cannot be resumed or leak into the next login',async()=>{const f=fixture({twoFactor:true});await f.flow.login(credentials);await f.flow.chooseMethod('totp');f.flow.cancel();await assert.rejects(f.flow.verify('totp','123456'),{code:'AUTH_2FA_RESTART'});assert.equal(f.flow.status().pending,false);});
