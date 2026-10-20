import assert from 'node:assert/strict';
import fs from 'node:fs';
import {networkLogUrl,networkLogCookieNames,redactNetworkLog} from '../apps/desktop/src/lib/networkLog.ts';
let passed=0;const check=(v,name)=>{assert.ok(v,name);passed++;console.log('✓ '+name)};
check(networkLogUrl('https://name:fake-password@example.invalid/callback?code=fake-code&ticket=fake-ticket#fake-fragment')==='https://example.invalid/callback','Redirect logs retain route but omit URL credentials, query and fragment');
check(networkLogUrl('not a URL fake-secret')==='[invalid URL]'&&networkLogUrl('file:///private/demo')==='[non-http URL]','Invalid and local URLs never echo raw input');
check(networkLogCookieNames(['session=fake-session-value; Path=/; Secure','csrftoken=fake-csrf; SameSite=Lax'])==='session,csrftoken','Only new cookie names are retained');
check(!networkLogCookieNames(['fake-secret-without-delimiter']).includes('fake-secret'),'Malformed cookie input is not logged');
for(const example of [
 'Authorization: Bearer fake-secret\nstatus=200',
 'Cookie: session=fake-secret; csrf=fake-secret',
 'Set-Cookie=session=fake-secret;Path=/',
 '{"apiKey":"fake-secret","password":"fake-secret","access_token":"fake-secret"}',
 "token='fake-secret' status=ok",
 'failure https://example.invalid/oauth?ticket=fake-secret',
 'debug Bearer fake-secret',
 '<html><input type="hidden" value="fake-secret"></html>',
 'status=200 body={"schooldata":"fake-secret"}',
 '[HTTP-WENGINE] body(500)=fake-secret ...TAIL... fake-secret',
 'submittedContent=fake-secret',
])check(!redactNetworkLog(example).includes('fake-secret'),'Credential or page markup is omitted: '+example.split(/[ :]/)[0]);
const transport=fs.readFileSync('apps/desktop/src/lib/transport.ts','utf8');
check(transport.includes('networkLogUrl(currentUrl)')&&transport.includes('networkLogCookieNames(res.set_cookies ?? [])'),'Actual redirect logger uses safe URL and cookie metadata helpers');
const clients=fs.readFileSync('apps/desktop/src/lib/clients.ts','utf8');
check(clients.includes('redactNetworkLog(text)')&&!clients.includes('content.slice(i * CHUNK'),'Persistent JS log sink redacts credentials and does not dump full school pages');
const diagnostics=fs.readFileSync('apps/desktop/src/lib/diagnostics.ts','utf8');
check(diagnostics.includes('redactNetworkLog(String(text ?? ""))'),'Copyable diagnostics share the credential and page-body guard');
check(transport.includes('redactNetworkLog(rawErrorText(err).trim())')&&!transport.includes('String(url.slice(0, 120))'),'Visible network errors and timeouts omit authentication URL parameters');
const auto=fs.readFileSync('apps/desktop/src/state/seafileAuto.ts','utf8');
check(!auto.includes('token 区域片段')&&!auto.includes('脚本片段')&&!auto.includes('页面接口候选'),'Unknown cloud profile pages never dump token regions or inline scripts');
console.log(`Network log privacy: ${passed} checks passed`);
