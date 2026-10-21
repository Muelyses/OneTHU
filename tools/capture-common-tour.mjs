import assert from 'node:assert/strict';
import {captureLocale,captureEnglish,captureSuffix} from './lib/public-capture-locale.mjs';
import { copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setup, call, close, browser } from './capture-public-preview.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const entries=[];
try{
 for(const mode of ['simple','practical']){
  const {page,context}=await setup(390,844,mode);
  for(const type of ['search','oh']){
   await call(page,'/src/plugins/ohControl.ts','requestOhPanel',[type,type==='search'?(captureEnglish?'assignment':'作业'):'']);
   await page.locator('.dock-panel').waitFor();
   if(type==='search')await page.locator('.ohx-hit').first().waitFor();
   await page.waitForTimeout(500);
   const file=type+'-'+mode+'.png',path='docs/assets/0.11'+captureSuffix+'/'+file;
   await page.screenshot({path,animations:'disabled'});
   copyFileSync(path,'apps/desktop/src/assets/tour/real-ui'+captureSuffix+'/'+file);
   entries.push({mode,type,file,sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),fixture:'Disposable browser, fictional data, external HTTP blocked. Actual compact mode and capsule UI.'});
  }
  await close(page,context);
 }
 assert.equal(entries.length,4);
}finally{await closeTestBrowser(browser);writeFileSync('apps/desktop/src/assets/tour/real-ui'+captureSuffix+'/manifest-common.json',JSON.stringify({locale:captureLocale,entries,passed:entries.length===4},null,2)+'\n');copyFileSync('apps/desktop/src/assets/tour/real-ui'+captureSuffix+'/manifest-common.json','docs/assets/0.11'+captureSuffix+'/manifest-common.json');}
