import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {installFakeCloud} from './lib/fake-cloud.mjs';
const out='docs/onegui/experience-mode';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const checks=[],errors=[];const check=(v,n)=>{assert.ok(v,n);checks.push(n);console.log('✓ '+n);};
const call=(p,path,name,args=[])=>p.evaluate(async({path,name,args})=>{const url=performance.getEntriesByType('resource').map(x=>x.name).find(x=>new URL(x).pathname.endsWith(path));if(!url)throw Error(path);return (await import(url))[name](...args);},{path,name,args});
async function setup(width=1280,height=860){const p=await browser.newPage({viewport:{width,height},hasTouch:width<600});p.setDefaultTimeout(10000);p.on('pageerror',e=>{if(!/reading 'invoke'/.test(e.message))errors.push(e.message);});await installFakeCloud(p);await p.addInitScript(()=>{performance.setResourceTimingBufferSize(10000);localStorage.setItem('onethu.onboarded.phone','1');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>window.__copied=t}});});await p.route('**/src/state/data.ts*',async route=>{const r=await route.fetch();let body=await r.text();for(const n of ['useLearnData','useCampusData'])body=body.replace(`export function ${n}() {`,`export function ${n}() {return {data:{semester:{id:'x'},courses:[],homework:[],notifications:[],files:[],schedule:[]},state:'ready',error:null,reload:async()=>{}};`);await route.fulfill({response:r,body});});await p.goto('http://127.0.0.1:5180/?explorer-preview=home');await p.locator('.explorer-shell').waitFor();await p.waitForTimeout(800);return p;}
const mode=(p,m)=>call(p,'/src/state/experienceMode.ts','setExperienceMode',[m]);const nav=(p,page,params=null)=>call(p,'/src/state/explorer.ts','openTab',[page,params]);
try{
 const p=await setup();
 check(await p.locator('.oneshot button').count()===5,'完整模式五个 OneShot');
 await nav(p,'learn');await nav(p,'life');await p.waitForTimeout(500);
 const saved=await p.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>/explorer|board|oneshot|onepage/.test(k))));
 await mode(p,'simple');await p.locator('.simple-home').waitFor();
 check(JSON.stringify(await p.locator('.oneshot button').allTextContents())===JSON.stringify(['学习','预约','生活','信息','课表']),'极简五个固定入口');
 check(await p.locator('.explorer-topbar,.ex-rail,.onego-bookmarks,.vault-box-button').count()===0,'极简隐藏标签、OneGO 和暂存箱');
 check(await p.locator('.simple-home section').count()===2,'固定首页仅待办和课程');
 await p.screenshot({path:out+'/simple-desktop.png'});
 await p.locator('.oneshot button').nth(4).click();await p.locator('[data-simple-page="schedule"]').waitFor();
 check(await p.locator('.simple-panel .schedule-workspace').isVisible(),'极简课表可导航');
 await p.screenshot({path:out+'/simple-schedule.png'});
 await nav(p,'vault');check(await p.locator('[data-simple-page="schedule"]').count()===1,'完整模式专属页不会泄露到极简');
 await p.getByRole('button',{name:'设置',exact:true}).click();await p.locator('.simple-settings').waitFor();
 check(await p.locator('.settings-seg').count()===0,'极简设置无名片或插件分栏');
 await p.screenshot({path:out+'/simple-settings.png'});
 await p.getByRole('button',{name:'关闭设置',exact:true}).click();await p.waitForTimeout(300);
 await mode(p,'full');await p.waitForTimeout(350);
 const restored=await p.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>/explorer|board|oneshot|onepage/.test(k))));
 console.log('changed stores',Object.keys({...saved,...restored}).filter(k=>saved[k]!==restored[k]).map(k=>({key:k,before:saved[k],after:restored[k]})));check(JSON.stringify(saved)===JSON.stringify(restored),'往返模式和极简导航不改完整存档');
 await call(p,'/src/components/OnboardingTour.tsx','replayOnboarding');await p.getByRole('dialog',{name:'OneTHU 使用导览'}).waitFor();
 await p.getByRole('button',{name:/极简模式/}).click();await p.getByRole('button',{name:'按此模式开始'}).click();
 check(await p.getByRole('heading',{name:'首页，只关心今天'}).isVisible(),'极简导览正确分流');
 await p.getByRole('button',{name:'下一步',exact:true}).click();check(await p.getByRole('heading',{name:'五个入口，直接到达'}).isVisible(),'极简导览精简');
 await p.getByRole('button',{name:'下一步',exact:true}).click();check(await p.getByRole('heading',{name:'需要时，再连接'}).isVisible(),'接入步骤可选');
 await p.getByRole('button',{name:'开始使用',exact:true}).click();await p.waitForTimeout(300);
 await call(p,'/src/components/OnboardingTour.tsx','replayOnboarding');await p.getByRole('button',{name:/完整模式/}).click();await p.getByRole('button',{name:'按此模式开始'}).click();
 for(const title of ['白板，把常用内容放到手边','暂存箱，先收起来再处理','一个短口令，传递一组内容','碰一碰，让内容接力','组织，把人和事情放在一起']){check(await p.getByRole('heading',{name:title}).isVisible(),'完整导览 '+title);await p.getByRole('button',{name:'下一步',exact:true}).click();}
 await p.getByRole('button',{name:'开始使用',exact:true}).click();await p.waitForTimeout(300);
 await nav(p,'contacts',{section:'orgs'});await p.getByRole('button',{name:'新建组织',exact:true}).click();await p.locator('.plg-form-modal input').first().fill('测试组织');await p.getByRole('button',{name:'提交',exact:true}).click();
 const dialog=p.getByRole('dialog',{name:'测试组织',exact:true});await dialog.waitFor();
 await dialog.getByRole('button',{name:'添加成员',exact:true}).click();await p.locator('.plg-form-modal input').first().fill('小明');await p.getByRole('button',{name:'提交',exact:true}).click();check(await dialog.getByText('小明',{exact:true}).isVisible(),'组织成员管理');
 await dialog.getByRole('radio',{name:'项目',exact:true}).click();await dialog.getByRole('button',{name:'新建项目'}).click();await p.locator('.plg-form-modal input').first().fill('迎新活动');await p.getByRole('button',{name:'提交',exact:true}).click();check(await dialog.getByText('迎新活动',{exact:true}).isVisible(),'组织项目创建');
 await dialog.getByRole('radio',{name:'公告',exact:true}).click();await dialog.getByRole('button',{name:'发布公告'}).click();await p.locator('.plg-form-modal input').first().fill('会议安排');await p.locator('.plg-form-modal textarea').fill('周五见');await p.getByRole('button',{name:'提交',exact:true}).click();check(await dialog.getByText('周五见',{exact:true}).isVisible(),'组织公告保存');
 await dialog.getByRole('radio',{name:'组织名片',exact:true}).click();check(await dialog.locator('.identity-card-name').innerText()==='测试组织','组织自动绑定名片');await p.screenshot({path:out+'/organization.png'});
 const state=await call(p,'/src/state/org.ts','orgSnapshot');const o=state.orgs[0];check(!await call(p,'/src/state/org.ts','removeOrgMember',[o.id,o.members[0].id]),'最后一位负责人保护');
 await p.keyboard.press('Escape');await p.waitForTimeout(400);
 await call(p,'/src/state/vault.ts','addToVault',[{type:'text',title:'分享测试',text:'内容'}]);await nav(p,'vault');await p.getByRole('button',{name:'分享口令',exact:true}).click();await p.locator('.vault-share-code').waitFor();
 check(/^ON(-[A-Z0-9]{4}){4}$/.test(await p.locator('.vault-share-code').innerText()),'标签页共享入口生成短口令');await p.keyboard.press('Escape');await p.waitForTimeout(300);
 await p.getByRole('button',{name:/^暂存箱，/}).click();await p.locator('.vault-radar').waitFor();await p.locator('.vault-radar').getByRole('button',{name:'分享口令',exact:true}).click();await p.locator('.vault-share-code').waitFor();check(await p.locator('.vault-share-code').isVisible(),'雷达共享入口生成短口令');await p.keyboard.press('Escape');await p.waitForTimeout(300);
 await p.locator('.vault-radar').getByRole('button',{name:'整理暂存箱'}).click();await p.locator('.vault-sheet').waitFor();await p.locator('.vault-sheet').getByRole('button',{name:'分享口令'}).click();await p.locator('.vault-share-code').waitFor();check(await p.locator('.vault-share-code').isVisible(),'抽屉共享入口生成短口令');
 await p.close();
 for(const width of [390,320]){const p=await setup(width,844);await mode(p,'simple');await p.waitForTimeout(350);const geom=await p.locator('.oneshot button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,right:r.right,bottom:r.bottom,width:r.width,text:e.innerText};}));check(geom.length===5&&geom.every(r=>r.x>=0&&r.right<=width&&r.width>40),width+' 手机五入口可见');check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+' 无横向溢出');await p.screenshot({path:out+'/simple-phone-'+width+'.png'});await p.close();}
 check(errors.length===0,'无新增浏览器错误 '+JSON.stringify(errors));
}finally{writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));await browser.close();}
