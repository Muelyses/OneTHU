/** Runs the real CLI learning service with an isolated host; no network or downloads. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
const sharedCompiled=ts.transpileModule(readFileSync(new URL('../packages/sdk/src/learn.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const compiled=ts.transpileModule(readFileSync(new URL('../apps/desktop/src/lib/cliLearn.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture() {
  let epoch=1; let enabled=true; let oh=true; let invokeHook=()=>{}; let inlineElements=[]; const calls=[];
  let now=1_800_000_000_000;let monotonic=0;
  const session={username:'fixture-account',state:'ready'};
  const course={id:'course',name:'数据结构',teacherName:'Teacher',courseNumber:'123',courseIndex:1,timeAndLocation:[],url:'https://learn.tsinghua.edu.cn/course'};
  const hw={id:'hw',baseId:'base',courseId:'course',title:'第一次作业',content:'<p>Body</p>',publishTime:'2026-10-24',deadline:'2026-10-31',submitted:false,graded:false,url:'https://learn.tsinghua.edu.cn/hw'};
  const notice={id:'notice',courseId:'course',title:'公告',content:'<p>Notice</p>',publishTime:'2026-10-24',publisher:'Teacher',url:'https://learn.tsinghua.edu.cn/notice'};
  const attachment=(id,role)=>({id,name:`${id}.pdf`,role,downloadUrl:`https://learn.tsinghua.edu.cn/b/download?wjid=${id}`});
  const learn={
    getCurrentSemester:async()=>({id:'server-semester',startDate:'',endDate:''}),
    getCourseList:async sem=>{calls.push(['courses',sem]);return[course];},
    getFileList:async cid=>{calls.push(['files',cid]);return[{id:'file',courseId:cid,title:'第一讲',fileType:'pdf',uploadTime:'2026-10-24',downloadUrl:'https://learn.tsinghua.edu.cn/b/file?wjid=file'}];},
    getAllHomework:async()=>{calls.push(['homework']);return[hw];},
    getNotificationList:async(cid,expired)=>{calls.push(['notices',expired]);return expired?[{...notice,id:'expired'}]:[notice];},
    getHomeworkDetail:async()=>({description:'<p>Full description</p>'}),
    getHomeworkReadDetail:async()=>({hasSubmitForm:true,attachments:[attachment('a','teacher'),attachment('b','teacher'),attachment('c','answer'),attachment('d','submission'),attachment('e','grade')]}),
    getNotificationPageDetail:async()=>({attachments:[attachment('n','attachment'),attachment('n2','attachment')]}),
  };
  const invoke=async(name,args)=>{calls.push(['invoke',name,args]);await invokeHook(args);return{absolutePath:'/fixture/out.pdf',bytes:42,sha256:'fixture-hash',mime:'application/pdf'};};
  const imports={
    './clients.js':{learn,session,http:{jar:{getCookies:()=>[{name:'session',value:'fixture-secret'}]}},sessionUrl:url=>url},
    './transport.js':{isTauri:true,nativeSessionEpoch:async()=>epoch,assertNativeSessionEpoch:async e=>{if(e!==epoch)throw Error('AUTH_SESSION_CHANGED');},nativeSessionChanged:()=>Error('AUTH_SESSION_CHANGED')},
    '@tauri-apps/api/core':{invoke},
    '../state/userext.js':{mcpServerEnabled:()=>enabled},
    '../state/privacyConsent.js':{ohAuthorized:()=>oh},
  };
  const exports={};
  // Fixtures have no inline links; DOM decoding is performed by the browser in production.
  const DOMParser=class{parseFromString(){return{querySelectorAll:()=>inlineElements};}};
  const sharedExports={};
  vm.runInNewContext(sharedCompiled,{exports:sharedExports,module:{exports:sharedExports},require:id=>{throw Error(id);},URL,TextEncoder,crypto:webcrypto,Date:{now:()=>now},performance:{now:()=>monotonic}},{filename:'sdk-learn-fixture.cjs'});
  imports['@onethu/sdk/learn']=sharedExports;
  vm.runInNewContext(compiled,{exports,module:{exports},require:id=>{assert.ok(imports[id],id);return imports[id];},URL,TextEncoder,crypto:webcrypto,DOMParser,Date:{now:()=>now},performance:{now:()=>monotonic}},{filename:'cli-learn-fixture.cjs'});
  const operations=exports.cliLearnOperations;
  return{operations,learn,calls,session,hw,now:()=>now,advance(ms){now+=ms;monotonic+=ms;},wallShift(ms){now+=ms;},withDeadline(name,args,deadline,check,signal){return exports.runCliLearnDownloadWithDeadline(name,args,deadline,check,signal);},onInvoke(fn){invokeHook=fn;},inline(elements){inlineElements=elements;},disable(){enabled=false;},revoke(){oh=false;},changeAccount(){epoch++;session.username='other';},run(name,...args){return operations.find(o=>o.name===name).run(...args);}};
}
let count=0;async function test(name,fn){await fn();count++;console.log('✓ '+name);}
await test('catalog covers complete learning query surface and gates only download as mutation',async()=>{
  const f=fixture();assert.deepEqual(Array.from(f.operations,o=>o.name),['currentSemester','courses','files','homework','notifications','homeworkDetail','notificationDetail','resources','download','downloadMany']);
  assert.deepEqual(Array.from(f.operations.filter(o=>o.mutation),o=>o.name),['download','downloadMany']);
});
await test('current semester comes from server and official Chinese names survive',async()=>{
  const f=fixture();assert.equal((await f.run('currentSemester')).id,'server-semester');const out=await f.run('courses');assert.equal(out.semester,'server-semester');assert.equal(out.rows[0].name,'数据结构');assert.equal(out.rows[0].url,undefined);
});
await test('file resources have stable references without leaking Cookie or download URL',async()=>{
  const f=fixture();const a=await f.run('files','course');const b=await f.run('files','course');
  assert.equal(a.rows[0].resource.resourceRef,b.rows[0].resource.resourceRef);assert.match(a.rows[0].resource.resourceRef,/^learn:[0-9a-f]{64}$/);
  assert.equal(a.rows[0].resource.filename,'第一讲.pdf');assert.equal(a.rows[0].downloadUrl,undefined);assert.ok(!JSON.stringify(a).includes('fixture-secret'));
});
await test('unknown course is rejected before touching its resources',async()=>{
  const f=fixture();await assert.rejects(f.run('files','unknown'),/LEARN_COURSE_NOT_FOUND/);assert.ok(!f.calls.some(c=>c[0]==='files'));
});
await test('resources reject externally hosted download URLs',async()=>{
  const f=fixture();f.learn.getFileList=async()=>[{id:'bad',courseId:'course',title:'bad',downloadUrl:'https://example.com/secret'}];await assert.rejects(f.run('files','course'),/LEARN_RESOURCE_URL_REJECTED/);
});
await test('homework details keep multiple teacher files and all four roles',async()=>{
  const f=fixture();f.hw.content='';const out=await f.run('homeworkDetail','course','hw');assert.equal(out.descriptionHtml,'<p>Full description</p>');assert.equal(out.attachments.length,5);assert.deepEqual(Array.from(out.attachments,x=>x.attachmentRole),['teacher','teacher','answer','submission','grade']);
  await assert.rejects(f.run('homeworkDetail','course','hw','unrelated-base'),/LEARN_HOMEWORK_NOT_FOUND/);
});
await test('list description avoids a redundant detail request and sends student/base IDs to their own endpoints',async()=>{
  const f=fixture();let jsonCalls=0;let pageCalls=0;
  f.learn.getHomeworkDetail=async base=>{jsonCalls++;assert.equal(base,'base');return{description:'<p>From JSON</p>'};};
  f.learn.getHomeworkReadDetail=async(course,id)=>{pageCalls++;assert.equal(course,'course');assert.equal(id,'hw');return{hasSubmitForm:false,attachments:[]};};
  const listed=await f.run('homeworkDetail','course','hw','base');assert.equal(listed.descriptionSource,'list');assert.equal(jsonCalls,0);assert.equal(listed.complete,true);
  f.hw.content='';const fetched=await f.run('homeworkDetail','course','hw','base');assert.equal(fetched.descriptionSource,'detail');assert.equal(jsonCalls,1);assert.equal(pageCalls,2);
});
await test('description failure retains independent page body and attachments with sanitized stage diagnostics',async()=>{
  const f=fixture();f.hw.content='';f.learn.getHomeworkDetail=async()=>{throw Object.assign(Error('LEARN_RESPONSE_UNEXPECTED'),{code:'LEARN_RESPONSE_UNEXPECTED',kind:'rejected-json',body:'secret_cookie=private',url:'https://private/?token=secret'});};
  const page=f.learn.getHomeworkReadDetail;f.learn.getHomeworkReadDetail=async()=>({...await page(),description:'<p>From page</p>'});
  const out=await f.run('homeworkDetail','course','hw');assert.equal(out.descriptionHtml,'<p>From page</p>');assert.equal(out.descriptionSource,'page');assert.equal(out.attachments.length,5);assert.equal(out.complete,false);
  assert.equal(out.descriptionComplete,true);assert.equal(out.attachmentsComplete,true);assert.equal(out.issues[0].code,'LEARN_RESPONSE_UNEXPECTED');assert.equal(out.issues[0].kind,'rejected-json');assert.equal(out.issues[0].stage,'homework-description');
  assert.ok(!JSON.stringify(out).includes('secret_cookie'));assert.ok(!JSON.stringify(out).includes('private'));
});
await test('an attachment-page failure preserves description and leaves form availability unknown',async()=>{
  const f=fixture();f.learn.getHomeworkReadDetail=async()=>{throw Object.assign(Error('LEARN_RESPONSE_UNEXPECTED'),{kind:'empty-page',stage:'homework-grade-page'});};
  const out=await f.run('homeworkDetail','course','hw');assert.equal(out.descriptionHtml,'<p>Body</p>');assert.equal(out.attachmentsComplete,false);assert.equal(out.hasSubmitForm,undefined);assert.equal(out.complete,false);assert.equal(out.submitFormChecked,false);assert.equal(out.issues[0].stage,'homework-grade-page');
});
await test('resource aggregation exposes per-stage failures without discarding available attachment references',async()=>{
  const f=fixture();f.hw.content='';f.learn.getHomeworkDetail=async()=>{throw Object.assign(Error('LEARN_RESPONSE_UNEXPECTED'),{kind:'unknown'});};
  const out=await f.run('resources','course');assert.equal(out.homework[0].complete,false);assert.equal(out.homework[0].attachments.length,5);assert.ok(out.issues.some(issue=>issue.stage==='homework-description'&&issue.kind==='unknown'));assert.ok(out.items.some(item=>item.kind==='homework'));
});
await test('authorization errors remain terminal rather than returning partial school data',async()=>{
  for(const phase of ['getHomeworkDetail','getHomeworkReadDetail']) {
    const f=fixture();f.hw.content='';f.learn[phase]=async()=>{throw Object.assign(Error('Login required'),{name:'AuthRequiredError'});};
    await assert.rejects(f.run('homeworkDetail','course','hw'),/Login required/);
  }
});
await test('announcement enumeration includes expired and detail keeps every attachment',async()=>{
  const f=fixture();assert.equal((await f.run('notifications','course')).count,2);assert.equal((await f.run('notifications','course',false)).count,1);assert.equal((await f.run('notificationDetail','course','notice')).attachments.length,2);
});
await test('notification original filename reaches resource registration and the actual download',async()=>{
  const f=fixture();
  f.learn.getNotificationList=async()=>[{id:'notice',courseId:'course',title:'公告',content:'',attachmentName:'实验说明.zip'}];
  f.learn.getNotificationPageDetail=async(course,id,name)=>{
    assert.equal(name,'实验说明.zip');
    return {attachments:[{id:'notice-file',name,downloadUrl:'https://learn.tsinghua.edu.cn/b/download?wjid=notice-file'}]};
  };
  const detail=await f.run('notificationDetail','course','notice');
  assert.equal(detail.attachments[0].filename,'实验说明.zip');
  await f.run('download',detail.attachments[0].resourceRef,'/fixture/output');
  assert.equal(f.calls.find(call=>call[0]==='invoke')[2].filename,'实验说明.zip');
});
await test('resource collection reuses lists and reports homework completeness limitations',async()=>{
  const f=fixture();const result=await f.run('resources','course');assert.equal(result.complete,false);assert.equal(result.issues[0].code,'LEARN_HOMEWORK_ENUMERATION_UNVERIFIED');assert.equal(f.calls.filter(c=>c[0]==='homework').length,1);assert.equal(f.calls.filter(c=>c[0]==='notices').length,2);assert.ok(result.count>=8);
  assert.equal(result.homework[0].descriptionHtml,'<p>Body</p>');assert.equal(result.notifications[0].contentHtml,'<p>Notice</p>');
});
await test('failed resource details preserve listed body and mark individual incompleteness',async()=>{
  const f=fixture();f.learn.getHomeworkReadDetail=async()=>{throw Error('fixture failure');};f.learn.getNotificationPageDetail=async()=>{throw Error('fixture failure');};
  const out=await f.run('resources','course');assert.equal(out.homework[0].descriptionHtml,'<p>Body</p>');assert.equal(out.homework[0].complete,false);
  assert.equal(out.notifications[0].contentHtml,'<p>Notice</p>');assert.equal(out.notifications[0].complete,false);assert.equal(out.items.length,1);assert.equal(out.issues.length,4);
});
await test('relative gateway inline resources stay on WebVPN origin',async()=>{
  const f=fixture();const path='/https/77726476706e69737468656265737421fcf2408e297e7c4377068ea48d546d30ca8cc97bcc/b/image.png';
  f.inline([{tagName:'IMG',getAttribute:key=>key==='src'?path:null}]);const out=await f.run('homeworkDetail','course','hw');
  await f.run('download',out.inlineResources[0].resourceRef,'/fixture');assert.equal(f.calls.find(c=>c[0]==='invoke')[2].url,'https://webvpn.tsinghua.edu.cn'+path);
});
await test('registered single download uses native epoch and private Cookie without exposing it',async()=>{
  const f=fixture();const files=await f.run('files','course');const ref=files.rows[0].resource.resourceRef;const out=await f.run('download',ref,'/fixture/output');const call=f.calls.find(c=>c[0]==='invoke');
  assert.equal(call[1],'cli_download_learn_resource');assert.equal(call[2].expectedEpoch,1);assert.equal(call[2].cookies,'session=fixture-secret');assert.equal(out.resourceRef,ref);assert.ok(!JSON.stringify(out).includes('fixture-secret'));
  assert.equal(call[2].deadlineUnixMs,f.now()+60_000);
  assert.equal(call[2].remainingBudgetMs,60_000);
});
await test('forged and prior-account resource references never reach native download',async()=>{
  const f=fixture();await assert.rejects(f.run('download','learn:forged','/fixture'),/REFERENCE_EXPIRED/);const old=(await f.run('files','course')).rows[0].resource.resourceRef;f.changeAccount();await assert.rejects(f.run('download',old,'/fixture'),/REFERENCE_EXPIRED/);assert.ok(!f.calls.some(c=>c[0]==='invoke'));
});
await test('logout and account change during response prevent result publication',async()=>{
  const f=fixture();f.session.state='idle';await assert.rejects(f.run('courses'),/SCHOOL_SESSION_REQUIRED/);f.session.state='ready';f.learn.getCourseList=async()=>{f.changeAccount();return[];};await assert.rejects(f.run('courses'),/AUTH_SESSION_CHANGED/);
});
await test('batch preserves earlier successes and reports invalid references individually',async()=>{
  const f=fixture();const ref=(await f.run('files','course')).rows[0].resource.resourceRef;
  const out=await f.run('downloadMany',[ref,'learn:missing',ref],'/fixture/output');
  assert.equal(out.results.length,2);assert.equal(out.failures.length,1);assert.equal(out.complete,false);assert.equal(out.enumerationComplete,false);
  assert.equal(out.failures[0].code,'LEARN_RESOURCE_REFERENCE_EXPIRED');
});
await test('batch limit rejects before calling native or touching school data',async()=>{
  const f=fixture();await assert.rejects(f.run('downloadMany',Array(501).fill('ref'),'/fixture'),/CLI_INVALID_ARGUMENT/);assert.equal(f.calls.length,0);
});
await test('CLI closure and OH consent revocation stop download entry',async()=>{
  for(const revoke of ['disable','revoke']) {
    const f=fixture();const ref=(await f.run('files','course')).rows[0].resource.resourceRef;f[revoke]();
    await assert.rejects(f.run('download',ref,'/fixture'),/CLI_DISABLED|OH_AUTHORIZATION_REQUIRED/);assert.ok(!f.calls.some(c=>c[0]==='invoke'));
  }
});
await test('mid-batch revocation or account switch preserves earlier success and skips later files',async()=>{
  for(const revoke of ['disable','revoke','changeAccount']) {
    const f=fixture();const ref=(await f.run('files','course')).rows[0].resource.resourceRef;let invokes=0;
    f.onInvoke(()=>{if(++invokes===2)f[revoke]();});
    const out=await f.run('downloadMany',[ref,ref,ref],'/fixture');assert.equal(out.results.length,1);assert.equal(out.failures.length,2);assert.equal(invokes,2);
    assert.match(out.failures[1].code,/SKIPPED_(AUTHORIZATION|SESSION)_CHANGED/);assert.equal(out.complete,false);
  }
});
await test('batch keeps completed file and reports every unstarted ref when shared budget runs out',async()=>{
  const f=fixture();const ref=(await f.run('files','course')).rows[0].resource.resourceRef;
  f.onInvoke(()=>f.advance(60_000));
  const out=await f.run('downloadMany',[ref,ref,ref],'/fixture');
  assert.equal(out.results.length,1);assert.equal(out.failures.length,2);assert.equal(out.remaining.length,2);
  assert.ok(out.failures.every(row=>row.code==='LEARN_DOWNLOAD_NOT_ATTEMPTED_DEADLINE'));
  assert.equal(out.complete,false);assert.equal(out.timedOut,true);assert.equal(f.calls.filter(c=>c[0]==='invoke').length,1);
});
await test('an in-flight native deadline failure is partial with retry refs and no later invoke',async()=>{
  const f=fixture();const ref=(await f.run('files','course')).rows[0].resource.resourceRef;let invokes=0;
  f.onInvoke(()=>{if(++invokes===2)throw Error('LEARN_DOWNLOAD_DEADLINE_EXCEEDED');});
  const out=await f.run('downloadMany',[ref,ref,ref],'/fixture');
  assert.equal(out.results.length,1);assert.equal(out.failures[0].code,'LEARN_DOWNLOAD_DEADLINE_EXCEEDED');
  assert.equal(out.failures[1].code,'LEARN_DOWNLOAD_NOT_ATTEMPTED_DEADLINE');assert.equal(out.remaining.length,2);assert.equal(invokes,2);
});
await test('request deadline includes confirmation time and is shared by all native files',async()=>{
  const f=fixture();const ref=(await f.run('files','course')).rows[0].resource.resourceRef;const deadline=f.now()+110_000;
  f.advance(45_000);f.onInvoke(()=>f.advance(20_000));
  const out=await f.withDeadline('learn.downloadMany',[[ref,ref,ref],'/fixture'],deadline);
  assert.equal(out.complete,true);assert.equal(out.timedOut,false);assert.equal(out.remaining.length,0);
  const calls=f.calls.filter(c=>c[0]==='invoke');assert.equal(calls.length,3);assert.ok(calls.every(c=>c[2].deadlineUnixMs===deadline-1000));
});
await test('expired request never reaches native; batch reports all refs without pretending completion',async()=>{
  const f=fixture();const ref=(await f.run('files','course')).rows[0].resource.resourceRef;
  await assert.rejects(f.withDeadline('learn.download',[ref,'/fixture'],f.now()-1),/DEADLINE_EXCEEDED/);
  const out=await f.withDeadline('learn.downloadMany',[[ref,ref],'/fixture'],f.now());
  assert.equal(out.results.length,0);assert.equal(out.failures.length,2);assert.equal(out.remaining.length,2);assert.equal(out.timedOut,true);
  assert.ok(!f.calls.some(c=>c[0]==='invoke'));
});
await test('deadline cannot exceed native ceiling or be extended by a backward wall-clock adjustment',async()=>{
  const f=fixture();const ref=(await f.run('files','course')).rows[0].resource.resourceRef;const now=f.now();
  await f.withDeadline('learn.download',[ref,'/fixture'],now+600_000);
  assert.equal(f.calls.find(c=>c[0]==='invoke')[2].deadlineUnixMs,now+150_000);
  f.onInvoke(()=>{f.advance(60_000);f.wallShift(-120_000);});
  const out=await f.run('downloadMany',[ref,ref],'/fixture');assert.equal(out.results.length,1);assert.equal(out.timedOut,true);
});
await test('clock rollback between files cannot enlarge the remaining native allowance',async()=>{
  const f=fixture();const ref=(await f.run('files','course')).rows[0].resource.resourceRef;let calls=0;
  f.onInvoke(()=>{if(++calls===1){f.advance(20_000);f.wallShift(-120_000);}});
  const out=await f.run('downloadMany',[ref,ref],'/fixture');assert.equal(out.complete,true);
  const invocations=f.calls.filter(c=>c[0]==='invoke');assert.equal(invocations[0][2].remainingBudgetMs,60_000);assert.equal(invocations[1][2].remainingBudgetMs,40_000);
});
await test('per-request final guard runs after prefetch and blocks revoked task download',async()=>{
  const f=fixture();const ref=(await f.run('files','course')).rows[0].resource.resourceRef;
  let checks=0;
  await assert.rejects(f.withDeadline('learn.download',[ref,'/fixture'],f.now()+110000,async()=>{checks++;throw Error('TASK_CANCELLED');}),/TASK_CANCELLED/);
  assert.equal(checks,1);assert.ok(!f.calls.some(c=>c[0]==='invoke'));
});
await test('task abort forwards its request-specific cancellation to native during a stalled download',async()=>{
  const f=fixture();const ref=(await f.run('files','course')).rows[0].resource.resourceRef;
  const controller=new AbortController();let release;const held=new Promise(resolve=>{release=resolve;});
  f.onInvoke(async args=>{if(args.resourceId){controller.abort();await held;}});
  const running=f.withDeadline('learn.download',[ref,'/fixture'],f.now()+110000,async()=>{},controller.signal);
  for(let i=0;i<60;i++)await Promise.resolve();
  const native=f.calls.find(c=>c[1]==='cli_download_learn_resource'),cancel=f.calls.find(c=>c[1]==='cli_download_cancel');
  assert.ok(native&&cancel);assert.equal(native[2].requestId,cancel[2].requestId);assert.ok(Number.isSafeInteger(native[2].requestId));
  release();await running;
});
await test('an already aborted task never crosses into native',async()=>{
  const f=fixture();const ref=(await f.run('files','course')).rows[0].resource.resourceRef;const controller=new AbortController();controller.abort();
  await assert.rejects(f.withDeadline('learn.download',[ref,'/fixture'],f.now()+110000,async()=>{},controller.signal),/LEARN_DOWNLOAD_CANCELLED/);
  assert.ok(!f.calls.some(c=>c[0]==='invoke'));
});
console.log(`cli-learn-service-test: ${count} groups passed`);
