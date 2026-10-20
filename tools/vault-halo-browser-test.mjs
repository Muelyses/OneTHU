/** Local acceptance halo and real vault transfer motions; no content preview panel. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
import { recordScreencast } from './lib/onboarding-recording.mjs';

const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = process.env.ONETHU_HALO_OUT ?? 'docs/onegui/vault-halo-2026-10-20';
const longTitle = '2026秋季学期人工智能研究课程资料与研讨项目合作计划最终修订版本.pdf';
const fixtures = [
  { type:'text',title:'随手记',text:'明天带上校园卡和实验报告。',source:'便笺' },
  { type:'payload',title:'研究资料夹',payload:{kind:'cloud-folder',repoId:'repo-one',path:'/研讨项目'},source:'云盘' },
  { type:'payload',title:'校园生活',payload:{kind:'tab',page:'home'},source:'标签页' },
  { type:'text',title:'Project_Reading_Notes_And_Review_2026_Autumn_Revision_Seven',text:'A distinct long English title for layout verification.',source:'文字' },
  { type:'file',title:longTitle,file:{name:longTitle,size:25234,mime:'application/pdf',hash:'qa-long-file'},source:'云盘' },
];
// Send continuous trusted touch samples; 0 retains the coarse six-step diagnostic.
const touchStep = Number(process.env.ONETHU_RADAR_TOUCH_STEP ?? 6);
const sizes = (process.env.ONETHU_TEST_SIZES ?? '1280x860,390x844,320x568,844x390').split(',').map(size => size.split('x').map(Number));
for (const name of ['screenshots', 'recordings', 'frames']) mkdirSync(`${out}/${name}`, { recursive: true });
const report = { sizes, fixtures, touchSampling: { maxStepPx: touchStep || null, intervalMs: touchStep ? 16 : 0, coarseSteps: touchStep ? null : 6 }, checks: [], errors: [], geometry: [], animations: [], recordings: [], input: [], passed: false, naturalCleanup: false };
const check = (value, message) => { assert.ok(value, message); report.checks.push(message); console.log('✓ ' + message); };
const call = (page, path, name, args = []) => page.evaluate(async ({ path, name, args }) => {
  const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname === path) ?? path;
  return (await import(url))[name](...args);
}, { path, name, args });
const countItems = page => page.evaluate(() => JSON.parse(localStorage.getItem('onethu.vaults.v1')).boxes.reduce((sum, box) => sum + box.items.length, 0));
const halo = page => page.locator('.vault-accept-halo');
const manager = page => page.locator('.vault-manager');
const anchor = page => page.locator('.vault-floating-anchor.is-ready .vault-box-button');
const source = (page, title) => page.locator('[data-vault-catch]:visible').filter({ hasText: title }).first();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--disable-updater-scheduler'],
});
let currentPage;

async function setup(width, height) {
  const touch = width !== 1280;
  const page = currentPage = await browser.newPage({ viewport: { width, height }, hasTouch: touch });
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => report.errors.push(`${width}x${height}: ${error.message}`));
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  // This fixture has no plugin PID/API configuration; also block external requests.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:5180|localhost:5180)/, route => route.abort());
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('onethu.onboarded.phone', '1');
    localStorage.setItem('onethu.experience.v1', 'full');
    localStorage.setItem('onethu.chatdock.open', '0');
    localStorage.setItem('onethu.test.cloud.v1', JSON.stringify({
      fs: { 'repo-one': { '/课程资料/说明.txt': '课程资料', '/研讨项目/说明.txt': '研讨项目', '/练习文件/说明.txt': '练习文件' } },
      repos: [{ id: 'repo-one', name: 'OneTHU', owner: 'tester@mails.tsinghua.edu.cn' }], shares: {}, seq: 0,
    }));
    window.__radarQA = { appearances: 0, pointers: [], touches: [], presses: [], contextMenus: [], clicks: [], oh: [] };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(type, event => {
      window.__radarQA.pointers.push({ time: performance.now(), type, pointerId: event.pointerId, pointerType: event.pointerType, trusted: event.isTrusted, x: event.clientX, y: event.clientY, active: document.body.classList.contains('is-vault-dragging') });
    }, true);
    document.addEventListener('touchmove', event => setTimeout(() => window.__radarQA.touches.push({ time: performance.now(), cancelled: event.defaultPrevented, cancelable: event.cancelable, active: document.body.classList.contains('is-vault-dragging') }), 0), { passive: true });
    window.addEventListener('contextmenu', event => {
      const entry={time:performance.now(),cancelled:false,target:event.target?.outerHTML.slice(0,240),detail:event.detail,pointerId:event.pointerId,trusted:event.isTrusted,active:document.body.classList.contains('is-vault-dragging'),owner:window.__vaultGestureOwner?.(),menus:document.querySelectorAll('[role=menu]').length};
      window.__radarQA.contextMenus.push(entry);setTimeout(()=>{entry.cancelled=event.defaultPrevented;},0);
    },true);
    window.addEventListener('click', event => {
      const target=event.target instanceof Element?event.target:null;
      const entry={time:performance.now(),trusted:event.isTrusted,detail:event.detail,pointerId:event.pointerId,active:document.body.classList.contains('is-vault-dragging'),owner:window.__vaultGestureOwner?.(),x:event.clientX,y:event.clientY,target:target?.outerHTML.slice(0,240),cancelled:false};
      window.__radarQA.clicks.push(entry);setTimeout(()=>{entry.cancelled=event.defaultPrevented;},0);
    },true);
    addEventListener('DOMContentLoaded', () => {
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes)
          if (node instanceof Element && (node.matches('.vault-accept-halo') || node.querySelector('.vault-accept-halo'))) window.__radarQA.appearances++;
      }).observe(document.body, { subtree: true, childList: true });
    });
  });
  await installFakeCloud(page);
  await page.route('**/src/plugins/ChatDock.tsx*', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('export function ohAsk(text) {', 'export function ohAsk(text) { window.__radarQA.oh.push(text);');
    assert.ok(body.includes('window.__radarQA.oh.push(text)'), 'Passive OH observer attaches to the real function');
    await route.fulfill({ response, body });
  });
  await page.route('**/src/state/data.ts*', async route => {
    const response = await route.fetch(); let body = await response.text();
    for (const name of ['useLearnData', 'useCampusData']) body = body.replace(`export function ${name}() {`, `export function ${name}() { return {data:{semester:{id:'fixture'},courses:[],homework:[],notifications:[],files:[],schedule:[]},state:'ready',error:null,reload:async()=>{}};`);
    await route.fulfill({ response, body });
  });
  await page.goto(base + '/?explorer-preview=onboarding');
  await page.locator('.explorer-shell').waitFor();
  await page.evaluate(async()=>{
    const path='/src/lib/gestureArena.ts';
    const url=performance.getEntriesByType('resource').map(entry=>entry.name).find(url=>new URL(url).pathname===path)??path;
    window.__vaultGestureOwner=(await import(url)).gestureOwner;
  });
  for (const item of fixtures) await call(page, '/src/state/vault.ts', 'addToVault', [item]);
  await call(page, '/src/state/explorer.ts', 'explorerNavigate', ['cloud']);
  await source(page, 'OneTHU').click();
  await source(page, '课程资料').waitFor();
  await anchor(page).waitFor();
  const cdp = await page.context().newCDPSession(page);
  let lastPoint;
  const input = {
    async down(locator) {
      await locator.scrollIntoViewIfNeeded();
      lastPoint = await locator.evaluate(element => {
        const rect = element.getBoundingClientRect();
        for (const dx of [Math.min(28, rect.width / 2), Math.min(70, rect.width / 2), rect.width / 2, rect.width - 20]) {
          const point = { x: rect.x + dx, y: rect.y + rect.height / 2 };
          if (element.contains(document.elementFromPoint(point.x, point.y))) return point;
        }
        throw Error('Source has no physically reachable press point');
      });
      await page.evaluate(point => {
        let element = document.elementFromPoint(point.x, point.y);
        const ancestors = [];
        while (element) {
          const style = getComputedStyle(element);
          ancestors.push({ tag: element.tagName, className: String(element.className), touchAction: style.touchAction,
            overflow: style.overflow, scrollTop: element.scrollTop, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight });
          element = element.parentElement;
        }
        window.__radarQA.presses.push({ time: performance.now(), point, ancestors });
      }, lastPoint);
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...lastPoint, radiusX: 3, radiusY: 3, force: 1, id: 1 }] });
      else { await page.mouse.move(lastPoint.x, lastPoint.y); await page.mouse.down(); }
    },
    async move(point) {
      if (touch) {
        const steps = touchStep ? Math.max(1, Math.ceil(Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) / touchStep)) : 6;
        for (let step = 1; step <= steps; step++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
            x: lastPoint.x + (point.x - lastPoint.x) * step / steps, y: lastPoint.y + (point.y - lastPoint.y) * step / steps, radiusX: 3, radiusY: 3, force: 1, id: 1,
          }] });
          if (touchStep) await page.waitForTimeout(16);
        }
      }
      else await page.mouse.move(point.x, point.y, { steps: 8 });
      lastPoint = point;
    },
    async up() { if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up(); },
    async swipeUp(locator, distance) {
      await input.down(locator);
      await input.move({ x: lastPoint.x + 2, y: Math.max(70, lastPoint.y - distance) });
      await input.up();
    },
    async cancel() {
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      else {
        await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.__radarQA.pointers.findLast(event => event.type === 'pointerdown').pointerId })));
        await page.mouse.up();
      }
    },
    tap: locator => touch ? locator.tap() : locator.click(),
    close: () => cdp.detach(),
  };
  return { page, input, label: `${width}x${height}`, width, height };
}

