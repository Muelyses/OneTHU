/**
 * Actual bundled images + real Three model objects, inside a browser.
 * This checks texture ownership and disposal contracts, not NFC hardware or GPU driver memory.
 * Run with the Vite app available at ONETHU_TEST_URL (default: http://127.0.0.1:5180).
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';

const baseUrl = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = process.env.ONETHU_MODEL_OUT ?? 'docs/onegui/onboarding-autoplay-2026-10-20';
mkdirSync(out, { recursive: true });
const report = {
  passed: false,
  naturalCleanup: false,
  assertions: 0,
  failedLoadRejected: false,
  retrySucceeded: false,
  checks: [
    'All 21 bundled app captures decode as HTMLImageElement sources.',
    'Concurrent loads share a promise; a failed image load can be retried.',
    'Mode, lesson and phase select the intended captured page.',
    'Screen textures reference the decoded images directly, without Canvas repainting.',
    'Captured aspect ratios are preserved; narrow glass margins and the camera do not cover app controls.',
    'Ordinary phone and tablet scenes contain no invented floating UI cards.',
    'Phone backs contain no Canvas logo or invented UI overlay.',
    'Pose changes reuse textures; each owned Three resource disposes exactly once.',
  ],
  limits: [
    'Pages use isolated example data through the existing fake-cloud adapter.',
    'Resource assertions observe Three geometry/material/texture disposal events, not GPU-driver allocations.',
    'No physical NFC, real-account permission or physical-phone performance claim.',
  ],
};
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--disable-updater-scheduler'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await installFakeCloud(page);
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await page.addInitScript(() => {
    localStorage.setItem('onethu.onboarded.phone', '1');
    performance.setResourceTimingBufferSize(10000);
  });
  await page.goto(baseUrl + '/?explorer-preview=onboarding');

  // Import Vite's ?url modules before blocking the image request itself.
  // Blocking the ?url module would test ESM failure caching instead of image retries.
  const assetUrl = await page.evaluate(async () => {
    window.__realScreensQA = await import('/src/components/tourStudioScreens.ts');
    return window.__realScreensQA.STUDIO_SCREEN_URLS['simple-home'];
  });
  const blockedUrl = new URL(assetUrl, baseUrl).href;
  await page.route(blockedUrl, route => route.abort());
  report.failedLoadRejected = await page.evaluate(async () => {
    try { await window.__realScreensQA.loadStudioScreenAssets(); return false; }
    catch { return true; }
  });
  assert.equal(report.failedLoadRejected, true, 'An image load failure must reject');
  await page.unroute(blockedUrl);

  const result = await page.evaluate(async () => {
    const screensModule = window.__realScreensQA;
    const { createStudioAssembly } = await import('/src/components/tourStudioModels.ts');
    let assertions = 0;
    const check = (condition, message) => {
      if (!condition) throw new Error(message);
      assertions++;
    };
    const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const convexHull = points => {
      const sorted = [...new Map(points.map(point => [point.join(','), point])).values()]
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const half = vertices => {
        const hull = [];
        for (const point of vertices) {
          while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
          hull.push(point);
        }
        return hull.slice(0, -1);
      };
      return [...half(sorted), ...half([...sorted].reverse())];
    };
    const first = screensModule.loadStudioScreenAssets();
    check(first === screensModule.loadStudioScreenAssets(), 'Concurrent calls share one decode promise');
    const assets = await first;
    check(Object.keys(assets).length === 21, 'All 21 real images decode');
    for (const [key, image] of Object.entries(assets)) {
      check(image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0, key + ': decoded image');
      check(image.src.includes('/real-ui/' + key + '.png'), key + ': correct bundled source');
    }

    // Explicit destinations provide semantic coverage independently of the model's selector call.
    const expectedDestinations = [
      ['today', 'simple', false, 'simple-home'],
      ['today', 'simple', true, 'simple-home-done'],
      ['today', 'practical', false, 'practical-home'],
      ['today', 'practical', true, 'practical-home-done'],
      ['swap', 'practical', true, 'practical-home-customized'],
      ['explorer', 'full', false, 'workspaces'],
      ['onego', 'full', false, 'onego'],
      ['plugin', 'full', false, 'plugins'],
      ['customize', 'full', false, 'appearance'],
      ['campus', 'full', false, 'learn'],
      ['data', 'full', false, 'data'],
    ];
    for (const [lesson, mode, after, expected] of expectedDestinations) {
      check(screensModule.selectStudioScreen(lesson, mode, after).primary.key === expected, 'Actual destination: ' + lesson);
    }

    // Fixture material colours only; screen pixels still come from the real PNGs.
    const palette = {
      body: '#d8dadc', edge: '#a5a8ad', glass: '#15171a', screen: '#fafafa',
      ink: '#202124', muted: '#70757a', paper: '#ffffff', accent: '#242424',
      accentInk: '#ffffff', note: '#f4e3aa',
    };
    const lessons = [
      'board', 'mode-full', 'nfc', 'today', 'quick', 'more', 'swap', 'mode-simple',
      'mode-practical', 'ready', 'explorer', 'onego', 'plugin', 'customize', 'campus', 'data',
    ];
    let modelCases = 0;
    for (const mode of ['simple', 'practical', 'full']) for (const lesson of lessons) {
      const assembly = createStudioAssembly(lesson, palette, mode, assets);
      const resources = new Set(), faces = [];
      assembly.group.traverse(object => {
        if (!object.isMesh) return;
        resources.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          resources.add(material);
          if (material.map) resources.add(material.map);
        }
        if (object.userData.studioScreen) faces.push(object);
      });
      check(faces.length > 0, lesson + ': real screen exists');
      for (const face of faces) {
        const key = face.userData.studioScreen.key, image = assets[key];
        check(face.material.map.image === image, key + ': original image, not repainted Canvas');
        face.geometry.computeBoundingBox();
        const bounds = face.geometry.boundingBox;
        const ratio = (bounds.max.x - bounds.min.x) / (bounds.max.y - bounds.min.y);
        check(Math.abs(ratio - image.naturalWidth / image.naturalHeight) < .00001, key + ': aspect preserved');
        const device = face.parent, camera = device.getObjectByName(device.name + '-front-camera');
        if (camera) {
          camera.geometry.computeBoundingBox();
          check(face.position.y + bounds.max.y < camera.position.y + camera.geometry.boundingBox.min.y, key + ': camera clear');
          const glass = device.getObjectByName(device.name + '-glass');
          glass.geometry.computeBoundingBox();
          const glassBounds = glass.geometry.boundingBox;
          const frame = device.getObjectByName(device.name + '-frame');
          frame.geometry.computeBoundingBox();
          const frameBounds = frame.geometry.boundingBox;
          check(
            (bounds.max.x - bounds.min.x) / (glassBounds.max.x - glassBounds.min.x) > .98
              && (bounds.max.y - bounds.min.y) / (glassBounds.max.y - glassBounds.min.y) > .98
              && (bounds.max.y - bounds.min.y) / (frameBounds.max.y - frameBounds.min.y) > .96
              && face.position.y + bounds.min.y > glass.position.y + glassBounds.min.y,
            key + ': captured viewport fills the glass while remaining inside the body',
          );
          const glassPositions = glass.geometry.getAttribute('position'), frontPoints = [];
          for (let index = 0; index < glassPositions.count; index++) {
            if (Math.abs(glassPositions.getZ(index) - glassBounds.max.z) < .00001) {
              frontPoints.push([glassPositions.getX(index) + glass.position.x, glassPositions.getY(index) + glass.position.y]);
            }
          }
          const outline = convexHull(frontPoints), positions = face.geometry.getAttribute('position');
          let cornersInside = outline.length > 3;
          for (let index = 0; index < positions.count; index++) {
            const point = [positions.getX(index) + face.position.x, positions.getY(index) + face.position.y];
            cornersInside &&= outline.every((vertex, edge) => cross(vertex, outline[(edge + 1) % outline.length], point) >= -.00001);
          }
          check(cornersInside, key + ': screen corners remain within the physical glass front');
        } else {
          check(key === 'board-full' && !assembly.group.getObjectByName('studio-board-card-todo'), 'Actual tablet, no fake cards');
        }
      }
      if (lesson !== 'nfc') {
        check(assembly.group.children.length === 1 && !assembly.group.getObjectByName('studio-preview-main'), 'Single device, no invented companion UI');
      }
      if (lesson !== 'board' && lesson !== 'mode-full') {
        const phones = new Set(faces.map(face => face.parent));
        let hasPaintedSurface = false;
        for (const phone of phones) phone.traverse(object => {
          if (object.isMesh && object.material.map?.image instanceof HTMLCanvasElement) hasPaintedSurface = true;
        });
        check(!hasPaintedSurface, 'No painted phone logo, screen or UI overlay');
      }
      const textureIds = faces.map(face => face.material.map.uuid).join();
      for (const progress of [0, .5, .89, .91, 1, 0]) {
        assembly.pose(progress);
        const selection = screensModule.selectStudioScreen(lesson, mode, progress >= .9);
        for (const face of faces.filter(candidate => candidate.visible)) {
          const expected = face.name.includes('receiver') ? selection.secondary : selection.primary;
          check(face.userData.studioScreen.key === expected.key, lesson + ': visible phase source');
        }
      }
      check(faces.map(face => face.material.map.uuid).join() === textureIds, 'Pose reuses all screen textures');
      const released = new Map([...resources].map(resource => [resource, 0]));
      for (const resource of released.keys()) {
        resource.addEventListener('dispose', () => released.set(resource, released.get(resource) + 1));
      }
      assembly.dispose();
      assembly.dispose();
      check([...released.values()].every(count => count === 1), 'Each owned resource releases once');
      check(Object.values(assets).every(image => image.complete && image.naturalWidth > 0), 'Shared decoded images remain usable');
      modelCases++;
    }
    let missingRejected = false;
    try { createStudioAssembly('nfc', palette, 'full'); }
    catch { missingRejected = true; }
    check(missingRejected, 'Missing captures never create a fabricated phone screen');
    return { assertions, modelCases, assetCount: Object.keys(assets).length, lessons, modes: ['simple', 'practical', 'full'] };
  });
  Object.assign(report, result, { retrySucceeded: true });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.request.dispose();
  await page.close();
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  try {
    await closeTestBrowser(browser);
    report.naturalCleanup = true;
  } finally {
    if (!report.naturalCleanup) report.passed = false;
    writeFileSync(out + '/real-screen-model-report.json', JSON.stringify(report, null, 2) + '\n');
  }
}
console.log(`✓ ${report.assertions} real screenshot/model assertions; ${report.modelCases} cases, ${report.assetCount} images; cleanup completed`);
