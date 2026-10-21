/** Opt-in real GitLab validation. Creates and deletes only its uniquely named private test group.
 * GITLAB_TOKEN=<owner api token> [GITLAB_SECOND_TOKEN=<second account api token>]
 * node tools/org-collaboration-live.mjs --run-isolated
 * Tokens are read only from environment and are never printed or saved.
 */
import assert from 'node:assert/strict';
const ownerToken=process.env.GITLAB_TOKEN,secondToken=process.env.GITLAB_SECOND_TOKEN;
if(!process.argv.includes('--run-isolated')||!ownerToken){console.log('SKIPPED: real GitLab test requires --run-isolated and GITLAB_TOKEN. No service validation claimed.');process.exit(0);}
const host='https://git.tsinghua.edu.cn/api/v4';
async function api(token,method,path,body){const response=await fetch(host+path,{method,headers:{'PRIVATE-TOKEN':token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const text=await response.text();if(!response.ok){const error=new Error(`GitLab ${method} ${path} → HTTP ${response.status}`);error.status=response.status;throw error;}return text?JSON.parse(text):null;}
const A=(method,path,body)=>api(ownerToken,method,path,body),B=(method,path,body)=>api(secondToken,method,path,body);
const slug='onethu-collab-test-'+Date.now().toString(36);let groupId=null;let assertions=0;
const check=(value,label)=>{assert.ok(value,label);assertions++;console.log('✓ '+label);};
try{
 const me=await A('GET','/user'),other=secondToken?await B('GET','/user'):null;
 if(other&&other.id===me.id)throw Error('Second token belongs to the same account; independent-account validation requires another user.');
 const group=await A('POST','/groups',{name:slug,path:slug,visibility:'private'});groupId=group.id;
 const project=await A('POST','/projects',{name:'Organization integration fixture',path:'metadata',namespace_id:groupId,visibility:'private',initialize_with_readme:true,default_branch:'main'});
 for(const [branch,level]of[['onethu-admin',40],['onethu-content',30]]){
  await A('POST',`/projects/${project.id}/repository/branches`,{branch,ref:project.default_branch||'main'});
  await A('POST',`/projects/${project.id}/protected_branches`,{name:branch,push_access_level:level,merge_access_level:level,allow_force_push:false});
  await A('POST',`/projects/${project.id}/repository/files/state.json`,{branch,content:'{"version":1}',commit_message:'Isolated OneTHU integration fixture'});
 }
 const read=(client,branch)=>client('GET',`/projects/${project.id}/repository/files/state.json?ref=${branch}`);
 const update=(client,branch,content,revision)=>client('PUT',`/projects/${project.id}/repository/files/state.json`,{branch,content,commit_message:'Isolated OneTHU CAS test',last_commit_id:revision});
 const original=await read(A,'onethu-content');await update(A,'onethu-content','{"version":2}',original.last_commit_id);
 await assert.rejects(()=>update(A,'onethu-content','{"version":3}',original.last_commit_id),e=>e.status===400||e.status===409);
 check(Buffer.from((await read(A,'onethu-content')).content,'base64').toString()==='{"version":2}','real GitLab rejects stale file revision and preserves the accepted write');
 if(other){
  await assert.rejects(()=>read(B,'onethu-content'),e=>[403,404].includes(e.status));check(true,'second account initially cannot read private metadata');
  await A('POST',`/groups/${groupId}/members`,{user_id:other.id,access_level:30});
  const remote=await read(B,'onethu-content');await update(B,'onethu-content','{"version":4}',remote.last_commit_id);
  check(Buffer.from((await read(A,'onethu-content')).content,'base64').toString()==='{"version":4}','authorized member edits are visible to owner');
  const admin=await read(B,'onethu-admin');await assert.rejects(()=>update(B,'onethu-admin','{"forbidden":true}',admin.last_commit_id),e=>[400,403].includes(e.status));check(true,'member cannot alter the protected admin branch');
  await A('PUT',`/groups/${groupId}/members/${other.id}`,{access_level:20});
  const reporter=await read(B,'onethu-content');await assert.rejects(()=>update(B,'onethu-content','{"forbidden":true}',reporter.last_commit_id),e=>[400,403].includes(e.status));check(true,'downgraded visitor cannot write shared content');
  await A('DELETE',`/groups/${groupId}/members/${other.id}`);await assert.rejects(()=>read(B,'onethu-content'),e=>[403,404].includes(e.status));check(true,'removed member loses private metadata access');
 }else console.log('NOT RUN: second-account read/write/downgrade/revocation checks require GITLAB_SECOND_TOKEN.');
 console.log(`${assertions} real-service assertions passed; ${other?'two accounts':'single account only'}.`);
}finally{
 if(groupId){const group=await A('GET',`/groups/${groupId}`);if(group.path!==slug)throw Error('Cleanup refused: test group identity changed.');await A('DELETE',`/groups/${groupId}`);console.log('Isolated test group deletion requested.');}
}
