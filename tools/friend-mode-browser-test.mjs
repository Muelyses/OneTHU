/** Mode isolation using real React controls and two browser accounts behind an ACL fixture. No live school services. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {privateCloudServer,installPrivateCloud} from './lib/private-cloud-fixture.mjs';
const base=process.env.ONETHU_TEST_URL??'http://127.0.0.1:5180';
const out=process.env.ONETHU_TEST_ARTIFACTS??'/Volumes/OneTHUBuild/artifacts/friend-mode-isolation';mkdirSync(out,{recursive:true});
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
 page.onethuModules=new Map(); page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/src/'))page.onethuModules.set(u.pathname,r.url());});
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
 await page.clock.install();
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
const call = (page, path, name, args = []) => {
 const url = page.onethuModules.get(path);
 if (!url) throw Error(`Module not loaded: ${path}`);
 return page.evaluate(async ({ url, name, args }) => (await import(url))[name](...args), { url, name, args });
};
const modeNames = { full: '完整模式', simple: '极简模式', practical: '实用模式' };
async function changeMode(page, mode, { direct = false } = {}) {
 await foreground(page);
 if (direct) await call(page, '/src/state/experienceMode.ts', 'setExperienceMode', [mode]);
 else {
  await call(page, '/src/state/explorer.ts', 'openSettings', ['settings']);
  const control = page.locator('.experience-mode-control:visible');
  await activate(control.locator('.experience-mode-summary button'), page);
  const option = control.getByRole('button', { name: modeNames[mode], exact: true });
  await option.scrollIntoViewIfNeeded(); await activate(option, page);
  await activate(page.getByRole('button', { name: '关闭设置', exact: true }), page);
 }
 await page.waitForFunction(mode => document.documentElement.dataset.experience === mode, mode);
 await page.waitForTimeout(350);
}
const persistentState = page => page.evaluate(() => Object.fromEntries(
 ['onethu.cards.v1', 'onethu.friendMsgs.v1'].map(key => [key, localStorage.getItem(key)])));
const readerCalls = requests => requests.filter(r => r.args.token === 'reader' && /seafile_(account|repos|dir|read_bytes|upload_text)/.test(r.command));
async function compactCheck(page, requests, width, mode, label) {
 const before = readerCalls(requests).length;
 await page.evaluate(() => {
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new Event('visibilitychange'));
 });
 // Execute real registered 15s/30s timers without waiting half a minute per case.
 await page.clock.fastForward(31_000); await page.waitForTimeout(200);
 check(readerCalls(requests).length === before, `${width}/${mode}/${label}: foreground, online and 31 seconds of timers make zero friend/cloud calls`);
 check(await page.locator('.contact-cabinet').count() > 0, `${width}/${mode}/${label}: full-mode Contacts remains mounted, exercising the hidden-tab case`);
 check(await page.locator('.friend-inbox-entry:visible,.friend-invitations:visible,.contact-detail-modal:visible,.contact-channel:visible').count() === 0,
  `${width}/${mode}/${label}: no invitation, card portal or channel leaks into compact mode`);
 check(await page.locator('.simple-home').isVisible(), `${width}/${mode}/${label}: home remains usable rather than blank or an error page`);
 check(!/好友通道邀请|friend channel invitation/i.test(await page.locator('.toast-host').allTextContents().then(t => t.join(' '))), `${width}/${mode}/${label}: no friend invitation toast remains`);
 await page.screenshot({ animations: 'disabled', path: `${out}/${label}-${mode}-${width}.png` });
}
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let passed=false; const errors=[];
try {
 for (const width of (process.env.ONETHU_TEST_WIDTHS ?? '1280,390').split(',').map(Number)) {
  const {server,requests}=fixture(); const a=await prepare(browser,server,'owner',width), b=await prepare(browser,server,'reader',width);
  const owner=a.page, reader=b.page;
  try {
   await call(reader, '/src/state/explorer.ts', 'openTab', ['contacts', { section: 'cards' }]);
   await reader.locator('.friend-invitations:visible').waitFor();
   const original = await persistentState(reader);
   await changeMode(reader, 'simple');
   await foreground(owner); await activate(owner.getByRole('button',{name:'打开接收者的名片',exact:true}),owner);
   await activate(owner.getByRole('button',{name:'邀请建立好友通道',exact:true}),owner);
   await owner.getByText('已邀请，等待对方接入',{exact:true}).waitFor();
   check([...server.repos.values()].some(repo => repo.files.has('/onethu-friend-channel.json') && repo.grants.has(server.emails.reader)), `${width}: another account really publishes an incoming invitation while reader is compact`);
   for (const mode of ['simple','practical']) {
    if (mode !== 'simple') await changeMode(reader, mode);
    await foreground(reader); await compactCheck(reader,requests,width,mode,'invitation');
    check(JSON.stringify(await persistentState(reader)) === JSON.stringify(original), `${width}/${mode}: incoming request does not alter contacts or message history`);
   }
   await changeMode(reader, 'full');
   await reader.locator('.friend-invitation:visible').waitFor();
   await reader.locator('.toast-host').filter({hasText:'好友通道邀请'}).waitFor();
   check(true, `${width}: full mode resumes discovery and invitation notification`);
   await changeMode(reader,'simple');
   check(!/好友通道邀请/.test((await reader.locator('.toast-host').allTextContents()).join(' ')), `${width}: switching away dismisses the existing friend invitation toast`);
   await changeMode(reader,'full');
   await activate(reader.getByRole('button',{name:'接入通道',exact:true}),reader);
   await reader.locator('.contact-detail-modal:visible').waitFor(); await reader.locator('.contact-channel:visible').waitFor();
   const contact = await reader.evaluate(() => JSON.parse(localStorage.getItem('onethu.cards.v1')).contacts[0]);
   check(!!contact?.shared?.acceptedAt, `${width}: the invitation is still usable when full mode resumes`);
   await foreground(owner); await owner.locator('.contact-detail-modal').getByText('已连接',{exact:true}).waitFor();
   await activate(owner.locator('.contact-detail-modal').getByRole('button',{name:'好友通道',exact:true}),owner);
   for (const mode of ['simple','practical']) {
    const before = await persistentState(reader);
    // Keep an open full-mode card to exercise its body-portal and active message poll.
    await changeMode(reader,mode,{direct:true});
    await foreground(owner); const text=`模式隔离 ${mode} ${width}`; await send(owner,text);
    await foreground(reader); await compactCheck(reader,requests,width,mode,'message');
    check(JSON.stringify(await persistentState(reader)) === JSON.stringify(before), `${width}/${mode}: receiving is suspended without deleting or modifying saved friend data`);
    await changeMode(reader,'full');
    check(!await reader.getByRole('button',{name:'关闭设置',exact:true}).isVisible(), `${width}/${mode}: Settings closes by a real click after switching back to full`);
    if (!await reader.locator('.contact-detail-modal:visible').count()) {
     await activate(reader.getByRole('button',{name:`打开${contact.name}的名片`,exact:true}),reader);
    }
    if (!await reader.locator('.contact-channel:visible').count()) {
     await activate(reader.locator('.contact-detail-modal').getByRole('button',{name:'好友通道',exact:true}),reader);
    }
    await reader.locator('.contact-channel:visible').getByText(text,{exact:true}).waitFor();
    check(true,`${width}/${mode}: restoring full mode keeps Settings usable and the existing card receives the pending message once`);
    check(await reader.locator('.contact-channel:visible').getByText(text,{exact:true}).count()===1,`${width}/${mode}: resumed message is not duplicated`);
   }
   check(a.errors.length+b.errors.length===0,`${width}: no React/browser errors throughout delivery and mode switches: ${[...a.errors,...b.errors].join('; ')}`);
   check(await reader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: restored full-mode card fits the viewport`);
   await reader.screenshot({animations:'disabled',path:`${out}/restored-full-${width}.png`});
  } catch(error) { await reader.screenshot({animations:'disabled',path:`${out}/failure-${width}.png`}).catch(()=>{}); throw error; }
  finally { errors.push(...a.errors,...b.errors); await owner.close(); await reader.close(); }
 }
 passed=true;
} catch(error) { errors.push(String(error)); throw error; }
finally {
 writeFileSync(`${out}/report.json`,JSON.stringify({passed,scope:'Real React settings clicks and mobile touch taps in two independent browser accounts with isolated server-side ACL fixture. Real interval callbacks advanced by Playwright clock; no school accounts or Android hardware.',checks,errors},null,2));
 await browser.close();
}
console.log(`${checks.length} friend mode browser assertions passed`);
