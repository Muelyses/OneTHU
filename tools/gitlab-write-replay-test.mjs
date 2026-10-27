#!/usr/bin/env node
/** Real InfoHelper API + fake platform transport. No account, live request or write.
 * Run: node --import tsx tools/gitlab-write-replay-test.mjs */
import assert from 'node:assert/strict';
import * as gitlab from '../packages/info-lib/src/lib/gitlab.ts';
import { roamingWrapper, roamingWriteWrapper } from '../packages/info-lib/src/lib/core.ts';
import { setPlatformFetch, ResponseStatusError } from '../packages/info-lib/src/utils/network.ts';
import { GitLabWriteOutcomeUnknownError } from '../packages/info-lib/src/utils/error.ts';

globalThis.fetch = async () => { throw Error('Live network forbidden'); };
const helper = { userId:'fixture', password:'fixture-only', mocked:()=>false };
const reply = (url,text,status=200)=>({status,text,headers:[],finalUrl:url});
function transport(write, options={}) {
  const calls=[]; let writes=0; let roams=0; let csrf=0;
  setPlatformFetch(async (url,init)=>{
    calls.push({url,...init}); const path=new URL(url).pathname;
    if(path.startsWith('/api/v4/') && init.method && init.method!=='GET') return write({url,init,attempt:++writes});
    if(path==='/') return reply(url,`<meta name="csrf-token" content="fixture-token-${++csrf}">`);
    if(path==='/users/sign_in') { roams++; if(options.roamFails)throw Error('fixture auth transport offline'); return reply(url,'<html>Fixture authenticated dashboard</html>'); }
    throw Error('Unexpected fixture request '+path);
  });
  return {calls,get writes(){return writes;},get roams(){return roams;},get csrf(){return csrf;}};
}
let count=0;async function test(name,run){await run();count++;console.log('✓ '+name);}
const unknown=e=>e instanceof GitLabWriteOutcomeUnknownError && e.code==='GITLAB_WRITE_OUTCOME_UNKNOWN' && e.retryable===false;

