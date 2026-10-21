/** Record the actual drag pipeline with fictional assignments. Only a pointer marker is added. */
import assert from 'node:assert/strict';
import {captureLocale,captureEnglish,captureSuffix,sample} from './lib/public-capture-locale.mjs';
import { mkdirSync,writeFileSync,copyFileSync,readFileSync } from 'node:fs';
import { recordScreencast } from './lib/onboarding-recording.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setup,call,close,browser } from './capture-public-preview.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const out=process.env.ONETHU_RECORD_OUT??join(tmpdir(),'onethu-vault-recording'+captureSuffix.replace('/','-'));mkdirSync(out,{recursive:true});mkdirSync(out+'/frames',{recursive:true});
const asset='apps/desktop/src/assets/tour/real-ui'+captureSuffix;mkdirSync(asset,{recursive:true});
let report={locale:captureLocale,passed:false,source:'Actual assignment card, real long-press/drag/commit handlers, fictional data; added circle visualizes the pointer only.',stages:[]};
try{
 const {page,context}=await setup(390,844,'full',{deviceScaleFactor:1});
 await call(page,'/src/state/explorer.ts','openTab',['learn-assignments']);
 const panel=page.locator('[data-tab-page="learn-assignments"]:visible');
 await panel.waitFor();
 const card=panel.locator('[data-vault-catch]').filter({hasText:sample('第二章习题')}).first();
 await card.scrollIntoViewIfNeeded();
 const origin=await card.boundingBox();const target=await page.locator('.vault-box-button').boundingBox();
 assert.ok(origin&&target,'Actual drag source and target must exist');
 const start={x:origin.x+Math.min(100,origin.width*.4),y:origin.y+Math.min(55,origin.height*.4)};
 const end={x:target.x+target.width/2,y:target.y+target.height/2};
 await page.addStyleTag({content:'#tour-pointer{position:fixed;width:28px;height:28px;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 2px #26262655,0 2px 8px #0003;background:#26262633;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);opacity:0}#tour-pointer.pressed{background:#26262666;box-shadow:0 0 0 7px #26262618,0 0 0 2px #fff}'});
 await page.evaluate(()=>{const marker=document.createElement('i');marker.id='tour-pointer';document.body.append(marker);window.addEventListener('pointermove',e=>{marker.style.left=e.clientX+'px';marker.style.top=e.clientY+'px';marker.style.opacity='1';});window.addEventListener('pointerdown',()=>marker.classList.add('pressed'));window.addEventListener('pointerup',()=>marker.classList.remove('pressed'));});
 const recording = await recordScreencast(page,out,'vault-drag',async()=>{
 await page.mouse.move(start.x,start.y);
 await page.screenshot({path:asset+'/vault-drag-start.png'});
 await page.waitForTimeout(700);
 await page.mouse.down();await page.waitForTimeout(800);
 await page.locator('body.is-vault-dragging, .vault-drag-ghost').first().waitFor();
 report.stages.push('long press activates the actual drag');
 for(let i=1;i<=30;i++){const p=i/30;const x=start.x+(end.x-start.x)*p;const y=start.y+(end.y-start.y)*p-Math.sin(p*Math.PI)*55;await page.mouse.move(x,y);await page.waitForTimeout(45);}
 await page.waitForTimeout(700);
 await page.screenshot({path:out+'/hover.png'});
 await page.mouse.up();
 await page.locator('.vault-box-count').filter({hasText:'1'}).waitFor();
 report.stages.push('release in target commits one item');
 await page.waitForTimeout(900);
 await page.locator('.vault-box-button').click();
 await page.locator('.vault-content-list').getByText(sample('第二章习题'),{exact:true}).waitFor();
 await page.mouse.move(25,60);
 await page.waitForTimeout(1100);
 if(captureEnglish)assert.doesNotMatch(await page.locator('body').innerText(),/[\u3400-\u9fff]/,'English recording must end in a fully English UI');
 await page.screenshot({path:asset+'/vault-drag-done.png'});
 report.stages.push('open staging box and verify the actual assignment title');
 });
 await close(page,context);
 copyFileSync(recording.video,asset+'/vault-drag.mp4');
 const duration=recording.durationSeconds;
 const publicRecording={...recording,video:'vault-drag.mp4',filmstrip:recording.filmstrip.map(frame=>({...frame,path:frame.path.split('/').at(-1)}))};
 report={...report,passed:true,duration,recording:publicRecording,viewport:{width:390,height:844},files:['vault-drag-start.png','vault-drag-done.png','vault-drag.mp4'].map(file=>({file,sha256:createHash('sha256').update(readFileSync(asset+'/'+file)).digest('hex')}))};
 copyFileSync(asset+'/vault-drag.mp4','docs/assets/0.11'+captureSuffix+'/vault-drag.mp4');
}finally{let naturalCleanup=false;try{await closeTestBrowser(browser);naturalCleanup=true;}finally{report={...report,passed:report.passed&&naturalCleanup,naturalCleanup,externalRequestsSent:0};writeFileSync(asset+'/manifest-vault-drag.json',JSON.stringify(report,null,2)+'\n');copyFileSync(asset+'/manifest-vault-drag.json','docs/assets/0.11'+captureSuffix+'/manifest-vault-drag.json');}}
