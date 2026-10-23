/** Update reminders in the real UI; fictional account, intercepted manifest, no downloads.
 * Reuses the public preview fixture's disposable browser and external-network denial.
 * The updater, version comparison, reminder store, modal, settings and navigation are real.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setup, close, browser } from './capture-public-preview.mjs';
import { advanceOnboardingPrivacy, closeTestBrowser } from './lib/onboarding-browser-steps.mjs';

const out = process.env.ONETHU_TEST_OUT ?? '/tmp/onethu-update-reminder';
mkdirSync(out, { recursive: true });
const manifestURL = 'https://github.com/smartThise/OneTHU/releases/latest/download/latest.json';
const snoozeKey = 'onethu.update.snooze.v1';
const durations = { hour: 3_600_000, day: 86_400_000, week: 604_800_000 };
const checks = [], samples = [], errors = [];
const groups = new Set((process.env.ONETHU_UPDATE_GROUPS ?? 'matrix,timing,overlays,locale').split(','));
let active, passed = false, releaseHeldResponse;
const check = (value, label) => { assert.ok(value, label); checks.push(label); console.log('✓ '+label); };
const prompt = page => page.getByTestId('software-update-prompt');
const moduleCall = (page, owner, dependency, fn, args = []) => page.evaluate(async ({ owner, dependency, fn, args }) => {
  // Reuse the document's first resolved module. Fresh Vite query URLs after a
  // concurrent source edit can otherwise create a second, disconnected store.
  const modules = window.__updateTestModules ??= new Map();
  if (!modules.has(dependency)) {
    const source = await (await fetch(owner)).text();
    const path = [...source.matchAll(/"([^" ]+)"/g)].map(m => m[1]).find(path => path.startsWith(dependency)) ?? dependency;
    modules.set(dependency, await import(path));
  }
  return modules.get(dependency)[fn](...args);
}, { owner, dependency, fn, args });
const reminder = (page, fn, args) => moduleCall(page, '/src/components/UpdatePromptHost.tsx', '/src/lib/updateReminder.ts', fn, args);
const explorer = (page, fn, args) => moduleCall(page, '/src/components/explorer/TabHost.tsx', '/src/state/explorer.ts', fn, args);
const setLocale = (page, locale) => moduleCall(page, '/src/components/UpdatePromptHost.tsx', '/src/i18n/index.ts', 'setLocale', [locale]);
const readSnooze = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), snoozeKey);
const settled = page => page.waitForTimeout(350);

async function boot({ mode = 'full', locale = 'zh-CN', width = 390, height = 844, snooze, beforeCheck } = {}) {
  const env = await setup(width, height, mode);
  active = env.page;
  const page = env.page;
  page.on('pageerror', e => errors.push(e.message));
  const network = { version: '99.0.0', reads: 0, downloads: 0, failed: false };
  await page.route(manifestURL, async route => {
    network.reads++;
    if (network.hold) await network.hold;
    if (network.failed) return route.fulfill({ status: 503, body: 'Fixture unavailable', headers: { 'access-control-allow-origin': '*' } });
    const asset = ext => ({ url: `https://example.invalid/OneTHU_${network.version}.${ext}`, size: 123456, sha256: 'a'.repeat(64) });
    await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({
      version: network.version, notes: 'Fictional release for UI verification only.',
      assets: { macos: asset('dmg'), windows: asset('exe'), linux: asset('AppImage'), android: asset('apk') },
    }) });
  });
  await page.route('https://example.invalid/**', route => { network.downloads++; return route.abort(); });
  if (snooze) await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: snoozeKey, value: snooze });
  // Fixed capture dates alone do not advance reminder timers. Install a real virtual clock.
  await page.clock.install({ time: new Date('2026-10-22T12:00:00Z') });
  await page.reload();
  await page.locator(mode === 'full' ? '.explorer-shell' : '.simple-home').waitFor();
  await setLocale(page, locale);
  if (beforeCheck) await beforeCheck(page);
  return { ...env, network, mode, locale };
}

async function waitPrompt(page) { await prompt(page).waitFor(); await settled(page); }
async function chooseLater(page, duration) {
  await prompt(page).getByRole('combobox').selectOption(duration);
  const now = await page.evaluate(() => Date.now());
  await prompt(page).getByRole('button').last().click();
  await prompt(page).waitFor({ state: 'hidden' });
  const value = await readSnooze(page);
  check(value?.version === '99.0.0' && Math.abs(value.until - now - durations[duration]) < 1500, `${duration}: click persists the exact version and requested duration`);
  return value;
}
async function fit(page, label) {
  const metrics = await prompt(page).evaluate(el => {
    const r = el.getBoundingClientRect();
    const buttons = [...el.querySelectorAll('button')].map(b => ({ text: b.textContent, rect: b.getBoundingClientRect().toJSON() }));
    return { rect: r.toJSON(), width: innerWidth, height: innerHeight, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, buttons, text: el.textContent };
  });
  samples.push({ label, metrics });
  check(metrics.rect.left >= 0 && metrics.rect.right <= metrics.width + 1 && metrics.rect.top >= 0 && metrics.rect.bottom <= metrics.height + 1 && metrics.scrollWidth <= metrics.clientWidth + 1, `${label}: reminder fits the viewport`);
  check(metrics.buttons.length === 2 && metrics.buttons.every(b => b.rect.width >= 44 && b.rect.height >= 32), `${label}: both actions have usable hit areas`);
}

try {
  // A full language × experience × viewport matrix; every case waits for the real
  // host's startup timer and the real updater's parsed HTTP manifest result.
  for (const locale of (groups.has('matrix') ? ['zh-CN', 'en-US'] : [])) for (const mode of ['full', 'practical', 'simple']) for (const [width, height, device] of [[390, 844, 'phone'], [1440, 900, 'desktop']]) {
    const env = await boot({ locale, mode, width, height });
    const { page, context, network } = env;
    const label = `${locale}-${mode}-${device}`;
    await waitPrompt(page);
    check(network.reads === 1, `${label}: automatic startup check shows exactly one reminder`);
    const text = await prompt(page).innerText();
    check(text.includes('99.0.0') && (locale === 'en-US' ? !/[\u3400-\u9fff]/.test(text) && /update/i.test(text) : /更新/.test(text)), `${label}: version and localized copy are correct`);
    await fit(page, label);
    await page.screenshot({ path: `${out}/${label}.png` });
    await prompt(page).getByRole('button').first().click();
    await prompt(page).waitFor({ state: 'hidden' });
    const section = page.locator('[id][data-set-id="row-set-update"]:visible');
    await section.waitFor();
    await page.waitForTimeout(600);
    const target = await section.evaluate(el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: innerHeight, text: el.textContent, hiddenAncestor: !!el.closest('[hidden]') };
    });
    samples.push({ label, updateTarget: target });
    check(!target.hiddenAncestor && target.top >= 0 && target.top < target.height - 60 && target.text.includes('99.0.0'), `${label}: update action lands at the visible populated software-update section`);
    check(!/\+\s*`/.test(target.text), `${label}: update details render prose without exposed template syntax`);
    check(network.downloads === 0 && network.reads === 1, `${label}: opening update settings reuses the check without downloading`);
    await close(page, context); active = null;
  }

  // Same-document expiry, reload persistence, all three duration choices.
  if (groups.has('timing')) {
  for (const duration of Object.keys(durations)) {
    const { page, context, network } = await boot();
    await waitPrompt(page);
    const saved = await chooseLater(page, duration);
    await page.clock.fastForward(durations[duration] - 2000);
    check(await prompt(page).count() === 0, `${duration}: no reminder before the deadline`);
    await page.clock.fastForward(3000);
    await waitPrompt(page);
    check(true, `${duration}: reminder returns on expiry in the same running session`);
    await chooseLater(page, duration);
    const beforeReload = await readSnooze(page);
    await page.reload(); await page.locator('.explorer-shell').waitFor();
    await page.waitForTimeout(3500);
    check(await prompt(page).count() === 0 && (await readSnooze(page)).until === beforeReload.until, `${duration}: document restart preserves the reminder deadline`);
    check(network.downloads === 0, `${duration}: delaying reminders never downloads an installer`);
    samples.push({ duration, saved, beforeReload, reads: network.reads });
    await close(page, context); active = null;
  }

  // New browser context: restore only the previously persisted preference.
  {
    const stored = { version: '99.0.0', until: Date.parse('2026-10-23T12:00:00Z') };
    const { page, context, network } = await boot({ snooze: stored });
    await page.waitForTimeout(3500);
    check(network.reads === 1 && await prompt(page).count() === 0, 'fresh browser session respects a persisted same-version delay');
    network.version = '99.0.1';
    await page.clock.fastForward(6 * 60 * 60 * 1000 + 1000);
    await waitPrompt(page);
    check((await prompt(page).innerText()).includes('99.0.1'), 'a newer release bypasses the old release delay at the periodic check');
    await close(page, context); active = null;
  }

  {
    const { page, context, network } = await boot({ width: 320, height: 568 });
    await waitPrompt(page);
    await fit(page, 'small-phone-320');
    await prompt(page).getByRole('button').last().scrollIntoViewIfNeeded();
    check(await prompt(page).getByRole('button').last().isVisible(), 'small phone can scroll to the postpone action');
    await page.screenshot({ path: `${out}/small-phone-320.png` });
    check(network.downloads === 0, 'small phone reminder performs no download');
    await close(page, context); active = null;
  }

  {
    const { page, context, network } = await boot();
    network.failed = true;
    await page.waitForTimeout(3500);
    check(network.reads === 1 && await prompt(page).count() === 0 && await page.locator('.explorer-shell').isVisible(), 'failed background check leaves the main screen usable without an error popup');
    network.failed = false;
    await page.clock.fastForward(15 * 60_000 + 1000);
    await waitPrompt(page);
    check(network.reads === 2, 'background check retries after its failure backoff');
    await close(page, context); active = null;
  }

  }

  // Keyboard and the same back() path used by the native Android listener.
  if (groups.has('overlays')) {
  for (const method of ['Escape', 'Android back']) {
    const { page, context } = await boot();
    await waitPrompt(page);
    const before = await explorer(page, 'explorerSnapshot');
    if (method === 'Escape') await page.keyboard.press('Escape');
    else {
      const consumed = await moduleCall(page, '/src/components/UpdatePromptHost.tsx', '/src/state/navStack.ts', 'back');
      check(consumed === true, 'Android back is consumed by the reminder overlay frame');
    }
    await prompt(page).waitFor({ state: 'hidden' });
    check((await explorer(page, 'explorerSnapshot')).activeId === before.activeId && await page.locator('.explorer-shell').isVisible(), `${method}: dismisses only the reminder and keeps the main screen`);
    check((await readSnooze(page))?.version === '99.0.0', `${method}: dismissal records the selected delay`);
    await close(page, context); active = null;
  }

  }

  if (groups.has('locale')) {
    const { page, context, network } = await boot();
    await waitPrompt(page);
    await setLocale(page, 'en-US');
    await settled(page);
    check(!/[\u3400-\u9fff]/.test(await prompt(page).innerText()), 'open reminder changes from Chinese to English immediately');
    await prompt(page).getByRole('button').first().click();
    const section = page.locator('[id][data-set-id="row-set-update"]:visible');
    await section.waitFor(); await settled(page);
    check(!/[\u3400-\u9fff]/.test(await section.innerText()), 'opening software update after switching language localizes the staged result and source');
    await setLocale(page, 'zh-CN'); await settled(page);
    const sourceZH = await moduleCall(page, '/src/components/SoftwareUpdateSection.tsx', '/src/i18n/index.ts', 't', ['lib.updater.71c70711a602']);
    check((await section.innerText()).includes(sourceZH), 'available update source follows an English-to-Chinese language switch');
    check((await section.innerText()).includes('Fictional release for UI verification only.'), 'external release notes remain unchanged during language switches');

    let releaseResponse;
    network.hold = new Promise(resolve => { releaseResponse = resolve; releaseHeldResponse = resolve; });
    network.version = await moduleCall(page, '/src/components/SoftwareUpdateSection.tsx', '/src/lib/update.ts', 'currentVersion');
    await section.getByRole('button').first().click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-set-id="row-set-update"] button')].some(button => button.getAttribute('aria-busy') === 'true' || button.disabled));
    await setLocale(page, 'en-US'); await settled(page);
    check(!/[\u3400-\u9fff]/.test(await section.innerText()), 'active update check localizes the source and loading text after a language switch');
    releaseResponse(); releaseHeldResponse = null; network.hold = null;
    await section.getByText(/up to date|latest version/i).first().waitFor();
    check(!/[\u3400-\u9fff]/.test(await section.innerText()), 'completed current-version result uses the current English locale');
    await setLocale(page, 'zh-CN'); await settled(page);
    check((await section.innerText()).includes('最新') && !/up to date|latest version/i.test(await section.innerText()), 'completed current-version result rerenders in Chinese without another request');
    check(network.reads === 2 && network.downloads === 0, 'language changes cause no extra update check or download');
    await page.screenshot({ path: `${out}/dynamic-locale-settings.png` });
    await close(page, context); active = null;

    for (const mode of ['practical', 'simple']) {
      const { page, context } = await boot({ mode, locale: 'en-US', width: 1440, height: 900 });
      check(await page.locator('.simple-section-head p').count() === 0, `${mode}: simplified home removes both explanatory slogans`);
      const expectedDate = await page.evaluate(() => new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date()));
      check((await page.locator('.simple-header-date').innerText()).trim() === expectedDate, `${mode}: home date uses the selected English locale`);
      await close(page, context); active = null;
    }
  }

  if (groups.has('overlays')) {
  {
    const { page, context, network } = await boot({ beforeCheck: page => explorer(page, 'openSettings', ['settings']) });
    await page.waitForTimeout(3500);
    check(network.reads === 1 && await prompt(page).count() === 0 && await page.locator('.settings-panel').isVisible(), 'existing settings dialog keeps focus while the check finishes');
    await page.locator('.settings-panel').getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.locator('.settings-panel').waitFor({ state: 'hidden' });
    await waitPrompt(page);
    check(true, 'reminder opens after the existing settings dialog finishes closing');
    await close(page, context); active = null;
  }

  {
    const { page, context, network } = await boot({ beforeCheck: page => page.evaluate(() => window.dispatchEvent(new Event('onethu.onboarding.replay'))) });
    const tour = page.locator('.experience-tour');
    await tour.locator('[data-tour-phase="privacy"]').waitFor();
    await page.waitForTimeout(3500);
    check(network.reads === 1 && await prompt(page).count() === 0, 'privacy onboarding blocks the reminder even without an Android overlay frame');
    await advanceOnboardingPrivacy(page);
    await tour.locator('.tour-language-continue').click();
    await tour.locator('.tour-next').click();
    if (await tour.locator('[data-tour-phase="layout"]').count()) await tour.locator('.tour-next').click();
    await tour.locator('[data-tour-phase="lesson"]').waitFor();
    // Use home practice so no other modal masks the practice-bar-only guard.
    await tour.getByRole('button', { name: '跳到：白板', exact: true }).click();
    await tour.locator('.tour-real-action button').first().click();
    await page.locator('.tour-resume').waitFor();
    await page.waitForTimeout(700);
    check(await prompt(page).count() === 0, 'the real onboarding practice return bar also defers reminders');
    await page.locator('.tour-resume button').last().click();
    await waitPrompt(page);
    check(true, 'finishing onboarding practice releases the pending reminder');
    await close(page, context); active = null;
  }

  }

  check(errors.length === 0, 'no browser runtime errors');
  passed = true;
} catch (error) {
  if (active) await active.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw error;
} finally {
  releaseHeldResponse?.();
  writeFileSync(`${out}/report.json`, JSON.stringify({ passed, groups: [...groups], checks, samples, errors, boundary: 'Isolated Chromium with synthetic data and intercepted HTTP manifests. Android back exercises the real JS listener target; native Activity/WebView/system installer require device acceptance.' }, null, 2));
  await closeTestBrowser(browser);
}
console.log(JSON.stringify({ passed, checks: checks.length, out }));
