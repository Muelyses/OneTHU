/** Viewport regressions on the real onboarding UI. Chromium + Windows platform hint;
 * this does not claim native WebView2 coverage. Reuses the caller's Vite server.
 * ONETHU_TEST_URL, CHROME_BIN, ONETHU_TEST_OUT select existing local tools/output.
 * ONETHU_TOUR_BASELINE=1 records the pre-fix overflow without asserting it.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.ONETHU_PLAYWRIGHT_PATH ? pathToFileURL(process.env.ONETHU_PLAYWRIGHT_PATH).href : 'playwright');
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { advanceOnboardingLanguage, advanceOnboardingLayout, closeTestBrowser } from './lib/onboarding-browser-steps.mjs';

const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = process.env.ONETHU_TEST_OUT ?? join(tmpdir(), 'onethu-tour-viewport');
const baseline = process.env.ONETHU_TOUR_BASELINE === '1';
mkdirSync(out, { recursive: true });
const report = { checks: [], failures: [], samples: [], errors: [], passed: false };
function check(ok, label) {
  report.checks.push(label);
  if (!ok) report.failures.push(label);
  console.log((ok ? '✓ ' : '✗ ') + label);
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true, args: ['--enable-unsafe-swiftshader'] });
/** Projected 3D model: the framed phone must stay inside its canvas at every viewport. */
async function modelFit(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="tour-studio-canvas"]');
    const info = canvas?.__tourStudioInspect?.();
    if (!info) return { status: 'no-webgl' };
    const model = info.models.find(item => item.active);
    if (!model) return { status: 'no-model' };
    const mul = (matrix, point) => [0, 1, 2, 3].map(row => point.reduce((sum, value, column) => sum + matrix[column * 4 + row] * value, 0));
    const points = [];
    for (const mesh of model.meshes.filter(item => item.visible)) for (let corner = 0; corner < 8; corner++) {
      const local = [0, 1, 2].map(axis => (corner & 1 << axis ? mesh.max : mesh.min)[axis]);
      const clip = mul(info.camera.projectionMatrix, mul(info.camera.matrixWorldInverse, mul(mesh.matrixWorld, [...local, 1])));
      points.push({ x: clip[0] / clip[3], y: clip[1] / clip[3], w: clip[3] });
    }
    const ys = points.map(point => point.y), xs = points.map(point => point.x);
    return {
      status: 'ok', lesson: info.lesson, canvas: info.viewport, lenses: model.meshes.filter(mesh => /-lens-/.test(mesh.name)).length,
      meshes: model.meshes.length,
      fits: points.every(point => point.w > 0 && Math.abs(point.x) <= 1.02 && Math.abs(point.y) <= 1.02),
      heightFraction: (Math.max(...ys) - Math.min(...ys)) / 2,
      widthFraction: (Math.max(...xs) - Math.min(...xs)) / 2,
    };
  });
}
async function measure(page, label) {
  const value = await page.locator('.experience-tour').evaluate(panel => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom, right:r.right }; };
    const body = panel.querySelector('.og-panel-body'), foot = panel.querySelector('.og-panel-foot');
    const content = [...panel.querySelectorAll('.tour-copy-heading, .tour-steps li, .tour-real-action, .tour-stage, .tour-visual-note, .tour-explore, .experience-mode-picker, .tour-preserve')].filter(e => e.getClientRects().length);
    return {
      viewport: {width:innerWidth,height:innerHeight}, panel:rect(panel), body:rect(body), footer:rect(foot),
      scroll: {body:body.scrollHeight-body.clientHeight,panel:panel.scrollHeight-panel.clientHeight,document:document.documentElement.scrollHeight-innerHeight},
      content:content.map(e => ({class:e.className,...rect(e)})),
      buttons:[...foot.querySelectorAll('button')].map(e => { const r=rect(e), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return {text:e.textContent,...r,hit:!!hit&&e.contains(hit)}; }),
    };
  });
  report.samples.push({label,...value});
  check(value.scroll.body <= 1 && value.scroll.panel <= 1, label + ': no vertical guide overflow '+JSON.stringify(value.scroll));
  check(value.content.every(r => r.y >= value.body.y-1 && r.bottom <= value.footer.y+1), label + ': all demonstration and copy visible above footer');
  check(value.buttons.every(r => r.hit && r.y >= 0 && r.bottom <= value.viewport.height && r.x >= 0 && r.right <= value.viewport.width), label + ': footer controls visible and hit-testable');
  return value;
}
try {
  for (const [width,height] of [[1280,860],[1280,720],[1024,600],[1024,560],[960,540],[800,600],[800,560],[720,600],[640,600]]) {
    const context=await browser.newContext({viewport:{width,height},locale:'zh-CN',timezoneId:'Asia/Shanghai',hasTouch:width===375,reducedMotion:'reduce'});
    const page=await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror',e=>report.errors.push(e.message));
    await page.routeWebSocket('**/*', socket=>socket.close());
    await page.route('**/*', route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
    await page.addInitScript(()=>{
      Object.defineProperty(navigator,'platform',{value:'Win32'});
      localStorage.setItem('onethu.privacy.v1',JSON.stringify({acknowledged:true,cloud:true,oh:true}));
      localStorage.setItem('onethu.experience.v1','full');
      localStorage.setItem('onethu.onboarded.flow4','1');
      localStorage.setItem('onethu.overlay.closed','1');
      localStorage.setItem('onethu.chatdock.open','0');
    });
    await page.goto(base+'/?explorer-preview=onboarding&tour=1');
    await advanceOnboardingLanguage(page);
    const tour=page.locator('.experience-tour');
    await measure(page,`${width}x${height} intro`);
    await tour.getByRole('button',{name:'按此模式开始',exact:true}).click();
    await advanceOnboardingLayout(page);
    for(const chapter of ['搜索、OH 与插件','白板','暂存箱','口令','碰一碰','组织','清小搭']) {
      const button=tour.getByRole('button',{name:'跳到：'+chapter,exact:true});
      if(await button.count()) await button.click();
      else if(chapter!=='搜索、OH 与插件') throw new Error('Missing chapter '+chapter);
      await page.waitForTimeout(100);
      await measure(page,`${width}x${height} ${chapter}`);
      if(chapter==='暂存箱') {
        await page.screenshot({path:join(out,`${baseline?'before':'after'}-${width}-${height}.png`),animations:'disabled'});
        await page.waitForFunction(() => document.querySelector('[data-testid="tour-studio-canvas"]')?.__tourStudioInspect?.().settled,{timeout:15000}).catch(() => undefined);
        const fit=await modelFit(page);
        report.samples.push({label:`${width}x${height} model`,...fit});
        check(fit.status==='no-webgl'||(fit.fits&&fit.heightFraction>=.5),`${width}x${height} phone model projected inside the stage and large enough `+JSON.stringify({fit:fit.fits,height:fit.heightFraction,lenses:fit.lenses}));
      }
    }
    await tour.getByRole('button',{name:'跳到：准备完成',exact:true}).click();
    await measure(page,`${width}x${height} ready`);
    for(const id of ['explorer','onego','plugin','customize','campus','data']) {
      await tour.locator(`[data-lesson-id="${id}"]`).click();
      await measure(page,`${width}x${height} extra ${id}`);
      await tour.getByRole('button',{name:'返回完成页',exact:true}).click();
    }
    await context.close();
  }
  check(report.errors.length===0,'no uncaught application errors '+JSON.stringify(report.errors));
  if(!baseline) assert.equal(report.failures.length,0,report.failures.join('\n'));
  report.passed=report.failures.length===0;
} finally {
  await closeTestBrowser(browser);
  writeFileSync(join(out,`${baseline?'baseline':'report'}.json`),JSON.stringify(report,null,2)+'\n');
  console.log('Report: '+out);
}
