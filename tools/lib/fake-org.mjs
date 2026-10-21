/** Isolated simulated GitLab service with real ACL/CAS semantics for browser regressions. No network writes. */
export function createFakeOrganizationServer() {
 const users=[{id:1,username:'owner',name:'测试用户',email:'tester@mails.tsinghua.edu.cn'}, {id:2,username:'lisi',name:'李四',email:'lisi@mails.tsinghua.edu.cn'}, {id:3,username:'visitor',name:'访客',email:'visitor@mails.tsinghua.edu.cn'}];
 const server={users,groups:new Map(),projects:new Map(),files:new Map(),protections:new Map(),cloud:new Map(),seq:10,revision:0,calls:[],conflictOnce:false,loseCreateResponse:false};
 const deny=()=>{throw Error('403 Forbidden');};
 const member=(g,u)=>g?.members.find(m=>m.id===u);
 const effective=(p)=>[...(server.groups.get(p.namespace.id)?.members??[]),...(p.members??[])].reduce((list,m)=>{const old=list.find(n=>n.id===m.id);if(!old)list.push({...m});else old.access_level=Math.max(old.access_level,m.access_level);return list;},[]);
 const key=(id,branch,path)=>`${id}/${branch}/${path}`;
 const fileResult=(f)=>({content:Buffer.from(f.text).toString('base64'),encoding:'base64',last_commit_id:f.revision,size:Buffer.byteLength(f.text)});
 server.call=async(actor,name,args=[])=>{
  server.calls.push({actor,name,args});
  const [a,b,c,d,e]=args;
  const user=users.find(u=>u.id===actor);if(!user)deny();
  if(name==='me')return {...user,access_level:0};
  if(name==='searchUsers')return users.filter(u=>u.username===a);
  if(name==='createGroup') {const id=++server.seq,g={id,name:a.name,path:a.path,full_path:a.path,web_url:`https://git.tsinghua.edu.cn/${a.path}`,visibility:'private',parent_id:null,members:[{...user,access_level:50}]};server.groups.set(id,g);if(server.loseCreateResponse){server.loseCreateResponse=false;throw Error('network response lost');}return {id,name:g.name,path:g.path,webUrl:g.web_url};}
  if(name==='group'){const g=server.groups.get(a)??[...server.groups.values()].find(g=>g.full_path===a);if(!g)throw Error('404 Not Found');if(!member(g,actor))deny();return structuredClone(g);}
  if(name==='createMetadataProject'||name==='createProject') {const groupId=name==='createProject'?a.namespaceId:a;const g=server.groups.get(groupId);if((member(g,actor)?.access_level??0)<40)deny();const id=++server.seq,p={id,name:'OneTHU 协作',path_with_namespace:`${g.path}/${name==='createProject'?a.name:b}`,web_url:`https://git.tsinghua.edu.cn/${g.path}/meta`,visibility:'private',default_branch:'main',namespace:{id:groupId},members:[],branches:['main']};server.projects.set(id,p);server.protections.set(id,[]);if(server.loseCreateResponse){server.loseCreateResponse=false;throw Error('network response lost');}return name==='createProject'?{id,name:p.name,path:p.path_with_namespace,webUrl:p.web_url}:structuredClone(p);}
  if(name==='members') {const collection=a==='groups'?server.groups:server.projects,obj=collection.get(b);if(!obj)throw Error('404 Not Found');const list=a==='groups'?obj.members:(c===false?obj.members:effective(obj));if(a==='groups'?!member(obj,actor):!effective(obj).some(m=>m.id===actor))deny();return structuredClone(list);}
  if(name==='setMember'||name==='removeMember') {const collection=a==='groups'?server.groups:server.projects,obj=collection.get(b);if(!obj)throw Error('404 Not Found');const own=a==='groups'?member(obj,actor):effective(obj).find(m=>m.id===actor);if((own?.access_level??0)<(a==='groups'?50:40))deny();obj.members=obj.members.filter(m=>m.id!==c);if(name==='setMember'){const u=users.find(u=>u.id===c);if(!u)throw Error('404 user');obj.members.push({...u,access_level:d});}return null;}
  if(name==='auditCloud')return null;
  if(name==='cloudOwner')return users[0].email;
  if(name==='listCloud')return structuredClone(server.cloud.get(a)??[]);
  if(name==='setCloud'){if(actor!==1)deny();server.cloud.set(a,[...(server.cloud.get(a)??[]).filter(s=>s.email!==b),{email:b,permission:c}]);return;}
  if(name==='removeCloud'){if(actor!==1)deny();server.cloud.set(a,(server.cloud.get(a)??[]).filter(s=>s.email!==b));return;}
  const p=server.projects.get(a)??[...server.projects.values()].find(p=>p.path_with_namespace===a);if(!p)throw Error('404 Not Found');const role=effective(p).find(m=>m.id===actor)?.access_level??0;if(role<20)deny();
  if(name==='project')return structuredClone(p);
  if(name==='protections')return structuredClone(server.protections.get(a));
  if(name==='createBranch'){if(role<40)deny();if(p.branches.includes(b))throw Error('Branch already exists');p.branches.push(b);return;}
  if(name==='protect'){if(role<40)deny();server.protections.get(a).push({name:b,allow_force_push:false,push_access_levels:[{access_level:c}],merge_access_levels:[{access_level:c}]});return;}
  if(name==='file'){const f=server.files.get(key(a,b,c));if(!f)throw Error('404 Not Found');return fileResult(f);}
  if(name==='createFile'||name==='updateFile'){
   const protection=server.protections.get(a).find(x=>x.name===b);if(role<(protection?.push_access_levels[0].access_level??30))deny();
   const k=key(a,b,c),old=server.files.get(k);
   if(name==='createFile'&&old)throw Error('400 file already exists');
   if(name==='updateFile'&&(!old||old.revision!==e))throw Error('400 last_commit_id does not match');
   if(server.conflictOnce){server.conflictOnce=false;server.files.set(k,{...old,revision:`rev${++server.revision}`});throw Error('400 concurrent commit');}
   server.files.set(k,{text:d,revision:`rev${++server.revision}`});return;
  }
  throw Error(`Fake GitLab method unsupported: ${name}`);
 };
 return server;
}
export async function installFakeOrganization(page,{server=createFakeOrganizationServer(),actor=1}={}) {
 await page.exposeFunction('__orgTestCall',(name,args)=>server.call(actor,name,args));
 await page.addInitScript(()=>{
  window.__orgPermissionCall=async(name,args)=>{
    const result=await window.__orgTestCall(name,args);
    if(window.__cloud && (name==='setCloud'||name==='removeCloud')){
      window.__cloud.sharedTo=window.__cloud.sharedTo.filter(s=>!(s.repoId===args[0]&&s.email===args[1]));
      if(name==='setCloud')window.__cloud.sharedTo.push({repoId:args[0],path:'/',email:args[1],permission:args[2]});
    }
    return result;
  };
  window.__orgApi=Object.fromEntries(["me","group","project","members","searchUsers","setMember","removeMember","createMetadataProject","file","createFile","updateFile","createBranch","protections","protect"].map(name=>[name,(...args)=>window.__orgTestCall(name,args)]));
 });
 await page.route('**/src/state/gitlab.ts*',async route=>{
  const response=await route.fetch();let body=await response.text();
  body=body.replace('export async function gitlabOrganizationApi() {','export async function gitlabOrganizationApi() { return window.__orgApi;');
  body=body.replace('export async function gitlabCreateGroup(input) {','export async function gitlabCreateGroup(input) { return window.__orgTestCall("createGroup",[input]);');
  body=body.replace('export async function gitlabCreateProject(input) {','export async function gitlabCreateProject(input) { return window.__orgTestCall("createProject",[input]);');
  await route.fulfill({response,body});
 });
 await page.route('**/src/state/orgSync.ts*',async route=>{
  const response=await route.fetch();let body=await response.text();
  for(const [key,value] of Object.entries({listCloud:'listRepoUserShares',cloudOwner:'repoOwnerEmail',auditCloud:'assertRepoAccountAcl',setCloud:'setRepoUserPermission',removeCloud:'removeRepoUserShare'}))body=body.replace(new RegExp(`${key}:\\s*${value}`),`${key}:(...args)=>window.__orgPermissionCall("${key}",args)`);
  await route.fulfill({response,body});
 });
 return server;
}
