/** Isolated motion lifecycle with real browser animations; no stored-content mutation. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installFakeCloud } from './lib/fake-cloud.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';

const checks = [], errors = [];
const check = (value, label) => { assert.ok(value, label); checks.push(label); console.log('✓ ' + label); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  await installFakeCloud(page);
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('onethu.onboarded.phone', '1');
    localStorage.setItem('onethu.onboarded.v1', '1');
    localStorage.setItem('onethu.experience.v1', 'full');
  });
  await page.goto((process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180') + '/?explorer-preview=home');
  await page.locator('.vault-floating-anchor.is-ready').waitFor();
  await page.evaluate(async () => {
    const path = '/src/components/vault/vaultDragMotion.ts';
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname === path) ?? path;
    const source = document.createElement('button'), receiver = document.createElement('button');
    source.textContent = 'Motion lifecycle source'; receiver.textContent = 'Receiver';
    Object.assign(source.style, { position:'fixed',left:'120px',top:'240px',width:'140px',height:'70px' });
    Object.assign(receiver.style, { position:'fixed',left:'180px',top:'650px',width:'40px',height:'40px' });
    document.body.append(source, receiver);
    const api = await import(url);
    window.__motion = { api, source, receiver, card: null, active: null, create() {
      const card = document.createElement('div'); card.className = 'vault-drag-ghost';
      const inner = document.createElement('div'); inner.className = 'vault-drag-card'; inner.textContent = '真实内容 Motion lifecycle';
      card.append(inner); this.card = card; return card;
    }, start() { this.active = api.beginVaultCardMotion(this.create(), source, 190, 275); return this.active; } };
  });
  const state = () => page.evaluate(() => ({
    cards: document.querySelectorAll('.vault-drag-ghost').length,
    sourceLifted: window.__motion.source.classList.contains('is-vault-lifted'),
    sourceSession: window.__motion.source.dataset.vaultLift,
    receiverAnimations: window.__motion.receiver.getAnimations().length,
    phase: window.__motion.card?.dataset.vaultMotion,
  }));
  const reset = async () => page.evaluate(() => {
    window.__motion.api.disposeVaultCardMotions();
    delete document.documentElement.dataset.ogMotion;
    delete document.hidden;
  });

  await page.evaluate(() => {
    const t = window.__motion, old = t.start();
    old.finish('return'); const oldId = t.source.dataset.vaultLift;
    t.start(); t.oldId = oldId; old.dispose();
  });
  let result = await state();
  check(result.cards === 1 && result.sourceLifted, 'retiring copy cannot clear a new pickup of the same source');
  check(await page.evaluate(() => window.__motion.source.dataset.vaultLift !== window.__motion.oldId), 'each pickup owns its source marker independently');
  await reset();
  check((await state()).cards === 0 && !(await state()).sourceLifted, 'unmount cleanup removes cards and restores the original source');

  await page.evaluate(() => { window.__motion.start(); document.documentElement.dataset.ogMotion = 'reduced'; });
  await page.waitForTimeout(30);
  result = await state();
  check(result.cards === 1 && result.sourceLifted && result.phase === 'drag', 'switching to reduced motion retains a readable stationary drag copy');
  check(await page.evaluate(() => window.__motion.card.getAnimations({ subtree:true }).length === 0), 'reduced motion cancels the in-flight pickup animation');
  await page.evaluate(() => {
    const t = window.__motion; t.active.finish('store', t.receiver.getBoundingClientRect(), t.receiver);
  });
  result = await state();
  check(result.cards === 0 && !result.sourceLifted && result.receiverAnimations === 0, 'reduced delivery performs no flight or receiver rebound and cleans its copy');
  await reset();

  await page.evaluate(() => {
    const t = window.__motion; t.start().finish('store', t.receiver.getBoundingClientRect(), t.receiver);
    Object.defineProperty(document, 'hidden', { configurable:true, get:() => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  result = await state();
  check(result.cards === 0 && !result.sourceLifted && result.receiverAnimations === 0, 'hiding during delivery removes the flight without delayed success animation');
  await reset();

  await page.evaluate(() => {
    const t = window.__motion; t.start().finish('store', t.receiver.getBoundingClientRect(), t.receiver);
  });
  await page.waitForFunction(() => window.__motion.receiver.getAnimations().length > 0);
  check((await state()).cards === 0 && !(await state()).sourceLifted, 'receiver acknowledges delivery only after the card finishes arriving');
  await page.evaluate(() => { document.documentElement.dataset.ogMotion = 'reduced'; });
  await page.waitForTimeout(30);
  check((await state()).receiverAnimations === 0, 'reducing motion also stops a receiver acknowledgment already running');
  await reset();

  await page.evaluate(() => { const t = window.__motion; t.api.playVaultTakeout(t.create(), t.source.getBoundingClientRect()); });
  check((await state()).cards === 1 && (await state()).phase === 'takeout', 'opening uses a separate takeout copy without marking the stored source removed');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable:true, get:() => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  check((await state()).cards === 0, 'hiding during takeout removes its transient copy immediately');
  await reset();

  await page.evaluate(() => {
    const t = window.__motion;
    document.documentElement.style.setProperty('--og-dur-3', ' ');
    t.start().finish('return');
  });
  check(await page.evaluate(() => window.__motion.card.getAnimations().every(a => a.effect.getTiming().duration < 500)), 'missing duration token falls back to milliseconds rather than a multi-minute flight');
  await page.waitForTimeout(450);
  check((await state()).cards === 0 && !(await state()).sourceLifted, 'a cancelled return finishes and releases its source normally');
  await page.evaluate(() => document.documentElement.style.removeProperty('--og-dur-3'));

  await page.evaluate(() => {
    const t = window.__motion; t.start(); t.api.playVaultTakeout(t.create(), t.source.getBoundingClientRect()); t.api.disposeVaultCardMotions();
  });
  result = await state();
  check(result.cards === 0 && !result.sourceLifted && result.receiverAnimations === 0, 'shared teardown also cleans concurrent dragging and takeout copies');
  const failures = await page.evaluate(async () => {
    const path = '/src/state/vaultRegistry.ts';
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname === path) ?? path;
    const { openVaultItem } = await import(url), messages = [];
    const env = { navigate() { throw Error('Invalid content must not navigate'); }, toast(message) { messages.push(message); } };
    const results = [
      { type:'atom', title:'失效对象', atom:{kind:'plugin:missing-motion-fixture',key:'missing'} },
      { type:'file', title:'缺失引用' },
      { type:'payload', title:'失效附件', payload:{kind:'learn-attachment'} },
      { type:'payload', title:'未知内容', payload:{kind:'unknown-fixture'} },
    ].map(item => openVaultItem(item, env));
    return { results, messages };
  });
  check(failures.results.every(result => result === false), 'invalid atom, missing file, expired attachment and unsupported content cannot start a takeout animation');
  check(failures.messages.length === 4, 'unavailable content still explains why it could not open');
  check(errors.length === 0, 'motion lifecycle has no runtime errors: ' + errors.join('; '));
  console.log(`\n${checks.length} vault motion cleanup assertions passed`);
} finally {
  await closeTestBrowser(browser, { timeoutMs: 10000 });
}
