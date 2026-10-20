/** Interactive guide acceptance. Browser simulation is not physical phone/NFC performance evidence. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';

const out = 'docs/onegui/onboarding-motion-2026-10-20';
for (const dir of ['after', 'frames']) mkdirSync(`${out}/${dir}`, { recursive: true });
const sizes = (process.env.ONETHU_TEST_SIZES ?? '1280x860,390x844,320x568,844x390').split(',').map(size => size.split('x').map(Number));
const checks = [], errors = [], geometry = [], samples = [], recordings = [], objectMotion = [];
let passed = false;
const check = (value, message) => { assert.ok(value, message); checks.push(message); console.log('✓ ' + message); };
const plans = { simple: ['today', 'quick'], practical: ['today', 'more', 'swap'], full: ['board', 'vault', 'code', 'nfc', 'organization'] };
const names = { simple: '极简', practical: '实用', full: '完整' };
const optional = ['explorer', 'onego', 'plugin', 'customize', 'campus', 'data'];
const call = (page, path, method, args = []) => page.evaluate(async ({ path, method, args }) => {
  const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname.endsWith(path)) ?? path;
  return (await import(url))[method](...args);
}, { path, method, args });
const contentSnapshot = page => page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => /^onethu\.(?:vault|freeboard|board|orgs|onepage)/.test(key)).sort(([a], [b]) => a.localeCompare(b))));
const setAxes = (page, patch) => page.evaluate(async patch => {
  const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname.endsWith('/packages/gui/src/pipeline/director.ts'));
  if (!url) throw new Error('Loaded OneGUI director module not found');
  (await import(url)).og.set(patch);
}, patch);
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-updater-scheduler'] });

/** Encode real compositor frames at their captured intervals; never invent intermediate motion. */
async function recordScreencast(page, name, performActions) {
  const session = await page.context().newCDPSession(page);
  const captured = [], acknowledgments = [];
  const onFrame = event => {
    captured.push({ timestamp: event.metadata.timestamp, metadata: event.metadata, data: Buffer.from(event.data, 'base64') });
    acknowledgments.push(session.send('Page.screencastFrameAck', { sessionId: event.sessionId }));
  };
  const raw = mkdtempSync(join(tmpdir(), 'onethu-tour-recording-'));
  try {
    await session.send('Page.enable');
    // Headless Chrome's outer window includes browser chrome even with an emulated CSS viewport.
    // Calibrate from real compositor metadata so recordings include the fixed footer.
    let calibrationTimer;
    const calibration = new Promise((resolve, reject) => {
      const listener = event => {
        session.send('Page.screencastFrameAck', { sessionId: event.sessionId });
        clearTimeout(calibrationTimer); session.off('Page.screencastFrame', listener); resolve(event.metadata);
      };
      session.on('Page.screencastFrame', listener);
      calibrationTimer = setTimeout(() => { session.off('Page.screencastFrame', listener); reject(new Error('No screencast calibration frame')); }, 5000);
    });
    await session.send('Page.startScreencast', { format: 'jpeg', quality: 40, everyNthFrame: 1 });
    const metadata = await calibration;
    await session.send('Page.stopScreencast');
    const viewport = page.viewportSize(), { windowId, bounds } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', { windowId, bounds: { width: bounds.width + viewport.width - metadata.deviceWidth, height: bounds.height + viewport.height - metadata.deviceHeight } });
    assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), viewport, 'Recording calibration must preserve the tested CSS viewport');
    session.on('Page.screencastFrame', onFrame);
    await session.send('Page.startScreencast' , { format: 'jpeg', quality: 88, maxWidth: 1280, maxHeight: 860, everyNthFrame: 2 });
    await performActions();
    await session.send('Page.stopScreencast');
    await Promise.all(acknowledgments);
    assert.ok(captured.length > 4, 'Screencast must contain actual compositor frames');
    assert.ok(captured.every(frame => frame.metadata.deviceWidth >= viewport.width && frame.metadata.deviceHeight >= viewport.height && frame.metadata.deviceWidth <= 1280 && frame.metadata.deviceHeight <= 860), 'Every unscaled recording frame must cover the full tested CSS viewport');
    const manifest = [];
    captured.forEach((frame, index) => {
      const filename = join(raw, `${String(index).padStart(5, '0')}.jpg`);
      writeFileSync(filename, frame.data);
      manifest.push(`file '${filename}'`, 'option framerate 1000');
      if (index + 1 < captured.length) manifest.push(`duration ${Math.max(0.001, captured[index + 1].timestamp - frame.timestamp).toFixed(6)}`);
    });
    const listing = join(raw, 'frames.ffconcat');
    writeFileSync(listing, manifest.join('\n') + '\n');
    mkdirSync(`${out}/recordings`, { recursive: true });
    const video = `${out}/recordings/${name}.mp4`;
    execFileSync(process.env.FFMPEG_BIN ?? 'ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listing, '-fps_mode', 'vfr', '-vf', `crop=${viewport.width}:${viewport.height}:0:0,pad=ceil(iw/2)*2:ceil(ih/2)*2`, '-c:v', 'libx264', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], { stdio: 'pipe' });
    const first = captured[0].timestamp, last = captured.at(-1).timestamp;
    const filmstrip = [0, .2, .4, .6, .8, 1].map((fraction, index) => {
      const target = first + (last - first) * fraction;
      const frame = captured.reduce((nearest, candidate) => Math.abs(candidate.timestamp - target) < Math.abs(nearest.timestamp - target) ? candidate : nearest);
      const path = `${out}/frames/${name}-${index}.jpg`;
      writeFileSync(path, frame.data);
      return { path, capturedAtSeconds: frame.timestamp - first };
    });
    return { video, viewport, crop: { x: 0, y: 0, ...viewport }, compositorViewport: { width: captured[0].metadata.deviceWidth, height: captured[0].metadata.deviceHeight }, frameCount: captured.length, durationSeconds: last - first, capturedFrameOffsetsSeconds: captured.map(frame => frame.timestamp - first), filmstrip, note: 'CDP compositor captures with original frame intervals; only the outer window area beyond the CSS viewport is cropped, no page content removed. Recording adds overhead and is not a frame-rate benchmark.' };
  } finally {
    session.off('Page.screencastFrame', onFrame);
    await session.send('Page.stopScreencast').catch(() => {});
    await Promise.allSettled(acknowledgments);
    await session.detach();
    rmSync(raw, { recursive: true, force: true });
  }
}

