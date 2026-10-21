/** Executable protocol tests: in-memory server, not real GitLab/Seafile account validation. */
import assert from 'node:assert/strict';
import {applyPermissionIntent, setGitPermission, replaceSharedItem, decodeOrgFile, OrgConflictError} from '../apps/desktop/src/state/orgSyncCore.ts';
let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;console.log('✓ '+label);};
const member=(id,level)=>({id,username:'user'+id,name:'成员'+id,access_level:level});
const binding=(id,email='user'+id+'@test.invalid')=>({userId:id,username:'user'+id,name:'成员'+id,email});
function fixture(){
 const state={group:[member(1,50),member(2,30)],project:[member(2,30)],inherited:[],cloud:[{email:binding(2).email,permission:'rw'}],calls:[],failRemove:false,lie:false};
 const api={
  project:async()=>({visibility:"private",namespace:{id:10}}),
  members:async(kind,id,all=true)=>structuredClone(kind==='groups'?state.group:[...state.project,...(all?state.inherited:[])]),
  setMember:async(kind,id,userId,level,exists)=>{state.calls.push(['set',kind,userId,level]);const key=kind==='groups'?'group':'project';if(state.lie)return;state[key]=[...state[key].filter(m=>m.id!==userId),member(userId,level)];},
  removeMember:async(kind,id,userId)=>{state.calls.push(['remove',kind,userId]);const key=kind==='groups'?'group':'project';state[key]=state[key].filter(m=>m.id!==userId);},
  auditCloud:async()=>{}, listCloud:async()=>structuredClone(state.cloud),cloudOwner:async()=>binding(1).email,
  setCloud:async(repo,email,permission)=>{state.calls.push(['cloud-set',email,permission]);state.cloud=[...state.cloud.filter(s=>s.email!==email),{email,permission}];},
  removeCloud:async(repo,email)=>{state.calls.push(['cloud-remove',email]);if(state.failRemove)throw Error('network unavailable');state.cloud=state.cloud.filter(s=>s.email!==email);},
 };
 const snapshot={ref:{groupId:10,projectId:100,adminBranch:'onethu-admin',contentBranch:'onethu-content'},admin:{revision:'a',value:{v:1,kind:'onethu-org-admin',orgId:'org1',name:'Group',brief:'',joinUrl:'',bindings:[binding(1),binding(2)],libraries:[{repoId:'cloud1',name:'资料库',addedAt:0}],gitlabRepos:[{id:20,name:'Repo',path:'group/repo',addedAt:0}]}},content:{revision:'c',value:{v:1,kind:'onethu-org-content',projects:[],announcements:[]}},members:state.group,me:member(1,50)};
 const intent=(target,removeUserId)=>({id:'transition',label:'test',createdAt:0,target,removeUserId,previousBindings:[binding(1),binding(2)],bindings:target?[binding(1),target]:[binding(1)]});
 return {state,api,snapshot,intent};
}
{
 const {state,api,snapshot,intent}=fixture();
 const errors=await applyPermissionIntent(api,snapshot,intent({...binding(2),role:'guest'}));
 check(errors.length===0,'role downgrade completes');
 check(state.group.find(m=>m.id===2).access_level===20,'GitLab group downgraded on server');
 check(state.project.find(m=>m.id===2).access_level===20,'GitLab project direct grant downgraded');
 check(state.cloud.find(s=>s.email===binding(2).email).permission==='r','Seafile permission downgraded to read');
 check(!state.calls.some(c=>c[0]==='cloud-set'&&c[1]===binding(1).email),'intrinsic cloud ownership does not cause self-share');
}
{
 const {state,api,snapshot,intent}=fixture();
 const errors=await applyPermissionIntent(api,snapshot,intent(undefined,2));
 check(errors.length===0,'removal completes after verified revocations');
 check(!state.group.some(m=>m.id===2),'removed member absent on authoritative group');
 check(!state.project.some(m=>m.id===2),'old project access removed');
 check(!state.cloud.some(s=>s.email===binding(2).email),'old cloud access removed');
}
{
 const {state,api,snapshot,intent}=fixture();
 const next=binding(2,'new@test.invalid');
 const errors=await applyPermissionIntent(api,snapshot,intent({...next,role:'member'}));
 check(errors.length===0,'changing email reconciles resources');
 check(!state.cloud.some(s=>s.email===binding(2).email),'changing email revokes old cloud account');
 check(state.cloud.some(s=>s.email===next.email&&s.permission==='rw'),'changing email grants new cloud account');
 check(state.calls.findIndex(c=>c[0]==='cloud-remove')<state.calls.findIndex(c=>c[0]==='cloud-set'),'revocation happens before new email grant');
}
{
 const {state,api,snapshot,intent}=fixture();api.project=async()=>({visibility:'public',namespace:{id:10}});
 await assert.rejects(()=>applyPermissionIntent(api,snapshot,intent(undefined,2)),/私有仓库/);
 check(state.calls.length===0,'public GitLab repository cannot be presented as revoked private access');
 api.project=async()=>({visibility:'private',namespace:{id:999}});
 await assert.rejects(()=>applyPermissionIntent(api,snapshot,intent(undefined,2)),/本组织/);
 check(state.calls.length===0,'outside namespace cannot bypass managed group authority');
 api.project=async()=>({visibility:'private',namespace:{id:10},shared_with_groups:[{group_id:999}]});
 await assert.rejects(()=>applyPermissionIntent(api,snapshot,intent(undefined,2)),/其他群组/);
 check(state.calls.length===0,'independent GitLab shared group is rejected');
 api.project=async()=>({visibility:'private',namespace:{id:10}});state.project.push(member(99,30));
 await assert.rejects(()=>applyPermissionIntent(api,snapshot,intent(undefined,2)),/名单外/);
 check(state.calls.length===0,'unknown direct project account is rejected');
}
{
 const {state,api,snapshot,intent}=fixture();api.auditCloud=async()=>{throw Error('独立群组/公开链接仍能访问');};
 await assert.rejects(()=>applyPermissionIntent(api,snapshot,intent({...binding(2),role:'guest'})),/独立群组/);
 check(state.calls.length===0,'independent cloud ACL bypass blocks transition before any permission mutation');
}
{
 const {state,api,snapshot,intent}=fixture();state.failRemove=true;
 const errors=await applyPermissionIntent(api,snapshot,intent({...binding(2,'replacement@test.invalid'),role:'member'}));
 check(errors.length>0,'email transition preserves failure when old account cannot be revoked');
 check(!state.cloud.some(s=>s.email==='replacement@test.invalid'),'new email is never granted while old email revocation failed');
}
{
 const {state,api,snapshot,intent}=fixture();state.failRemove=true;
 const operation=intent(undefined,2);
 check((await applyPermissionIntent(api,snapshot,operation)).some(e=>e.includes('network unavailable')),'partial cloud failure remains explicit');
 check(!state.group.some(m=>m.id===2),'partial failure does not regrant authoritative membership');
 check(!state.project.some(m=>m.id===2),'cloud revocation failure does not skip independent GitLab revocation');
 state.failRemove=false;
 check((await applyPermissionIntent(api,snapshot,operation)).length===0,'same persisted intent can finish after retry');
 const writes=state.calls.length;
 check((await applyPermissionIntent(api,snapshot,operation)).length===0&&state.calls.length===writes,'completed intent retry is idempotent');
}
{
 const {state,api,snapshot,intent}=fixture();snapshot.me=member(2,50);
 await assert.rejects(()=>applyPermissionIntent(api,snapshot,intent(undefined,1)),/不是组织负责人/);
 check(state.calls.length===0,'cached owner role cannot override real server membership');
}
{
 const {state,api,snapshot,intent}=fixture();
 await assert.rejects(()=>applyPermissionIntent(api,snapshot,intent(undefined,1)),/至少保留/);
 check(state.calls.length===0,'last server owner cannot be removed');
 state.group.push(member(3,50));
 await assert.rejects(()=>applyPermissionIntent(api,snapshot,intent({...binding(1),role:'guest'})),/另一位负责人/);
 check(state.calls.length===0,'self-demotion cannot strand an unfinished permission transaction');
}
{
 const {state,api,snapshot,intent}=fixture();state.lie=true;
 check((await applyPermissionIntent(api,snapshot,intent({...binding(2),role:'owner'}))).some(e=>e.includes('权限回读不符')),'false-success API response is rejected by readback');
 check(!state.calls.some(c=>c[0]==='cloud-set'),'secondary grants stop if authoritative role update failed');
}
{
 const {state,api}=fixture();state.inherited=[member(2,40)];state.project=[];
 await assert.rejects(()=>setGitPermission(api,'projects',20,2,20),/上级组织/);
 check(true,'inherited elevated project rights are surfaced rather than declared downgraded');
}
{
 const {state,api,snapshot,intent}=fixture();snapshot.admin.value.gitlabRepos=[];
 const operation=intent({...binding(1),role:'guest'});snapshot.me=member(3,50);state.group.push(member(3,50));
 await assert.rejects(()=>applyPermissionIntent(api,snapshot,operation),/所有者/);
 check(state.calls.length===0,'cloud-owner downgrade stops before partial membership changes');
}
{
 const before={id:'p',name:'v1'}, other={id:'q',name:'other'}, edited={id:'p',name:'v2'};
 check(replaceSharedItem([before,other],before,edited).length===2,'updates preserve other concurrent objects');
 assert.throws(()=>replaceSharedItem([{id:'p',name:'remote changed'},other],before,edited),OrgConflictError);
 check(true,'stale editor cannot overwrite newer object');
 assert.throws(()=>replaceSharedItem([],before,edited),OrgConflictError);
 check(true,'stale editor cannot resurrect another user deletion');
 check(replaceSharedItem([before],before,undefined).length===0,'delete uses matching starting object');
 const value={v:1,kind:'onethu-org-content',projects:[],announcements:[]};
 const file={content:Buffer.from(JSON.stringify(value)).toString('base64'),encoding:'base64',last_commit_id:'v1',size:80};
 check(decodeOrgFile(file,'onethu-org-content').revision==='v1','remote file retains optimistic concurrency token');
 assert.throws(()=>decodeOrgFile({...file,last_commit_id:''},'onethu-org-content'));
 check(true,'missing server revision rejected');
}
console.log(`${checks} organization collaboration protocol assertions passed (simulated services)`);
