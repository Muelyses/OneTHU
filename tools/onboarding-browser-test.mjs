import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { walkFullOnboarding, resumeWithKeyboard, closeTestBrowser, advanceOnboardingLanguage } from './lib/onboarding-browser-steps.mjs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-updater-scheduler']});
let count=0;
const check=(value,label)=>{assert.ok(value,label);count++;console.log('✓ '+label);};
try {
 for(const width of [1280,390]) {
  const page=await browser.newPage({viewport:{width,height:860},hasTouch:width<600});
  page.setDefaultTimeout(12000);
  // Keep this walkthrough stable while parallel workers edit the dev-server sources.
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/,()=>{});
  const errors=[];page.on('pageerror',e=>{if(!/reading 'invoke'/.test(e.message))errors.push(e.message);});
  await installFakeCloud(page);
  await page.addInitScript(()=>{localStorage.setItem('onethu.onboarded.phone','1');localStorage.setItem('onethu.overlay.closed','1');});
  await page.goto('http://127.0.0.1:5180/?explorer-preview=onboarding');
  await page.locator('.explorer-shell').waitFor();
  const tour=page.getByRole('dialog',{name:'OneTHU 使用导览'});
  const replay=async mode=>{await page.evaluate(()=>window.dispatchEvent(new Event('onethu.onboarding.replay')));await tour.waitFor();await advanceOnboardingLanguage(page);await tour.getByRole('button',{name:mode+'模式',exact:true}).click();await tour.getByRole('button',{name:'按此模式开始'}).click();};
  await replay('完整');
  await walkFullOnboarding(page,check);
  await tour.getByRole('switch',{name:'OH MCP 服务器开关'}).click();
  const mcpPrefs=await page.evaluate(()=>localStorage.getItem('onethu.userext.v1'));
  await tour.getByRole('button',{name:'开始使用',exact:true}).click();
  for(const mode of ['极简','实用']) {
   await replay(mode);
   await tour.getByRole('heading',{name:'首页，只关心今天'}).waitFor();
   await tour.getByRole('button',{name:'下一步',exact:true}).click();
   if(mode==='实用') {
    await tour.getByRole('button',{name:'展开更多功能',exact:true}).click();
    const more=page.getByRole('dialog',{name:'更多功能',exact:true});await more.waitFor();
    check(await more.getByRole('textbox',{name:'搜索功能'}).isVisible(),width+' 实用导览打开真实功能目录');
    await resumeWithKeyboard(page,more,check,width+' 实用更多功能');await more.waitFor({state:'hidden'});
    await tour.getByRole('button',{name:'下一步',exact:true}).click();
   }
   await tour.getByRole('button',{name:'下一步',exact:true}).click();
   await tour.getByRole('heading',{name:'需要时，再连接'}).waitFor();
   check(await tour.getByRole('switch',{name:'OH MCP 服务器开关'}).count()===0,width+' '+mode+'导览不暴露高级 MCP 开关');
   await tour.getByRole('button',{name:'开始使用',exact:true}).click();
  }
  await replay('完整');
  for(let i=0;i<5;i++)await tour.getByRole('button',{name:'下一步',exact:true}).click();
  await tour.locator('[data-lesson-id="customize"]').click();
  await tour.getByRole('button',{name:'打开外观设置',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'我的',exact:true});
  await settings.getByRole('button',{name:'切换模式',exact:true}).click();
  await settings.getByRole('button',{name:'实用模式',exact:true}).click();
  await tour.getByRole('heading',{name:'首页，只关心今天',exact:true}).waitFor();
  check(await tour.locator('.tour-shell').getAttribute('data-tour-mode')==='practical' && await tour.locator('.tour-shell').getAttribute('data-lesson')==='today',width+' 体验中切换模式后导览跟随新模式');
  await tour.getByRole('button',{name:'跳过导览',exact:true}).click();
  check(await page.evaluate(()=>localStorage.getItem('onethu.userext.v1'))===mcpPrefs,width+' 切换精简导览保留完整模式 MCP 偏好');
  check(await page.evaluate(()=>localStorage.getItem('onethu.overlay.closed'))==='1',width+' 导览保留已保存的悬浮球关闭偏好');
  check(errors.length===0,width+' 导览无页面异常 '+JSON.stringify(errors));
  await page.unrouteAll({behavior:"ignoreErrors"});
  await page.request.dispose();
  await page.close();
 }

} catch (error) { console.error(error); throw error; } finally {await closeTestBrowser(browser);}

console.log(`${count} onboarding browser assertions passed; browser cleanup complete`);