const studioInspect = tour => tour.locator('[data-testid="tour-studio-canvas"]').evaluate(canvas => canvas.__tourStudioInspect());
function projectStudio(info) {
  const multiply = (matrix, point) => [0, 1, 2, 3].map(row => point.reduce((sum, value, column) => sum + matrix[column * 4 + row] * value, 0));
  const points = [], meshes = [];
  for (const model of info.models.filter(model => model.active)) for (const mesh of model.meshes.filter(mesh => mesh.effectiveVisible ?? mesh.visible)) {
    const projected = [];
    for (let corner = 0; corner < 8; corner++) {
      const local = [0, 1, 2].map(axis => (corner & (1 << axis) ? mesh.max : mesh.min)[axis]);
      const world = multiply(mesh.matrixWorld, [...local, 1]);
      const view = multiply(info.camera.matrixWorldInverse, world), clip = multiply(info.camera.projectionMatrix, view);
      projected.push({ x: clip[0] / clip[3], y: clip[1] / clip[3], z: clip[2] / clip[3], w: clip[3] });
    }
    points.push(...projected); meshes.push({ path: mesh.path ?? mesh.name, points: projected });
  }
  const fits = points.length > 0 && points.every(point => point.w > 0 && Math.abs(point.x) <= 1.015 && Math.abs(point.y) <= 1.015 && Math.abs(point.z) <= 1.015);
  return { fits, meshCount: meshes.length, bounds: { minX: Math.min(...points.map(point => point.x)), maxX: Math.max(...points.map(point => point.x)), minY: Math.min(...points.map(point => point.y)), maxY: Math.max(...points.map(point => point.y)) }, outside: meshes.filter(mesh => mesh.points.some(point => point.w <= 0 || Math.abs(point.x) > 1.015 || Math.abs(point.y) > 1.015 || Math.abs(point.z) > 1.015)) };
}

async function readyStudio(tour, renderer = 'webgl', expectedLesson) {
  const lesson = expectedLesson ?? await tour.locator('.tour-stage').getAttribute('data-lesson');
  await tour.page().waitForFunction(({ renderer, lesson }) => {
    const stage = document.querySelector('.experience-tour .tour-stage');
    const host = stage?.querySelector('.tour-studio-scene');
    if (stage?.getAttribute('data-lesson') !== lesson || host?.getAttribute('data-renderer') !== renderer || host?.getAttribute('data-settled') !== 'true') return false;
    if (renderer === 'fallback') return true;
    const actual = host.querySelector('canvas')?.__tourStudioInspect?.();
    return actual?.lesson === lesson && actual.settled;
  }, { renderer, lesson });
}

async function replay(page, mode, capture = false, renderer = 'webgl') {
  await page.evaluate(() => window.dispatchEvent(new Event('onethu.onboarding.replay')));
  const tour = page.getByRole('dialog', { name: 'OneTHU 使用导览' });
  await tour.waitFor();
  await tour.getByRole('button', { name: names[mode] + '模式', exact: true }).click();
  if (capture) {
    const { width, height } = page.viewportSize();
    await page.screenshot({ path: `${out}/after/intro-${mode}-${width}x${height}.png`, animations: 'disabled' });
    check(await tour.getByRole('button', { name: names[mode] + '模式', exact: true }).getAttribute('aria-pressed') === 'true', `${width}x${height} 模式卡清楚标记已选择${names[mode]}模式`);
  }
  await tour.getByRole('button', { name: '按此模式开始', exact: true }).click();
  await tour.locator(`.tour-stage[data-lesson="${plans[mode][0]}"]`).waitFor();
  await readyStudio(tour, renderer);
  return tour;
}

