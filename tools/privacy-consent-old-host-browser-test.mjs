/** Regression: old native hosts must explain failed consent saves inside the dialog. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {closeTestBrowser} from './lib/onboarding-browser-steps.mjs';
const base=process.env.ONETHU_TEST_URL??'http://127.0.0.1:5180';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let count=0;
try {
 for(const [failure,copy] of [['Command privacy_consent_write not found','原生壳版本过旧'],['disk write failed','权限选择未能保存']]) {
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(15000);
  await page.routeWebSocket('**/*',s=>s.close());
  await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.fallback():r.abort());
  await page.route('**/src/state/privacyConsent.ts*',async r=>{
   const response=await r.fetch(),s=await response.text(),needle='export function savePrivacyConsent(next) {';
   assert.ok(s.includes(needle));await r.fulfill({response,body:s.replace(needle,needle+'\n return Promise.reject(new Error('+JSON.stringify(failure)+'));')});
  });
  await page.addInitScript(()=>localStorage.setItem('onethu.overlay.closed','1'));
  await page.goto(base+'/?explorer-preview=onboarding');
  const privacy=page.locator('.experience-tour [data-tour-phase="privacy"]');await privacy.waitFor();
  await privacy.getByRole('checkbox').check();await page.locator('.tour-privacy-continue').click();
  await privacy.getByRole('alert').filter({hasText:copy}).waitFor();
  assert.equal(await privacy.isVisible(),true);assert.equal(await page.locator('.tour-privacy-continue').isEnabled(),true);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('onethu.privacy.v1')??'{}').cloud===true),false);
  count++;await context.close();
 }
} finally {await closeTestBrowser(browser);}
console.log(`Consent save failures: ${count} real UI cases passed (old host and storage failure).`);
