/** Automatic studio acceptance; simulations never mutate real user content. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser, advanceOnboardingLanguage } from './lib/onboarding-browser-steps.mjs';
import { recordScreencast } from './lib/onboarding-recording.mjs';

const out = process.env.ONETHU_AUTOPLAY_OUT ?? 'docs/onegui/onboarding-autoplay-2026-10-20';
const scope = process.env.ONETHU_AUTOPLAY_SCOPE ?? 'all';
assert.ok(['all', 'cycles', 'lifecycle', 'recordings'].includes(scope), 'Scope: all, cycles, lifecycle, recordings');
const sizes = (process.env.ONETHU_TEST_SIZES ?? '1280x860,390x844,320x568').split(',').map(value => value.split('x').map(Number));
for (const dir of ['after', 'frames', 'recordings']) mkdirSync(`${out}/${dir}`, { recursive: true });
const checks = [], errors = [], cycles = [], transitions = [], recordings = [], lifecycle = [], layout = [];
const report = { scope, sizes, checks, errors, cycles, transitions, recordings, lifecycle, layout, passed: false, naturalCleanup: false };
const check = (condition, text) => { assert.ok(condition, text); checks.push(text); console.log('✓ ' + text); };
const plans = { simple: ['essentials', 'today', 'quick'], practical: ['essentials', 'today', 'more', 'swap'], full: ['essentials', 'board', 'vault', 'code', 'nfc', 'organization', 'xiaoda'] };
const names = { simple: '极简', practical: '实用', full: '完整' };
const extras = ['explorer', 'onego', 'plugin', 'customize', 'campus', 'data'];
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--disable-updater-scheduler'],
});
let currentPage;
const snapshot = page => page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => /^onethu\.(?:vault|freeboard|board|orgs|onepage)/.test(key)).sort(([a], [b]) => a.localeCompare(b))));
const inspect = page => page.locator('.experience-tour [data-testid="tour-studio-canvas"]').evaluate(canvas => canvas.__tourStudioInspect?.());
const stage = page => page.locator('.experience-tour .tour-stage');
const tour = page => page.getByRole('dialog', { name: 'OneTHU 使用导览', exact: true });
const phase = (page, lesson, desired, settled = true, fallback = false) => page.waitForFunction(({ lesson, desired, settled, fallback }) => {
  const stage = document.querySelector('.experience-tour .tour-stage');
  if (stage?.getAttribute('data-lesson') !== lesson || stage.getAttribute('data-phase') !== desired) return false;
  if (fallback) return stage.querySelector('.tour-studio-scene')?.getAttribute('data-renderer') === 'fallback';
  const state = stage.querySelector('canvas')?.__tourStudioInspect?.();
  return state?.lesson === lesson && (!settled || state.settled && state.models.find(model => model.active)?.progress === (desired === 'after' ? 1 : 0));
}, { lesson, desired, settled, fallback }, { timeout: 22000 });

function projectModel(info, model) {
  const mul = (matrix, point) => [0, 1, 2, 3].map(row => point.reduce((sum, value, column) => sum + matrix[column * 4 + row] * value, 0));
  const points = [];
  for (const mesh of model.meshes.filter(mesh => mesh.visible)) for (let corner = 0; corner < 8; corner++) {
    const local = [0, 1, 2].map(axis => (corner & 1 << axis ? mesh.max : mesh.min)[axis]);
    const clip = mul(info.camera.projectionMatrix, mul(info.camera.matrixWorldInverse, mul(mesh.matrixWorld, [...local, 1])));
    points.push({ x: clip[0] / clip[3], y: clip[1] / clip[3], w: clip[3] });
  }
  return {
    minX: Math.min(...points.map(point => point.x)), maxX: Math.max(...points.map(point => point.x)),
    minY: Math.min(...points.map(point => point.y)), maxY: Math.max(...points.map(point => point.y)),
    fits: points.length > 0 && points.every(point => point.w > 0 && Math.abs(point.x) <= 1.015 && Math.abs(point.y) <= 1.015),
  };
}
async function openPage(width, height, fallback = false) {
  const page = currentPage = await browser.newPage({ viewport: { width, height }, hasTouch: width < 600 });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(`${width}x${height}: ${error.message}`));
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await installFakeCloud(page);
  await page.addInitScript(({ fallback }) => {
    localStorage.setItem('onethu.onboarded.phone', '1'); localStorage.setItem('onethu.chatdock.open', '0');
    performance.setResourceTimingBufferSize(10000);
    const qa = window.__autoplayQA = { scheduled: 0, pending: [] };
    const nativeRAF = requestAnimationFrame.bind(window), nativeCancel = cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      const tracked = /TourStudioScene/.test(new Error().stack ?? ''); let id;
      id = nativeRAF(time => { if (tracked) qa.pending = qa.pending.filter(handle => handle !== id); callback(time); });
      if (tracked) { qa.scheduled++; qa.pending.push(id); } return id;
    };
    window.cancelAnimationFrame = id => { qa.pending = qa.pending.filter(handle => handle !== id); nativeCancel(id); };
    if (fallback) {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /^(webgl2?|experimental-webgl)$/.test(type) ? null : original.call(this, type, ...args); };
    }
  }, { fallback });
  await page.goto((process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180') + '/?explorer-preview=onboarding');
  await page.locator('.explorer-shell').waitFor(); return page;
}
async function openMode(page, mode, start = true) {
  await page.evaluate(() => window.dispatchEvent(new Event('onethu.onboarding.replay')));
  await tour(page).waitFor();
  await advanceOnboardingLanguage(page);
  await tour(page).getByRole('button', { name: names[mode] + '模式', exact: true }).click();
  if (start) await tour(page).getByRole('button', { name: '按此模式开始', exact: true }).click();
}
async function visibleStage(page, lesson) {
  await page.waitForFunction(lesson => document.querySelector('.experience-tour .tour-stage')?.getAttribute('data-lesson') === lesson, lesson);
  await stage(page).locator('.tour-stage-canvas').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.experience-tour .tour-stage')?.getAttribute('data-running') === 'true');
}
async function closePage(page) { await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.request.dispose(); await page.close(); }
async function checkLayout(page, label) {
  const measured = await tour(page).evaluate(panel => {
    const r = panel.getBoundingClientRect(), foot = panel.querySelector('.og-panel-foot');
    const buttons = [...foot.querySelectorAll('button')].filter(button => !button.disabled).map(button => {
      const b = button.getBoundingClientRect();
      return { name: button.textContent, fits: b.left >= 0 && b.right <= innerWidth + 1 && b.top >= 0 && b.bottom <= innerHeight + 1, hit: button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)) };
    });
    return { panel: r.toJSON(), width: innerWidth, height: innerHeight, documentFits: document.documentElement.scrollWidth <= innerWidth + 1, buttons };
  });
  layout.push({ label, ...measured });
  check(measured.documentFits && measured.panel.left >= 0 && measured.panel.right <= measured.width + 1 && measured.panel.bottom <= measured.height + 1 && measured.buttons.every(button => button.fits && button.hit), label + ' 面板和固定页脚完整可用');
}
async function automaticCycle(page, lesson, label, capture = false, fallback = false) {
  await visibleStage(page, lesson);
  check(await stage(page).getAttribute('data-autoplay') === 'true' && await stage(page).getByRole('button').count() === 1 && await stage(page).getByRole('button', { name: '暂停演示', exact: true }).count() === 1, label + ' 仅保留暂停控制，不含点击模拟或重播');
  await phase(page, lesson, 'before', true, fallback);
  const beforeText = await stage(page).locator('.tour-stage-console').innerText();
  const observing = page.evaluate(({ lesson, fallback }) => new Promise((resolve, reject) => {
    const samples = [], start = performance.now(); let last = -Infinity, sawAfter = false;
    const tick = now => {
      const stage = document.querySelector('.experience-tour .tour-stage'), info = stage?.querySelector('canvas')?.__tourStudioInspect?.();
      const phase = stage?.getAttribute('data-phase'), actor = info?.models.find(model => model.active);
      if (stage?.getAttribute('data-lesson') !== lesson) return reject(new Error('Automatic observation changed lesson unexpectedly'));
      sawAfter ||= phase === 'after' && (fallback || info?.settled && actor?.progress === 1);
      const complete = sawAfter && phase === 'before' && (fallback || info?.settled && actor?.progress === 0);
      if (now - last >= 70 || complete) {
        last = now;
        samples.push({ time: now - start, phase, progress: actor?.progress, settled: info?.settled, frames: info?.frames, mesh: actor?.meshes.find(mesh => /screen|lid|card/.test(mesh.path))?.matrixWorld ?? actor?.meshes[0]?.matrixWorld, camera: info?.camera.position });
      }
      if (complete) resolve(samples);
      else if (now - start > 22000) reject(new Error(`Automatic ${lesson} did not complete before → after → before`));
      else requestAnimationFrame(tick);
    }; requestAnimationFrame(tick);
  }), { lesson, fallback });
  await phase(page, lesson, 'after', true, fallback);
  // The caption changes after the renderer reports its settled callback in React.
  await page.waitForFunction(text => document.querySelector('.experience-tour .tour-stage-console')?.textContent !== text, beforeText);
  const afterText = await stage(page).locator('.tour-stage-console').innerText();
  const actual = fallback ? undefined : await inspect(page);
  if (capture) await page.screenshot({ path: `${out}/after/${label}.png` });
  const observed = await observing;
  const phases = observed.map(sample => sample.phase).filter((value, index, array) => index === 0 || value !== array[index - 1]);
  const evidence = { label, lesson, phases, beforeText, afterText, observed };
  cycles.push(evidence);
  check(phases.join(',') === 'before,after,before' && afterText !== beforeText, label + ' 无点击自动展开、停留并收回，说明随阶段更新');
  if (actual) {
    const active = actual.models.find(model => model.active), projection = projectModel(actual, active);
    check(actual.renderer.calls > 0 && actual.renderer.triangles > 100 && new Set(observed.map(sample => JSON.stringify([sample.mesh, sample.camera]))).size >= 5 && observed.at(-1).frames > observed[0].frames, label + ' 真实网格连续运动并绘制');
    check(projection.fits, label + ' 自动结果模型完整位于舞台');
    evidence.projection = projection;
    if (active.meshes.some(mesh => mesh.path.includes('studio-phone'))) {
      evidence.screens = active.meshes.filter(mesh => mesh.visible && mesh.screen).map(mesh => ({ name: mesh.name, screen: mesh.screen, textureSources: mesh.textureSources }));
      check(evidence.screens.length > 0 && evidence.screens.every(mesh => mesh.textureSources.some(source => source && (new URL(source).pathname.endsWith(`/assets/tour/real-ui/${mesh.screen.key}.png`) || lesson === 'vault' && new URL(source).pathname.endsWith('/assets/tour/real-ui/vault-drag.mp4')))), label + ' 真实GPU手机纹理直接来自运行中app截图资产');
      if (lesson === 'nfc') check(evidence.screens.map(mesh => mesh.screen.key).sort().join(',') === 'vault-received,vault-send-code', label + ' 双机结果分别使用实际发送口令与实际接收结果画面');
    }
  } else {
    evidence.images = await stage(page).locator('.tour-real-display img').evaluateAll(images => images.map(image => ({ src: image.currentSrc, complete: image.complete, width: image.naturalWidth, height: image.naturalHeight })));
    check(evidence.images.length >= 2 && evidence.images.every(image => image.complete && image.width > 0 && image.src.includes('/assets/tour/real-ui/')), label + ' CSS降级同样显示真实app截图');
  }
}
async function cyclePass(page, width, height) {
  await page.evaluate(async () => {
    const call = async (path, name, args) => {
      const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname.endsWith(path)) ?? path;
      return (await import(url))[name](...args);
    };
    await call('/src/state/vault.ts', 'addToVault', [{ type: 'text', title: '自动演示隔离验收', text: '这条真实内容必须保留' }]);
    await call('/src/state/freeBoard.ts', 'addNote', [100, 100]);
    await call('/src/state/org.ts', 'createOrg', [{ name: '自动演示保留组织' }]);
  });
  const size = `${width}x${height}`, stored = await snapshot(page);
  check(Object.keys(stored).length >= 3, size + ' 已播种真实暂存箱、白板与组织存档用于隔离验收');
  for (const mode of width === 1280 ? ['simple', 'practical', 'full'] : ['full']) {
    await openMode(page, mode, false);
    if (width === 1280) await automaticCycle(page, 'mode-' + mode, `${size}-${mode}-intro`);
    await tour(page).getByRole('button', { name: '按此模式开始', exact: true }).click();
    if (width === 320) {
      await tour(page).getByRole('button', { name: '跳到：碰一碰', exact: true }).click();
      await checkLayout(page, size + '-nfc'); await automaticCycle(page, 'nfc', `${size}-nfc`, true);
      await tour(page).getByRole('button', { name: '跳过导览', exact: true }).click(); continue;
    }
    for (const lesson of plans[mode]) {
      await checkLayout(page, size + '-' + lesson);
      await automaticCycle(page, lesson, `${size}-${mode}-${lesson}`, ['nfc', 'today'].includes(lesson));
      await tour(page).getByRole('button', { name: '下一步', exact: true }).click();
    }
    if (width === 1280) {
      await automaticCycle(page, 'ready', `${size}-${mode}-ready`);
      if (mode === 'full') for (const lesson of extras) {
        await tour(page).locator(`[data-lesson-id="${lesson}"]`).click();
        await automaticCycle(page, lesson, `${size}-${mode}-${lesson}`);
        await tour(page).getByRole('button', { name: '返回完成页', exact: true }).click();
      }
    }
    await tour(page).getByRole('button', { name: '开始使用', exact: true }).click();
  }
  check(JSON.stringify(await snapshot(page)) === JSON.stringify(stored), size + ' 自动演示未改变真实白板、暂存箱和组织内容');
}
async function frozen(page, label, expectPhase) {
  await page.waitForTimeout(160);
  const read = () => page.evaluate(() => {
    const stage = document.querySelector('.experience-tour .tour-stage'), state = stage?.querySelector('canvas')?.__tourStudioInspect?.();
    return { phase: stage?.getAttribute('data-phase'), frames: state?.frames, pending: window.__autoplayQA.pending.length, scheduled: window.__autoplayQA.scheduled, actors: state?.models.map(model => ({ lesson: model.lesson, progress: model.progress, matrix: model.worldMatrix })) };
  });
  const first = await read(); await page.waitForTimeout(2200); const second = await read();
  lifecycle.push({ label, first, second });
  check(first.phase === second.phase && (!expectPhase || second.phase === expectPhase), label + ' 跨越停留时长仍保持阶段');
  check(first.frames === second.frames && first.scheduled === second.scheduled && second.pending === 0 && JSON.stringify(first.actors) === JSON.stringify(second.actors), label + ' 实际绘制、RAF 与物件姿态均停止');
}
async function setMotion(page, motion) {
  await page.evaluate(async motion => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname.endsWith('/packages/gui/src/pipeline/director.ts'));
    (await import(path)).og.set({ motion });
  }, motion);
}
async function lifecyclePass(page) {
  await openMode(page, 'full'); await visibleStage(page, 'board'); await phase(page, 'board', 'after', false);
  await stage(page).getByRole('button', { name: '暂停演示', exact: true }).click(); await frozen(page, '用户暂停');
  await tour(page).getByRole('button', { name: '下一步', exact: true }).click(); await frozen(page, '暂停后切课', 'before');
  check(await stage(page).getByRole('button', { name: '播放演示', exact: true }).count() === 1, '切课保留已暂停偏好');
  await stage(page).getByRole('button', { name: '播放演示', exact: true }).click(); await phase(page, 'vault', 'after');
  for (const source of ['system', 'application']) {
    if (source === 'system') await page.emulateMedia({ reducedMotion: 'reduce' }); else await setMotion(page, 'reduced');
    await page.waitForFunction(() => document.querySelector('.experience-tour .tour-stage')?.getAttribute('data-reduced') === 'true');
    await frozen(page, source + ' 减少动态', 'after');
    check(await stage(page).getByRole('button', { name: '已减弱动画', exact: true }).isDisabled(), source + ' 提供静态结果');
    if (source === 'system') await page.emulateMedia({ reducedMotion: 'no-preference' }); else await setMotion(page, 'full');
  }
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await frozen(page, '文档 hidden 事件模拟');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }); await phase(page, 'vault', 'after');
  await stage(page).evaluate(el => { el.style.transform = 'translateX(-300vw)'; });
  await page.waitForFunction(() => document.querySelector('.experience-tour .tour-stage')?.getAttribute('data-running') === 'false');
  await frozen(page, '舞台实际离开视口');
  await stage(page).evaluate(el => { el.style.removeProperty('transform'); }); await phase(page, 'vault', 'before');
  check(true, '重新可见后自动循环继续');
  const host = stage(page).locator('.tour-studio-scene');
  check(await host.locator('canvas').evaluate(canvas => { window.__lostContext = canvas.getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lostContext?.loseContext(); return !!window.__lostContext; }), '实际注入 WebGL 上下文丢失');
  await host.locator('.tour-studio-fallback').waitFor();
  await automaticCycle(page, 'vault', 'context-lost-fallback', false, true);
  await page.evaluate(() => window.__lostContext.restoreContext()); await phase(page, 'vault', 'after');
  check((await inspect(page)).renderer.calls > 0, '上下文恢复后自动绘制真实模型');
  await tour(page).getByRole('button', { name: '跳过导览', exact: true }).click();
  await tour(page).waitFor({ state: 'hidden' }); await frozen(page, '导览卸载');
}
async function transitionPass(page, width, height) {
  await openMode(page, 'full'); await visibleStage(page, 'board'); await phase(page, 'board', 'before');
  const observe = () => page.evaluate(projectSource => {
    const project = eval('(' + projectSource + ')'), frames = [];
    window.__transitionTrace = { frames, active: true }; let last = -Infinity, start = performance.now();
    const tick = now => {
      const info = document.querySelector('.experience-tour canvas[data-testid="tour-studio-canvas"]')?.__tourStudioInspect?.();
      if (info && now - last >= 28) {
        last = now;
        frames.push({ time: now - start, lesson: info.lesson, models: info.models.map(model => ({
          id: model.meshes[0]?.id, lesson: model.lesson, active: model.active, opacity: model.opacity, x: model.worldMatrix[12], projection: project(info, model),
          maxMaterialOpacity: Math.max(...model.meshes.flatMap(mesh => mesh.materials.map(material => material.opacity))),
          depthWritesWhileFading: model.opacity < .999 && model.meshes.some(mesh => mesh.materials.some(material => material.depthWrite)),
        })) });
      }
      if (window.__transitionTrace.active) requestAnimationFrame(tick);
    }; requestAnimationFrame(tick);
  }, projectModel.toString());
  const perform = async () => {
    await observe();
    for (let i = 0; i < 4; i++) { await tour(page).getByRole('button', { name: '下一步', exact: true }).click(); await page.waitForTimeout(1400); }
    await page.waitForTimeout(1500);
    await tour(page).getByRole('button', { name: '跳到：白板', exact: true }).click();
    for (const name of ['暂存箱', '口令', '白板', '碰一碰', '组织']) {
      await page.waitForTimeout(160); await tour(page).getByRole('button', { name: '跳到：' + name, exact: true }).click();
    }
    await visibleStage(page, 'organization'); await phase(page, 'organization', 'before');
    await page.evaluate(() => { window.__transitionTrace.active = false; });
  };
  const size = `${width}x${height}`;
  recordings.push(await recordScreencast(page, out, size + '-continuous-next', perform));
  const frames = await page.evaluate(() => window.__transitionTrace.frames);
  const ids = [...new Set(frames.flatMap(frame => frame.models.map(model => model.id)))], removed = [];
  for (const id of ids) {
    const observations = frames.flatMap((frame, index) => frame.models.filter(model => model.id === id).map(model => ({ index, time: frame.time, ...model })));
    const last = observations.at(-1);
    if (last.index === frames.length - 1) continue;
    const departing = observations.filter(model => !model.active);
    if (!departing.length) continue;
    const offscreen = last.projection.maxX < -1 || last.projection.minX > 1 || last.projection.maxY < -1 || last.projection.minY > 1;
    check(offscreen || last.maxMaterialOpacity < .015, `${size} ${last.lesson} 出画或真实近透明后才移除`);
    check(departing.every(model => !model.depthWritesWhileFading && model.maxMaterialOpacity <= model.opacity + .0001), `${size} ${last.lesson} 真实材质渐隐且不写深度`);
    check(departing.length >= 4 && new Set(departing.map(model => model.x)).size >= 4, `${size} ${last.lesson} 持续退场，没有边缘等待后突删`);
    removed.push({ id, lesson: last.lesson, samples: departing.length, last });
  }
  check(removed.length >= 5 && frames.every(frame => frame.models.length > 0), size + ' 连续与快速切课正常交接和清理');
  transitions.push({ size, removed, frames });
  await tour(page).getByRole('button', { name: '跳到：碰一碰', exact: true }).click(); await visibleStage(page, 'nfc'); await phase(page, 'nfc', 'before');
  recordings.push(await recordScreencast(page, out, size + '-nfc-autoplay', () => automaticCycle(page, 'nfc', size + '-nfc-final-screen', true)));
  await tour(page).getByRole('button', { name: '跳过导览', exact: true }).click();
  await tour(page).waitFor({ state: 'hidden' });
  await openMode(page, 'simple');
  const showSimple = () => automaticCycle(page, 'today', size + '-simple-real-screen', true);
  if (width === 390) recordings.push(await recordScreencast(page, out, 'mobile-single-phone', showSimple));
  else await showSimple();
  await tour(page).getByRole('button', { name: '跳过导览', exact: true }).click();
}
try {
  if (scope === 'all' || scope === 'cycles') for (const [width, height] of sizes) {
    const page = await openPage(width, height); await cyclePass(page, width, height); await closePage(page);
  }
  if (scope === 'all' || scope === 'lifecycle') {
    const page = await openPage(1280, 860); await lifecyclePass(page); await closePage(page);
    const fallback = await openPage(390, 844, true); await openMode(fallback, 'simple');
    await automaticCycle(fallback, 'today', 'no-webgl-fallback', true, true);
    await stage(fallback).getByRole('button', { name: '暂停演示', exact: true }).click(); await frozen(fallback, '无 WebGL 降级暂停'); await closePage(fallback);
  }
  if (scope === 'all' || scope === 'recordings') for (const [width, height] of sizes.filter(([width]) => width === 1280 || width === 390)) {
    const page = await openPage(width, height); await transitionPass(page, width, height); await closePage(page);
  }
  if (scope === 'recordings') {
    const page = await openPage(390, 844, true);
    await openMode(page, 'simple'); await automaticCycle(page, 'today', 'real-screenshot-fallback', true, true);
    await stage(page).getByRole('button', { name: '暂停演示', exact: true }).click(); await frozen(page, '真实截图降级暂停');
    await closePage(page);
  }
  check(errors.length === 0, '无浏览器页面异常'); report.passed = true;
} catch (error) {
  report.failure = error.stack;
  if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw error;
} finally {
  try { await closeTestBrowser(browser); report.naturalCleanup = true; }
  catch (error) { report.passed = false; report.cleanupFailure = error.stack; throw error; }
  finally { writeFileSync(`${out}/${process.env.ONETHU_TEST_REPORT ?? 'report.json'}`, JSON.stringify(report, null, 2) + '\n'); }
}
console.log(`${checks.length} autoplay browser assertions passed; browser cleanup complete`);