async function gone(page, label) {
  await halo(page).waitFor({ state: 'detached' });
  await page.waitForFunction(() => !document.body.classList.contains('is-vault-dragging') && !document.querySelector('.vault-drag-ghost'));
  check((await call(page, '/src/lib/gestureArena.ts', 'gestureOwner')) === null, label + ' 局部扫描、跟随物与手势所有权均释放');
}
async function hold(page, input, title, label, locator = source(page, title)) {
  const existingManagers = await manager(page).count();
  await input.down(locator);
  const startedAt = performance.now();
  await page.waitForTimeout(180);
  check(await halo(page).count() === 0, label + ' 短按阶段不提前显示局部扫描');
  await halo(page).waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.vault-accept-halo')).opacity === '1');
  await page.waitForTimeout(Math.max(0, 670 - (performance.now() - startedAt)));
  check(await halo(page).isVisible(), label + ' 长按内容才显示局部接受扫描');
  check(await manager(page).count() === existingManagers, label + ' 长按不意外切换管理弹层');
  check(await page.getByRole('menu').count() === 0, label + ' 长按收纳不叠加来源的菜单');
  check(await page.locator('.explorer-ctxmenu').count() === 0, label + ' 持续按住超过 650ms 不触发标签页背景菜单');
}
async function center(locator) {
  const rect = await locator.boundingBox();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
async function closeManager(page) {
  await page.keyboard.press('Escape'); await manager(page).waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.matches('.vault-box-button'));
}
async function setMotion(page, motion) {
  await page.evaluate(async motion => {
    const path = '/packages/gui/src/pipeline/director.ts';
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname.endsWith(path)) ?? path;
    (await import(url)).og.set({ motion });
  }, motion);
}
async function startFrames(page,label) {
  await page.evaluate(label=>{
    const samples=[]; let stopped=false,frame;
    const ids=new WeakMap();let nextId=1;
    const tick=()=>{
      const nodes=[...document.querySelectorAll('.vault-drag-ghost')].map(node=>{
        if(!ids.has(node))ids.set(node,nextId++);const style=getComputedStyle(node);
        const inner=node.querySelector('.vault-drag-card');
        return {id:ids.get(node),motion:node.dataset.vaultMotion,title:node.dataset.vaultTitle,origin:node.dataset.vaultOrigin,
          rect:node.getBoundingClientRect().toJSON(),opacity:Number(style.opacity),transform:style.transform,
          innerTransform:inner?getComputedStyle(inner).transform:null,
          destination:{x:Number(node.dataset.vaultDestinationX),y:Number(node.dataset.vaultDestinationY)},
          card:!!inner,icon:!!node.querySelector('.vault-drag-ghost-icon svg'),text:node.querySelector('.vault-drag-ghost-title')?.textContent};
      });
      const receivers=[...document.querySelectorAll('.vault-box-button,[data-oh-drop]')].map(node=>({
        kind:node.hasAttribute('data-oh-drop')?'oh':'vault',transform:getComputedStyle(node).transform,
        waapi:node.getAnimations().filter(animation=>animation.constructor.name==='Animation'&&animation.playState==='running').map(animation=>({duration:animation.effect?.getComputedTiming().duration,keyframes:animation.effect?.getKeyframes().map(frame=>frame.transform)})),
      }));
      const scan=document.querySelector('.vault-accept-scan');
      samples.push({time:performance.now(),nodes,receivers,halo:!!document.querySelector('.vault-accept-halo'),scanTransform:scan?getComputedStyle(scan).transform:null});
      if(!stopped)frame=requestAnimationFrame(tick);
    };
    window.__cardFrames={label,samples,stop(){stopped=true;cancelAnimationFrame(frame);}};tick();
  },label);
}
async function endFrames(page,label,expected,{reduced=false}={}) {
  await page.waitForFunction(()=>!document.querySelector('.vault-drag-ghost'));
  await page.waitForFunction(()=>[...document.querySelectorAll('.vault-box-button,[data-oh-drop]')].every(node=>node.getAnimations().every(animation=>animation.constructor.name!=='Animation'||animation.playState!=='running')));
  const trace=await page.evaluate(()=>{window.__cardFrames.stop();return{label:window.__cardFrames.label,samples:window.__cardFrames.samples};});
  const nodes=trace.samples.flatMap(frame=>frame.nodes),phases=[...new Set(nodes.map(node=>node.motion))];
  report.animations.push({...trace,expected,reduced});
  if(!reduced){
    check(phases.includes(expected),label+' 实际卡片进入 '+expected+' 动作');
    const moving=nodes.filter(node=>node.motion===expected);
    const states=new Set(moving.map(node=>`${node.transform}|${node.innerTransform}|${node.opacity}`));
    check(states.size>=3,label+' 连续绘制帧中实体位置或透明度实际变化');
    check(nodes.some(node=>node.icon&&node.card&&node.text),label+' 拾取物保留内容名称和类型图标');
    if(expected==='store')check(new Set(trace.samples.map(frame=>frame.scanTransform).filter(Boolean)).size>=3,label+' 局部扫描在真实连续帧中旋转');
    if(expected==='store'||expected==='oh'){
      const kind=expected==='store'?'vault':'oh';
      const receivers=trace.samples.flatMap(frame=>frame.receivers.filter(receiver=>receiver.kind===kind&&receiver.waapi.length));
      check(new Set(receivers.map(receiver=>receiver.transform)).size>=3,label+' 实际接收控件在抵达后压缩回弹');
    }
  }
  await gone(page,label);
  check(await page.locator('.is-vault-lifted').count()===0,label+' 动画结束还原来源高亮');
  return trace;
}
async function closeOh(page) {
  const panel=page.locator('.dock-panel');
  await panel.waitFor();await panel.getByRole('button',{name:'收起',exact:true}).click();await panel.waitFor({state:'hidden'});
}
async function haloGeometry(page,label,before) {
  const result=await page.evaluate(()=>{
    const el=document.querySelector('.vault-accept-halo'),ring=el.getBoundingClientRect();
    const button=document.querySelector('.vault-floating-anchor .vault-box-button').getBoundingClientRect();
    return{ring:ring.toJSON(),button:button.toJSON(),pointerEvents:getComputedStyle(el).pointerEvents,
      layerDrop:document.querySelector('.vault-accept-layer')?.hasAttribute('data-vault-drop'),
      targets:[...document.querySelectorAll('[data-vault-drop]')].map(node=>({className:node.className,rect:node.getBoundingClientRect().toJSON()})),
      panels:document.querySelectorAll('.vault-radar,.vault-radar-item').length};
  });
  report.geometry.push({label,before,...result});
  check(result.ring.width<=128&&result.ring.height<=128&&result.ring.width>70,label+' 接受扫描仅为按钮周围局部圆环');
  check(Math.abs(result.ring.x+result.ring.width/2-result.button.x-result.button.width/2)<1&&Math.abs(result.ring.y+result.ring.height/2-result.button.y-result.button.height/2)<1,label+' 扫描圆环与原按钮同心');
  check(['x','y','width','height'].every(key=>Math.abs(result.button[key]-before[key])<1),label+' 开始接收不改变原按钮位置或尺寸');
  check(result.panels===0&&result.pointerEvents==='none'&&!result.layerDrop,label+' 无大面板或内容卡，视觉层不拦截页面');
  check(result.targets.every(target=>target.rect.width<=128&&target.rect.height<=128),label+' 投递目标局限于按钮和局部圆环');
}
async function basicFlow({page,input,label}) {
  await page.evaluate(()=>{window.__radarQA.appearances=0;});
  await input.tap(anchor(page));await manager(page).waitFor();
  check(await halo(page).count()===0&&await page.evaluate(()=>window.__radarQA.appearances)===0,label+' 普通点击直接打开管理，全程无扫描闪现');
  await closeManager(page);
  await anchor(page).focus();await page.keyboard.press('Enter');await manager(page).waitFor();
  check(await halo(page).count()===0,label+' 键盘Enter打开管理不显示扫描');
  await closeManager(page);
  const before=await countItems(page),button=await anchor(page).boundingBox();
  await startFrames(page,label+' store');
  await hold(page,input,'课程资料',label+' store');
  await haloGeometry(page,label,button);
  await page.screenshot({path:`${out}/screenshots/${label}-hold.png`});
  await input.move(await center(halo(page)));
  await page.waitForFunction(()=>document.querySelector('.vault-floating-anchor')?.classList.contains('is-hover'));
  await page.screenshot({path:`${out}/screenshots/${label}-store-hover.png`});
  await input.up();await endFrames(page,label+' store','store');
  check(await countItems(page)===before+1,label+' 实际存入一项并完成飞入与接收回弹');
  await input.tap(anchor(page));await manager(page).waitFor();
  const row=manager(page).locator('.vault-item-in').filter({hasText:'随手记'});
  await startFrames(page,label+' withdrawal');
  await hold(page,input,'随手记',label+' withdrawal',row);
  await input.move(await center(page.locator('[data-oh-drop]:visible').first()));
  await page.locator('.transfer-oh-hint.is-active').waitFor();
  await input.up();await endFrames(page,label+' withdrawal','oh');
  await manager(page).waitFor({state:'hidden'});
  check(await page.evaluate(()=>window.__radarQA.oh.length===1&&window.__radarQA.oh[0].includes('随手记'))&&await countItems(page)===before+1,label+' 从管理取用的内容发给OH，原内容保留');
  await page.locator('.dock-panel').waitFor();
  check(await page.locator('.dock-panel').isVisible(),label+' 同次触摸释放后OH面板保持打开，无背景误触');
  await page.screenshot({path:`${out}/screenshots/${label}-oh-received.png`});
  await closeOh(page);
  await startFrames(page,label+' cancel');
  await hold(page,input,'练习文件',label+' cancel');await input.cancel();
  await endFrames(page,label+' cancel','return');
  check(await countItems(page)===before+1,label+' 取消动画返回来源，不误存入或删除');
}
async function additionalFlow({page,input,label,width}) {
  if(width!==390)return;
  await input.tap(anchor(page));await manager(page).waitFor();
  const row=manager(page).locator('.vault-item-in').filter({hasText:'随手记'}),before=await countItems(page);
  await startFrames(page,'duplicate return');
  await hold(page,input,'随手记','duplicate',row);await input.move(await center(halo(page)));await input.up();
  await endFrames(page,'duplicate return','return');
  check(await countItems(page)===before&&await manager(page).isVisible(),'重复存入回到来源，未新增且管理仍打开');
  await startFrames(page,'open takeout');await row.locator('.og-row').click();await page.locator('.vault-text-preview').waitFor();
  await endFrames(page,'open takeout','takeout');
  check(await page.locator('.vault-text-body').textContent()==='明天带上校园卡和实验报告。'&&await countItems(page)===before,'实际打开全文的取用动画不删除暂存内容');
  await page.keyboard.press('Escape');await page.locator('.vault-text-preview').waitFor({state:'hidden'});await closeManager(page);
  for(const mode of ['system','application']){
    if(mode==='system')await page.emulateMedia({reducedMotion:'reduce'});else await setMotion(page,'reduced');
    const beforeOh=await page.evaluate(()=>window.__radarQA.oh.length);
    await hold(page,input,'练习文件',mode+' reduced');
    const running=await page.evaluate(()=>[...document.querySelectorAll('.vault-accept-halo,.vault-drag-ghost')].flatMap(node=>node.getAnimations({subtree:true})).filter(animation=>animation.playState==='running'&&Number(animation.effect?.getComputedTiming().duration)>50).length);
    check(running===0,mode+' 减少动态下扫描与拾取物无持续运动');
    if(mode==='system')await page.screenshot({path:`${out}/screenshots/${label}-reduced.png`});
    await input.move(await center(page.locator('[data-oh-drop]:visible').first()));await page.locator('.transfer-oh-hint.is-active').waitFor();await input.up();
    check(await page.locator('.vault-drag-ghost').count()===0,mode+' 减少动态不播放飞行');await gone(page,mode+' reduced');
    check(await page.evaluate(()=>window.__radarQA.oh.length)===beforeOh+1&&await countItems(page)===before,mode+' 减少动态仍可真实投递且不改原数据');
    await closeOh(page);
    if(mode==='system')await page.emulateMedia({reducedMotion:'no-preference'});else await setMotion(page,'full');
  }
  await call(page,'/src/state/theme.ts','activateTheme',['onethu.theme.night']);
  const rect=await anchor(page).boundingBox();await hold(page,input,'练习文件','dark');await haloGeometry(page,'dark',rect);
  await page.screenshot({path:`${out}/screenshots/${label}-dark.png`});await input.cancel();await gone(page,'dark');
  await call(page,'/src/state/theme.ts','deactivateTheme');
  await call(page,'/src/state/vault.ts','createVault',['空箱验收']);await hold(page,input,'练习文件','empty');
  check(await page.locator('.vault-radar,.vault-radar-item').count()===0&&await anchor(page).getAttribute('aria-label')==='暂存箱，0 项','空箱仍只显示接收圆环，不制造内容预览');
  await page.screenshot({path:`${out}/screenshots/${label}-empty.png`});await input.cancel();await gone(page,'empty');
}
async function actualEntryFlow({page,input,label,width,height}) {
  const snapshot=()=>page.evaluate(()=>({
    time:performance.now(),rect:document.querySelector('.vault-box-button')?.getBoundingClientRect().toJSON(),
    anchor:document.querySelector('.vault-floating-anchor')?.outerHTML.slice(0,800),
    desktop:localStorage.getItem('onethu.vault-anchor.desktop.v1'),phone:localStorage.getItem('onethu.vault-anchor.phone.v1'),
    viewport:{width:innerWidth,height:innerHeight},owner:window.__vaultGestureOwner?.(),
  }));
  for(const [side,x,y]of[['left-middle',Math.round(width*.33),Math.round(height*.45)],['right-middle',Math.round(width*.73),Math.round(height*.36)]]){
    const before=await snapshot();
    await input.down(anchor(page));if(width!==1280)await page.waitForTimeout(500);
    await input.move({x,y});const during=await snapshot();await input.up();
    await page.waitForFunction(()=>!document.querySelector('.vault-floating-anchor')?.classList.contains('is-moving'));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const after=await snapshot();
    report.geometry.push({label:`${label} actual ${side} drag`,desired:{x,y},before,during,after});
    await page.screenshot({path:`${out}/screenshots/${label}-entry-${side}.png`});
    check(Math.abs(after.rect.y+after.rect.height/2-y)<20,`${label} ${side} 入口实际停在用户拖到的高度`);
    check(Math.abs(after.rect.x+after.rect.width/2-x)<20,`${label} ${side} 入口实际停在用户拖到的横向位置`);
    for(let repeat=0;repeat<3;repeat++){
      await input.tap(anchor(page));await manager(page).waitFor({timeout:2500});
      check(await manager(page).isVisible(),`${label} ${side} 拖动后第${repeat+1}次点击真实打开管理`);
      await closeManager(page);
    }
    report.input.push({label:`${label} ${side} before reload`,...await page.evaluate(()=>window.__radarQA)});
    await page.reload();await page.locator('.explorer-shell').waitFor();await anchor(page).waitFor();
    await page.evaluate(async()=>{
      const path='/src/lib/gestureArena.ts',url=performance.getEntriesByType('resource').map(entry=>entry.name).find(url=>new URL(url).pathname===path)??path;
      window.__vaultGestureOwner=(await import(url)).gestureOwner;
    });
    const restored=await snapshot();report.geometry.push({label:`${label} ${side} reload`,before:after,after:restored});
    check(Math.abs(restored.rect.x-after.rect.x)<3&&Math.abs(restored.rect.y-after.rect.y)<3,`${label} ${side} 刷新后保留真实落点`);
  }
}
try{
  for(const[width,height]of sizes){
    const ctx=await setup(width,height);
    if(process.env.ONETHU_HALO_ENTRY_ONLY==='1')await actualEntryFlow(ctx);
    else if([1280,390].includes(width)&&process.env.ONETHU_RADAR_SKIP_VIDEO!=='1'){
      const recording=await recordScreencast(ctx.page,out,`${ctx.label}-store-takeout`,()=>basicFlow(ctx));
      for(const frame of recording.filmstrip){const temporary=frame.path.replace(/\.jpg$/,'.cropped.jpg');execFileSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',frame.path,'-vf',`crop=${width}:${height}:0:0`,'-frames:v','1','-q:v','2',temporary],{stdio:'pipe'});renameSync(temporary,frame.path);}
      recording.filmstripCrop={x:0,y:0,width,height};report.recordings.push(recording);
    }else await basicFlow(ctx);
    if(process.env.ONETHU_HALO_ENTRY_ONLY!=='1')await additionalFlow(ctx);
    report.input.push({label:ctx.label,...await ctx.page.evaluate(()=>window.__radarQA)});
    await ctx.input.close();await ctx.page.unrouteAll({behavior:'ignoreErrors'});await ctx.page.request.dispose();await ctx.page.close();
  }
  check(report.errors.length===0,'无浏览器页面异常');report.passed=true;
}catch(error){
  report.failure=error.stack;
  if(currentPage&&!currentPage.isClosed()){
    report.failureState=await currentPage.evaluate(()=>({qa:window.__radarQA,frames:window.__cardFrames?.samples,html:document.querySelector('.vault-accept-layer')?.outerHTML})).catch(()=>null);
    await currentPage.screenshot({path:`${out}/failure.png`}).catch(()=>{});
  }
  throw error;
}finally{
  try{await closeTestBrowser(browser);report.naturalCleanup=true;}catch(error){report.passed=false;report.cleanupFailure=error.stack;throw error;}
  finally{writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');}
}
console.log(`${report.checks.length} vault halo assertions passed; browser cleanup complete`);
