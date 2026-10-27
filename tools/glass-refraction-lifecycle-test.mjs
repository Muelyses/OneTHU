/** Real Chromium + synthetic DOM. No app profile or school requests. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const playwright=await import(process.env.ONETHU_PLAYWRIGHT_PATH ? pathToFileURL(process.env.ONETHU_PLAYWRIGHT_PATH).href : 'playwright');
const {chromium}=playwright.chromium ? playwright : playwright.default;
const source=readFileSync('packages/gui/src/pipeline/refraction.ts','utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN});
const appUa='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36';
let count=0;
async function pageFor(mode) {
  const context=await browser.newContext({viewport:{width:800,height:600},userAgent:mode==='legacy'?'Chrome/90.0':appUa});
  const page=await context.newPage();
  await page.route('**/*',route=>route.abort());
  await page.setContent('<html data-og-skin="glass"><head><style>.lens{width:200px;height:50px;position:absolute;top:0;left:0;border-radius:12px;background:rgba(255,255,255,.5);backdrop-filter:blur(4px);--og-blur-1:4px;--og-saturate:100;}</style></head><body></body></html>');
  await page.evaluate(mode=>{
    Object.defineProperty(navigator,'hardwareConcurrency',{value:8});
    Object.defineProperty(navigator,'vendor',{value:mode==='webkit'?'Apple Computer, Inc.':'Google Inc.'});
    Object.defineProperty(navigator,'userAgentData',{value:mode==='legacy'?{brands:[{brand:'Chromium',version:'90'}]}:undefined,configurable:true});
    if(mode==='legacy')Object.defineProperty(globalThis,'structuredClone',{value:undefined,configurable:true});
  },mode);
  await page.addScriptTag({content:`window.optics={};(function(exports){${code}\n})(window.optics);`});
  return{context,page};
}
try {
  for(const mode of ['app','legacy','webkit']) {
    const {context,page}=await pageFor(mode);
    const result=await page.evaluate(async()=>{
      const supported=window.optics.refractionSupported();
      const stop=window.optics.installGlassRefraction('.lens');
      const el=document.createElement('div');el.className='lens';document.body.append(el);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const installed=el.hasAttribute('data-og-refraction');const blur=getComputedStyle(el).backdropFilter;stop();
      return{supported,installed,blur};
    });
    assert.equal(result.supported,mode==='app',mode);assert.equal(result.installed,mode==='app',mode);
    if(mode!=='app')assert.match(result.blur,/blur\(/,mode+' retains frosted material');
    count++;await context.close();
  }
  const {context,page}=await pageFor('app');
  const lifecycle=await page.evaluate(async()=>{
    const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const stop=window.optics.installGlassRefraction('.lens');let assigned=0;
    for(let i=0;i<60;i++){
      const el=document.createElement('div');el.className='lens';document.body.append(el);await frames();
      if(el.hasAttribute('data-og-refraction'))assigned++;
      el.remove();await frames();
    }
    const batch=Array.from({length:26},()=>{const el=document.createElement('div');el.className='lens';document.body.append(el);return el;});
    await frames();batch.slice(0,24).forEach(el=>el.remove());await frames();
    const backfilled=batch.slice(24).every(el=>el.hasAttribute('data-og-refraction'));
    stop();return{assigned,backfilled,remainingFilters:document.querySelectorAll('[data-og-optics]').length,remainingAttributes:document.querySelectorAll('[data-og-refraction]').length};
  });
  assert.equal(lifecycle.assigned,60);assert.equal(lifecycle.backfilled,true);assert.equal(lifecycle.remainingFilters,0);assert.equal(lifecycle.remainingAttributes,0);
  count++;await context.close();
  console.log(JSON.stringify({passed:true,checks:count,appUaRetained:true,lifecycle}));
} finally {await browser.close();}
