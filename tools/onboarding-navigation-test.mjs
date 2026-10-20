/** Real navigation stack; only the three UI panel adapters are replaced with observable stubs. */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

globalThis.location = { hash: '#/today' };
globalThis.history = { replaceState(_state, _title, url) { location.hash = url; } };
globalThis.__tourPanelCalls = [];
const calls = globalThis.__tourPanelCalls;
const stubs = {
  '../state/explorer.js': 'export const closeSettings=()=>globalThis.__tourPanelCalls.push("settings"); export const openSettings=()=>{}; export const openTab=()=>{};',
  '../components/explorer/OneGoSheet.js': 'export const closeOneGoSheet=()=>globalThis.__tourPanelCalls.push("onego"); export const openOneGoSection=()=>{};',
  '../state/settingsMode.js': 'export const requestSettingsTab=()=>{};',
  '../state/practicalFeatures.js': 'export const showPracticalFeatures=value=>globalThis.__tourPanelCalls.push(value===false?"practical-close":"practical-open");',
};
registerHooks({ resolve(specifier, context, next) {
  const source = context.parentURL?.endsWith('/lib/onboardingNavigation.ts') && stubs[specifier];
  return source ? { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true } : next(specifier, context);
} });
const nav = await import('../apps/desktop/src/state/navStack.ts');
const { beginPracticePanels, closePracticePanels, endPracticePanels } = await import('../apps/desktop/src/lib/onboardingNavigation.ts');
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log('✓ ' + label); };
const root = { page: 'today', params: null, url: '#/today' };
const detail = { page: 'vault', params: null, url: '#/vault' };
const ids = () => nav.navFrames().filter(frame => frame.kind === 'overlay').map(frame => frame.id);
const reset = () => { nav.initNavStack(root); calls.length = 0; };

reset();
nav.openOverlayFrame('unrelated', () => assert.fail('No practice session owns this overlay'));
check(closePracticePanels(), 'cleanup without a practice session succeeds');
check(ids().join(',') === 'unrelated', 'cleanup without a baseline never pops unrelated overlays');
check(calls.join(',') === 'settings,onego,practical-close', 'legacy practice panel cleanup still runs once');

reset();
const closed = [];
nav.openOverlayFrame('existing-sheet', () => closed.push('existing-sheet'));
nav.openOverlayFrame('onboarding-tour', () => closed.push('onboarding-tour'));
beginPracticePanels();
nav.closeOverlayFrame('onboarding-tour');
nav.openOverlayFrame('vault-receive', () => closed.push('vault-receive'));
nav.openOverlayFrame('receiver-help', () => closed.push('receiver-help'));
check(closePracticePanels(), 'nested practice overlays close successfully');
check(closed.join(',') === 'receiver-help,vault-receive', 'practice overlays unwind from the child to its parent');
check(ids().join(',') === 'existing-sheet', 'the pre-existing overlay remains open');
check(nav.navFrames()[0].page === 'today' && location.hash === '#/today', 'cleanup preserves the saved page and route');

reset();
beginPracticePanels();
nav.openOverlayFrame('onboarding-tour', () => assert.fail('The guide must never close itself through practice cleanup'));
check(closePracticePanels() && ids().join(',') === 'onboarding-tour', 'the guide is a protected boundary even when it was not in the snapshot');

reset();
beginPracticePanels();
nav.openOverlayFrame('under-page', () => assert.fail('Cleanup must not cross a real page boundary'));
nav.pushNav(detail);
check(closePracticePanels() && nav.topFrame().page === 'vault', 'cleanup never navigates Back through a real page');
check(ids().join(',') === 'under-page' && location.hash === '#/vault', 'an overlay below the page boundary is left untouched');

reset();
nav.openOverlayFrame('baseline', () => assert.fail('Retry must keep the original baseline'));
beginPracticePanels();
let busy = true, completed = false, attempts = 0;
const closeTransfer = () => {
  attempts++;
  if (busy) nav.openOverlayFrame('transfer', closeTransfer);
  else completed = true;
};
nav.openOverlayFrame('transfer', closeTransfer);
nav.openOverlayFrame('transfer-menu', () => closed.push('transfer-menu'));
check(!closePracticePanels(), 'a busy transfer that re-registers its frame declines cleanup');
check(attempts === 1 && !completed && ids().join(',') === 'baseline,transfer', 'busy refusal stops after one attempt and retains its parent');
check(calls.length === 0, 'busy refusal does not close containing practice panels');
busy = false;
check(closePracticePanels() && completed, 'the same practice can retry once the transfer is ready');
check(attempts === 2 && ids().join(',') === 'baseline', 'retry uses the original snapshot and closes only its transfer');
check(calls.join(',') === 'settings,onego,practical-close', 'successful retry closes guide panels exactly once');

reset();
beginPracticePanels();
let chain = 0;
const openNext = () => nav.openOverlayFrame('replacement-' + chain++, openNext);
openNext();
check(!closePracticePanels(), 'a callback that keeps opening new overlays cannot loop forever');
check(chain === nav.MAX_FRAMES + 1 && calls.length === 0, 'cleanup has a fixed bound and preserves the still-open panel on exhaustion');
nav.closeOverlayFrame(nav.topFrame().id);
check(closePracticePanels(), 'a bounded refusal remains recoverable after the replacement overlay closes');

reset();
beginPracticePanels();
nav.openOverlayFrame('user-work', () => assert.fail('Ending the guide must retain user work'));
endPracticePanels();
check(ids().join(',') === 'user-work' && calls.length === 0, 'ending a practice only relinquishes ownership without closing anything');
nav.openOverlayFrame('later-work', () => assert.fail('A later replay must not inherit the old practice ownership'));
check(closePracticePanels() && ids().join(',') === 'user-work,later-work', 'later replay cleanup cannot dismiss work from an ended practice');

console.log(`${checks} onboarding navigation assertions passed`);
