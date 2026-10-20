/** Two independent browser clients against a simulated ACL + CAS server. No real accounts. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createFakeOrganizationServer,installFakeOrganization} from './lib/fake-org.mjs';
import {installFakeCloud} from './lib/fake-cloud.mjs';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const server=createFakeOrganizationServer();let checks=0;
const check=(v,m)=>{assert.ok(v,m);console.log('✓ '+m);checks++;};
const invoke=(page,path,fn,args=[])=>page.evaluate(async({path,fn,args})=>{
 const url=performance.getEntriesByType('resource').map(r=>r.name).find(url=>new URL(url).pathname===path)??path;
 return (await import(url))[fn](...args);
},{path,fn,args});
const org=(p,fn,args)=>invoke(p,'/src/state/org.ts',fn,args),sync=(p,fn,args)=>invoke(p,'/src/state/orgSync.ts',fn,args);
async function client(actor){const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();await installFakeCloud(page);await installFakeOrganization(page,{server,actor});await page.addInitScript(()=>{performance.setResourceTimingBufferSize(10000);localStorage.setItem('onethu.onboarded.phone','1');});await page.routeWebSocket('**/*',ws=>ws.close());await page.goto('http://127.0.0.1:5180/?explorer-preview=page&page=contacts',{waitUntil:'domcontentloaded'});await page.waitForSelector('.explorer-shell');return page;}
try{
 const a=await client(1),b=await client(2);
 const local=await org(a,'createOrg',[{name:'云协作验收',ownerEmail:'tester@mails.tsinghua.edu.cn'}]);
 await org(a,'saveOrgProject',[local.id,{name:'迁移前项目',description:'保留',owner:'我',status:'planned'}]);
 await Promise.all([sync(a,'enableOrgCollaboration',[local.id]),sync(a,'enableOrgCollaboration',[local.id])]);
 check(server.groups.size===1&&server.projects.size===1,'concurrent initialization reuses one group and metadata project');
 let current=(await org(a,'orgSnapshot')).orgs[0];
 check(current.collaboration.status==='ready','local organization migrates into private server metadata');
 check(current.projects[0].name==='迁移前项目','migration preserves existing projects');
 check(server.protections.get(current.collaboration.projectId).length===2,'admin and collaborative content have separate protected branches');
 const ref={...current.collaboration};
 const meta=server.projects.get(current.collaboration.projectId), group=server.groups.get(current.collaboration.groupId);
 const protections=server.protections.get(meta.id), adminProtection=protections.find(p=>p.name==='onethu-admin');
 adminProtection.push_access_levels.push({access_level:0,user_id:3});
 await assert.rejects(()=>sync(a,'refreshRemoteOrg',[local.id]),/服务器保护/);
 check(true,'specific-user protected branch exception is rejected');adminProtection.push_access_levels.pop();
 protections.push({name:'onethu-*',allow_force_push:false,push_access_levels:[{access_level:30}],merge_access_levels:[{access_level:30}]});
 await assert.rejects(()=>sync(a,'refreshRemoteOrg',[local.id]),/服务器保护/);
 check(true,'more permissive wildcard protection is rejected');protections.pop();
 group.members.push({...server.users[2],access_level:40});
 await assert.rejects(()=>sync(a,'refreshRemoteOrg',[local.id]),/Maintainer/);
 check(true,'unmodelled Maintainer role cannot write protected admin metadata');group.members.pop();
 meta.members.push({...server.users[2],access_level:30});
 await assert.rejects(()=>sync(a,'refreshRemoteOrg',[local.id]),/额外直接成员/);
 check(true,'metadata project cannot grant independent user access');meta.members=[];
 meta.shared_with_groups=[{group_id:999}];
 await assert.rejects(()=>sync(a,'refreshRemoteOrg',[local.id]),/共享给其他群组/);
 check(true,'metadata project cannot inherit an unapproved shared group');meta.shared_with_groups=[];
 await sync(a,'refreshRemoteOrg',[local.id]);
 const adminKey=`${meta.id}/onethu-admin/organization.json`,adminFile=server.files.get(adminKey),remoteAdmin=JSON.parse(adminFile.text);
 server.files.set(adminKey,{text:JSON.stringify({...remoteAdmin,name:'远端已接受的名称'}),revision:'init-resume-rev'});
 await org(a,'markOrgRemote',[local.id,{...current.collaboration,status:'error',lastReadAt:undefined}]);
 await sync(a,'enableOrgCollaboration',[local.id]);
 check(server.files.get(adminKey).revision==='init-resume-rev'&&(await org(a,'orgSnapshot')).orgs[0].name==='远端已接受的名称','initialization retry preserves previously accepted remote edits');

 await assert.rejects(()=>sync(b,'joinRemoteOrg',[ref]),/403|尚未获得/);
 check(true,'invitation reference cannot grant access to nonmember');
 const binding=await sync(a,'resolveOrgUser',['lisi','lisi@mails.tsinghua.edu.cn']);
 await sync(a,'changeRemoteMember',[local.id,undefined,{...binding,role:'member'}]);
 const bid=await sync(b,'joinRemoteOrg',[ref]);
 check((await org(b,'orgSnapshot')).orgs.find(o=>o.id===bid).collaboration.projectId===ref.projectId,'authorized second account opens same shared organization');
 const project={id:'shared-project',name:'成员发布的项目',description:'B wrote it',owner:'lisi',status:'active',updatedAt:1};
 await sync(b,'saveRemoteContent',[bid,'projects',undefined,project]);
 await sync(a,'refreshRemoteOrg',[local.id]);
 check((await org(a,'orgSnapshot')).orgs[0].projects.some(p=>p.id===project.id),'member changes are read by owner from remote store');
 await assert.rejects(()=>sync(b,'changeRemoteMember',[bid,1,undefined]),/负责人/);
 check(true,'member cannot edit authoritative membership');
 const first={...project,name:'A version',updatedAt:2};
 await sync(a,'saveRemoteContent',[local.id,'projects',project,first]);
 await assert.rejects(()=>sync(b,'saveRemoteContent',[bid,'projects',project,{...project,name:'stale B'}]),/输入已保留/);
 check(true,'stale second client cannot overwrite first client update');
 server.conflictOnce=true;
 await assert.rejects(()=>sync(a,'saveRemoteContent',[local.id,'projects',first,{...first,name:'racing'}]),/输入已保留/);
 check(true,'server CAS race is surfaced as a conflict');
 await sync(a,'changeRemoteMember',[local.id,2,{...binding,role:'guest'}]);
 await assert.rejects(()=>sync(b,'saveRemoteContent',[bid,'projects',first,{...first,name:'forbidden'}]),/没有编辑/);
 check(true,'server-side downgrade makes second client read-only');
 await sync(a,'changeRemoteMember',[local.id,2,undefined]);
 await assert.rejects(()=>sync(b,'refreshRemoteOrg',[bid]),/403|尚未获得/);
 check(true,'removed client loses access even with old local cache');
 await a.reload();await a.waitForSelector('.explorer-shell');await sync(a,'refreshRemoteOrg',[local.id]);
 check((await org(a,'orgSnapshot')).orgs[0].projects.find(p=>p.id===project.id).name==='A version','remote content survives reload without losing accepted concurrent version');

 // A migrated group can already have members whose cloud email is unknown.
 const migrated=await org(a,'createOrg',[{name:'旧资料库迁移恢复',ownerEmail:'tester@mails.tsinghua.edu.cn'}]);
 const oldGroup=await server.call(1,'createGroup',[{name:'旧群组',path:'migration-repair'}]);
 server.groups.get(oldGroup.id).members.push({...server.users[1],access_level:30});
 await org(a,'setOrgGitlabGroup',[migrated.id,oldGroup]);
 await org(a,'addOrgLibrary',[migrated.id,{repoId:'legacy-cloud',name:'旧资料库'}]);
 await assert.rejects(()=>sync(a,'enableOrgCollaboration',[migrated.id]),/尚未绑定云盘邮箱/);
 let migratedCurrent=(await org(a,'orgSnapshot')).orgs.find(o=>o.id===migrated.id);
 check(migratedCurrent.collaboration.pending===true,'migration with old libraries never claims permission completion without email bindings');
 await sync(a,'changeRemoteMember',[migrated.id,2,{...binding,role:'member'},{email:'',role:'member'}]);
 migratedCurrent=(await org(a,'orgSnapshot')).orgs.find(o=>o.id===migrated.id);
 check(!migratedCurrent.collaboration.pending&&server.cloud.get('legacy-cloud').some(s=>s.email===binding.email),'pending migration can repair missing email and complete shared permissions');
 // Failed grants can leave an applied email behind even if their response was lost.
 const migrationMeta=migratedCurrent.collaboration.projectId,key=`${migrationMeta}/onethu-admin/organization.json`;
 let file=server.files.get(key),admin=JSON.parse(file.text);
 const ghost={...binding,email:'attempted@mails.tsinghua.edu.cn'};
 server.cloud.set('legacy-cloud',[...server.cloud.get('legacy-cloud'),{email:ghost.email,permission:'rw'}]);
 admin.pending={id:'interrupted-email',label:'response lost',createdAt:0,target:{...ghost,role:'member'},bindings:admin.bindings.map(x=>x.userId===2?ghost:x),previousBindings:admin.bindings,errors:['response lost']};
 server.files.set(key,{text:JSON.stringify(admin),revision:'pending-email-v1'});
 await sync(a,'changeRemoteMember',[migrated.id,2,{...binding,role:'member'},{email:binding.email,role:'member'}]);
 check(!server.cloud.get('legacy-cloud').some(s=>s.email===ghost.email),'repair revokes every previously attempted email, including response-lost grants');
 // New invalid resources must fail before they can strand the organization in pending.
 const mg=server.groups.get(oldGroup.id);mg.members.push({...server.users[2],access_level:20});
 await assert.rejects(()=>sync(a,'updateRemoteResources',[migrated.id,'libraries',migratedCurrent.libraries,[...migratedCurrent.libraries,{repoId:'new-cloud',name:'New',addedAt:1}]]),/每位组织成员/);
 check(!(await org(a,'orgSnapshot')).orgs.find(o=>o.id===migrated.id).collaboration.pending,'missing email preflight does not persist a new blocking resource intent');
 mg.members.pop();
 const repo=await server.call(1,'createProject',[{namespaceId:oldGroup.id,name:'linked-project'}]);
 server.projects.get(repo.id).visibility='public';
 await assert.rejects(()=>sync(a,'updateRemoteResources',[migrated.id,'gitlabRepos',[],[{...repo,addedAt:1}]]),/私有仓库/);
 check(!(await org(a,'orgSnapshot')).orgs.find(o=>o.id===migrated.id).collaboration.pending,'public project is rejected before resource metadata changes');
 // A lost server response must be found by the stable path instead of creating duplicates.
 const resumed=await org(a,'createOrg',[{name:'响应丢失恢复',ownerEmail:'tester@mails.tsinghua.edu.cn'}]);
 const groupsBefore=server.groups.size,projectsBefore=server.projects.size;
 server.loseCreateResponse=true;
 await sync(a,'enableOrgCollaboration',[resumed.id]);
 check(server.groups.size===groupsBefore+1&&server.projects.size===projectsBefore+1,'lost group creation response recovers the same stable remote resources');
 console.log(`${checks} organization collaboration browser assertions passed (simulated services, independent contexts)`);
}finally{await browser.close();}
