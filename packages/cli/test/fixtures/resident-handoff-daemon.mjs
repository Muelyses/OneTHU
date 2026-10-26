/** Test-only process: real CLI daemon + bundled SDK; all school fetches are
 * synthetic and unknown requests fail before any network implementation runs. */
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
const profile=process.argv[2];
if(!profile||!path.isAbsolute(profile))throw Error('FIXTURE_PROFILE_REQUIRED');
globalThis.fetch=async(raw,init={})=>{
  const url=new URL(typeof raw==='string'?raw:raw.url??String(raw));
  const method=(init.method??'GET').toUpperCase();
  if(method!=='GET'||url.hostname!=='webvpn.tsinghua.edu.cn')throw Error('FIXTURE_EXTERNAL_NETWORK_FORBIDDEN');
  const kind=url.pathname==='/wengine-vpn/cookie'?'cookie':url.pathname.endsWith('/grjbxx')?'identity':url.pathname.includes('/f/wlxt/index/course/student')?'learn':null;
  if(!kind)throw Error('FIXTURE_EXTERNAL_NETWORK_FORBIDDEN');
  await appendFile(path.join(profile,'synthetic-school.jsonl'),JSON.stringify({at:Date.now(),pid:process.pid,method,kind})+'\n',{mode:0o600});
  if(kind==='cookie')return new Response('XSRF-TOKEN=synthetic-csrf;');
  if(kind==='identity')return Response.json({result:'success',object:{ryh:'90000001',xm:'Synthetic Fixture'}});
  return new Response('<input name="_csrf" value="synthetic-learn">');
};
const {serve}=await import('../../src/daemon.mjs');
await serve({dataDir:profile});
