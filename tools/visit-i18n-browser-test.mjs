/** Real VisitTab locale transitions with isolated service fixtures. No school requests.
 * Start Vite, then run: node tools/visit-i18n-browser-test.mjs
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const visitSource = await (await fetch(base + '/src/pages/info/VisitTab.tsx')).text();
const coreUrl = visitSource.match(/from "([^"]*[/]packages[/]core[/]src[/]index[.]ts[^"]*)"/)?.[1];
assert.ok(coreUrl, 'Use the same core Error constructors as the mounted page');
const prefix = 'pages.info.visittab.';
const scenarios = [
  {name:'API HTTP error', error:"new VisitApiError('临时来访报备系统返回了无法识别的内容（HTTP 502）')", key:'e3301e2db296', params:{value:'502'}},
  {name:'API code error', error:"new VisitApiError('请求未成功（编号 431）')", key:'488837fe85bd', params:{value:'431'}},
  {name:'restored session auto-load', restored:true, error:"new VisitApiError('请求未成功（编号 431）')", key:'488837fe85bd', params:{value:'431'}},
  {name:'generic loading fallback', error:"new Error('synthetic loading failure')", key:'8d66f991153b'},
  {name:'expired session note', error:'new VisitAuthRequiredError()', key:'7c4768ed455b'},
  {name:'actual login HTTP error', error:"new VisitLoginError('统一身份认证页面形态不认识（HTTP 503），请稍后重试')", key:'0dc9677cab64', params:{value:'503'}, initial:'en-US'},
  {name:'school error stays raw', error:"new VisitApiError('学校测试原因：该时段暂停接待')", raw:'学校测试原因：该时段暂停接待'},
  {name:'raw text does not become a descriptor', error:"new VisitApiError('@pages.info.visittab.e22da1c2173d')", raw:'@pages.info.visittab.e22da1c2173d'},
  {name:'my registrations app error', stage:'mine', error:"new VisitApiError('表单模型解析失败')", key:'48ea9c8f9a02'},
  {name:'my registrations school error', stage:'mine', error:"new Error('学校测试原因：列表暂不可用')", raw:'学校测试原因：列表暂不可用'},
  {name:'my registrations unknown failure', stage:'mine', error:"'synthetic non-Error failure'", key:'cc06059ac1bf'},
  {name:'submission validation', stage:'submit', error:"new VisitApiError('请至少填写一位来访人后再提交')", key:'00afe7c5403e'},
  {name:'submission fallback', stage:'submit', error:"new Error('synthetic submit failure')", key:'0b0682ac2f83'},
  {name:'retry after submission failure', stage:'success', retry:true, key:'e22da1c2173d'},
  {name:'submission success', stage:'success', key:'e22da1c2173d'},
  {name:'successful submission with list refresh failure', stage:'success', key:'e22da1c2173d', mineAfterSubmit:true},
  {name:'OH draft note', stage:'draft', key:'af16cc0b5325'},
];
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless:true, args:['--disable-updater-scheduler'],
});
let checks = 0;
const check = (condition, label) => { assert.ok(condition,label); checks++; };
try {
  for (const scenario of scenarios) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    const ready = ['mine','submit','success'].includes(scenario.stage);
    await page.route('**/src/lib/visit.ts*', route => route.fulfill({contentType:'application/javascript', body:`
      import {VisitApiError,VisitLoginError,VisitAuthRequiredError} from ${JSON.stringify(coreUrl)};
      window.visitCalls={login:0,model:0,mine:0,submit:0};
      export const visitHasSession=()=>${!!scenario.restored};
      export const visitEnsureLogin=async()=>{window.visitCalls.login++;${!ready ? `throw ${scenario.error ?? "new Error('unused fixture')"}` : ''}};
      export const visitClient={
        formModel:async()=>{window.visitCalls.model++;return {fields:[],visitorFields:[],prefilled:{},formName:'Synthetic form'}},
        myReports:async()=>{window.visitCalls.mine++;${scenario.stage === 'mine' ? `throw ${scenario.error}` : scenario.mineAfterSubmit ? `if(window.visitCalls.submit)throw new VisitApiError('表单模型解析失败');return {rows:[]}` : 'return {rows:[]}' }},
        submitReport:async()=>{window.visitCalls.submit++;${scenario.stage === 'submit' ? `throw ${scenario.error}` : scenario.retry ? `if(window.visitCalls.submit===1)throw new Error('synthetic retry fixture')` : ''}}
      };
    `}));
    await page.route('**/__visit_i18n_test', route => route.fulfill({contentType:'text/html', body:`
      <div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
      const rm=await import('/node_modules/.vite/deps/react.js');const React=rm.default??rm;
      const dm=await import('/node_modules/.vite/deps/react-dom_client.js');const DOM=dm.default??dm;
      const source=await(await fetch('/src/i18n/I18nProvider.tsx')).text();
      const url=source.match(/from "([^"]*[/]src[/]i18n[/]index[.]ts[^"]*)"/)[1];const i18n=await import(url);
      const {I18nProvider}=await import('/src/i18n/I18nProvider.tsx');
      const visitSource=await(await fetch('/src/pages/info/VisitTab.tsx')).text();
      const draftUrl=visitSource.match(/from "([^"]*[/]state[/]visitDraft[.]ts[^"]*)"/)[1];const draft=await import(draftUrl);
      const {VisitTab}=await import('/src/pages/info/VisitTab.tsx');
      i18n.setLocale(${JSON.stringify(scenario.initial ?? 'zh-CN')});
      DOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(I18nProvider,null,React.createElement(VisitTab))));
      window.api={i18n,draft};window.ready=true;
      </script>
    `}));
    await page.goto(base + '/__visit_i18n_test');
    await page.waitForFunction(() => window.ready);
    const text = key => page.evaluate(key => window.api.i18n.t(key), prefix + key);
    if (scenario.stage === 'draft') {
      await page.evaluate(() => window.api.draft.requestVisitDraft({reasonText:'Synthetic unsent draft'}));
    } else if (!scenario.restored) {
      await page.getByRole('button',{name:await text('fd9918edd55e'),exact:true}).click();
    }
    if (ready) {
      await page.getByText('Synthetic form',{exact:true}).waitFor();
      await page.locator('textarea').fill('Synthetic unsent draft');
    }
    if (['submit','success'].includes(scenario.stage)) {
      await page.getByRole('checkbox').check();
      await page.getByRole('button',{name:await text('f7c356bbe1c2'),exact:true}).click();
      await page.getByRole('dialog').getByRole('button',{name:await text('9ebe36f8cf23'),exact:true}).click();
    }
    if (scenario.retry) {
      await page.getByText(await text('0b0682ac2f83'),{exact:true}).waitFor();
      await page.getByRole('button',{name:await text('f7c356bbe1c2'),exact:true}).click();
      await page.getByRole('dialog').getByRole('button',{name:await text('9ebe36f8cf23'),exact:true}).click();
    }
    const notice = expected => scenario.stage === 'success' ? page.locator('.og-banner-main').filter({hasText:expected}) : page.getByText(expected,{exact:true});
    const expected = () => page.evaluate(({key,params,raw,mine}) => {
      const reason=raw ?? window.api.i18n.t('pages.info.visittab.'+key,params);
      return mine ? window.api.i18n.t('pages.info.visittab.727f5033a84b',{value:reason}) : reason;
    },{...scenario,mine:scenario.stage==='mine'});
    await notice(await expected()).waitFor().catch(async error => { console.error(scenario.name, await page.locator('body').innerText(), await page.evaluate(() => window.visitCalls)); throw error; });checks++;
    check((await page.evaluate(() => window.visitCalls.login)) === (scenario.stage === 'draft' ? 0 : 1), 'One sign-in attempt per load');
    const calls = await page.evaluate(() => JSON.stringify(window.visitCalls));
    // Check both directions using the already mounted notice. Do not retry requests.
    for (const locale of scenario.initial === 'en-US' ? ['zh-CN','en-US'] : ['en-US','zh-CN']) {
      await page.evaluate(locale => window.api.i18n.setLocale(locale),locale);
      await notice(await expected()).waitFor();checks++;
      check(await page.evaluate(() => JSON.stringify(window.visitCalls)) === calls, scenario.name+': locale switch must not repeat a service call');
      if (scenario.retry) check(!await page.getByText(await text('0b0682ac2f83'),{exact:true}).count(), 'Successful retry clears the previous failure');
      if (scenario.mineAfterSubmit) {
        const warning = await page.evaluate(() => window.api.i18n.t('pages.info.visittab.727f5033a84b', {value:window.api.i18n.t('pages.info.visittab.48ea9c8f9a02')}));
        await page.getByText(warning,{exact:true}).waitFor();checks++;
        check(!await page.getByText(await text('0b0682ac2f83'),{exact:true}).count(), 'A list read failure must not report a failed write');
      }
      if (ready && scenario.stage !== 'success') check(await page.locator('textarea').inputValue() === 'Synthetic unsent draft', 'Language switch keeps the unsent form');
    }
    check(errors.length===0,errors.join('; '));
    await context.close();
    console.log('✓ '+scenario.name);
  }
} finally { await closeTestBrowser(browser); }
console.log(`Visit i18n browser: ${checks} checks passed`);
