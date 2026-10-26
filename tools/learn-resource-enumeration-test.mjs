/** Synthetic LearnClient transport. No school request, account, or local file download. */
import assert from 'node:assert/strict';
import { HttpClient } from '../packages/core/src/http.ts';
import { LearnClient } from '../packages/core/src/learn/client.ts';
import { LearnEnumerationError, collectLearnOffsetPages, collectLearnSizePages, readLearnTotal } from '../packages/core/src/learn/pagination.ts';
globalThis.fetch = async () => { throw Error('Live network forbidden'); };
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('✓ ' + name); }
const rows = (n, prefix='r') => Array.from({length:n}, (_,i)=>({id:`${prefix}${i}`}));
const id = row => row.id;
const fails = kind => e => e instanceof LearnEnumerationError && e.code === 'LEARN_ENUMERATION_INCOMPLETE' && e.complete === false && e.kind === kind;
function fixture(handler) {
  const calls=[];
  const http=new HttpClient({fetch:async(url, init)=>{
    if(url.includes('/wengine-vpn/cookie')) return new Response('');
    calls.push({url,init});
    const body=await handler(url,init);
    return body instanceof Response ? body : new Response(JSON.stringify(body));
  }});
  const client=new LearnClient(http); client.applyCsrf('fixture');
  return {client,calls};
}
await test('metadata prefers filtered total, never synthesizes count, rejects malformed totals',async()=>{
  assert.equal(readLearnTotal({object:{iTotalDisplayRecords:'7',iTotalRecords:10}},'test'),7);
  assert.equal(readLearnTotal({object:{aaData:[]},iTotalRecords:0},'test'),0);
  assert.equal(readLearnTotal({object:[],count:200},'test'),null);
  for(const value of [-1,NaN,1.2,'12abc','',Infinity,{},true]) assert.throws(()=>readLearnTotal({total:value},'test'),fails('invalid-total'));
});
await test('files grow verified prefixes beyond the old 200-row cap and retain resource metadata',async()=>{
  const files=rows(501,'file').map(x=>({wjid:x.id,bt:'第一讲',wjlx:'.pdf',fileSize:'2 MB',scsj:'2026-10-24'}));
  const f=fixture(url=>({object:files.slice(0,Number(new URL(url).searchParams.get('size')))}));
  const out=await f.client.getFileList('course-A');
  assert.equal(out.length,501);
  assert.deepEqual(f.calls.map(c=>new URL(c.url).searchParams.get('size')),['200','400','800']);
  assert.equal(out[500].id,'file500'); assert.equal(out[0].fileType,'pdf');
  assert.equal(out[0].courseId,'course-A'); assert.match(out[0].downloadUrl,/wjid=file0/);
});
await test('file server total proves exactly 200 items in one request',async()=>{
  const f=fixture(()=>({object:rows(200).map(x=>({wjid:x.id})),iTotalRecords:200}));
  assert.equal((await f.client.getFileList('course')).length,200); assert.equal(f.calls.length,1);
});
await test('a total supplied on the larger file request proves completion of an unchanged prefix',async()=>{
  const out=await collectLearnSizePages('files',async size=>({rows:rows(2),total:size===2?null:2}),id,2,8);
  assert.equal(out.length,2);
});
await test('size-ignoring file server reports its unproven cap instead of silent success',async()=>{
  const f=fixture(()=>({object:rows(200).map(x=>({wjid:x.id}))}));
  await assert.rejects(f.client.getFileList('course'),fails('repeated-page')); assert.equal(f.calls.length,2);
});
await test('files reject changing prefix, duplicate IDs, missing IDs, and server totals that shrink',async()=>{
  await assert.rejects(collectLearnSizePages('files',async n=>({rows:n===2?rows(2):rows(3).reverse(),total:null}),id,2,8),fails('snapshot-changed'));
  await assert.rejects(collectLearnSizePages('files',async()=>({rows:[{id:'a'},{id:'a'}],total:2}),id,2,8),fails('duplicate-id'));
  await assert.rejects(collectLearnSizePages('files',async()=>({rows:[{id:''}],total:null}),id,2,8),fails('missing-id'));
  await assert.rejects(collectLearnSizePages('files',async n=>({rows:rows(n),total:n===2?6:5}),id,2,8),fails('snapshot-changed'));
});
await test('file maximum and declared-over-limit fail with explicit incomplete metadata',async()=>{
  await assert.rejects(collectLearnSizePages('files',async n=>({rows:rows(n),total:null}),id,2,8),e=>fails('limit-exceeded')(e)&&e.fetched===8&&e.total===null);
  await assert.rejects(collectLearnSizePages('files',async()=>({rows:[],total:9}),id,2,8),e=>fails('limit-exceeded')(e)&&e.total===9);
});
await test('empty file lists remain authoritative',async()=>{
  for(const object of [[],{aaData:[]},{resultsList:[]}]) {
    const f=fixture(()=>({object})); assert.deepEqual(await f.client.getFileList('course'),[]); assert.equal(f.calls.length,1);
  }
});
await test('notifications advance real offsets past 50 with total and preserve full HTML/IDs',async()=>{
  const notices=rows(123,'notice').map((x,i)=>({ggid:x.id,wlkcid:'course',bt:'公告',ggnr:Buffer.from('<p>正文</p>').toString('base64'),fbsj:`2026-10-${String(i%20+1).padStart(2,'0')}`}));
  const offsets=[];
  const f=fixture((url,init)=>{
    assert.match(url,/pageListXsbyWgq/);
    const p=Object.fromEntries(JSON.parse(init.body.get('aoData')).map(x=>[x.name,x.value])); offsets.push(p.iDisplayStart);
    return {object:{aaData:notices.slice(p.iDisplayStart,p.iDisplayStart+p.iDisplayLength),iTotalDisplayRecords:notices.length}};
  });
  const out=await f.client.getNotificationList('course');
  assert.equal(out.length,123); assert.deepEqual(offsets,[0,50,100]);
  assert.equal(new Set(out.map(x=>x.id)).size,123); assert.equal(out[0].content,'<p>正文</p>');
  assert.ok(out.every(x=>x.courseId==='course'));
});
await test('expired notices enumerate separately, legacy aggregate sorts and deduplicates input course IDs',async()=>{
  const f=fixture((url,init)=>{
    assert.match(url,/pageListXsbyYgq/);
    const p=Object.fromEntries(JSON.parse(init.body.get('aoData')).map(x=>[x.name,x.value]));
    return {object:[{ggid:'one',wlkcid:p.wlkcid,fbsj:p.wlkcid==='A'?'2026-10-23':'2026-10-24'}]};
  });
  const out=await f.client.getAllNotifications(['A','B','A'],true);
  assert.equal(out.length,2); assert.equal(out[0].courseId,'B'); assert.equal(f.calls.length,2);
});
await test('notification pages without totals use a terminal short page, including empty exact-boundary probe',async()=>{
  for(const n of [0,20,50,100,123]) {
    const all=rows(n); const offsets=[];
    const out=await collectLearnOffsetPages('notices',async(offset,limit)=>{offsets.push(offset);return{rows:all.slice(offset,offset+limit),total:null};},id);
    assert.equal(out.length,n); assert.equal(offsets.length,Math.floor(n/50)+1);
  }
});
await test('explicit totals support a smaller server page cap by advancing by actual returned rows',async()=>{
  const all=rows(73); const offsets=[];
  const out=await collectLearnOffsetPages('notices',async offset=>{offsets.push(offset);return{rows:all.slice(offset,offset+20),total:73};},id);
  assert.equal(out.length,73); assert.deepEqual(offsets,[0,20,40,60]);
});
await test('repeat pages and overlapping pages are detected before another request',async()=>{
  let calls=0;
  await assert.rejects(collectLearnOffsetPages('notices',async()=>{calls++;return{rows:rows(50),total:100};},id),fails('repeated-page'));
  assert.equal(calls,2);
  await assert.rejects(collectLearnOffsetPages('notices',async offset=>({rows:rows(100).slice(offset?49:0,offset?99:50),total:100}),id),fails('repeated-page'));
});
await test('offset enumeration rejects premature empty pages, total drift, duplicate IDs and limits',async()=>{
  await assert.rejects(collectLearnOffsetPages('notices',async offset=>({rows:offset?[]:rows(50),total:100}),id),fails('incomplete-page'));
  await assert.rejects(collectLearnOffsetPages('notices',async offset=>({rows:rows(50,`${offset}-`),total:offset?110:100}),id),fails('snapshot-changed'));
  await assert.rejects(collectLearnOffsetPages('notices',async()=>({rows:[{id:'a'},{id:'a'}],total:2}),id),fails('duplicate-id'));
  await assert.rejects(collectLearnOffsetPages('notices',async offset=>({rows:rows(2,`${offset}-`),total:null}),id,2,4),fails('limit-exceeded'));
});
await test('upstream failures after a successful page propagate without publishing a partial list',async()=>{
  const f=fixture((url,init)=>{
    const p=Object.fromEntries(JSON.parse(init.body.get('aoData')).map(x=>[x.name,x.value]));
    return p.iDisplayStart ? new Response('Unavailable',{status:503}) : {object:rows(50).map(x=>({ggid:x.id}))};
  });
  await assert.rejects(f.client.getNotificationList('course'),/503/); assert.equal(f.calls.length,2);
});
await test('invalid response containers stay errors instead of valid empty enumerations',async()=>{
  for(const method of ['getFileList','getNotificationList']) await assert.rejects(fixture(()=>({unrelated:[]})).client[method]('course'),/LEARN_RESPONSE_UNEXPECTED/);
});
await test('homework keeps all attachment roles, multiple files and legacy first-slot compatibility',async()=>{
  const attachment=(id,quote='"')=>`<a href=${quote}/b/download?fileId=${id}${quote}>${id}.pdf</a>`;
  const block=contents=>`<div class="list fujian clearfix">${contents}</div>`;
  const page=extra=>`<html>${block(attachment('teacher1')+attachment('teacher2',"'")+extra)}${block(attachment('answer'))}${block(attachment('submission'))}${block(attachment('grade'))}</html>`;
  const f=fixture(url=>new Response(page(url.includes('viewCj')?attachment('teacher3'):'')));
  const detail=await f.client.getHomeworkPageDetail('course','hw');
  assert.equal(detail.attachment.id,'teacher1'); assert.equal(detail.answerAttachment.id,'answer');
  assert.equal(detail.submittedAttachment.id,'submission'); assert.equal(detail.gradeAttachment.id,'grade');
  assert.equal(detail.attachments.length,6); assert.equal(detail.attachments.filter(x=>x.role==='teacher').length,3);
});
await test('homework page description uses the upstream calendar body, retaining nested HTML and excluding the answer',async()=>{
  const block=body=>`<div class="list clearfix calendar"><div class="left">Label</div><div class="right fl"><div class="c55">${body}</div></div></div>`;
  const f=fixture(()=>new Response(`<html><div class="outer">${block('<p>Task <b>HTML</b></p><div>Nested</div>')}${block('Answer must not replace task')}</div></html>`));
  const detail=await f.client.getHomeworkPageDetail('course','hw');assert.equal(detail.description,'<p>Task <b>HTML</b></p><div>Nested</div>');
});
await test('an empty verified homework body differs from a missing or unclosed description block',async()=>{
  for(const [body,expected] of [
    ['<div class="list calendar clearfix"><div class="fl right"><div class="c55"></div></div></div>',''],
    ['<div class="boxbox"><div class="c55">Submission</div></div>',undefined],
    ['<div class="list calendar clearfix"><div class="fl right"><div class="c55">Unclosed',undefined],
  ]) {
    const f=fixture(()=>new Response(`<html>${body}</html>`));assert.equal((await f.client.getHomeworkPageDetail('course','hw')).description,expected);
  }
});
await test('homework and announcement detail requests carry CSRF, using student IDs for pages and base ID for JSON',async()=>{
  const f=fixture((url,init)=>{
    const u=new URL(url);assert.equal(u.searchParams.get('_csrf'),'fixture');
    if(u.pathname.endsWith('/detail')) {assert.equal(init.body.get('id'),'base-id');return{result:'success',msg:'&lt;p&gt;Task&lt;/p&gt;'};}
    if(/viewCj|tijiao/.test(u.pathname)) {assert.equal(u.searchParams.get('xszyid'),'student-id');assert.equal(u.searchParams.get('wlkcid'),'course-id');}
    return new Response('<html><textarea name="zynr"></textarea></html>');
  });
  assert.equal((await f.client.getHomeworkDetail('base-id')).description,'<p>Task</p>');
  await f.client.getHomeworkPageDetail('course-id','student-id');await f.client.getNotificationPageDetail('course-id','notice-id');
  assert.equal(f.calls.length,4);
});
await test('homework JSON must contain a description field; a verified empty string remains valid',async()=>{
  for(const body of [{},{result:'success',unrelated:'text'}]) await assert.rejects(fixture(()=>body).client.getHomeworkDetail('base'),e=>e.code==='LEARN_RESPONSE_UNEXPECTED'&&e.kind==='invalid-homework-description');
  assert.equal((await fixture(()=>({result:'success',msg:''})).client.getHomeworkDetail('base')).description,'');
});
await test('read-only homework uses a valid grade page even when the submission route is a gateway page',async()=>{
  const guide='<html><script>var __vpn_hostname_data="vpn", __vpn_app_hostname_data="learn";</script></html>';
  const page='<html><div class="list calendar clearfix"><div class="fl right"><div class="c55"><p>Read-only body</p></div></div></div><div class="list fujian clearfix"><a href="/b/download?fileId=teacher">Teacher.pdf</a></div></html>';
  const f=fixture(url=>new Response(url.includes('viewCj')?page:guide));
  const detail=await f.client.getHomeworkReadDetail('course','student');
  assert.equal(detail.description,'<p>Read-only body</p>');assert.equal(detail.attachments.length,1);assert.equal(detail.attachments[0].role,'teacher');assert.equal('hasSubmitForm' in detail,false);
  assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.includes('viewCj'));
  await assert.rejects(f.client.getHomeworkPageDetail('course','student'),e=>e.kind==='webvpn-guide'&&e.stage==='homework-submit-page');
});
await test('unavailable grade pages stay failures in read-only mode, regardless of a working submission page',async()=>{
  for(const response of [
    new Response('<html><script>var __vpn_hostname_data="vpn", __vpn_app_hostname_data="learn";</script></html>'),
    new Response('Unavailable',{status:503}),
    new Response('<html><p>The requested assignment is unavailable</p></html>'),
  ]) {
    const f=fixture(url=>url.includes('viewCj')?response:new Response('<html><textarea name="zynr"></textarea></html>'));
    await assert.rejects(f.client.getHomeworkReadDetail('course','student'),e=>e.stage==='homework-grade-page');
    assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.includes('viewCj'));
  }
});
await test('a recognized empty read-only homework page confirms empty visible attachments without checking a submit form',async()=>{
  const f=fixture(()=>new Response('<html><div class="list calendar clearfix"><div class="fl right"><div class="c55"></div></div></div></html>'));
  const out=await f.client.getHomeworkReadDetail('course','student');assert.equal(out.description,'');assert.deepEqual(out.attachments,[]);assert.equal('hasSubmitForm' in out,false);
});
await test('notification keeps multiple attachments, filters navigation, and decodes escaped URL parameters',async()=>{
  const f=fixture(()=>new Response(`<html><a class="ml-10" href="/f/navigation">Navigation</a><a href="/b/download?wjid=a&amp;downloadUrl=%2Fb%2Fdownload%3Fwjid%3Da">A.pdf</a><a href='/b/download?wjid=b'>B.pdf</a><a href="/bbs/thread?wjid=unrelated">Discussion</a></html>`));
  const detail=await f.client.getNotificationPageDetail('course','notice');
  assert.equal(detail.attachment.id,'a'); assert.deepEqual(detail.attachments.map(x=>x.id),['a','b']);
  assert.ok(!detail.attachment.downloadUrl.includes('amp;'));
});
await test('notification download labels use the original list filename with its extension',async()=>{
  for(const label of ['下载','下载附件','Download','Download file']) {
    const f=fixture(()=>new Response(`<html><a class="ml-10" href="/b/download?wjid=file">${label}</a></html>`));
    const detail=await f.client.getNotificationPageDetail('course','notice','实验说明 &amp; 数据.zip');
    assert.equal(detail.attachment.name,'实验说明 & 数据.zip');
    assert.equal(detail.attachments[0].name,'实验说明 & 数据.zip');
  }
});
await test('attachment filenames in link attributes remain distinct and real link names take precedence',async()=>{
  const f=fixture(()=>new Response(`<html><a download="第一份.pdf" href="/b/download?wjid=a">下载</a><a href="/b/download?wjid=b" title="第二份.xlsx">Download</a><a href="/b/download?wjid=c" title="点击下载">第三份.docx</a></html>`));
  const detail=await f.client.getNotificationPageDetail('course','notice','不能套给所有附件.zip');
  assert.deepEqual(detail.attachments.map(row=>row.name),['第一份.pdf','第二份.xlsx','第三份.docx']);
});
console.log(`learn-resource-enumeration-test: ${count} groups passed`);
