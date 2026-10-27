import test from 'node:test';
import assert from 'node:assert/strict';
import {sdkError} from '../src/standalone.mjs';
test('Rain Classroom sign-in errors retain actionable hints while dropping external response bodies',()=>{
  for(const code of ['YUKETANG_NOT_CONFIGURED','YUKETANG_SESSION_EXPIRED']){
    const error=sdkError(new Error(`${code}: sessionid=PRIVATE school response`));
    assert.equal(error.code,code);assert.match(error.message,/QR code/);assert.ok(!error.message.includes('PRIVATE'));
  }
});
test('other unknown responses still use the safe generic error adapter',()=>{
  const error=sdkError(new Error('<html>sessionid=PRIVATE</html>'));
  assert.equal(error.code,'CLI_OPERATION_FAILED');assert.ok(!error.message.includes('PRIVATE'));
});
