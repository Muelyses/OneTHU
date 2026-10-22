/** Real touch input on the mounted widget drawer; fictional data, external requests blocked. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setup, call, close, browser } from './capture-public-preview.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';

const out = process.env.ONETHU_TEST_OUT ?? '/tmp/onethu-board-add-touch';
mkdirSync(out, { recursive: true });
const checks = [];
const check = (value, label) => { assert.ok(value, label); checks.push(label); console.log('✓ ' + label); };
const count = page => page.locator('.free-item').count();
async function center(locator) {
  const r = await locator.boundingBox();
  assert.ok(r, 'Visible touch target');
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
async function gesture(client, points, cancel = false) {
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] });
  for (const point of points.slice(1)) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
  }
  await client.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
}
const tap = async (client, locator) => gesture(client, [await center(locator)]);
async function openWidget(page, client, id) {
  await tap(client, page.locator('[data-coach="home-add"]:visible'));
  const card = page.locator(`[data-widget-option="${id}"]`);
  await card.waitFor();
  await page.waitForTimeout(250);
  await card.scrollIntoViewIfNeeded();
  await tap(client, card);
  await page.locator(`[data-add-confirm="${id}"]`).waitFor();
  await page.waitForTimeout(100);
}
async function trackExit(page) {
  await page.evaluate(() => {
    window.__drawerExitOverview = false;
    window.__drawerTouchEvents = [];
    window.__drawerObserver = new MutationObserver(() => {
      if (document.querySelector('.add-drawer.is-out .add-overview')) window.__drawerExitOverview = true;
    });
    window.__drawerObserver.observe(document.body, { subtree: true, childList: true });
    for (const type of ['pointerup', 'pointercancel', 'click']) document.addEventListener(type, event => {
      if (event.target?.closest?.('[data-add-confirm]')) window.__drawerTouchEvents.push(type);
    }, true);
  });
}
async function confirmVisible(page, label) {
  check(await page.locator('[data-add-confirm]').evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.height >= 44 && r.top >= 0 && r.bottom <= innerHeight
      && [[.1,.5],[.5,.15],[.5,.5],[.5,.85],[.9,.5]].every(([x,y]) => el.contains(document.elementFromPoint(r.left+r.width*x,r.top+r.height*y)));
  }), label + ': full 44px confirmation target is above navigation and inside viewport');
}

let passed = false;
let current;
try {
  for (const [width, height] of [[360,780], [390,844], [844,390]]) {
    const { page, context } = await setup(width, height);
    current = page;
    const client = await context.newCDPSession(page);
    const label = `${width}×${height}`;
    await page.addStyleTag({ content: 'html{--og-safe-top:24px;--og-safe-bottom:34px}' });
    await tap(client, page.locator('[data-coach="home-edit"]'));
    await openWidget(page, client, 'custom:note');
    await confirmVisible(page, label);
    await trackExit(page);
    const before = await count(page);
    const point = await center(page.locator('[data-add-confirm]'));
    // Remain inside the 44px button. Previously pan-y issued pointercancel at 18px.
    if (width === 390) await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await gesture(client, [point, { x: point.x, y: point.y + 18 }]);
    check(await count(page) === before + 1, label + ': one touch with 18px thumb drift commits immediately once');
    await page.locator('.add-drawer').waitFor({ state: 'hidden' });
    check(await count(page) === before + 1, label + ': compatibility click never duplicates the widget');
    check(await page.evaluate(() => !window.__drawerExitOverview), label + ': closing never remounts the widget catalog');
    check(await page.evaluate(() => window.__drawerTouchEvents.includes('pointerup') && !window.__drawerTouchEvents.includes('pointercancel')), label + ': button gesture reaches pointerup without native scroll cancellation');
    if (width === 390) await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.evaluate(() => window.__drawerObserver.disconnect());

    await openWidget(page, client, 'text-label');
    const confirm = page.locator('[data-add-confirm]');
    let p = await center(confirm);
    await gesture(client, [p, { x:p.x, y:p.y-80 }, p]);
    check(await count(page) === before + 1 && await confirm.isVisible(), label + ': dragging away and back cancels instead of submitting');
    p = await center(confirm);
    await gesture(client, [p], true);
    check(await count(page) === before + 1 && await confirm.isVisible(), label + ': touch cancellation preserves the open selection');
    // Start close to the top edge, finish outside with a small movement.
    const r = await confirm.boundingBox();
    await gesture(client, [{x:p.x,y:r.y+2},{x:p.x,y:r.y-7}]);
    check(await count(page) === before + 1 && await confirm.isVisible(), label + ': release outside the button cancels even within the movement tolerance');
    await tap(client, confirm);
    check(await count(page) === before + 2, label + ': the next intentional tap after cancellation succeeds');
    await page.locator('.add-drawer').waitFor({state:'hidden'});

    await openWidget(page, client, 'custom:mine-gpa');
    const carousel = page.locator('[data-size-list]');
    const start = await center(carousel), end = await center(page.locator('[data-add-confirm]'));
    await gesture(client, [start,{x:start.x-45,y:start.y+20},{x:end.x,y:end.y}]);
    check(await count(page) === before + 2 && await page.locator('[data-add-confirm]').isVisible(), label + ': a size-preview drag ending over confirm adds nothing');
    const dots = page.locator('[data-size-dot]');
    await tap(client, dots.last());
    const selectedSize = await page.locator('[data-size-current]').getAttribute('data-size-current');
    await tap(client, page.locator('[data-add-confirm]'));
    check(await count(page) === before + 3, label + ': size change can be confirmed while its preview is animating');
    await page.locator('.add-drawer').waitFor({state:'hidden'});
    const requested = selectedSize.split('x').map(Number);
    const stored = await page.evaluate(() => {
      const doc = JSON.parse(localStorage.getItem('onethu.board.v1'));
      return doc.boards.flatMap(b => b.cells.portrait ?? []).find(it => it.spec.id === 'mine-gpa')?.cell;
    });
    check(stored?.w === requested[0] && stored?.h === requested[1], label + ': the chosen size is persisted in the actual board document');
    check(await page.locator('[data-tab-page="homepage"]:visible').count() === 1, label + ': release does not click through to OneShot or the background');

    await tap(client, page.locator('[data-coach="home-add"]:visible'));
    await page.locator('.add-scroll').waitFor();
    await page.waitForTimeout(250);
    const scroll = page.locator('.add-scroll');
    const sr = await scroll.boundingBox();
    const origin = { x:sr.x+sr.width/2, y:sr.y+sr.height-20 };
    const points = [origin, ...Array.from({length:10},(_,i)=>({x:origin.x,y:origin.y-(i+1)*Math.min(20,(sr.height-40)/10)}))];
    await gesture(client, points);
    await page.waitForTimeout(150);
    check(await scroll.evaluate(el => el.scrollTop > 0), label + ': the catalog keeps native vertical touch scrolling');
    await page.screenshot({path:out+`/catalog-${width}.png`});
    const last=page.locator('.add-card').last();await last.scrollIntoViewIfNeeded();await tap(client,last);
    await page.locator('[data-add-confirm]').waitFor();
    await confirmVisible(page,label+' bottom catalog item');
    await page.waitForTimeout(350);
    await page.screenshot({path:out+`/confirm-${width}.png`});
    await close(page,context);
  }

  {
    const {page,context}=await setup(390,844);current=page;
    const client=await context.newCDPSession(page);
    await page.evaluate(async()=>{
      const board=await import('/src/state/board.ts');const ops=await import('/src/state/boardOps.ts');
      const created=ops.createBoard(board.loadBoard(),'Fictional add-widget OnePage');
      board.saveBoard(ops.setActiveBoard(created.doc,created.board.id));
    });
    await call(page,'/src/state/explorer.ts','openTab',['board']);
    await page.locator('[data-tab-page="board"]:visible .freeboard-wrap').waitFor();
    await tap(client,page.locator('[data-coach="home-edit"]:visible'));
    await openWidget(page,client,'custom:note');
    const before=await count(page),p=await center(page.locator('[data-add-confirm]'));
    await gesture(client,[p,{x:p.x,y:p.y+18}]);
    check(await count(page)===before+1,'OnePage: one drifting touch adds the widget to the user board');
    await page.locator('.add-drawer').waitFor({state:'hidden'});
    check(await page.locator('[data-tab-page="board"]:visible .free-item[data-widget="note"]').count()===1,'OnePage: the current board owns the newly added widget');
    await close(page,context);
  }

  const {page,context}=await setup(1280,900,'full',{hasTouch:false});current=page;
  await page.locator('[data-coach="home-add"]').click();
  await page.locator('[data-widget-option="text-label"]').click();
  await page.locator('[data-add-confirm]').focus();
  const before=await count(page);
  await page.keyboard.press('Enter');
  check(await count(page)===before+1,'desktop: keyboard Enter adds exactly once');
  await page.locator('.add-drawer').waitFor({state:'hidden'});
  await page.locator('[data-coach="home-add"]').click();await page.locator('[data-widget-option="custom:note"]').click();
  await page.locator('[data-add-confirm]').click();
  check(await count(page)===before+2,'desktop: mouse click adds exactly once');
  await page.locator('.add-drawer').waitFor({state:'hidden'});
  await close(page,context);
  passed=true;
} catch(error) {
  if(current&&!current.isClosed()) {
    await current.screenshot({path:out+'/failure.png'}).catch(()=>{});
    writeFileSync(out+'/failure.txt',await current.locator('body').innerText().catch(()=>''));
  }
  throw error;
} finally {
  await closeTestBrowser(browser);
  writeFileSync(out+'/report.json',JSON.stringify({passed,checks,scope:'Isolated Chromium CDP touch input, real React drawer and persistence, fictional data; no physical Android install'},null,2));
}
