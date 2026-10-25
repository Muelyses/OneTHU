/** iPhone geometry + real Vite-module integration. Requires the existing desktop dev server, not a replacement server.
 * node tools/onboarding-phone-model-test.mjs
 * ONETHU_PHONE_MODEL_UNIT_ONLY=1 skips browser integration explicitly (never reports it as passed).
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { createPhoneFace, createPhoneSlab, fitPhoneScreen, IPHONE_18_PRO as phone, phoneContour } from '../apps/desktop/src/components/tourPhoneGeometry.ts';

const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const threeModule = await import(pathToFileURL(requireDesktop.resolve('three')).href);
/** three's CommonJS entry exposes constructors only through its default export. */
const THREE = { ...(threeModule.default ?? {}), ...threeModule };
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; console.log(`✓ ${message}`); };
const close = (actual, expected, epsilon = 1e-6) => Math.abs(actual - expected) <= epsilon;
const cross = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
const curvature = (a, b, c) => 2 * Math.abs(cross(a, b, c)) / (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y) * Math.hypot(c.x - a.x, c.y - a.y));

check(close(phone.width / phone.height, 71.9 / 150) && close(phone.depth / phone.height, 8.75 / 150), 'Body shares one physical scale: 71.9 × 150 × 8.75 mm');
check(phone.displayWidthPx === 1206 && phone.displayHeightPx === 2622, 'Panel aspect is sourced from 1206 × 2622 pixels');
const outline = phoneContour(phone.width, phone.height, phone.corner);
let area = 0;
for (let i = 0; i < outline.length; i++) {
  const a = outline[i], b = outline[(i + 1) % outline.length], c = outline[(i + 2) % outline.length];
  assert.ok([a.x, a.y, a.nx, a.ny].every(Number.isFinite));
  assert.ok(close(Math.hypot(a.nx, a.ny), 1));
  assert.ok(cross(a, b, c) <= 1e-10, `non-convex contour at ${i}`);
  assert.ok(Math.hypot(b.x - a.x, b.y - a.y) > 1e-10);
  area += a.x * b.y - b.x * a.y;
}
check(area < 0 && outline.length === 100, '100-point contour is finite, clockwise, convex, and closes without a zero-length seam');
for (let corner = 0; corner < 4; corner++) {
  const end = outline[corner * 25 + 24], next = outline[((corner + 1) * 25) % outline.length];
  assert.ok(close(end.nx, next.nx) && close(end.ny, next.ny));
  const dx = next.x - end.x, dy = next.y - end.y;
  assert.ok(close(dx * end.nx + dy * end.ny, 0));
}
const fine = phoneContour(phone.width, phone.height, phone.corner, 256), coarse = phoneContour(phone.width, phone.height, phone.corner, 128);
check(curvature(...fine.slice(0, 3)) < curvature(...coarse.slice(0, 3)) * .6, 'Corner curvature tends to zero at the straight join (G2), rather than a circular/quadratic kink');
check(true, 'All four straight-to-corner joins share tangent and normal directions');

