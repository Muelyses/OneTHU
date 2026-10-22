/** Real React data hooks; fictional account, isolated browser, all external traffic blocked. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5210';
const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const errors = []; let checks = 0;
const check = (value,label) => { assert.ok(value,label); checks++; console.log('✓ '+label); };
try {
  const page = await browser.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('onethu.locale','zh-CN'));
  await page.routeWebSocket('**/*',socket=>socket.close());
  await page.route('**/*',route=>new URL(route.request().url()).origin===base ? route.fallback() : route.abort());
  await page.route('**/src/**',async route=>{
    const response=await route.fetch();
    const body=(await response.text()).replace(/(["'])(\/src\/[^"'?]+)\?t=\d+\1/g,'$1$2$1');
    await route.fulfill({response,body});
  });
  const source=await (await page.request.get(base+'/src/state/context.ts')).text();
  const react=source.match(/from "([^"\n]+react\.js[^"\n]*)"/)[1];
  const harness=readFileSync('tools/lib/news-language-harness.mjs','utf8').replace('__REACT_URL__',react);
  await page.route('**/__news-language-harness.js',route=>route.fulfill({contentType:'text/javascript',body:harness}));
  await page.route('**/__news-language',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('/__news-language-harness.js');</script></body></html>`}));
  await page.goto(base+'/__news-language');
  const waitSource = async name => page.waitForFunction(name=>window.__snapshot?.().news.data?.[0]?.source===name && window.__snapshot?.().feed.data?.list[0]?.source===name,name);
  await waitSource('示例单位');
  check(await page.evaluate(()=>window.__calls.every(call=>call.language==='zh')),'Chinese mount uses Chinese reads instead of legacy English cache');
  check(await page.evaluate(()=>window.__snapshot().feed.data.from==='subs' && window.__calls.some(call=>call.method==='feed' && call.id===null)),'Old English subscription labels still retrieve the authoritative subscription feed');
  await page.evaluate(()=>{window.__hold('en');window.__locale('en-US');});
  await page.waitForFunction(()=>window.__calls.some(call=>call.method==='news' && call.language==='en') && window.__snapshot().news.state==='loading');
  check(await page.evaluate(()=>window.__snapshot().news.data===null),'Changing language hides prior-language rows while the new response is pending');
  await page.evaluate(()=>window.__locale('zh-CN')); await waitSource('示例单位');
  await page.evaluate(()=>window.__release('en'));
  await page.waitForFunction(()=>window.__cache('en-US').list?.data[0]?.source==='Example Office');
  check(await page.evaluate(()=>window.__snapshot().news.data[0].source==='示例单位'),'Late English response cannot overwrite the current Chinese view');
  await page.evaluate(()=>window.__locale('en-US')); await waitSource('Example Office');
  check(await page.evaluate(()=>window.__snapshot().news.data[0].name==='原始标题 Example' && window.__snapshot().feed.data.list[0].name==='原始标题 Example'),'English labels preserve original news headlines in both real hooks');
  check(await page.evaluate(()=>window.__cache('zh-CN').list.data[0].source==='示例单位' && window.__cache('en-US').list.data[0].source==='Example Office'),'Chinese and English cache entries coexist without overwriting each other');
  await page.evaluate(()=>{window.__hold('en');window.__page(2);});
  await page.waitForFunction(()=>window.__calls.some(call=>call.method==='news' && call.page===2));
  check(await page.evaluate(()=>window.__snapshot().news.data===null),'Page changes do not display prior-page cached rows');
  await page.evaluate(()=>window.__release('en'));
  await page.waitForFunction(()=>window.__snapshot().news.data?.[0]?.xxid==='example-2');
  check(errors.length===0,'No React or page errors');
  console.log(`News language browser: ${checks} checks passed (actual StrictMode hooks; no school requests).`);
} finally { await browser.close(); }
