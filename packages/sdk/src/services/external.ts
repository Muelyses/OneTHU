import { createExternalSources, createYuketangSource, createYuketangQueries, HttpClient, type ExtHwCreds } from '@onethu/core';
import type { NodeSession } from '../node/session.js';
import type { RuntimeStore } from '../store.js';
import { desktopYuketangSyncStatus } from '../yuketangSync.js';
import { accountKey, check, fail, integer, object, operation, requestFetch, save, secret, string, tuple, type ExtendedContext } from './extendedSupport.js';
const sourceHosts={yuketang:'https://pro.yuketang.cn/',tuoj:'https://ai.tuoj.thusaac.com/',tuojClassic:'https://oj.cs.tsinghua.edu.cn/',dsa:'https://dsa.cs.tsinghua.edu.cn/',tyche:'http://166.111.236.164:6080/'} as const;
type SourceId=keyof typeof sourceHosts;
type Snapshot={items:any[];errors:Record<string,string>;lastAt:number;configured:boolean;complete:boolean;staleSourceIds:string[]};
const empty:Snapshot={items:[],errors:{},lastAt:0,configured:false,complete:false,staleSourceIds:[]};
export function createExternalServices(runtime:NodeSession,store:RuntimeStore){
  const config=()=>store.read<ExtHwCreds>(accountKey(runtime,'exthw'),{});
  const snapshot=()=>store.read<Snapshot>(accountKey(runtime,'exthw-cache'),empty);
  async function prepare(ctx:ExtendedContext){const creds=await config();check(runtime,ctx,ctx.accountEpoch??runtime.epoch());for(const[id,base]of Object.entries(sourceHosts)){const cookie=creds[id as SourceId]?.cookie;if(!cookie)continue;for(const part of cookie.split(';')){const pair=part.trim();if(/^[!#$%&'*+.^_`|~\w-]+=[^\r\n;]*$/.test(pair))runtime.http.jar.setRaw(new URL(base),`${pair}; Path=/${base.startsWith('https:')?'; Secure':''}`);}}const fetch=requestFetch(runtime,ctx);const http=new HttpClient({fetch,jar:runtime.http.jar}).withWebVPN(false);http.webVPNEncoder=runtime.http.webVPNEncoder;return{creds,fetch,http};}
  const sourceSchema={enum:Object.keys(sourceHosts)};
  const queries=['status','courses','contents','homework','homeworkDetail','leafDetail','noticeDetail'] as const;
  return[
    ...queries.map(method=>operation(`yuketang.${method}`,'exthw:read',async(args,ctx)=>{
      const epoch=(ctx as ExtendedContext).accountEpoch??runtime.epoch();
      const transport=method==='status'?null:runtime.createServiceTransport();
      const guardedFetch=transport?requestFetch({...runtime,fetch:transport.fetch},ctx,epoch):requestFetch(runtime,ctx,epoch);
      const query=createYuketangQueries({
        credentials:async()=>{const creds=await config();return creds.yuketang?{...creds.yuketang,days:creds.days}:null;},
        fetch:async(url,init={})=>{
          check(runtime,ctx,epoch);
          const origin=new URL(String(url));
          if(origin.origin!==sourceHosts.yuketang.slice(0,-1)||origin.username||origin.password)fail('YUKETANG_URL_REJECTED');
          // Node's transport deliberately rebuilds Cookie from its jar. Seed
          // the platform's explicit headers into this isolated service jar.
          const cookie=new Headers(init.headers).get('cookie');
          for(const part of cookie?.split(';')??[]){const pair=part.trim();if(/^[!#$%&'*+.^_`|~\w-]+=[^\r\n;]*$/.test(pair))transport!.jar.setRaw(origin,`${pair}; Path=/; Secure`);}
          return guardedFetch(url,init);
        },check:async()=>check(runtime,ctx,epoch),
      });
      try{
        const result=await (query[method] as (...values:any[])=>Promise<Record<string,unknown>>)(...args);
        if(method==='status') return {...result,desktopSync:await desktopYuketangSyncStatus(store,runtime.session.username)};
        return result;
      }finally{transport?.close();}
    })),
    operation('exthw.configure','exthw:refresh',async([id,cfg],ctx)=>{if(!Object.hasOwn(sourceHosts,id))fail('EXTHW_SOURCE_INVALID');secret(cfg.cookie);const creds=await config();const next={cookie:cfg.cookie,...(cfg.username?{username:String(cfg.username)}:{}),...(cfg.uvId?{uvId:String(cfg.uvId)}:{})};await save(runtime,store,'exthw',{...creds,[id]:next,days:cfg.days??creds.days??30},ctx);return{configured:true,source:id};},{mutation:true,localOnly:true,parameters:tuple([sourceSchema,object({cookie:{...string(16384),writeOnly:true},username:string(254),uvId:string(100),days:integer(1,365)},['cookie'])]),description:'Import a platform session cookie into this private account profile. Passwords are not stored.'}),
    operation('exthw.disconnect','exthw:refresh',async([id],ctx)=>{const creds=await config();delete creds[id as SourceId];await save(runtime,store,'exthw',creds,ctx);const old=await snapshot();await save(runtime,store,'exthw-cache',{...old,items:old.items.filter(item=>item.source!==id),complete:false},ctx);return{source:id,configured:false};},{mutation:true,localOnly:true,parameters:tuple([sourceSchema])}),
    operation('exthw.snapshot','exthw:read',async()=>snapshot()),
    operation('exthw.refresh','exthw:refresh',async(_args,ctx)=>{await ctx.beforeWrite();const{creds,fetch,http}=await prepare(ctx);const sources=createExternalSources({creds,fetchLike:fetch,http});const old=await snapshot();const items:any[]=[],errors:Record<string,string>={},staleSourceIds:string[]=[];for(const source of sources){try{items.push(...await source.fetch());}catch{errors[source.id]='EXTHW_SOURCE_UNAVAILABLE';staleSourceIds.push(source.id);items.push(...old.items.filter(item=>item.source===source.id));}}const next={items,errors,lastAt:Date.now(),configured:sources.length>0,complete:sources.length>0&&!staleSourceIds.length,staleSourceIds};await save(runtime,store,'exthw-cache',next,ctx);return next;}),
    operation('exthw.courses','exthw:read',async([id],ctx)=>{const{creds,fetch,http}=await prepare(ctx);const source=createExternalSources({creds,fetchLike:fetch,http}).find(s=>s.id===id);if(!source)fail('EXTHW_NOT_CONFIGURED');if(!source.fetchCourses)fail('EXTHW_COURSES_UNAVAILABLE');return source.fetchCourses();},{parameters:tuple([sourceSchema])}),
    operation('exthw.contents','exthw:read',async([id],ctx)=>{const{creds,fetch,http}=await prepare(ctx);const source=createExternalSources({creds,fetchLike:fetch,http}).find(s=>s.id===id);if(!source)fail('EXTHW_NOT_CONFIGURED');if(!source.fetchContents)fail('EXTHW_CONTENTS_UNAVAILABLE');return source.fetchContents();},{parameters:tuple([sourceSchema])}),
    operation('exthw.homeworkDetail','exthw:read',async([leaf,classroom],ctx)=>{const{creds,fetch}=await prepare(ctx);if(!creds.yuketang)fail('EXTHW_NOT_CONFIGURED');return createYuketangSource(creds.yuketang,fetch,creds.days??30).getExerciseDetail(leaf,classroom);},{parameters:tuple([string(),string()]),description:'Read a Yuketang assignment using its leafTypeId and classroomId.'}),
  ];
}