const slabs = [.15, .012].map(depth => createPhoneSlab(phone.width, phone.height, depth, phone.corner, .002));
for (let slabIndex = 0; slabIndex < slabs.length; slabIndex++) {
  const geometry = slabs[slabIndex], dimensions = new THREE.Vector3(); geometry.boundingBox.getSize(dimensions);
  assert.ok(close(dimensions.x, phone.width) && close(dimensions.y, phone.height) && close(dimensions.z, [.15, .012][slabIndex]));
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), indices = geometry.index.array;
  const edgeUses = new Map();
  const key = index => [position.getX(index), position.getY(index), position.getZ(index)].map(value => Math.round(value * 1e6)).join(',');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), faceNormal = new THREE.Vector3(), averageNormal = new THREE.Vector3();
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = [...indices.slice(i, i + 3)];
    a.fromBufferAttribute(position, triangle[0]); b.fromBufferAttribute(position, triangle[1]); c.fromBufferAttribute(position, triangle[2]);
    faceNormal.crossVectors(b.sub(a), c.sub(a));
    assert.ok(faceNormal.lengthSq() > 1e-20, 'degenerate triangle');
    averageNormal.set(0, 0, 0);
    for (const vertex of triangle) {
      averageNormal.add(new THREE.Vector3().fromBufferAttribute(normal, vertex));
      assert.ok([position.getX(vertex), position.getY(vertex), position.getZ(vertex)].every(Number.isFinite));
    }
    assert.ok(faceNormal.dot(averageNormal) > 0, 'triangle winding disagrees with outward normals');
    for (let edge = 0; edge < 3; edge++) {
      const id = [key(triangle[edge]), key(triangle[(edge + 1) % 3])].sort().join('|');
      edgeUses.set(id, (edgeUses.get(id) ?? 0) + 1);
    }
  }
  assert.ok([...edgeUses.values()].every(count => count === 2), 'slab must be watertight after position welding');
  assert.ok(geometry.userData.phoneSlab.radius > geometry.userData.phoneSlab.depth / 2);
}
for (let i = 500; i < 600; i++) {
  const a = slabs[0].getAttribute('position'), b = slabs[1].getAttribute('position');
  assert.ok(close(a.getX(i), b.getX(i)) && close(a.getY(i), b.getY(i)));
}
check(true, 'Thick and thin slabs have the same XY outline, exact bounds, closed surfaces, and outward triangles');
const face = createPhoneFace(phone.displayWidth, phone.displayHeight, phone.displayCorner);
const uv = face.getAttribute('uv');
check([...uv.array].every(value => Number.isFinite(value) && value >= -1e-6 && value <= 1 + 1e-6), 'Display contour has finite normalized UVs');
for (const [width, height] of [[390, 844], [1206, 2622], [844, 390], [1000, 1000], [1, 2000]]) {
  const fit = fitPhoneScreen(width, height);
  assert.ok(close(fit.width / fit.height, width / height));
  assert.ok(fit.width <= phone.contentWidth + 1e-10 && fit.height <= phone.contentHeight + 1e-10);
  assert.ok(close(fit.width, phone.contentWidth) || close(fit.height, phone.contentHeight));
}
check(true, 'Portrait, landscape, square, and narrow captures use maximal aspect-preserving contain');
for (const dimensions of [[0, 844], [390, 0], [-1, 2], [NaN, 844], [390, Infinity]]) assert.throws(() => fitPhoneScreen(...dimensions), RangeError);
for (const args of [[0, 2, .1], [1, 2, -.1], [1, 2, .6], [1, 2, .1, 2]]) assert.throws(() => phoneContour(...args), RangeError);
check(true, 'Invalid capture dimensions and invalid contours fail explicitly');
slabs.forEach(slab => slab.dispose()); face.dispose();