await test('Issue creation is not replayed after the server commits then the socket drops',async()=>{
  let committed=0;const f=transport(()=>{committed++;throw Error('fixture socket closed after commit');});
  await assert.rejects(gitlab.createProjectIssue(helper,1,'Title','Body'),unknown);
  assert.equal(f.writes,1);assert.equal(committed,1);assert.equal(f.roams,0);
});
await test('timeout, 5xx, malformed success JSON and login HTML never replay writes',async()=>{
  for(const kind of ['timeout','502','503','invalid-json','login-html']) {
    const f=transport(({url})=>{
      if(kind==='timeout')throw Object.assign(Error('fixture timeout'),{name:'TimeoutError'});
      if(kind==='502'||kind==='503')return reply(url,'gateway',Number(kind));
      return reply(url,kind==='invalid-json'?'{unfinished':'<html>sign in</html>',201);
    });
    await assert.rejects(gitlab.addIssueNote(helper,1,2,'Body'),unknown);assert.equal(f.writes,1);assert.equal(f.roams,0);
  }
});
await test('known non-auth rejections never trigger roaming or resubmit',async()=>{
  for(const status of [400,403,404,409,422,429]) {
    const f=transport(({url})=>reply(url,'rejected',status));
    await assert.rejects(gitlab.createMergeRequest(helper,1,'source','target','Title','Body'),e=>e instanceof ResponseStatusError&&e.status===status);
    assert.equal(f.writes,1);assert.equal(f.roams,0);
  }
});
await test('HTTP 401 permits one auth recovery and a new CSRF token before the second write',async()=>{
  const headers=[];const f=transport(({url,init,attempt})=>{headers.push(init.headers['X-CSRF-Token']);return reply(url,attempt===1?'unauthorized':'{"id":9}',attempt===1?401:201);});
  assert.equal((await gitlab.createProjectIssue(helper,1,'Title','Body')).id,9);
  assert.equal(f.writes,2);assert.equal(f.roams,1);assert.ok(f.csrf>=1);assert.equal(headers[1],`fixture-token-${f.csrf}`);
});
await test('second 401 and an uncertain second result terminate the recovery tier',async()=>{
  for(const second of ['401','disconnect']) {
    const f=transport(({url,attempt})=>{if(attempt===1||second==='401')return reply(url,'unauthorized',401);throw Error('socket lost');});
    await assert.rejects(gitlab.addMergeRequestNote(helper,1,2,'Body'),second==='401'?e=>e.status===401:unknown);
    assert.equal(f.writes,2);assert.equal(f.roams,1);
  }
});
await test('a 401 at a redirect target cannot prove that the original mutation was rejected',async()=>{
  const f=transport(({url})=>({...reply(url,'unauthorized',401),finalUrl:'https://git.tsinghua.edu.cn/users/sign_in'}));
  await assert.rejects(gitlab.createProjectIssue(helper,1,'Title','Body'),unknown);assert.equal(f.writes,1);assert.equal(f.roams,0);
});
await test('failed auth recovery after explicit rejection does not start a second write',async()=>{
  const f=transport(({url})=>reply(url,'unauthorized',401),{roamFails:true});
  await assert.rejects(gitlab.createProjectIssue(helper,1,'Title','Body'),/fixture auth transport offline/);assert.equal(f.writes,1);assert.equal(f.roams,1);
});
await test('all GitLab mutation entry points share the protected write wrapper',async()=>{
  const cases=[
    ['createProject',[{name:'Fixture'}]],['createGroup',[{name:'Fixture',path:'fixture'}]],['addGroupMember',[1,2]],['addProjectMember',[1,2]],
    ['createProjectIssue',[1,'Title','Body']],['setIssueState',[1,2,'close']],['addIssueNote',[1,2,'Body']],
    ['setMergeRequestState',[1,2,'close']],['addMergeRequestNote',[1,2,'Body']],['updateIssueNote',[1,2,3,'Body']],['updateMergeRequestNote',[1,2,3,'Body']],
    ['createDiscussion',['issue',1,2,'Body']],['addDiscussionNote',['issue',1,2,'thread','Body']],['updateDiscussionNote',['issue',1,2,'thread',3,'Body']],
    ['deleteDiscussionNote',['issue',1,2,'thread',3]],['resolveDiscussion',['issue',1,2,'thread',true]],['assignTo',['issue',1,2,[3]]],
    ['addAward',['issue',1,2,'thumbsup']],['removeAward',['issue',1,2,3]],['createMergeRequest',[1,'source','target','Title','Body']],['mergeMergeRequest',[1,2]],
  ];
  for(const [name,args] of cases) {
    const f=transport(()=>{throw Error('fixture disconnect');});await assert.rejects(gitlab[name](helper,...args),unknown);assert.equal(f.writes,1,name);assert.equal(f.roams,0,name);
  }
  const org=gitlab.organizationGitApi(helper);
  for(const [name,args] of [['setMember',['groups',1,2,30,false]],['removeMember',['groups',1,2]],['createMetadataProject',[1,'fixture']],['createFile',[1,'main','file','body']],['updateFile',[1,'main','file','body','sha']],['createBranch',[1,'feature','main']],['protect',[1,'main',30]]]) {
    const f=transport(()=>{throw Error('fixture disconnect');});await assert.rejects(org[name](...args),unknown);assert.equal(f.writes,1,name);assert.equal(f.roams,0,name);
  }
});
await test('successful DELETE 204 and normal creation are completed once',async()=>{
  let f=transport(({url})=>reply(url,'',204));await gitlab.removeAward(helper,'issue',1,2,3);assert.equal(f.writes,1);assert.equal(f.roams,0);
  f=transport(({url})=>reply(url,'{"id":7}',201));assert.equal((await gitlab.createMergeRequest(helper,1,'source','target','Title','Body')).id,7);assert.equal(f.writes,1);
});
await test('write wrapper never infers 401 from text while read retry behavior remains available',async()=>{
  let attempts=0;transport(()=>{throw Error('Unexpected mutation');});
  await assert.rejects(roamingWriteWrapper(helper,'gitlab','',async()=>{attempts++;throw Error('network timeout 401 text');}),/network timeout/);assert.equal(attempts,1);
  attempts=0;const f=transport(()=>{throw Error('Unexpected mutation');});
  const result=await roamingWrapper(helper,'gitlab','',async()=>{if(++attempts===1)throw Error('read disconnected');return 'read recovered';});
  assert.equal(result,'read recovered');assert.equal(attempts,2);assert.equal(f.roams,1);
});
await test('account change during authentication recovery cannot submit the old write again',async()=>{
  const scoped={...helper};let attempts=0;
  setPlatformFetch(async url=>{scoped.userId='another-fixture';return reply(url,'<html>Authenticated</html>');});
  await assert.rejects(roamingWriteWrapper(scoped,'gitlab','',async()=>{attempts++;throw new ResponseStatusError('unauthorized',401,true);}),e=>e.code==='AUTH_SESSION_CHANGED');
  assert.equal(attempts,1);
});
await test('missing login fails before mutation and preview createProject keeps its fixture',async()=>{
  const f=transport(()=>{throw Error('Unexpected mutation');});
  await assert.rejects(gitlab.createProjectIssue({...helper,userId:''},1,'Title','Body'),/Please login/);assert.equal(f.writes,0);
  const preview=await gitlab.createProject({...helper,mocked:()=>true},{name:'Fixture'});assert.equal(typeof preview.id,'number');assert.equal(f.writes,0);
});
await test('every CLI GitLab writer accepts an isolated guard at the final mutation boundary', async () => {
  const cases = [
    ['createProjectIssue',[1,'Title','Body']], ['setIssueState',[1,2,'close']], ['addIssueNote',[1,2,'Body']],
    ['setMergeRequestState',[1,2,'close']], ['addMergeRequestNote',[1,2,'Body']], ['updateIssueNote',[1,2,3,'Body']], ['updateMergeRequestNote',[1,2,3,'Body']],
    ['addDiscussionNote',['issue',1,2,'thread','Body']], ['deleteDiscussionNote',['issue',1,2,'thread',3]],
    ['resolveDiscussion',['issue',1,2,'thread',true]], ['assignTo',['issue',1,2,[3]]],
    ['addAward',['issue',1,2,'thumbsup',undefined]], ['removeAward',['issue',1,2,3,undefined]],
    ['createMergeRequest',[1,'source','target','Title','Body']], ['mergeMergeRequest',[1,2]],
  ];
  for (const [name, args] of cases) {
    const f = transport(({url}) => reply(url, '{"id":1}'));
    await assert.rejects(gitlab[name](helper, ...args, async () => { throw Error('CLI_DISABLED'); }), /CLI_DISABLED/);
    assert.equal(f.writes, 0, name); assert.equal(f.roams, 0, name);
  }
  const f = transport(({url}) => reply(url, '{"id":2}'));
  const results = await Promise.allSettled([
    gitlab.createProjectIssue(helper,1,'guarded','Body',async()=>{throw Error('CLI_DISABLED');}),
    gitlab.createProjectIssue(helper,1,'ordinary UI','Body'),
  ]);
  assert.equal(results[0].status,'rejected'); assert.equal(results[1].status,'fulfilled'); assert.equal(f.writes,1);
});
await test('revocation while reading CSRF and during 401 roaming cannot submit a mutation', async () => {
  // End on 401 so the next operation must actually read a fresh token.
  transport(({url})=>reply(url,'unauthorized',401));
  await assert.rejects(gitlab.createProjectIssue(helper,1,'Title','Body'));
  let allowed = true, writes = 0;
  setPlatformFetch(async (url,init) => {
    if (new URL(url).pathname === '/') { allowed=false; return reply(url,'<meta name="csrf-token" content="fixture">'); }
    writes++; return reply(url,'{"id":1}');
  });
  await assert.rejects(gitlab.createProjectIssue(helper,1,'Title','Body',async()=>{if(!allowed)throw Error('CLI_DISABLED');}),/CLI_DISABLED/);
  assert.equal(writes,0);
  allowed=true; writes=0;
  setPlatformFetch(async (url,init) => {
    const pathname=new URL(url).pathname;
    if(pathname==='/') return reply(url,'<meta name="csrf-token" content="fixture">');
    if(pathname==='/users/sign_in') { allowed=false; return reply(url,'<html>Authenticated fixture</html>'); }
    writes++; return reply(url,'unauthorized',401);
  });
  await assert.rejects(gitlab.createProjectIssue(helper,1,'Title','Body',async()=>{if(!allowed)throw Error('CLI_DISABLED');}),/CLI_DISABLED/);
  assert.equal(writes,1,'revoked second attempt never reaches transport');
});
await test('organization metadata uses the same final write guard after CSRF preparation', async () => {
  const f = transport(({url}) => reply(url, '{"id":1}'));
  const api = gitlab.organizationGitApi(helper, async () => { throw Error('ORG_APPROVAL_REVOKED'); });
  await assert.rejects(api.updateFile(1, 'onethu-content', 'collaboration.json', '{}', 'old-revision'), /ORG_APPROVAL_REVOKED/);
  await assert.rejects(api.setMember('groups', 1, 2, 30, false), /ORG_APPROVAL_REVOKED/);
  assert.equal(f.writes, 0); assert.equal(f.roams, 0);
});
console.log(`gitlab-write-replay-test: ${count} groups passed`);
