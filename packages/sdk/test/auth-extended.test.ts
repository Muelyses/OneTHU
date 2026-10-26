import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { MemoryCookieJar } from '@onethu/core';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

const directory=await mkdtemp(path.join(os.tmpdir(),'onethu-extended-fixture-'));after(()=>rm(directory,{recursive:true,force:true}));
const outfile=path.join(directory,'extended.mjs');
await build({entryPoints:[fileURLToPath(new URL('../src/services/extended.ts',import.meta.url))],outfile,bundle:true,platform:'node',format:'esm',target:'node20',logLevel:'silent',banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"},plugins:[{name:'offline-mail-only',setup(build){build.onResolve({filter:/^(imapflow|nodemailer|mailparser)$/},args=>({path:args.path,namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='imapflow'?'export const ImapFlow=globalThis.__sdkMailFixture.ImapFlow;':args.path==='nodemailer'?'export default globalThis.__sdkMailFixture.nodemailer;':'export const simpleParser=globalThis.__sdkMailFixture.simpleParser;',loader:'js'}));}}]});
const {createExtendedServices}=await import(pathToFileURL(outfile).href);
function fixture(router:(url:string,init:RequestInit)=>Promise<Response>=async()=>{throw new Error('UNEXPECTED_FIXTURE_NETWORK');}){
  let epoch=0,writes=0;const values=new Map<string,any>(),calls:{url:string;init:RequestInit}[]=[];
  const runtime:any={session:{username:'12345678',state:'ready',fingerprint:'a'.repeat(32),finger3:'',getIdCredentials:()=>null},epoch:()=>epoch,assertCurrent:(old:number)=>{if(old!==epoch)throw Object.assign(new Error('AUTH_SESSION_CHANGED'),{code:'AUTH_SESSION_CHANGED'});},http:{jar:new MemoryCookieJar()},fetch:async(url:string,init:RequestInit={})=>{calls.push({url,init});return router(url,init);}};
  const store={read:async(key:string,fallback:any)=>values.has(key)?structuredClone(values.get(key)):fallback,write:async(key:string,value:any)=>{writes++;values.set(key,structuredClone(value));},flush:async()=>{}};
  const ops=createExtendedServices(runtime,store),ctx={signal:new AbortController().signal,deadline:Date.now()+20000,beforeWrite:async()=>{}};
  return{runtime,values,calls,ops,ctx,key:(name:string)=>`${name}-${createHash('sha256').update(runtime.session.username).digest('hex').slice(0,24)}`,writes:()=>writes,bump(){epoch++;},async run(name:string,args:any[]=[],context=ctx){const op=ops.find((o:any)=>o.name===name);assert.ok(op);return op.run(args,context);}};
}
test('credential configuration is local-only and output contains no cloud token',async()=>{
  const f=fixture(async()=>Response.json({email:'fixture@mails.tsinghua.edu.cn',token:'do-not-return'}));
  for(const name of ['cloud.configure','cloud.disconnect','mail.configure','mail.disconnect','caldav.configure','caldav.disconnect','exthw.configure','exthw.disconnect','visit.connect'])assert.equal(f.ops.find((op:any)=>op.name===name).localOnly,true,name);
  const result=await f.run('cloud.configure',['fixture-token']);assert.deepEqual(result,{configured:true,account:'fixture@mails.tsinghua.edu.cn'});assert.equal(JSON.stringify(await f.run('cloud.status')).includes('fixture-token'),false);assert.equal(new Headers(f.calls[0].init.headers).get('authorization'),'Bearer fixture-token');assert.equal(f.calls[0].init.redirect,'error');
  f.runtime.session.username='87654321';f.bump();assert.equal((await f.run('cloud.status')).configured,false);
});
test('configuration and sharing fail before dispatch when consent or account changes',async()=>{
  const f=fixture();await assert.rejects(f.run('cloud.configure',['fixture-token'],{...f.ctx,beforeWrite:async()=>{throw new Error('CONFIRMATION_CANCELLED');}}),/CONFIRMATION_CANCELLED/);assert.equal(f.calls.length,0);assert.equal(f.writes(),0);
  f.values.set(f.key('cloud'),{token:'fixture-token',email:'fixture@mails.tsinghua.edu.cn'});
  await assert.rejects(f.run('cloud.share',['repo','/notes',7],{...f.ctx,beforeWrite:async()=>{f.bump();}}),{code:'AUTH_SESSION_CHANGED'});assert.equal(f.calls.length,0);
});
test('cloud listing preserves source provenance and one share creates one remote request',async()=>{
  const f=fixture(async(url)=>url.includes('share-links')?Response.json({link:'https://cloud.tsinghua.edu.cn/f/fixture/',token:'private-management-token'}):Response.json([{id:'a',name:'Shared',owner:'another@mails.tsinghua.edu.cn',type:'repo'},{id:'a',name:'duplicate'},{id:'b',name:'Owned',owner:'fixture@mails.tsinghua.edu.cn',type:'repo'}]));f.values.set(f.key('cloud'),{token:'fixture-token',email:'fixture@mails.tsinghua.edu.cn'});
  assert.deepEqual((await f.run('cloud.repos')).map((r:any)=>r.repoType),['shared','mine']);const value=await f.run('cloud.share',['a','/notes',7]);assert.equal(value.token,undefined);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});
test('calendar uses Shanghai wall time and rejects invalid dates before writing',async()=>{
  const f=fixture();const value=await f.run('cal.add',['Fixture event','2026-10-24','08:00','09:00',{local:true}]);assert.equal(value.where,'local');let rows=await f.run('cal.agenda',['2026-10-24','2026-10-24']);assert.equal(rows.length,1);assert.equal(rows[0].start,'08:00');
  await f.run('cal.edit',[value.uid,{title:'Changed',start:'08:30'}]);rows=await f.run('cal.agenda',['2026-10-24','2026-10-24']);assert.equal(rows[0].start,'08:30');assert.equal(rows[0].title,'Changed');
  await assert.rejects(f.run('cal.add',['invalid','2026-02-30','08:00','09:00',{local:true}]),{code:'CAL_DATE_INVALID'});await f.run('cal.remove',[value.uid]);assert.deepEqual(await f.run('cal.agenda',['2026-10-24','2026-10-24']),[]);assert.equal(f.calls.length,0);
});
test('CalDAV discovery retains manual redirects and refuses an external credential target',async()=>{
  const f=fixture(async()=>new Response('',{status:302,headers:{location:'https://outside.invalid/stolen/'}}));
  await assert.rejects(f.run('caldav.configure',['fixture@mails.tsinghua.edu.cn','fixture-auth-code']),/其他站点/);assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.redirect,'manual');assert.equal(f.writes(),0);
});
test('CalDAV event edit preserves and submits the current etag',async()=>{
  const root='https://mails.tsinghua.edu.cn';const ics='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:fixture\r\nDTSTART:20261024T000000Z\r\nDTEND:20261024T010000Z\r\nSUMMARY:Old\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const f=fixture(async(url,init)=>{
    const p=new URL(url).pathname;
    if(init.method==='PUT')return new Response(null,{status:204,headers:{etag:'"version-2"'}});
    if(p==='/.well-known/caldav')return new Response('',{status:302,headers:{location:'/dav/'}});
    if(p==='/dav/')return new Response('<D:multistatus xmlns:D="DAV:"><D:response><D:calendar-home-set><D:href>/home/</D:href></D:calendar-home-set></D:response></D:multistatus>',{status:207});
    if(p==='/home/')return new Response('<D:multistatus xmlns:D="DAV:"><D:response><D:href>/home/default/</D:href><D:displayname>Calendar</D:displayname><D:calendar/></D:response></D:multistatus>',{status:207});
    if(p==='/home/default/')return new Response('<D:multistatus xmlns:D="DAV:"><D:response><D:href>/home/default/fixture.ics</D:href><D:getetag>"version-1"</D:getetag></D:response></D:multistatus>',{status:207});
    assert.equal(url,root+'/home/default/fixture.ics');return new Response(ics);
  });f.values.set(f.key('mail'),{email:'fixture@mails.tsinghua.edu.cn',authCode:'fixture-auth'});
  await f.run('cal.edit',['fixture',{title:'Updated'}]);const put=f.calls.find(c=>c.init.method==='PUT');assert.ok(put);assert.equal(new Headers(put.init.headers).get('if-match'),'"version-1"');assert.match(String(put.init.body),/SUMMARY:Updated/);
});
test('external homework without a configured source returns an explicit incomplete snapshot',async()=>{const f=fixture();const result=await f.run('exthw.refresh');assert.equal(result.configured,false);assert.equal(result.complete,false);assert.deepEqual(result.items,[]);assert.equal(f.calls.length,0);});
test('visit.fill stays a private draft and cannot submit or open a GUI',async()=>{const f=fixture();const value=await f.run('visit.fill',[{visitDate:'2026-10-24',confirmed:true}]);assert.equal(value.submit,false);assert.equal((await f.run('visit.draft')).confirmed,false);await assert.rejects(f.run('visit.fill',[{}, {open:true}]),{code:'GUI_OPERATION_UNAVAILABLE'});assert.equal(f.calls.length,0);});

