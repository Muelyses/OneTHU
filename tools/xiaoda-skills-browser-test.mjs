/** Real OneGUI skill controls on desktop/mobile sizes with native IPC fixtures.
 * Native archive/runtime behavior is tested separately by Rust; no school traffic. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const base=process.env.ONETHU_TEST_URL??'http://127.0.0.1:5180';
const out=process.env.ONETHU_TEST_ARTIFACTS??'/Volumes/OneTHUBuild/artifacts/xiaoda-skills/ui';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const checks=[],errors=[];
const ok=(condition,label)=>{assert.ok(condition,label);checks.push(label);console.log('✓ '+label)};
try {
 for(const [width,locale] of [[1280,'zh-CN'],[390,'zh-CN'],[390,'en-US']]) {
  const page=await browser.newPage({viewport:{width,height:860},isMobile:width<600,hasTouch:width<600});
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.routeWebSocket('**/*',socket=>socket.close());
  const records=[];
  const calls=[];
  await page.exposeFunction('__skillInvoke',async(command,args={})=>{
   if(command==='skills_action'){
    calls.push(args.action);
    if(args.action==='list')return structuredClone(records);
    if(args.action==='import'){
     const item={id:args.id,name:args.name,description:args.description,sha256:'fixture-hash',installedAt:1,enabled:false,compatibility:args.id==='heavy'?'external-agent':'text',requirements:args.id==='heavy'?['python','external-service']:[],files:['SKILL.md','references/example.md'],expandedBytes:1200};records.push(item);return item;
    }
    if(args.action==='enable'){const item=records.find(item=>item.id===args.id);item.enabled=args.enabled;return item;}
    if(args.action==='delete'){records.splice(records.findIndex(item=>item.id===args.id),1);return {ok:true};}
    if(args.action==='compute')return {runtime:'quickjs',executed:true,result:10};
    if(args.action==='load')return {text:'# Fixture guide',untrusted:true};
   }
   if(command==='skills_export')return '/chosen/skill-'+args.id;
   return null;
  });
  await page.addInitScript(locale=>{
   localStorage.setItem('onethu.locale',locale);localStorage.setItem('onethu.experience.v1','full');
   window.__TAURI_INTERNALS__={invoke:(c,a)=>window.__skillInvoke(c,a),transformCallback:()=>1,metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}}};
  },locale);
  await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
  await page.route('**/__skills_test',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px}#root{max-width:1000px;margin:auto}</style></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;
    const source=await(await fetch('/src/main.tsx')).text();
    for(const path of [...source.matchAll(/import "([^"]+\\.css[^"]*)"/g)].map(m=>m[1]))await import(path);
    const rm=await import('/node_modules/.vite/deps/react.js');const React=rm.default??rm;
    const dm=await import('/node_modules/.vite/deps/react-dom_client.js');const DOM=dm.default??dm;
    const componentSource=await(await fetch('/src/pages/xiaoda/SkillLibrary.tsx')).text();
    const dependency=(source,prefix)=>[...source.matchAll(/"([^" ]+)"/g)].map(m=>m[1]).find(path=>path.startsWith(prefix));
    const guiPath=[...componentSource.matchAll(/"([^" ]+)"/g)].map(m=>m[1]).find(path=>path.includes('/packages/gui/src/index.ts'));
    const {installOneGUI}=await import(guiPath);installOneGUI({platform:()=>innerWidth<600?'mobile':'desktop',densityByPlatform:{desktop:'compact',mobile:'touch'}});
    document.documentElement.classList.toggle('is-phone',innerWidth<600);
    const skillPath=dependency(componentSource,'/src/lib/skills.ts');
    const skillSource=await(await fetch(skillPath)).text();
    const {session}=await import(dependency(skillSource,'/src/lib/clients.ts'));session.username='2099000000';session.state='ready';
    const {SkillLibrary}=await import('/src/pages/xiaoda/SkillLibrary.tsx');
    const {I18nProvider}=await import('/src/i18n/I18nProvider.tsx');
    const {xiaodaClient}=await import(dependency(skillSource,'/src/lib/xiaoda.ts'));xiaodaClient.skillDetail=async id=>({id,name:id,description:'Fixture skill package'});
    window.skillApi=await import(skillPath);window.skillMode=await import(dependency(skillSource,'/src/state/experienceMode.ts'));
    window.skillI18n=await import(dependency(skillSource,'/src/i18n/index.ts'));
    function Demo(){const [selected,setSelected]=React.useState(null);window.pickSkill=id=>setSelected({id,name:id==='heavy'?'Heavy Python Skill':'Writing Guide',description:'Fixture skill package'});return React.createElement(SkillLibrary,{selected,onClose:()=>setSelected(null)})}
    DOM.createRoot(document.getElementById('root')).render(React.createElement(I18nProvider,null,React.createElement(Demo)));
  </script></body></html>`}));
  await page.goto(base+'/__skills_test');
  const label=async key=>page.evaluate(key=>window.skillI18n.t(key),key);
  await page.getByText(locale==='zh-CN'?'OH 技能库':'OH skill library',{exact:true}).waitFor();
  await page.getByRole('button',{name:await label('skills.check'),exact:true}).click();
  await page.getByRole('button',{name:await label('skills.checked'),exact:true}).waitFor().catch(async error=>{console.log(await page.locator('body').innerText(), calls);throw error});
  ok(calls.includes('compute'),`${width}/${locale}: runtime check reaches native command`);
  await page.evaluate(()=>window.pickSkill('light'));
  await page.getByRole('button',{name:await label('skills.import'),exact:true}).click();
  await page.getByRole('button',{name:await label('skills.enable'),exact:true}).waitFor();
  ok(!records[0].enabled,`${width}/${locale}: importing does not auto-enable third-party content`);
  await page.getByRole('button',{name:await label('skills.enable'),exact:true}).click();
  await page.getByRole('button',{name:await label('skills.disable'),exact:true}).waitFor();
  ok((await page.evaluate(()=>window.skillApi.searchSkills('Writing'))).length===1,`${width}/${locale}: enabled skill reaches OH index`);
  await page.evaluate(()=>window.skillMode.setExperienceMode('simple'));
  ok((await page.evaluate(()=>window.skillApi.searchSkills(''))).length===0,`${width}/${locale}: compact mode hides skills without deleting settings`);
  await page.evaluate(()=>window.skillMode.setExperienceMode('full'));
  await page.screenshot({path:out+`/light-${width}-${locale}.png`});
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.pickSkill('heavy'));
  await page.getByRole('button',{name:await label('skills.import'),exact:true}).click();
  await page.getByRole('button',{name:await label('skills.export'),exact:true}).waitFor();
  ok(await page.getByRole('button',{name:await label('skills.enable'),exact:true}).count()===0,`${width}/${locale}: heavy skill cannot be enabled`);
  await page.getByRole('button',{name:await label('skills.export'),exact:true}).click();
  await page.getByText('/chosen/skill-heavy',{exact:false}).waitFor();
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}/${locale}: no horizontal overflow`);
  const dialog=page.getByRole('dialog');
  const box=await dialog.boundingBox();ok(box&&box.x>=0&&box.x+box.width<=width+1,`${width}/${locale}: modal remains within viewport`);
  const tail=page.getByText(await label('skills.localOnly'),{exact:true});
  await tail.scrollIntoViewIfNeeded();
  const tailBox=await tail.boundingBox();ok(tailBox&&tailBox.y>=0&&tailBox.y+tailBox.height<=860,`${width}/${locale}: modal end remains reachable by scrolling`);
  await page.screenshot({path:out+`/heavy-${width}-${locale}.png`});
  await page.getByRole('button',{name:await label('skills.delete'),exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  ok(records.length===1,`${width}/${locale}: remove only selected skill`);
  await page.close();
 }
 ok(errors.length===0,'No React runtime errors');
}finally{writeFileSync(out+'/report.json',JSON.stringify({checks,errors,scope:'Actual React/OneGUI UI and host facade with native IPC fixtures on macOS Chromium; not an Android device test.'},null,2));await browser.close();}
