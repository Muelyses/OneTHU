import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
const daemonEntry=fileURLToPath(new URL('./fixtures/resident-handoff-daemon.mjs',import.meta.url));
const clientEntry=fileURLToPath(new URL('./fixtures/resident-handoff-client.mjs',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function startDaemon(profile){
  const child=spawn(process.execPath,[daemonEntry,profile],{env:{...process.env,ONETHU_ENDPOINT:''},stdio:['ignore','pipe','pipe']});
  const closed=once(child,'close');let stderr='';child.stderr.on('data',part=>{stderr+=part;});
  const lines=createInterface({input:child.stdout});
  const ready=await Promise.race([once(lines,'line'),closed.then(()=>{throw Error(stderr||'fixture daemon exited early');}),new Promise((_,reject)=>{setTimeout(()=>reject(Error('fixture startup timeout')),15000).unref();})]);
  lines.close();assert.equal(JSON.parse(ready[0]).running,true);
  return {child,closed,stderr:()=>stderr};
}
async function client(profile,action,id){
  const child=spawn(process.execPath,[clientEntry,profile,action,...(id?[id]:[])],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',part=>{stdout+=part;});child.stderr.on('data',part=>{stderr+=part;});
  const [status]=await once(child,'close');assert.equal(status,0,stderr||'fixture client failed');
  return JSON.parse(stdout);
}
test('real daemon continues a handed-off school task after frontend process exits and persists results across reconnect/restart',{timeout:55000},async t=>{
  const profile=await mkdtemp(path.join(tmpdir(),'onethu-resident-handoff-'));
  const daemons=[];t.after(async()=>{for(const daemon of daemons){if(daemon.child.exitCode===null)daemon.child.kill('SIGTERM');await daemon.closed;}await rm(profile,{recursive:true,force:true});});
  let daemon=await startDaemon(profile);daemons.push(daemon);
  const handoff=await client(profile,'handoff');const frontendExitedAt=Date.now();
  assert.notEqual(handoff.clientPid,daemon.child.pid);assert(frontendExitedAt<handoff.runAt,'foreground process must exit before the task is due');
  assert.throws(()=>process.kill(handoff.clientPid,0),error=>error.code==='ESRCH');
  // No daemon RPC connections are made while the scheduled task runs. The
  // observer only reads this private synthetic profile's atomic task file.
  let completed;const deadline=Date.now()+35000;
  while(Date.now()<deadline){
    const state=JSON.parse(await readFile(path.join(profile,'tasks.json'),'utf8'));
    completed=state.tasks.find(row=>row.id===handoff.taskId)?.history.at(-1);
    if(completed?.finishedAt)break;
    await delay(200);
  }
  assert(completed,'the real 15-second scheduler must run without a frontend');
  assert.equal(completed.status,'succeeded');assert.equal(completed.notified,1);assert(completed.startedAt>=handoff.runAt);assert(completed.startedAt>frontendExitedAt);
  const schoolEvents=(await readFile(path.join(profile,'synthetic-school.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert(schoolEvents.every(row=>row.method==='GET'));
  assert(schoolEvents.some(row=>row.kind==='identity'&&row.at>=completed.startedAt&&row.pid===daemon.child.pid),'the background run must use the real school adapter after frontend exit');
  const reconnected=await client(profile,'inspect',handoff.taskId);
  assert.equal(reconnected.task.id,handoff.taskId);assert.equal(reconnected.history.length,1);assert.equal(reconnected.inboxCount,1);assert.match(reconnected.inboxText,/user\.info/);
  const firstPid=daemon.child.pid;await client(profile,'stop');assert.equal((await daemon.closed)[0],0);assert.equal(daemon.stderr(),'');
  daemon=await startDaemon(profile);daemons.push(daemon);
  const restarted=await client(profile,'inspect',handoff.taskId);
  assert.notEqual(daemon.child.pid,firstPid);assert.equal(restarted.history.length,1);assert.equal(restarted.history[0].id,completed.id);assert.equal(restarted.inboxCount,1);assert.equal(restarted.task.nextRunAt,null);
  assert.equal(daemon.stderr(),'');
  const report={passed:true,scenario:'real-daemon-private-rpc-synthetic-school-frontend-exit',syntheticAccount:true,
    realExternalNetwork:false,realImSent:false,daemonPid:firstPid,frontendPid:handoff.clientPid,frontendExitedAt,
    taskId:handoff.taskId,scheduledAt:handoff.runAt,runStartedAt:completed.startedAt,runFinishedAt:completed.finishedAt,
    readOperation:'user.info',runStatus:completed.status,inboxCount:reconnected.inboxCount,
    reconnectedClientPid:reconnected.clientPid,restartedDaemonPid:daemon.child.pid,restartHistoryCount:restarted.history.length,restartInboxCount:restarted.inboxCount,
    schoolAdapterMethods:[...new Set(schoolEvents.map(row=>row.method))],sdkBundleSha256:createHash('sha256').update(await readFile(new URL('../dist/sdk/index.mjs',import.meta.url))).digest('hex')};
  if(process.env.ONETHU_ACCEPTANCE_REPORT){const output=path.resolve(process.env.ONETHU_ACCEPTANCE_REPORT);await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});}
  t.diagnostic(JSON.stringify(report));
});
