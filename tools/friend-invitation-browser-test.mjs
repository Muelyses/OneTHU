/** Two independent browser accounts, actual Contacts controls, isolated ACL fixture. No real cloud requests. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {privateCloudServer,installPrivateCloud} from './lib/private-cloud-fixture.mjs';
const base=process.env.ONETHU_TEST_URL??'http://127.0.0.1:5180';
const out=process.env.ONETHU_TEST_ARTIFACTS??'/Volumes/OneTHUBuild/artifacts/friend-invitation-review';mkdirSync(out,{recursive:true});
const checks=[];const check=(value,label)=>{assert.ok(value,label);checks.push(label);console.log('✓ '+label);};
function fixture(){
 const server=privateCloudServer(),invoke=server.invoke,dirs=new Map(),requests=[];
 server.invoke=async(command,args={})=>{
  requests.push({command,args});
  if(command==='seafile_mkdir'){
   await invoke(command,args);const entries=dirs.get(args.repoId)??new Set();entries.add(args.path);dirs.set(args.repoId,entries);return null;
  }
  if(command==='seafile_share_folder_to_user'){
   assert.equal(args.path,'/','new invitations share their own dedicated library');
   return invoke('seafile_set_repo_user_permission',args);
  }
  if(command==='seafile_dir'){
   await invoke('seafile_repo_owner',args); // The same server ACL applies to listing.
   const repo=server.repos.get(args.repoId),prefix=args.path.replace(/\/+$/,'')+'/';const entries=new Map();
   for(const [path,bytes] of repo.files){
    if(!path.startsWith(prefix))continue;const rest=path.slice(prefix.length);if(!rest)continue;
    const name=rest.split('/')[0],kind=rest.includes('/')?'dir':'file';
    entries.set(name,{name,kind,size:kind==='file'?bytes.length:0,mtime:1});
   }
   for(const path of dirs.get(args.repoId)??[]){if(path.startsWith(prefix)){const name=path.slice(prefix.length).split('/')[0];if(name)entries.set(name,{name,kind:'dir',size:0,mtime:1});}}
   return [...entries.values()];
  }
  return invoke(command,args);
 };
 return {server,requests};
}
async function prepare(browser,server,token,width){
 const page=await browser.newPage({viewport:{width,height:850},isMobile:width<600,hasTouch:width<600});
 await page.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===new URL(base).origin?route.fallback():route.abort();});
 await installPrivateCloud(page,server,token);
 await page.addInitScript(({token,emails})=>{
  localStorage.setItem('onethu.onboarded.flow4','1');localStorage.setItem('onethu.chatdock.open','0');localStorage.setItem('onethu.experience.v1','full');
  const person=(name,email)=>({name,cloudEmail:email,avatar:'',website:'',social:'',phone:'',bio:'用于浏览器验收的测试名片',updatedAt:1});
  localStorage.setItem('onethu.cards.v1',JSON.stringify({v:1,personal:person(token==='owner'?'发起者':'接收者',emails[token]),orgs:[],contacts:token==='owner'?[{id:'ct.reader',kind:'personal',name:'接收者',note:'测试好友',card:person('接收者',emails.reader),addedAt:1}]:[]}));
 },{token,emails:server.emails});
 for(const name of ['friendInbox','friendChannel'])await page.route(`**/src/state/${name}.ts*`,async route=>{
  const response=await route.fetch();const body=(await response.text()).replace(/import \{ invoke \} from [^;]+;/,'const invoke = window.__privateCloudInvoke;');await route.fulfill({response,body});
 });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+(token==='owner'?'/?explorer-preview=page&page=contacts':'/?explorer-preview=home'));
 await page.locator('.explorer-shell').waitFor();await page.waitForTimeout(1200);
 return {page,errors};
}
async function foreground(page){await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));}
const activate=(locator,page)=>page.viewportSize().width<600?locator.tap():locator.click();
async function send(page,text){
 await activate(page.locator('.contact-detail-modal').getByRole('button',{name:'留言',exact:true}),page);
 const form=page.locator('.plg-form-modal');await form.locator('textarea').fill(text);await activate(form.getByRole('button',{name:'提交',exact:true}),page);
 await form.waitFor({state:'detached'});await page.locator('.contact-channel').getByText(text,{exact:true}).waitFor();
}
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});let passed=false;
try{
 for(const width of (process.env.ONETHU_TEST_WIDTHS??'1280,390').split(',').map(Number)){
  const {server,requests}=fixture();const a=await prepare(browser,server,'owner',width),b=await prepare(browser,server,'reader',width);const owner=a.page,reader=b.page;
  await foreground(owner);await activate(owner.getByRole('button',{name:'打开接收者的名片',exact:true}),owner);
  await activate(owner.getByRole('button',{name:'邀请建立好友通道',exact:true}),owner);
  await owner.getByText('已邀请，等待对方接入',{exact:true}).waitFor();
  const channels=()=>[...server.repos].filter(([,repo])=>repo.files.has('/onethu-friend-channel.json'));
  check(channels().length===1,`${width}: the Contacts invite button creates one dedicated shared library`);
  const [repoId,repo]=channels()[0];
  check(repo.grants.get(server.emails.reader)==='rw'&&server.shares.size===0,`${width}: invitation uses recipient account access without a public link`);
  await foreground(reader);
  const inboxButton=reader.locator('.friend-inbox-entry:visible').getByRole('button',{name:'好友邀请 · 1',exact:true});await inboxButton.waitFor();
  check(true,`${width}: returning to the home page foreground discovers the invitation automatically`);
  await reader.screenshot({animations:'disabled',path:`${out}/incoming-home-${width}.png`});
  await activate(inboxButton,reader);await reader.getByRole('button',{name:'接入通道',exact:true}).waitFor();
  await reader.locator('.friend-invitation:visible').getByText(server.emails.owner,{exact:true}).waitFor();
  check(await reader.locator('.friend-invitation:visible').getByText(server.emails.owner,{exact:true}).count()===1,`${width}: global envelope opens the invitation with the verified sender account`);
  await reader.screenshot({animations:'disabled',path:`${out}/incoming-contacts-${width}.png`});
  await activate(reader.getByRole('button',{name:'接入通道',exact:true}),reader);
  await reader.locator('.contact-detail-modal').waitFor();await reader.locator('.contact-channel').waitFor();
  check(await reader.locator('.friend-inbox-entry:visible').count()===0,`${width}: accepting adds the sender card, opens the channel and clears the badge`);
  const incoming=await reader.evaluate(()=>JSON.parse(localStorage.getItem('onethu.cards.v1')).contacts[0]);
  check(incoming.shared.repoId===repoId&&incoming.shared.path==='/'&&channels().length===1,`${width}: both accounts connect to the same library without reciprocal setup`);
  check(repo.files.has('/onethu-friend-accepted.json'),`${width}: acceptance writes a server receipt`);
  await send(reader,'接收者：通道已收到');
  await foreground(owner);await owner.locator('.contact-detail-modal').getByText('已连接',{exact:true}).waitFor();
  check(true,`${width}: sender sees accepted status after returning to foreground`);
  await activate(owner.locator('.contact-detail-modal').getByRole('button',{name:'好友通道',exact:true}),owner);
  await owner.locator('.contact-channel').getByText('接收者：通道已收到',{exact:true}).waitFor();
  check(true,`${width}: sender reads the recipient message in the actual channel UI`);
  await send(owner,'发起者：双向留言正常');
  await foreground(reader);await reader.locator('.contact-channel').getByText('发起者：双向留言正常',{exact:true}).waitFor();
  check(true,`${width}: recipient receives the return message on foreground refresh`);
  await activate(reader.locator('.contact-channel').getByRole('button',{name:'刷新留言',exact:true}),reader);
  check(await reader.locator('.contact-channel').getByText('接收者：通道已收到',{exact:true}).count()===1,`${width}: refreshing does not duplicate the sender's local message`);
  check(await reader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)&&await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: both account layouts fit the viewport`);
  const modal=await reader.locator('.contact-detail-modal').boundingBox();check(modal&&modal.x>=0&&modal.x+modal.width<=width+1,`${width}: the open card/channel modal stays within the screen`);
  await reader.locator('.contact-channel').getByRole('button',{name:'留言',exact:true}).scrollIntoViewIfNeeded();
  await reader.screenshot({animations:'disabled',path:`${out}/connected-channel-${width}.png`});
  check(a.errors.length+b.errors.length===0,`${width}: no runtime errors: ${[...a.errors,...b.errors].join('; ')}`);
  check(requests.filter(r=>r.command==='seafile_set_repo_user_permission').length===1,`${width}: only the sender grants access once`);
  await owner.close();await reader.close();
 }
 passed=true;
}finally{writeFileSync(`${out}/report.json`,JSON.stringify({passed,scope:'Two independent browser contexts, real React controls and server-side ACL fixture; desktop1280 and mobile390 with touch taps. Not real school accounts or Android hardware.',checks},null,2));await browser.close();}
console.log(`${checks.length} friend invitation browser assertions passed`);