if (process.env.ONETHU_PHONE_MODEL_UNIT_ONLY === '1') {
  console.log(`${checks} pure-geometry checks passed; browser integration SKIPPED by explicit request.`);
} else {
  const requested = process.env.ONETHU_PLAYWRIGHT_PATH;
  const { chromium } = requested ? await import(requested.startsWith('/') ? pathToFileURL(requested).href : requested) : await import('playwright');
  const executablePath = process.env.ONETHU_BROWSER_EXECUTABLE ?? chromium.executablePath();
  assert.ok(existsSync(executablePath), `Browser does not exist: ${executablePath}`);
  const base = process.env.ONETHU_BASE_URL ?? 'http://127.0.0.1:5180';
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    // Only the test document is fulfilled locally. All modules and capture images come from the actual running Vite app.
    await page.route(`${base}/__onboarding_phone_model_test__`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Phone model regression</title>' }));
    await page.goto(`${base}/__onboarding_phone_model_test__`);
    const result = await page.evaluate(async () => {
      const { createStudioAssembly } = await import('/src/components/tourStudioModels.ts');
      const { loadStudioScreenAssets } = await import('/src/components/tourStudioScreens.ts');
      const { IPHONE_18_PRO: spec, fitPhoneScreen: fit } = await import('/src/components/tourPhoneGeometry.ts');
      const palette = { body: '#c6c6c6', edge: '#737373', glass: '#171717', screen: '#fafafa', ink: '#171717', muted: '#737373', paper: '#ffffff', accent: '#262626', accentInk: '#ffffff', note: '#faf7eb' };
      const screens = await loadStudioScreenAssets('zh-CN');
      const assertions = [], failures = [], near = (a, b, tolerance = 1e-5) => Math.abs(a - b) <= tolerance;
      const expect = (value, message) => (value ? assertions : failures).push(message);
      const summaries = [];
      const originalCreate = document.createElement.bind(document), videos = [];
      document.createElement = function(tag, ...args) { const element = originalCreate(tag, ...args); if (tag.toLowerCase() === 'video') videos.push(element); return element; };
      try {
        for (const [lesson, mode] of [['today', 'simple'], ['today', 'practical'], ['quick', 'full'], ['nfc', 'full'], ['vault', 'full']]) {
          const assembly = createStudioAssembly(lesson, palette, mode, screens), phones = assembly.group.children.filter(child => child.name.startsWith('studio-phone-'));
          expect(phones.length === (lesson === 'nfc' ? 2 : 1), `${lesson}/${mode}: expected physical phone count`);
          const resources = new Map(), allScreens = [];
          assembly.group.traverse(object => {
            if (!object.isMesh) return;
            const add = resource => { if (resource && !resources.has(resource)) { const counter = { count: 0 }; resource.addEventListener('dispose', () => counter.count++); resources.set(resource, counter); } };
            add(object.geometry);
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) { add(material); for (const value of Object.values(material)) if (value?.isTexture) add(value); }
            if (object.userData.studioScreen) allScreens.push(object);
          });
          for (const device of phones) {
            const lenses = device.children.filter(child => child.isGroup && /-lens-(main|ultra|tele)$/.test(child.name));
            expect(lenses.length === 3, `${lesson}/${device.name}: three separate main/ultrawide/telephoto lens assemblies`);
            const frame = device.getObjectByName(`${device.name}-frame`); frame.geometry.computeBoundingBox();
            const bounds = frame.geometry.boundingBox;
            expect(near(bounds.max.x - bounds.min.x, spec.width) && near(bounds.max.y - bounds.min.y, spec.height) && near(bounds.max.z - bounds.min.z, spec.depth), `${lesson}/${device.name}: physical frame bounds match the specification scale`);
            for (const part of ['action', 'volume-up', 'volume-down', 'side-button', 'camera-control', 'usb-c']) expect(!!device.getObjectByName(`${device.name}-${part}`), `${lesson}/${device.name}: includes ${part}`);
            const island = device.getObjectByName(`${device.name}-island`);
            for (const screen of allScreens.filter(screen => screen.parent === device)) {
              screen.geometry.computeBoundingBox(); const box = screen.geometry.boundingBox, data = screen.userData.studioScreen;
              const width = box.max.x - box.min.x, height = box.max.y - box.min.y, expected = fit(data.width, data.height);
              expect(near(width / height, data.width / data.height), `${lesson}/${screen.name}: original screenshot aspect preserved`);
              expect(near(width, expected.width) && near(height, expected.height), `${lesson}/${screen.name}: actual screen uses shared contain helper`);
              const uv = screen.geometry.getAttribute('uv'), xs = [], ys = [];
              for (let index = 0; index < uv.count; index++) { xs.push(uv.getX(index)); ys.push(uv.getY(index)); }
              // The capture is never repainted or resampled: UVs still span the whole image.
              // Only the physical display corner (displayCorner) masks the extreme pixels,
              // exactly like the rounded corner of a real OLED panel.
              expect(near(Math.min(...xs), 0) && near(Math.max(...xs), 1) && near(Math.min(...ys), 0) && near(Math.max(...ys), 1),
                `${lesson}/${screen.name}: full capture texture mapped over the display area`);
              expect(!!screen.material.map?.image && screen.material.toneMapped === false, `${lesson}/${screen.name}: actual image-backed unlit material`);
              if (island) {
                island.geometry.computeBoundingBox();
                const cameraBottom = island.position.y + island.geometry.boundingBox.min.y, cameraTop = island.position.y + island.geometry.boundingBox.max.y;
                expect(cameraBottom >= screen.position.y + box.max.y || cameraTop <= screen.position.y + box.min.y, `${lesson}/${screen.name}: front camera never covers captured controls`);
              }
            }
          }
          for (const progress of [0, .5, 1, -1, 2]) {
            assembly.pose(progress);
            const p = Math.max(0, Math.min(1, progress));
            if (lesson === 'nfc') {
              const [sender, receiver] = phones;
              expect(near(sender.position.x, -1.4 + .5 * p) && near(receiver.position.x, 1.4 - .5 * p) && near(sender.rotation.y, 2.42 + (.24 - 2.42) * p), `nfc: existing choreography at ${progress}`);
            } else {
              expect(near(phones[0].position.y, -.02 + .04 * p) && near(phones[0].rotation.y, -.32 + .44 * p), `${lesson}/${mode}: existing choreography at ${progress}`);
            }
          }
          if (lesson === 'vault') {
            const video = videos.at(-1), screen = allScreens[0];
            assembly.setPlaying?.(false, true); assembly.pose(0); const first = screen.material.map;
            assembly.pose(1); const last = screen.material.map;
            expect(first !== last && first.image === screens['vault-drag-start'] && last.image === screens['vault-drag-done'], 'vault: reduced motion selects original first/last screenshot');
            expect(video.paused, 'vault: reduced motion remains paused');
          }
          assembly.dispose(); assembly.dispose();
          expect(assembly.group.children.length === 0, `${lesson}/${mode}: dispose detaches scene children`);
          expect([...resources.values()].every(counter => counter.count === 1), `${lesson}/${mode}: every reachable geometry/material/texture disposed exactly once`);
          if (lesson === 'vault') expect(videos.at(-1).paused && !videos.at(-1).hasAttribute('src'), 'vault: dispose stops and releases the video');
          summaries.push({ lesson, mode, resources: resources.size, screenCount: allScreens.length });
        }
      } finally { document.createElement = originalCreate; }
      return { assertions, failures, summaries };
    });
    for (const message of result.assertions) check(true, message);
    console.log(JSON.stringify(result.summaries, null, 2));
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    assert.deepEqual(result.failures, [], 'Phone integration regressions');
    check(true, 'Browser integration has no failures or uncaught errors');
  } finally { await browser.close(); }
  console.log(`${checks} phone-model checks passed.`);
}
