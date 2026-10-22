import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
const version=process.env.ONETHU_EXPECT_VERSION??JSON.parse(readFileSync('apps/desktop/package.json','utf8')).version;
const base=process.env.ONETHU_SITE_URL??'http://127.0.0.1:8770/';
const out=process.env.ONETHU_TEST_OUT??'/Volumes/OneTHUBuild/artifacts/release-'+version+'/download-page';mkdirSync(out,{recursive:true});
const proxy=process.env.ONETHU_BROWSER_PROXY?new URL(process.env.ONETHU_BROWSER_PROXY):null;
const browser=await chromium.launch({...(proxy?{proxy:{server:proxy.origin,username:decodeURIComponent(proxy.username),password:decodeURIComponent(proxy.password)}}:{}),executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const report=[];
try{
 for(const width of [1440,768,390,320])for(const language of ['', 'en/']){
  const context=await browser.newContext({viewport:{width,height:900},javaScriptEnabled:false});const page=await context.newPage();
  await page.goto(base+language+'download.html');
  assert.equal(await page.locator('.cloud-download').count(),3);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page overflows');
  for(const link of await page.locator('.cloud-download').all()){
   assert.ok(await link.isVisible());const box=await link.boundingBox();assert.ok(box.height>=44&&box.width>200,'Download action too small');
   const u=new URL(await link.getAttribute('href'));assert.ok(['/Android/','/macOS/','/Windows/'].some(dir=>u.searchParams.get('p')?.startsWith(dir+'OneTHU_'+version+'_')));assert.equal(u.searchParams.get('dl'),'1');
  }
  await page.locator('.download-checksum').first().locator('summary').click();assert.ok(await page.locator('.download-checksum code').first().isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Checksum overflows');
  await page.evaluate(()=>{document.activeElement?.blur();scrollTo({top:0,behavior:"instant"});});
  await page.waitForFunction(()=>scrollY===0);
  await page.screenshot({path:out+'/'+(language?'en':'zh')+'-'+width+'.png',fullPage:true});report.push({width,language:language?'en':'zh',noJavaScript:true,passed:true});await context.close();
 }
}finally{await browser.close();writeFileSync(out+'/report.json',JSON.stringify(report,null,2));}
console.log('✓ 8 browser layouts (320–1440px, Chinese/English), direct cloud actions, expandable checksums, no JavaScript required');