async function layout(page, tour, prefix, lesson) {
  await readyStudio(tour, 'webgl', lesson);
  const result = await tour.evaluate(el => {
    const rect = el.getBoundingClientRect(), stage = el.querySelector('.tour-stage'), heading = el.querySelector('h2');
    const body = el.querySelector('.og-panel-body');
    const foot = el.querySelector('.og-panel-foot');
    const rail = el.querySelector('.tour-chapters'), current = rail?.querySelector('[aria-current="step"]');
    const railRect = rail?.getBoundingClientRect(), currentRect = current?.getBoundingClientRect();
    const buttons = [...(foot?.querySelectorAll('button') ?? [])].filter(button => !button.disabled).map(button => {
      const r = button.getBoundingClientRect();
      return { text: button.textContent, visible: r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight, hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
    });
    return { rect: rect.toJSON(), stage: stage?.getBoundingClientRect().toJSON(), stageFits: !stage || stage.scrollWidth <= stage.clientWidth + 1, heading: heading?.getBoundingClientRect().toJSON(), bodyScrollTop: body?.scrollTop, panelScrollTop: el.scrollTop, body: body?.getBoundingClientRect().toJSON(), foot: foot?.getBoundingClientRect().toJSON(), currentChapter: current?.textContent, currentFits: !currentRect || currentRect.left >= railRect.left - 1 && currentRect.right <= railRect.right + 1, buttons, documentFits: document.documentElement.scrollWidth <= innerWidth + 1, width: innerWidth, height: innerHeight };
  });
  geometry.push({ prefix, lesson, ...result });
  check(result.rect.x >= 0 && result.rect.y >= 0 && result.rect.right <= result.width + 1 && result.rect.bottom <= result.height + 1 && result.documentFits && result.stageFits, `${prefix} ${lesson} 面板与舞台无横向越界`);
  check(result.buttons.length > 0 && result.buttons.every(button => button.visible && button.hit), `${prefix} ${lesson} 页脚按钮完整可点`);
  check(result.panelScrollTop === 0 && result.heading && result.heading.y >= result.rect.y && result.heading.bottom <= result.foot.y + 1, `${prefix} ${lesson} 切课后标题可见，没有沿用旧滚动位置`);
  if (result.currentChapter) check(result.currentFits, `${prefix} ${lesson} 章节栏自动滚到当前课程`);
  // In short viewports the explanatory heading may initially place the renderer below the fold.
  // Check that initial layout first, then scroll like a user and inspect an actually painted scene.
  await tour.locator('.tour-stage-canvas').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.experience-tour .tour-studio-scene')?.getAttribute('data-running') === 'true');
  await readyStudio(tour, 'webgl', lesson);
  const projection = projectStudio(await studioInspect(tour));
  geometry.push({ prefix, lesson, kind: 'studio-projection-before', ...projection });
  check(projection.fits, `${prefix} ${lesson} 当前真实3D模型独立投影完整位于画布内`);
  await tour.locator(':scope > .og-panel-body').evaluate(el => { el.scrollTop = 0; });
}

async function exerciseStage(page, tour, prefix, lesson, capture) {
  const stage = tour.locator(`.tour-stage[data-lesson="${lesson}"]`);
  await stage.waitFor();
  await readyStudio(tour);
  await stage.getByRole('button', { name: /^试一试：/ }).click({ trial: true });
  const stored = await contentSnapshot(page);
  const explanationBefore = await stage.locator('.tour-stage-console [role="status"]').innerText();
  await stage.getByRole('button', { name: /^试一试：/ }).click();
  await page.waitForFunction(id => document.querySelector(`.tour-stage[data-lesson="${id}"]`)?.getAttribute('data-phase') === 'after', lesson);
  check(await stage.locator('.tour-stage-console [role="status"]').innerText() !== explanationBefore, `${prefix} ${lesson} 真实点击演示切到可读的结果状态`);
  if (capture) {
    await stage.locator('.tour-stage-canvas').scrollIntoViewIfNeeded();
    await readyStudio(tour);
    const projection = projectStudio(await studioInspect(tour));
    geometry.push({ prefix, lesson, kind: 'studio-projection-after', ...projection });
    check(projection.fits, `${prefix} ${lesson} 操作后的真实3D模型投影无裁切`);
    if (page.viewportSize().height <= 650) await page.screenshot({ path: `${out}/after/${prefix}-${lesson}-interaction.png`, animations: 'disabled' });
    await tour.locator(':scope > .og-panel-body').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `${out}/after/${prefix}-${lesson}.png`, animations: 'disabled' });
  }
  await stage.getByRole('button', { name: '重播演示', exact: true }).click();
  await page.waitForFunction(id => document.querySelector(`.tour-stage[data-lesson="${id}"]`)?.getAttribute('data-phase') === 'before', lesson);
  check(true, `${prefix} ${lesson} 重播回到演示起点`);
  const pause = stage.getByRole('button', { name: '暂停演示', exact: true });
  if (await pause.count()) await pause.click();
  await page.waitForFunction(id => document.querySelector(`.tour-stage[data-lesson="${id}"]`)?.getAttribute('data-running') === 'false', lesson);
  await stage.getByRole('button', { name: /^试一试：/ }).click();
  check(await stage.getAttribute('data-phase') === 'after', `${prefix} ${lesson} 暂停时仍可查看操作结果`);
  const play = stage.getByRole('button', { name: '播放演示', exact: true });
  if (await play.count()) await play.click();
  check(JSON.stringify(await contentSnapshot(page)) === JSON.stringify(stored), `${prefix} ${lesson} 演示未改真实白板、暂存箱或组织存档`);
}

async function samplePerformance(page, tour) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  try {
    const recording = page.evaluate(() => new Promise(resolve => {
      const times = [], tasks = [], start = performance.now();
      let previous = start;
      const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => ({ start: entry.startTime - start, duration: entry.duration }))));
      observer.observe({ entryTypes: ['longtask'] });
      const tick = now => {
        times.push(now - previous); previous = now;
        if (now - start < 2400) requestAnimationFrame(tick);
        else { observer.disconnect(); resolve({ duration: now - start, intervals: times.slice(1), longTasks: tasks }); }
      };
      requestAnimationFrame(tick);
    }));
    const stage = tour.locator('.tour-stage');
    await stage.getByRole('button', { name: '重播演示', exact: true }).click();
    await stage.getByRole('button', { name: /^试一试：/ }).click();
    await page.waitForTimeout(600);
    await stage.getByRole('button', { name: '重播演示', exact: true }).click();
    const raw = await recording;
    const sorted = [...raw.intervals].sort((a, b) => a - b);
    samples.push({ scope: 'Local headless Chrome, 4x CPU throttle, guide board interaction only; not physical phone frame rate', ...raw, p50: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)], max: Math.max(...sorted) });
    check(raw.intervals.length > 10, '4x CPU 下取得真实 RAF/LongTask 参考采样，不设置虚假的绝对流畅阈值');
  } finally { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await cdp.detach(); }
}

