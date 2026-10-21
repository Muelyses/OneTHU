/** First-open home versus the actual template control at desktop display widths.
 * Runs on Chromium with a Windows platform hint; not a Windows WebView2 test. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
// A fresh module graph avoids duplicate stores from stale development HMR URLs.
const requireDesktop=createRequire(new URL('../apps/desktop/package.json',import.meta.url));
const {createServer}=await import(pathToFileURL(join(dirname(requireDesktop.resolve('vite/package.json')),'dist/node/index.js')).href);
const cache=mkdtempSync(join(tmpdir(),'onethu-profile-vite-'));
const server=await createServer({root:resolve('apps/desktop'),configFile:resolve('apps/desktop/vite.config.ts'),cacheDir:cache,logLevel:'error',server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});
await server.listen();
const base='http://127.0.0.1:'+server.httpServer.address().port;
const out=process.env.ONETHU_TEST_ARTIFACTS??join(tmpdir(),'onethu-home-initial');
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});


try {
 for(const width of [1280,1024,900]) {
 const context=await browser.newContext({viewport:{width,height:850}}),page=await context.newPage();
 page.setDefaultTimeout(15000);
 await page.addInitScript(()=>Object.defineProperty(navigator,'platform',{value:'Win32'}));
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'?explorer-preview=home#/homepage');
 await page.locator('.free-item').first().waitFor();
 // Seed the exact historical default, including the former narrow rail.
 await page.evaluate(async()=>{
  const b=await import('/src/state/board.ts'),c=await import('/src/state/boardCore.ts');
  const doc={v:1,activeBoardId:c.SYSTEM_BOARD_ID,order:{mode:'auto',edited:false},boards:[c.buildSystemBoard({...b.boardDeps,loadLayoutItems:()=>null})]};
  b.saveBoard(c.migrateHomeCanvas(doc));
 });
 await page.reload();await page.locator('.free-item').first().waitFor();
 await page.waitForTimeout(1400);
 const snapshot=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('onethu.board.v1')).boards[0].cells.portrait.map(it=>({spec:it.spec,rect:it.rect})));
 const initial=await snapshot();
 assert.equal(initial.length,7);
 assert.equal(initial.find(it=>it.spec.id==='classes').rect.w,540);
 await page.screenshot({path:out+'/initial-'+width+'.png'});
 // Use the real template control, not the reset helper.
 await page.getByRole('button',{name:'模板',exact:true}).click();
 await page.getByRole('menuitem',{name:/默认首页 ·/}).click();
 assert.deepEqual(await snapshot(),initial,'Initial migrated home must match manually selected home template');
 const bounds=await page.locator('.free-item').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}));
 assert.ok(bounds.every(r=>r.x>=0&&r.x+r.w<=width+1));
 await page.screenshot({path:out+'/template-'+width+'.png'});
 assert.deepEqual(errors,[]);
 console.log('✓ First-open legacy default equals actual home template at '+width+' CSS px (Windows platform hint)');
 await context.close();
 }
}catch(error){console.error(error);throw error;}finally{await browser.close();server.httpServer.closeAllConnections?.();await server.close();rmSync(cache,{recursive:true,force:true});}