const mailState={readOnly:false,connects:0,closed:0,sends:0,sendThrows:false,imapOptions:null as any,smtpOptions:null as any};
(globalThis as any).__sdkMailFixture={
  ImapFlow:class {constructor(options:any){mailState.imapOptions=options;}on(){}async connect(){mailState.connects++;}close(){mailState.closed++;}async mailboxOpen(_folder:string,opts:any){mailState.readOnly=opts.readOnly;return{exists:2};}async *fetch(){yield{uid:1,envelope:{subject:'Fixture'},flags:new Set()};}async fetchOne(){return{size:10};}async download(){return{content:Readable.from([Buffer.from('Fixture')])};}},
  nodemailer:{createTransport(options:any){mailState.smtpOptions=options;return{close(){},async sendMail(){mailState.sends++;if(mailState.sendThrows)throw new Error('secret auth code must not escape');return{accepted:['to@example.test'],rejected:[],messageId:'fixture-message'};}};}},
  simpleParser:async()=>({subject:'Fixture',text:'Body',attachments:[]}),
};
test('mail.read uses a read-only mailbox and safe TLS with no seen mutation',async()=>{const f=fixture();f.values.set(f.key('mail'),{email:'fixture@mails.tsinghua.edu.cn',authCode:'fixture-auth'});const result=await f.run('mail.read',['INBOX',1]);assert.equal(result.markedSeen,false);assert.equal(mailState.readOnly,true);assert.equal(mailState.imapOptions.secure,true);assert.equal(mailState.imapOptions.tls.rejectUnauthorized,true);assert.equal(mailState.imapOptions.logger,false);assert.equal(result.text,'Body');});
test('SMTP failure is a single attempt with unknown outcome and no secret in its error',async()=>{const f=fixture();f.values.set(f.key('mail'),{email:'fixture@mails.tsinghua.edu.cn',authCode:'fixture-auth'});mailState.sendThrows=true;const before=mailState.sends;await assert.rejects(f.run('mail.send',['to@example.test','','Fixture','Body']),{code:'MAIL_SEND_OUTCOME_UNKNOWN'});assert.equal(mailState.sends-before,1);assert.equal(mailState.smtpOptions.secure,true);assert.equal(mailState.smtpOptions.tls.rejectUnauthorized,true);});
