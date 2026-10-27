import { getXkCatalog, getSelectedCourses, getXkCourseDetail, searchXkCourses, type ZhjwxkSession } from '@onethu/core';
import type { NodeSession } from '../node/session.js';
import { checkedJson, fail, operation, requestFetch, type ExtendedContext } from './extendedSupport.js';
export function createSelectionServices(runtime:NodeSession){
  const session=(ctx:ExtendedContext):ZhjwxkSession=>({http:runtime.http,username:runtime.session.username,password:runtime.session.getIdCredentials()?.password??'',fingerprint:runtime.session.fingerprint,finger3:runtime.session.finger3,isoFetch:requestFetch(runtime,ctx)});
  return[
    operation('xk.search','xk:read',async([options],ctx)=>searchXkCourses(session(ctx),options)),
    operation('xk.catalog','xk:read',async([semester],ctx)=>getXkCatalog(session(ctx),semester?{semester}:{})),
    operation('xk.selected','xk:read',async([semester],ctx)=>getSelectedCourses(session(ctx),semester?{semester}:{})),
    operation('xk.detail','xk:read',async([teacherId,code],ctx)=>getXkCourseDetail(session(ctx),{teacherId,code})),
    operation('xk.reviews','xk:read',async([course,teacher=''],ctx)=>{
      const fetch=requestFetch(runtime,ctx),base='https://thubook.help/data/';const data=await checkedJson(await fetch(base+'with_comment_index.json',{credentials:'omit'}));
      const norm=(v:string)=>v.normalize('NFKC').replace(/\s+/g,'').toLowerCase();const candidates=Object.values(data.courses??{}).filter((row:any)=>norm(String(row.kcm??''))===norm(course)&&(!teacher||String(row.jsm??'').includes(teacher))) as any[];
      if(!candidates.length)return null;if(candidates.length>1)return{ambiguous:true,candidates:candidates.map(r=>({course:r.kcm,teacher:r.jsm,count:r.count}))};
      const row=candidates[0],id=String(row.sqid);if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))fail('REVIEWS_RESPONSE_INVALID');let url:string|null=base+`courses/${id}.json`;const results:any[]=[],seen=new Set<string>();let count=0;
      for(let page=0;url&&page<6;page++){if(seen.has(url))fail('REVIEWS_REPEATED_PAGE');seen.add(url);const u:URL=new URL(url);if(u.origin!=='https://thubook.help'||!u.pathname.startsWith('/data/'))fail('REVIEWS_URL_REJECTED');const doc=await checkedJson(await fetch(u.href,{redirect:'error',credentials:'omit'}));if(!Array.isArray(doc.results))fail('REVIEWS_RESPONSE_INVALID');results.push(...doc.results);count=Math.max(count,Number(doc.count??0));url=doc.next?new URL(doc.next,u).href:null;}
      return{course:row.kcm,teacher:row.jsm,count:count||results.length,avg:row.avg,reviews:results,complete:!url&&results.length>=count};
    },{authenticated:false}),
  ];
}
