/** First-run language selection in the actual app, with disposable browser profiles.
 * The third-language dictionary is injected only into an isolated test context.
 * Start Vite, then: node tools/onboarding-language-browser-test.mjs
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { closeTestBrowser, advanceOnboardingPrivacy } from './lib/onboarding-browser-steps.mjs';
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless:true, args:['--disable-updater-scheduler'],
});
let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};
const tour=page=>page.locator('.experience-tour');
async function setup(width,height,third=false) {
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<600});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.routeWebSocket('**/*',socket=>socket.close());
  await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
  if(third) await page.route('**/src/i18n/index.ts*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const fixture=`registry.set('fr-FR',{label:'Français',messages:Object.fromEntries(Object.entries(enSeed.messages).map(([key,value])=>[key,'FR · '+value]))});\n`;
    assert.ok(source.includes('export const LOCALES'), 'Inject the fixture before locale registration is finalized');
    await route.fulfill({response,body:source.replace('export const LOCALES',fixture+'export const LOCALES')});
  });
  await page.addInitScript(()=>{
    localStorage.setItem('onethu.overlay.closed','1');
    localStorage.setItem('onethu.experience.v1','full');
  });
  await page.goto(base+'/?explorer-preview=onboarding&tour=1');
  await advanceOnboardingPrivacy(page);
  await tour(page).locator('[data-tour-phase="language"]').waitFor().catch(async error=>{console.error('SETUP',errors,await page.locator('body').innerText());throw error;});
  return {context,page,errors};
}
async function choose(page,code) {
  const option=tour(page).locator('.tour-language-option').filter({has:page.locator(`input[value="${code}"]`)});
  await option.click();
  await page.waitForFunction(code=>document.documentElement.lang===code,code);
  check(await option.getByRole('radio').isChecked(),'Chosen language stays selected');
  check(await page.evaluate(()=>localStorage.getItem('onethu.locale'))===code,'Language is persisted immediately');
}
async function layout(page) {
  const result=await tour(page).evaluate(panel=>{
    const r=panel.getBoundingClientRect(),button=panel.querySelector('.tour-language-continue'),b=button.getBoundingClientRect();
    return {fits:r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1,
      footer:b.top>=r.top&&b.bottom<=r.bottom&&button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)),
      overflow:panel.querySelector('.tour-shell').scrollWidth>panel.querySelector('.tour-shell').clientWidth+1};
  });
  check(result.fits&&result.footer&&!result.overflow,'Language panel and Continue fit the viewport without horizontal clipping');
}
try {
  for(const [width,height] of [[1280,860],[390,844],[320,568]]) {
    for(const mode of ['simple','practical','full']) {
      const {context,page,errors}=await setup(width,height);
      check(await tour(page).getByText('你想使用哪种语言？',{exact:true}).isVisible(),'First-run question is visible in Chinese');
      check(await tour(page).getByText('Which language would you like to use?',{exact:true}).isVisible(),'First-run question is visible in English');
      check(await tour(page).getByRole('radio').count()===2,'Options come from the two installed dictionaries');
      check(await tour(page).locator('.tour-stage').count()===0,'No mode demo or heavy scene runs before language selection');
      await layout(page);
      if(width===320) check(await tour(page).locator('.tour-language-option').evaluateAll(options=>options.every(option=>{
        const r=option.getBoundingClientRect(),body=option.closest('.og-panel-body').getBoundingClientRect();
        return r.top>=body.top&&r.bottom<=body.bottom;
      })), 'Both built-in language options are visible without scrolling on a short phone');
      if(mode==='full') await page.screenshot({path:`/tmp/onethu-language-${width}.png`});
      if(width===1280&&mode==='full') {
        await tour(page).getByRole('button',{name:'继续 / Continue',exact:true}).click();
        await tour(page).getByRole('heading',{name:'你想怎样使用 OneTHU？',exact:true}).waitFor();
        check(await page.evaluate(()=>localStorage.getItem('onethu.locale'))==='zh-CN','Continue persists the default language even without changing its radio');
        await tour(page).getByRole('button',{name:'上一步',exact:true}).click();
        await tour(page).locator('[data-tour-phase="language"]').waitFor();
        await tour(page).locator('input[value="zh-CN"]').focus();
        await page.keyboard.press('ArrowDown');
        await page.waitForFunction(()=>document.documentElement.lang==='en-US');
        check(await tour(page).locator('input[value="en-US"]').isChecked(),'Native radio arrow keys change the language');
      }
      await choose(page,'en-US');
      check(await page.evaluate(()=>localStorage.getItem('onethu.experience.v1'))==='full','Language choice does not change the experience mode');
      // Refreshing before completion returns to step zero with the saved selection.
      await page.reload();
      await advanceOnboardingPrivacy(page);
      await tour(page).locator('[data-tour-phase="language"]').waitFor();
      check(await tour(page).locator('input[value="en-US"]').isChecked(),'Refresh restores the selected language');
      check(await tour(page).getByText('你想使用哪种语言？',{exact:true}).isVisible(),'Question remains bilingual even after selecting English');
      await tour(page).getByRole('button',{name:'继续 / Continue',exact:true}).click();
      await tour(page).getByRole('heading',{name:'How would you like to use OneTHU?',exact:true}).waitFor();
      checks++;
      const modeName={simple:'Minimal mode',practical:'Practical mode',full:'Full mode'}[mode];
      await tour(page).getByRole('button',{name:modeName,exact:true}).click();
      // Going back to language keeps the draft mode choice.
      await tour(page).getByRole('button',{name:'Back',exact:true}).click();
      await tour(page).locator('[data-tour-phase="language"]').waitFor();
      check(await tour(page).locator('input[value="en-US"]').isChecked(),'Back returns to the saved language');
      await tour(page).getByRole('button',{name:'继续 / Continue',exact:true}).click();
      check(await tour(page).getByRole('button',{name:modeName,exact:true}).getAttribute('aria-pressed')==='true','Back keeps the draft experience-mode choice');
      check(!/[\u3400-\u9fff]/u.test(await tour(page).locator('.tour-copy').innerText()),'Mode choice copy follows English');
      check(!/[\u3400-\u9fff]/u.test(await tour(page).locator('.tour-visual-note').innerText()),'Mode illustration caption follows English');
      await tour(page).getByRole('button',{name:'Start with this mode',exact:true}).click();
      await tour(page).locator('[data-tour-phase="lesson"]').waitFor();
      check(!/[\u3400-\u9fff]/u.test(await tour(page).locator('.tour-copy').innerText()),'Mode-specific lesson follows English');
      check(!/[\u3400-\u9fff]/u.test(await tour(page).locator('.tour-chapters').innerText()),'All chapter navigation follows English');
      await tour(page).getByRole('button',{name:'Skip tour',exact:true}).click();
      await page.evaluate(()=>window.dispatchEvent(new Event('onethu.onboarding.replay')));
      await advanceOnboardingPrivacy(page);
      await tour(page).locator('[data-tour-phase="language"]').waitFor();
      check(await tour(page).locator('input[value="en-US"]').isChecked(),'Replay starts at step zero with the saved language');
      await choose(page,'zh-CN');
      await tour(page).getByRole('button',{name:'继续 / Continue',exact:true}).click();
      await tour(page).getByRole('heading',{name:'你想怎样使用 OneTHU？',exact:true}).waitFor();checks++;
      check(errors.length===0,errors.join('; '));
      await context.close();
      console.log(`✓ ${width}×${height} ${mode}: first run, keyboard/back, persistence, replay and selected-language lessons`);
    }
  }
  const {context,page,errors}=await setup(390,844,true);
  check(await tour(page).getByRole('radio').count()===3,'A newly registered third language is discovered without editing the guide');
  await choose(page,'fr-FR');
  check(await tour(page).getByText('Which language would you like to use?',{exact:true}).isVisible(),'Step-zero question remains bilingual for a third language');
  await tour(page).getByRole('button',{name:'继续 / Continue',exact:true}).click();
  await tour(page).getByRole('heading',{name:'FR · How would you like to use OneTHU?',exact:true}).waitFor();checks++;
  await tour(page).getByRole('button',{name:'FR · Full mode',exact:true}).click();
  await tour(page).getByRole('button',{name:'FR · Start with this mode',exact:true}).click();
  await tour(page).getByRole('heading',{name:'FR · Search, OH and plugins',exact:true}).waitFor();checks++;
  check((await tour(page).locator('.tour-chapters').innerText()).includes('FR · Board'),'Third-language chapters use the new dictionary');
  check(errors.length===0,errors.join('; '));
  await context.close();
  console.log('✓ Isolated third-language fixture (not a shipped French translation)');
} finally { await closeTestBrowser(browser); }
console.log(`Onboarding language: ${checks} checks passed`);