/** Cross-check the real renderer with WebGL calls, pixel reads and independent matrix projection. */
async function studioProbe(fallbackOnly = false) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(`studio probe: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') console.error(`studio browser console: ${message.text()} ${JSON.stringify(message.location())}`); });
  page.on('response', response => { if (response.status() >= 400 && /^http:\/\/(?:127\.0\.0\.1|localhost):5180\//.test(response.url())) console.error(`studio local response: ${response.status()} ${response.url()}`); });
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await installFakeCloud(page);
  await page.addInitScript(({ fallbackOnly }) => {
    localStorage.setItem('onethu.onboarded.phone', '1'); localStorage.setItem('onethu.chatdock.open', '0');
    performance.setResourceTimingBufferSize(10000);
    const qa = window.__studioQA = { draws: 0, scheduled: 0, pending: [], pixels: [], capturePixels: false, lastRead: -Infinity };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (fallbackOnly && /^(webgl2?|experimental-webgl)$/.test(type)) return null;
      return getContext.call(this, type, ...args);
    };
    const nativeRAF = requestAnimationFrame.bind(window), nativeCancel = cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      const tracked = /TourStudioScene/.test(new Error().stack ?? '');
      let id;
      id = nativeRAF(time => { if (tracked) qa.pending = qa.pending.filter(handle => handle !== id); callback(time); });
      if (tracked) { qa.scheduled++; qa.pending.push(id); }
      return id;
    };
    window.cancelAnimationFrame = id => { qa.pending = qa.pending.filter(handle => handle !== id); nativeCancel(id); };
    for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
      for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'].filter(method => type.prototype[method])) {
        const original = type.prototype[method];
        type.prototype[method] = function(...args) {
          const result = original.apply(this, args);
          if (!this.canvas.matches?.('[data-testid="tour-studio-canvas"]')) return result;
          qa.draws++;
          if (qa.capturePixels && performance.now() - qa.lastRead > 90 && !this.isContextLost() && this.getParameter(this.FRAMEBUFFER_BINDING) === null) {
            qa.lastRead = performance.now();
            const w = this.drawingBufferWidth, h = this.drawingBufferHeight;
            const data = new Uint8Array(w * h * 4); this.readPixels(0, 0, w, h, this.RGBA, this.UNSIGNED_BYTE, data);
            let hash = 2166136261, nonzero = 0;
            for (let i = 0; i < data.length; i += 4) { nonzero += data[i + 3] > 0 ? 1 : 0; hash = Math.imul(hash ^ data[i], 16777619); hash = Math.imul(hash ^ data[i + 1], 16777619); }
            const debug = this.getExtension('WEBGL_debug_renderer_info');
            qa.pixels.push({ time: qa.lastRead, hash: hash >>> 0, nonzero, width: w, height: h, renderer: debug ? this.getParameter(debug.UNMASKED_RENDERER_WEBGL) : this.getParameter(this.RENDERER) });
          }
          return result;
        };
      }
    }
  }, { fallbackOnly });
  await page.goto((process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180') + '/?explorer-preview=onboarding');
  await page.locator('.explorer-shell').waitFor();
  const tour = await replay(page, 'full', false, fallbackOnly ? 'fallback' : 'webgl');
  const stage = tour.locator('.tour-stage');
  const counters = () => page.evaluate(() => ({ draws: window.__studioQA.draws, scheduled: window.__studioQA.scheduled, pending: [...window.__studioQA.pending] }));
  const stopped = async label => {
    await page.waitForTimeout(180); const before = await counters(); await page.waitForTimeout(240); const after = await counters();
    objectMotion.push({ kind: 'stopped-renderer', label, before, after });
    check(before.draws === after.draws && before.scheduled === after.scheduled && after.pending.length === 0, `${label}：真实 WebGL 绘制与渲染 RAF 都停止`);
  };
  if (fallbackOnly) {
    check(await stage.locator('.tour-studio-fallback').isVisible() && (await counters()).draws === 0, '无 WebGL 时显示可读物件降级，没有伪造GPU渲染');
    await stage.getByRole('button', { name: /^试一试：/ }).click();
    check(await stage.getAttribute('data-phase') === 'after', '无 WebGL 仍可操作并阅读演示结果');
    await stage.getByRole('button', { name: '暂停演示', exact: true }).click();
    const fallback = stage.locator('.tour-studio-fallback');
    await page.waitForTimeout(100);
    check(await fallback.evaluate(el => el.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')), '降级物件暂停时同样停止实际动画');
    await page.screenshot({ path: `${out}/after/webgl-unavailable-fallback.png`, animations: 'disabled' });
  } else {
    const labels = { board: '白板', vault: '暂存箱', code: '口令', nfc: '碰一碰', organization: '组织' };
    let boardMemory;
    for (const [lesson, label] of Object.entries(labels)) {
      await tour.getByRole('button', { name: '跳到：' + label, exact: true }).click(); await readyStudio(tour, 'webgl', lesson);
      const info = await studioInspect(tour);
      if (lesson === 'board') boardMemory = info.renderer.memory;
      check(info.renderer.calls > 0 && info.renderer.triangles > 100 && (await counters()).draws > 0, `${lesson} 实际绘制三维三角网格并调用 WebGL`);
      check(projectStudio(info).fits, `${lesson} 操作前模型独立NDC投影完整位于画布内`);
      await stopped(`${lesson} 终态无持续空转`);
      await page.evaluate(() => { window.__studioQA.capturePixels = true; window.__studioQA.pixels = []; });
      const trace = page.evaluate(() => new Promise(resolve => {
        const samples = [], start = performance.now(); let previous = -Infinity;
        const tick = now => {
          if (now - previous > 65) {
            previous = now;
            const info = document.querySelector('[data-testid="tour-studio-canvas"]').__tourStudioInspect();
            const active = info.models.find(model => model.active), stride = Math.max(1, Math.floor(active.meshes.length / 8));
            samples.push({ time: now - start, lesson: info.lesson, settled: info.settled, progress: active.progress, camera: info.camera, models: info.models.map(model => ({ lesson: model.lesson, active: model.active })), objects: active.meshes.filter((mesh, index) => index % stride === 0 || /frame|lid/.test(mesh.path ?? mesh.name)).slice(0, 14).map(mesh => ({ id: mesh.id, name: mesh.path ?? mesh.name, matrix: mesh.matrixWorld })) });
          }
          if (now - start < 2400) requestAnimationFrame(tick); else resolve(samples);
        };
        requestAnimationFrame(tick);
      }));
      await stage.getByRole('button', { name: /^试一试：/ }).click();
      const observed = await trace; await readyStudio(tour);
      const pixels = await page.evaluate(() => { window.__studioQA.capturePixels = false; return window.__studioQA.pixels; });
      const poses = observed[0].objects.map(object => ({ id: object.id, name: object.name, poses: new Set(observed.map(sample => JSON.stringify(sample.objects.find(item => item.id === object.id)?.matrix))).size }));
      check(poses.some(object => object.poses >= 3) && observed.at(-1).progress > .95, `${lesson} 操作中真实网格经过连续姿态并完成目标`);
      check(new Set(pixels.filter(frame => frame.nonzero > 0).map(frame => frame.hash)).size >= 3, `${lesson} 实际 framebuffer 产生至少三个不同的非空画面`);
      const finalInfo = await studioInspect(tour);
      check(projectStudio(finalInfo).fits, `${lesson} 操作后实体投影无裁切`);
      objectMotion.push({ kind: 'studio-action', lesson, poses, observed, pixels, projection: projectStudio(finalInfo) });
      if (lesson === 'nfc') {
        await stage.getByRole('button', { name: /^试一试：/ }).click();
        await page.waitForTimeout(180);
        const reversing = await studioInspect(tour);
        check(reversing.models.find(model => model.active).progress > 0 && reversing.models.find(model => model.active).progress < 1, 'NFC 可反向收拢，真实模型经过中间姿态');
        await stage.getByRole('button', { name: /^试一试：/ }).click();
        const retargeted = await studioInspect(tour);
        check(retargeted.models.find(model => model.active).progress > 0 && retargeted.models.find(model => model.active).progress < 1, '反向动作中再次操作保持当前物理姿态，没有瞬跳到端点');
        await readyStudio(tour);
        const complete = await studioInspect(tour);
        check(complete.models.find(model => model.active).progress === 1, '被打断的动作最终抵达最新请求的终态');
        objectMotion.push({ kind: 'studio-action-reversal', reversing, retargeted, complete });
      }
    }
    await tour.getByRole('button', { name: '跳到：白板', exact: true }).click(); await readyStudio(tour);
    const returned = await studioInspect(tour);
    check(returned.models.length === 1 && returned.renderer.memory.geometries === boardMemory.geometries && returned.renderer.memory.textures === boardMemory.textures, '切过五场景回白板后仅保留当前模型，几何与纹理数量没有累积');
    const swapTrace = page.evaluate(() => new Promise(resolve => {
      const samples = [], start = performance.now();
      const tick = now => {
        const info = document.querySelector('[data-testid="tour-studio-canvas"]').__tourStudioInspect();
        samples.push({ time: now - start, lesson: info.lesson, models: info.models.map(model => ({ lesson: model.lesson, active: model.active, matrix: model.worldMatrix })), camera: info.camera.position });
        if (now - start < 2200) requestAnimationFrame(tick); else resolve(samples);
      };
      requestAnimationFrame(tick);
    }));
    await tour.getByRole('button', { name: '下一步', exact: true }).click();
    const swap = await swapTrace; await readyStudio(tour);
    check(swap.some(frame => frame.models.some(model => model.lesson === 'board') && frame.models.some(model => model.lesson === 'vault')) && swap.every(frame => frame.models.length > 0), '切课期间旧新模型连续交接，没有清空场景');
    objectMotion.push({ kind: 'studio-chapter-transition', samples: swap });
    await tour.getByRole('button', { name: '跳到：碰一碰', exact: true }).click(); await readyStudio(tour);
    await stage.getByRole('button', { name: /^试一试：/ }).click(); await page.waitForTimeout(120);
    await stage.getByRole('button', { name: '暂停演示', exact: true }).click(); await stopped('用户暂停');
    await tour.getByRole('button', { name: '跳到：组织', exact: true }).click(); await readyStudio(tour);
    check(await stage.getAttribute('data-running') === 'false' && await tour.getByRole('button', { name: '播放演示', exact: true }).count() === 1, '暂停后切课保留暂停偏好并显示目标模型');
    await stage.getByRole('button', { name: '播放演示', exact: true }).click();
    for (const source of ['system', 'application']) {
      if (source === 'system') await page.emulateMedia({ reducedMotion: 'reduce' }); else await setAxes(page, { motion: 'reduced' });
      await page.waitForFunction(() => document.querySelector('.tour-stage')?.getAttribute('data-reduced') === 'true');
      await stopped(`${source} 减少动态`);
      if (source === 'system') await page.emulateMedia({ reducedMotion: 'no-preference' }); else await setAxes(page, { motion: 'full' });
    }
    await stage.getByRole('button', { name: '重播演示', exact: true }).click();
    const host = stage.locator('.tour-studio-scene');
    await host.evaluate(el => { el.style.transform = 'translateX(-300vw)'; });
    await page.waitForFunction(() => document.querySelector('.tour-studio-scene')?.getAttribute('data-running') === 'false');
    await stopped('模型实际移出视口');
    await host.evaluate(el => { el.style.removeProperty('transform'); }); await readyStudio(tour);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await stopped('模拟文档 hidden');
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }); await readyStudio(tour);
    check(await stage.locator('[data-testid="tour-studio-canvas"]').evaluate(canvas => { window.__studioLost = canvas.getContext('webgl2').getExtension('WEBGL_lose_context'); window.__studioLost?.loseContext(); return !!window.__studioLost; }), '通过真实 WEBGL_lose_context 注入上下文丢失');
    await host.locator('.tour-studio-fallback').waitFor();
    check(await host.getAttribute('data-renderer') === 'fallback', '上下文丢失后显示可读物件降级');
    await stopped('图形上下文丢失');
    await page.evaluate(() => window.__studioLost.restoreContext()); await readyStudio(tour);
    check((await studioInspect(tour)).renderer.triangles > 100, '上下文恢复后重新绘制真实实体');
  }
  await tour.getByRole('button', { name: '跳过导览', exact: true }).click(); await tour.waitFor({ state: 'hidden' });
  await stopped(fallbackOnly ? '降级舞台卸载' : 'Three 舞台卸载');
  await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.request.dispose(); await page.close();
}

/** Focused acceptance for the finite replay camera; records real compositor frames again after a camera fix. */
async function replayCameraPass() {
  const labels = { board: '白板', vault: '暂存箱', code: '口令', nfc: '碰一碰', organization: '组织' };
  for (const [width, height] of sizes) {
    const size = `${width}x${height}`, page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 600 });
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(`${size} replay: ${error.message}`));
    await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
    await installFakeCloud(page);
    await page.addInitScript(() => { localStorage.setItem('onethu.onboarded.phone', '1'); localStorage.setItem('onethu.chatdock.open', '0'); });
    await page.goto((process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180') + '/?explorer-preview=onboarding');
    await page.locator('.explorer-shell').waitFor();
    const tour = await replay(page, 'full'), stage = tour.locator('.tour-stage');
    if (process.env.ONETHU_TEST_PERFORMANCE_ONLY) {
      await samplePerformance(page, tour);
      await tour.getByRole('button', { name: '跳过导览', exact: true }).click();
      await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.request.dispose(); await page.close();
      return;
    }
    for (const [lesson, label] of Object.entries(labels).filter(([lesson]) => width === 1280 || ['vault', 'nfc'].includes(lesson))) {
      await tour.getByRole('button', { name: '跳到：' + label, exact: true }).click();
      await stage.locator('.tour-stage-canvas').scrollIntoViewIfNeeded();
      await readyStudio(tour, 'webgl', lesson);
      await stage.getByRole('button', { name: /^试一试：/ }).click();
      await stage.locator('.tour-stage-canvas').scrollIntoViewIfNeeded(); await readyStudio(tour, 'webgl', lesson);
      const perform = async () => {
        const observing = page.evaluate(({ projectSource }) => new Promise((resolve, reject) => {
          const project = eval('(' + projectSource + ')'), samples = [], start = performance.now(); let moving = false;
          const tick = now => {
            const info = document.querySelector('[data-testid="tour-studio-canvas"]').__tourStudioInspect();
            const projected = project(info);
            moving ||= !info.settled;
            samples.push({ time: now - start, settled: info.settled, take: info.take, frames: info.frames, progress: info.models.find(model => model.active)?.progress, projection: { ...projected, outside: projected.outside.map(mesh => mesh.path) } });
            if (moving && info.settled) resolve(samples);
            else if (now - start > 12000) reject(new Error('Replay camera did not settle within 12 seconds'));
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }), { projectSource: projectStudio.toString() });
        await stage.getByRole('button', { name: '重播演示', exact: true }).click();
        // Actual users may start the demonstration during its replay turn; that must also remain framed.
        await page.waitForTimeout(500);
        await stage.getByRole('button', { name: /^试一试：/ }).click();
        await stage.locator('.tour-stage-canvas').scrollIntoViewIfNeeded();
        const trace = await observing;
        objectMotion.push({ kind: 'replay-camera-framing', size, lesson, samples: trace });
        check(trace.length > 10 && trace.some(frame => !frame.settled) && trace.some(frame => frame.take?.phase === 'pullback') && trace.some(frame => frame.take?.phase === 'turn') && trace.at(-1).take === null && trace.at(-1).settled, `${size} ${lesson} 重播与中途操作经过真实拉远和转身并收敛`);
        check(trace.every(frame => frame.projection.fits), `${size} ${lesson} 重播转体全程实体投影无裁切`);
      };
      if (width === 1280 || width === 390) recordings.push(await recordScreencast(page, `full-${size}-${lesson}`, perform));
      else await perform();
      await readyStudio(tour, 'webgl', lesson);
      if (height <= 650) await page.screenshot({ path: `${out}/after/full-${size}-${lesson}-interaction.png`, animations: 'disabled' });
      await tour.locator(':scope > .og-panel-body').evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: `${out}/after/full-${size}-${lesson}.png`, animations: 'disabled' });
    }
    await tour.getByRole('button', { name: '跳过导览', exact: true }).click();
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.request.dispose(); await page.close();
  }
}

try {
  if (process.env.ONETHU_TEST_REPLAY_ONLY || process.env.ONETHU_TEST_PERFORMANCE_ONLY) await replayCameraPass();
  for (const [width, height] of process.env.ONETHU_TEST_MOTION_ONLY || process.env.ONETHU_TEST_REPLAY_ONLY || process.env.ONETHU_TEST_PERFORMANCE_ONLY ? [] : sizes) {
    const size = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 600 });
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(`${size}: ${error.message}`));
    await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
    await installFakeCloud(page);
    await page.addInitScript(() => { performance.setResourceTimingBufferSize(10000); localStorage.setItem('onethu.onboarded.phone', '1'); localStorage.setItem('onethu.chatdock.open', '0'); });
    // A named home preview schedules a delayed focusTab; an unused preview name avoids that fixture navigation.
    await page.goto((process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180') + '/?explorer-preview=onboarding');
    await page.locator('.explorer-shell').waitFor();
    await call(page, '/src/state/vault.ts', 'addToVault', [{ type: 'text', title: '验收保留内容', text: '这条真实内容不能被演示改变' }]);
    await call(page, '/src/state/freeBoard.ts', 'addNote', [100, 100]);
    await call(page, '/src/state/org.ts', 'createOrg', [{ name: '验收保留组织' }]);
    const initial = await contentSnapshot(page);

    for (const mode of ['simple', 'practical', 'full']) {
      const prefix = `${mode}-${size}`, ids = plans[mode];
      const tour = await replay(page, mode, true);
      check(await tour.locator('.tour-shell').getAttribute('data-tour-mode') === mode, `${prefix} 使用所选模式导览`);
      const visited = [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        await tour.locator(`.tour-stage[data-lesson="${id}"]`).waitFor();
        visited.push(await tour.locator('.tour-shell').getAttribute('data-lesson'));
        await layout(page, tour, prefix, id);
        await exerciseStage(page, tour, prefix, id, i === 0 || width === 1280 || width === 390 || height <= 650 && id === 'organization');
        if (!process.env.ONETHU_TEST_SKIP_RECORDINGS && mode === 'full' && (width === 1280 || width === 390 && ['vault', 'nfc'].includes(id))) {
          const stage = tour.locator('.tour-stage');
          await stage.getByRole('button', { name: '重播演示', exact: true }).click();
          recordings.push(await recordScreencast(page, `${prefix}-${id}`, async () => {
            await page.waitForTimeout(500);
            await stage.getByRole('button', { name: /^试一试：/ }).click();
            await readyStudio(tour);
            await page.waitForTimeout(250);
            if (width === 1280 && id === 'board') {
              await tour.getByRole('button', { name: '下一步', exact: true }).click();
              await readyStudio(tour);
              await page.waitForTimeout(250);
              await tour.getByRole('button', { name: '上一步', exact: true }).click();
              await readyStudio(tour);
            }
          }));
        }
        if (!process.env.ONETHU_TEST_SKIP_PERFORMANCE && width === 1280 && mode === 'full' && i === 0) {
          await samplePerformance(page, tour);

        }
        await tour.getByRole('button', { name: '下一步', exact: true }).click();
      }
      await tour.getByRole('heading', { name: '需要时，再连接', exact: true }).waitFor();
      check(JSON.stringify(visited) === JSON.stringify(ids), `${prefix} 课程次序与该模式准确对应`);
      check(await tour.locator('[data-lesson-id]').count() === (mode === 'full' ? 6 : 0), `${prefix} 六个选修仅出现在完整模式结束页`);
      check(await tour.getByRole('switch', { name: 'OH MCP 服务器开关' }).count() === (mode === 'full' ? 1 : 0), `${prefix} 高级 MCP 只出现在完整模式`);
      if (mode === 'full') {
        for (const id of optional) {
          await tour.locator(`[data-lesson-id="${id}"]`).click();
          await layout(page, tour, prefix, id);
          await exerciseStage(page, tour, prefix, id, false);
          await tour.getByRole('button', { name: '返回完成页', exact: true }).click();
          await tour.getByRole('heading', { name: '需要时，再连接', exact: true }).waitFor();
        }
      }
      await page.screenshot({ path: `${out}/after/${prefix}-ready.png`, animations: 'disabled' });
      await tour.getByRole('button', { name: '开始使用', exact: true }).click();
      await tour.waitFor({ state: 'hidden' });
    }
    check(JSON.stringify(await contentSnapshot(page)) === JSON.stringify(initial), `${size} 完成三模式导览后真实数据仍原样保留`);

    // Back/forward, fast repeated navigation, and keyboard must preserve a single current scene.
    const tour = await replay(page, 'full');
    await tour.getByRole('button', { name: '下一步', exact: true }).click();
    await tour.getByRole('button', { name: '上一步', exact: true }).click();
    check(await tour.locator('.tour-shell').getAttribute('data-lesson') === 'board', `${size} 上一步回到对应课程`);
    for (let i = 0; i < 4; i++) {
      await tour.getByRole('button', { name: '下一步', exact: true }).click({ delay: 0 });
      await tour.getByRole('button', { name: '上一步', exact: true }).click({ delay: 0 });
    }
    await readyStudio(tour);
    check(await tour.locator('.tour-stage').count() === 1 && await tour.locator('.tour-shell').getAttribute('data-lesson') === 'board' && await tour.locator('.tour-studio-scene[data-scene-lesson="board"]').count() === 1, `${size} 连续快速前后切课只保留当前实体舞台`);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      check(await tour.evaluate(el => el.contains(document.activeElement)), `${size} Tab 焦点留在导览内 ${i + 1}`);
    }
    await page.keyboard.press('Shift+Tab');
    check(await tour.evaluate(el => el.contains(document.activeElement)), `${size} Shift+Tab 焦点仍在导览内`);

    // System preference and the actual OneGUI motion axis each independently suppress movement.
    for (const source of ['system', 'application']) {
      if (source === 'system') await page.emulateMedia({ reducedMotion: 'reduce' });
      else await setAxes(page, { motion: 'reduced' });
      const stage = tour.locator('.tour-stage');
      await page.waitForFunction(() => document.querySelector('.tour-stage')?.getAttribute('data-reduced') === 'true');
      await stage.getByRole('button', { name: '重播演示', exact: true }).click();
      await stage.getByRole('button', { name: /^试一试：/ }).click();
      check(await stage.getAttribute('data-phase') === 'after' && await stage.getAttribute('data-running') === 'false', `${size} ${source} 减少动态时仍展示完整结果且不运行动画`);
      const animations = await stage.evaluate(el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && Number(animation.effect?.getComputedTiming().duration) > 1).length);
      check(animations === 0, `${size} ${source} 减少动态实际没有运行中的舞台动画`);
      if (source === 'system') await page.emulateMedia({ reducedMotion: 'no-preference' });
      else await setAxes(page, { motion: 'full' });
    }
    for (const [name, axes] of [['dark', { scheme: 'dark', skin: 'neutral' }], ['glass', { scheme: 'light', skin: 'glass', skinLevel: 'deep' }], ['dark-glass', { scheme: 'dark', skin: 'glass', skinLevel: 'deep' }]]) {
      await setAxes(page, axes);
      await tour.getByRole('button', { name: '跳到：暂存箱', exact: true }).click();
      await tour.getByRole('button', { name: '跳到：白板', exact: true }).click();
      await layout(page, tour, `${size}-${name}`, 'board');
      await tour.locator('.tour-stage').getByRole('button', { name: '重播演示', exact: true }).click();
      await tour.locator('.tour-stage').getByRole('button', { name: /^试一试：/ }).click();
      await tour.locator('.tour-stage-canvas').scrollIntoViewIfNeeded();
      await readyStudio(tour);
      await tour.locator(':scope > .og-panel-body').evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: `${out}/after/${size}-${name}.png`, animations: 'disabled' });
    }
    await tour.getByRole('button', { name: '跳过导览', exact: true }).click(); await tour.waitFor({ state: 'hidden' });
    check(await page.evaluate(() => localStorage.getItem('onethu.onboarded.flow4')) === '1', `${size} 跳过也记住已完成状态`);
    const again = await replay(page, 'practical');
    check(await again.locator('.tour-shell').getAttribute('data-lesson') === 'today', `${size} 重放从所选模式第一课重新开始`);
    await again.getByRole('button', { name: '跳过导览', exact: true }).click(); await again.waitFor({ state: 'hidden' });
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.request.dispose(); await page.close();
  }
  if (!process.env.ONETHU_TEST_SKIP_STUDIO_PROBE && !process.env.ONETHU_TEST_PERFORMANCE_ONLY) {
    await studioProbe(false);
    await studioProbe(true);
  }
  check(errors.length === 0, '全部导览场景没有页面运行时错误：' + errors.join('; '));
  passed = true;
} catch (error) {
  errors.push(error.stack ?? String(error));
  for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
    console.error(await page.locator('.experience-tour').evaluate(el => { const shell = el.querySelector('.tour-shell'); return { phase: shell?.getAttribute('data-tour-phase'), mode: shell?.getAttribute('data-tour-mode'), lesson: shell?.getAttribute('data-lesson'), panelScrollTop: el.scrollTop, bodyScrollTop: el.querySelector('.og-panel-body')?.scrollTop, focus: document.activeElement?.outerHTML.slice(0, 300), text: el.textContent?.slice(0, 1500) }; }).catch(() => null));
  }
  throw error;
} finally {
  try { await closeTestBrowser(browser); }
  catch (error) { passed = false; errors.push(error.stack ?? String(error)); throw error; }
  finally { writeFileSync(`${out}/${process.env.ONETHU_TEST_REPORT ?? (process.env.ONETHU_TEST_MOTION_ONLY ? 'object-motion-report.json' : 'report.json')}`, JSON.stringify({ passed, scope: process.env.ONETHU_TEST_PERFORMANCE_ONLY ? 'final-studio-performance-reference' : process.env.ONETHU_TEST_REPLAY_ONLY ? 'replay-camera-four-viewports-and-studio-lifecycle' : process.env.ONETHU_TEST_MOTION_ONLY ? 'object-motion-only' : 'selected-viewports-and-object-motion', checks, errors, sizes, geometry, samples, recordings, objectMotion, environment: 'Local headless Chrome with fake cloud; CDP CPU throttle is a reference only, not physical Android/NFC or real-account verification.' }, null, 2)); }
}
console.log(`${checks.length} onboarding motion assertions passed; browser cleanup complete`);
