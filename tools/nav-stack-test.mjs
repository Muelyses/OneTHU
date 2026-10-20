/** Real navigation state: nested overlays, cancellation and busy re-entry. */
import assert from 'node:assert/strict';

globalThis.location = { hash: '#/today' };
globalThis.history = { replaceState(_state, _title, url) { location.hash = url; } };
const nav = await import('../apps/desktop/src/state/navStack.ts');
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log('✓ ' + label); };
const root = { page: 'today', params: null, url: '#/today' };
const detail = { page: 'vault', params: null, url: '#/vault' };
const ids = () => nav.navFrames().filter(frame => frame.kind === 'overlay').map(frame => frame.id);
const closed = [];

nav.initNavStack(root);
nav.pushNav(detail);
nav.openOverlayFrame('drawer', () => closed.push('drawer'));
nav.openOverlayFrame('menu', () => closed.push('menu'));
nav.openOverlayFrame('form', () => closed.push('form'));
check(ids().join(',') === 'drawer,menu,form', 'drawer, menu and form each register a distinct nested layer');
nav.openOverlayFrame('menu', () => closed.push('duplicate'));
check(ids().join(',') === 'drawer,menu,form', 'registering an existing layer never duplicates or reorders it');
check(location.hash === '#/vault', 'opening overlays leaves the underlying route unchanged');
check(nav.back() && closed.join(',') === 'form' && nav.topFrame().id === 'menu', 'Back closes the form and returns to its menu');
check(nav.back() && closed.join(',') === 'form,menu' && nav.topFrame().id === 'drawer', 'next Back closes the menu and returns to its drawer');
check(nav.back() && closed.join(',') === 'form,menu,drawer' && nav.topFrame().page === 'vault', 'next Back closes only the drawer');
check(nav.back() && nav.topFrame().page === 'today' && location.hash === '#/today', 'page navigation resumes after the overlay stack is empty');
check(!nav.back(), 'Back at the single root page remains unhandled for the native exit policy');

nav.openOverlayFrame('drawer', () => {});
nav.openOverlayFrame('menu', () => {});
nav.openOverlayFrame('form', () => {});
nav.closeOverlayFrame('menu');
check(ids().join(',') === 'drawer,form', 'a menu closing itself does not remove its child form or parent drawer');
nav.closeOverlayFrame('missing');
check(ids().join(',') === 'drawer,form', 'closing an absent layer leaves the stack intact');
nav.closeOverlayFrame('form');
check(nav.topFrame().id === 'drawer', 'closing the child explicitly restores its remaining parent');

let busy = true;
let done = false;
const closeBusy = () => {
  if (busy) nav.openOverlayFrame('operation', closeBusy);
  else done = true;
};
nav.openOverlayFrame('operation', closeBusy);
check(nav.back() && ids().join(',') === 'drawer,operation' && !done, 'a busy top layer re-enters above its original parent after Back');
nav.openOverlayFrame('confirm', () => {});
check(nav.back() && nav.topFrame().id === 'operation', 'a child confirmation closes before the busy operation');
busy = false;
check(nav.back() && done && nav.topFrame().id === 'drawer', 'the same operation closes normally after work finishes');
nav.closeOverlayFrame('drawer');
check(nav.topFrame().page === 'today' && nav.stackDepth() === 1, 'all overlay closes preserve the underlying root frame');

console.log(`${checks} navigation stack assertions passed`);
