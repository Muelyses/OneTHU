import { chromium } from 'playwright';
const base='http://127.0.0.1:5180';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
for (const [w,h,tag] of [[1280,900,'desktop'],[390,844,'phone']]) {
  const p=await browser.newPage({viewport:{width:w,height:h},hasTouch:w<600,isMobile:w<600});
  p.on('pageerror',e=>console.log(tag,'ERR',e.message.slice(0,120)));
  await p.addInitScript(()=>{ performance.setResourceTimingBufferSize(10000); localStorage.removeItem('onethu.userext.v1'); });
  await p.goto(base+'/?explorer-preview=home&tour=1',{waitUntil:'domcontentloaded'});
  await p.waitForSelector('.explorer-shell'); await p.waitForTimeout(900);
  await p.getByRole('button',{name:'按此模式开始'}).click(); await p.waitForTimeout(300);
  for(let i=0;i<14;i++){ const next=p.getByRole('button',{name:'下一步'}); if(!(await next.count())) break; await next.click(); await p.waitForTimeout(120); }
  await p.waitForTimeout(400);
  const modal=p.locator('.experience-tour');
  const text=(await modal.innerText()).replace(/\n+/g,' | ');
  console.log(tag,'connect', text.slice(0,220));
  const sw=modal.locator('button[role="switch"], [role="switch"]').first();
  console.log(tag,'switch count', await modal.locator('[role="switch"]').count());
  await p.screenshot({path:`/tmp/tour-connect-${tag}.png`});
  if(await modal.locator('[role="switch"]').count()){ await modal.locator('[role="switch"]').first().click(); await p.waitForTimeout(500);
    console.log(tag,'mcp after', await p.evaluate(()=>{try{return JSON.parse(localStorage.getItem('onethu.userext.v1')||'{}').mcpServer??null}catch{return 'err'}}));
    await p.screenshot({path:`/tmp/tour-connect-${tag}-on.png`});
  }
  await p.close();
}
await browser.close();
