/** WebView2 cannot create a window from a synchronous Tauri IPC callback.
 * Structural regression guard; actual Windows startup still needs a device test.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apps/desktop/src-tauri/src/overlay_win.rs', import.meta.url), 'utf8');
function violations(text) {
  const functions = [...text.matchAll(/^(?:pub\s+)?(async\s+)?fn\s+(\w+)\s*\(/gm)];
  return functions.flatMap((match, index) => {
    const body = text.slice(match.index, functions[index + 1]?.index ?? text.length);
    const createsWindow = /WebviewWindowBuilder::new\s*\(/.test(body);
    const callsCreation = /\bensure_window\s*\(/.test(body.slice(body.indexOf('{')));
    return !match[1] && (createsWindow || callsCreation) ? [match[2]] : [];
  });
}
assert.deepEqual(violations(source), [], 'Lazy WebView creation must only run through async commands');
// The guard must reject the old startup deadlock and a future drag fallback.
assert.deepEqual(violations('pub fn overlay_show(app: AppHandle) { ensure_window(&app)?; }'), ['overlay_show']);
assert.deepEqual(violations('fn ensure_window() { WebviewWindowBuilder::new(); }'), ['ensure_window']);
assert.deepEqual(violations('pub fn overlay_drag_start() { ensure_window(&app)?; }'), ['overlay_drag_start']);
assert.deepEqual(violations('pub async fn overlay_show() { ensure_window(&app).await?; }'), []);
assert.match(source, /pub fn overlay_drag_start\(/, 'macOS native drag must keep its synchronous mouse-event context');
console.log('Windows WebView creation guard passed (including rejected synchronous regressions); native drag remains synchronous.');
