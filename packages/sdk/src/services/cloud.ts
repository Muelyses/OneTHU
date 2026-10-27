import type { NodeSession } from '../node/session.js';
import type { RuntimeStore } from '../store.js';
import { accountKey, check, checkedJson, fail, operation, requestFetch, save, secret, string, tuple, type ExtendedContext } from './extendedSupport.js';
const BASE='https://cloud.tsinghua.edu.cn';
type CloudConfig={token:string;email:string};
export function createCloudServices(runtime:NodeSession,store:RuntimeStore){
  const config=()=>store.read<CloudConfig|null>(accountKey(runtime,'cloud'),null);
  async function request(path:string,ctx:ExtendedContext,init:RequestInit={},override?:string){
    const cfg=override?{token:override}:await config();if(!cfg?.token)fail('CLOUD_NOT_CONFIGURED');
    const epoch=runtime.epoch();const data=await checkedJson(await requestFetch(runtime,ctx,epoch)(BASE+path,{...init,redirect:'error',headers:{...Object.fromEntries(new Headers(init.headers)),Authorization:`Bearer ${cfg.token}`}}));check(runtime,ctx,epoch);return data;
  }
  const repo=(id:string)=>{if(!/^[a-zA-Z0-9-]{1,100}$/.test(id))fail('CLOUD_REPO_INVALID');return encodeURIComponent(id);};
  const cloudPath=(p:string)=>{if(/[\x00-\x1f]/.test(p)||p.split('/').includes('..'))fail('CLOUD_PATH_INVALID');return p.startsWith('/')?p:'/'+p;};
  const entries=(rows:any)=>{if(!Array.isArray(rows))fail('CLOUD_RESPONSE_UNEXPECTED');return rows.map((r:any)=>({name:String(r.name??String(r.path??'').split('/').pop()??''),path:r.path,kind:r.type==='dir'||r.type==='folder'||r.is_dir?'dir':'file',size:Number(r.size??0),mtime:typeof r.mtime==='string'?Date.parse(r.mtime)/1000:Number(r.mtime??0)}));};
  return [
    operation('cloud.configure','cloud:write',async([token],ctx)=>{secret(token);await ctx.beforeWrite();const epoch=runtime.epoch();const account=await request('/api2/account/info/',ctx,{},token);check(runtime,ctx,epoch);if(typeof account.email!=='string'||!account.email.includes('@'))fail('CLOUD_ACCOUNT_UNKNOWN');await save(runtime,store,'cloud',{token,email:account.email},ctx,epoch);return{configured:true,account:account.email};},{mutation:true,localOnly:true,parameters:tuple([{...string(16384),writeOnly:true}]),description:'Configure the cloud token in this private CLI profile; token is never returned.'}),
    operation('cloud.status','cloud:read',async()=>{const cfg=await config();return{configured:!!cfg,account:cfg?.email??null};}),
    operation('cloud.disconnect','cloud:write',async(_args,ctx)=>{await save(runtime,store,'cloud',null,ctx);return{configured:false};},{mutation:true,localOnly:true}),
    operation('cloud.repos','cloud:read',async(_args,ctx)=>{const cfg=await config();const rows=await request('/api2/repos/',ctx);if(!Array.isArray(rows))fail('CLOUD_RESPONSE_UNEXPECTED');const seen=new Set<string>();return rows.filter((r:any)=>r.id&&!seen.has(r.id)&&!!seen.add(r.id)).map((r:any)=>({id:r.id,name:r.name,mtime:r.mtime,size:r.size,owner:r.owner,ownerName:r.owner_name,permission:r.permission,repoType:r.owner&&cfg?.email&&r.owner.toLowerCase()===cfg.email.toLowerCase()?'mine':r.type==='grepo'?'group':'shared',isVirtual:!!r.is_virtual}));}),
    operation('cloud.list','cloud:read',async([id,p],ctx)=>entries(await request(`/api2/repos/${repo(id)}/dir/?p=${encodeURIComponent(cloudPath(p))}`,ctx))),
    operation('cloud.search','cloud:read',async([id,q],ctx)=>{const data=await request(`/api2/search/?repo_id=${repo(id)}&q=${encodeURIComponent(q)}`,ctx);return entries(Array.isArray(data)?data:data.data??data.results);}),
    operation('cloud.share','cloud:write',async([id,p,days],ctx)=>{if(!Number.isSafeInteger(days)||days<0||days>3650)fail('CLOUD_EXPIRY_INVALID');repo(id);const value={repo_id:id,path:cloudPath(p),...(days>0?{expire_days:days}:{})};await ctx.beforeWrite();const result=await request('/api/v2.1/share-links/',ctx,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});if(typeof result.link!=='string'||new URL(result.link).origin!==BASE)fail('CLOUD_RESPONSE_UNEXPECTED');return{link:result.link};}),
  ];
}
