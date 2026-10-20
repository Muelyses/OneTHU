/** Deterministic server boundary: identities and ACL live in Node, never in the page. */
import { randomUUID, randomBytes } from 'node:crypto';
export function privateCloudServer() {
 const emails={owner:'owner@example.test',reader:'reader@example.test',other:'other@example.test'};
 const repos=new Map(),shares=new Map(),temps=new Map();let fail='';
 const actor=t=>{if(!emails[t])throw Error('401 unauthorized');return emails[t];};
 const repo=(a,write=false)=>{const r=repos.get(a.repoId);if(!r)throw Error('404 absent');const e=actor(a.token);if(e!==r.owner && (!r.grants.has(e)||write&&r.grants.get(e)!=='rw'))throw Error('403 forbidden');return r;};
 const own=a=>{const r=repo(a);if(r.owner!==actor(a.token))throw Error('403 owner only');return r;};
 const getShare=link=>{const id=/\/(?:d|f)\/([^/]+)/.exec(link)?.[1];const s=shares.get(id);if(!s||s.expiresAt&&s.expiresAt<Date.now())throw Error('404 revoked or expired');return s;};
 async function invoke(cmd,a={}) {
  if(fail===cmd){fail='';throw Error('injected transient network failure');}
  switch(cmd){
   case 'seafile_account':return {email:actor(a.token),name:'Test account',usage:0,total:100000};
   case 'seafile_repos':return [...repos].filter(([,r])=>r.owner===actor(a.token)||r.grants.has(actor(a.token))).map(([id,r])=>({id,name:r.name}));
   case 'seafile_create_repo':{const id=randomUUID();repos.set(id,{name:a.name,owner:actor(a.token),grants:new Map(),files:new Map()});return {id};}
   case 'seafile_repo_owner':return repo(a).owner;
   case 'seafile_repo_user_shares':return [...own(a).grants].map(([email,permission])=>({email,permission}));
   case 'seafile_set_repo_user_permission':own(a).grants.set(a.email,a.permission);return null;
   case 'seafile_remove_repo_user_share':own(a).grants.delete(a.email);return null;
   case 'seafile_delete_repo':{actor(a.token);if(!repos.has(a.repoId))return null;const r=own(a);if(!r.name.startsWith('OneTHU 私密分享 '))throw Error('not a private key library');repos.delete(a.repoId);return null;}
   case 'seafile_mkdir':repo(a,true);return null;
   case 'write_temp_file':{const path='/tmp/'+randomUUID()+'/'+a.name;temps.set(path,Buffer.from(a.dataBase64,'base64'));return path;}
   case 'save_local_download':return '/Downloads/'+a.name;
   case 'read_file_base64':{const b=temps.get(a.path);if(!b)throw Error('file missing');return b.toString('base64');}
   case 'seafile_upload':{const b=temps.get(a.localPath);if(!b)throw Error('file missing');repo(a,true).files.set(a.parentDir.replace(/\/$/,'')+'/'+a.localPath.split('/').at(-1),b);return b.length;}
   case 'seafile_upload_text':repo(a,true).files.set(a.parentDir.replace(/\/$/,'')+'/'+a.name,Buffer.from(a.content));return a.content.length;
   case 'seafile_read_bytes':{const b=repo(a).files.get(a.path);if(!b)throw Error('file missing');return b.toString('base64');}
   case 'seafile_share':{own(a);const token=randomBytes(10).toString('hex');shares.set(token,{repoId:a.repoId,path:a.path,expiresAt:a.expireDays?Date.now()+a.expireDays*86400000:0});return {token,link:'https://cloud.tsinghua.edu.cn/d/'+token+'/'};}
   case 'seafile_share_read':{const s=getShare(a.link);const b=repos.get(s.repoId)?.files.get(s.path+'/manifest.json');if(!b)throw Error('file missing');return b.toString();}
   case 'seafile_share_read_bytes':{const s=getShare(a.link);const b=repos.get(s.repoId)?.files.get(s.path+'/'+a.path);if(!b)throw Error('file missing');return b.toString('base64');}
   case 'seafile_share_delete':{const s=shares.get(a.shareToken);if(s)own({...a,repoId:s.repoId});shares.delete(a.shareToken);return null;}
   case 'seafile_delete':{const r=repo(a,true);for(const p of r.files.keys())if(p===a.path||p.startsWith(a.path+'/'))r.files.delete(p);return null;}
   default:throw Error('fixture missing '+cmd);
  }
 }
 return {invoke,repos,shares,temps,emails,failOnce:cmd=>{fail=cmd;}};
}
export async function installPrivateCloud(page,server,token){
 await page.exposeFunction('__privateCloudInvoke',server.invoke);
 await page.addInitScript(token=>{window.__cloudToken=token;performance.setResourceTimingBufferSize(10000);localStorage.setItem('onethu.onboarded.phone','1');},token);
 await page.routeWebSocket(/(?:localhost|127\.0\.0\.1):5180/,()=>{});
 for(const name of ['seafile','vaultCloud','sealedShare','cloudExchange','vaultRegistry'])await page.route(`**/src/state/${name}.ts*`,async route=>{
  const r=await route.fetch();let body=await r.text();
  body=body.replace(/import \{ invoke \} from [^;]+;/,'const invoke = window.__privateCloudInvoke;');
  body=body.replace('return cfg?.token ?? "";','return window.__cloudToken;');
  body=body.replace('loaded = true;','loaded = true; cfg = {token:window.__cloudToken};');
  await route.fulfill({response:r,body});
 });
}
