/** Real InfoClient booking flows with a synthetic transport; never books a real seat. */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'sm-crypto') return { url: 'data:text/javascript,export const sm2={};export const sm3={};export const sm4={};', shortCircuit: true };
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
    try { return next(specifier.slice(0, -3) + '.ts', context); } catch {}
  }
  return next(specifier, context);
} });
const { InfoClient } = await import('../packages/core/src/info/client.ts');
const { VenueClient } = await import('../packages/core/src/venue/client.ts');
const { webvpnWrap } = await import('../packages/core/src/crypto/webvpn.ts');
const urls = await import('../packages/core/src/info/urls.ts');
const formUrl = 'http://myhome.tsinghua.edu.cn/kongjian/kj_yuyue2.aspx?room=fixture';
const myUrl = 'http://myhome.tsinghua.edu.cn/kongjian/kj_yuyue_my.aspx';
const profile = { name: 'Fixture', sid: 'fixture-user', tel: 'fixture-only', other: 'synthetic test' };
const room = { devId: 1, devName: 'Fixture room', kindId: 2, roomId: 3 };
// Existing cancellation verification has a 20s fallback timer; unref keeps a
// successful synthetic request from keeping this node process alive afterwards.
const nativeTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...args) => { const timer = nativeTimeout(...args); if (args[1] === 20_000) timer.unref(); return timer; };
let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
function fixture({ action = './kj_yuyue2.aspx?room=fixture', onRead, onWrite } = {}) {
  const calls = [];
  const http = {
    lastDebug: '', lastCookieNames: '', lastFinalUrl: '',
    async request(url, init = {}) {
      const method = init.method ?? 'GET'; calls.push({ url, method, init });
      if (method === 'POST') {
        const supplied = await onWrite?.(url, init);
        if (supplied) return supplied;
        if (url.includes('/api.php/')) return Response.json({ status: 1 });
        if (url.includes('/ic-web/')) return Response.json({ code: 0 });
        if (url.startsWith('http://myhome.tsinghua.edu.cn/kongjian/') || url.startsWith('https://myhome.tsinghua.edu.cn/kongjian/')) return new Response('预约成功');
        throw Error(`Unexpected synthetic POST: ${url}`);
      }
      await onRead?.(url);
      if (url === urls.LIBRARY_CAS_FORM()) return new Response('', { status: 302, headers: { location: 'https://seat.lib.tsinghua.edu.cn/api/id_tsinghua_callback?ticket=fixture-only' } });
      if (url.startsWith('https://oauth.tsinghua.edu.cn/')) return new Response('', { headers: { 'x-onethu-final-url': urls.LIBRARY_HOME() } });
      if (url === urls.LIBRARY_HOME()) return new Response('<script>window.ska={"userid":"fixture-user","access_token":"fixture-token-1234567890"};</script>');
      if (url === urls.LIBRARY_DAYS(4)) {
        const now = new Date(); const day = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        return Response.json({ status: 1, data: { list: [{ id: 2, day, startTime: `${day} 08:00:00`, endTime: `${day} 22:00:00` }] } });
      }
      if (url === urls.LIBROOM_USER_INFO()) return Response.json({ code: 0, data: { pid: 'fixture-user', accNo: 123 } });
      if (url === urls.LIBRARY_BOOK_RECORD()) return new Response('<table><tbody></tbody></table>');
      if (url.startsWith(formUrl) || url.startsWith('https://myhome.tsinghua.edu.cn/kongjian/kj_yuyue2.aspx')) return new Response(`<form name="form1" action="${action}"><input type="hidden" name="__VIEWSTATE" value="fixture-state"><input type="submit" name="fixture$btnOK" value="OK"></form>`);
      if (url === myUrl) return new Response('<form name="form1"><input type="hidden" name="__VIEWSTATE" value="fixture-state"></form>');
      throw Error(`Unexpected synthetic GET: ${url}`);
    },
    async text(url, init) { return (await this.request(url, init)).text(); },
  };
  const client = new InfoClient(http); client.resetStaticSessionCaches();
  return { client, calls, writes: () => calls.filter(call => call.method === 'POST') };
}
const cases = [
  ['library.book', (c, guard) => c.bookLibrarySeat({ id: 7 }, 4, 0, 'fixture-user', guard)],
  ['library.cancel', (c, guard) => c.cancelLibBooking('record-fixture', 'fixture-user', guard)],
  ['libroom.book', (c, guard) => c.bookLibRoom('fixture-user', room, '2026-10-24 10:00', '2026-10-24 11:00', [], guard)],
  ['libroom.cancel', (c, guard) => c.cancelLibRoomBooking('fixture-user', 'record-fixture', guard)],
  ['kongjian.book', (c, guard) => c.kongjianBook(formUrl, profile, guard)],
  ['kongjian.cancel', (c, guard) => c.kongjianCancel('fixture$cancel', guard)],
];
for (const [name, run] of cases) {
  await test(`${name}: access revoked during prefetch prevents the eventual write`, async () => {
    let revoked = false, checked = 0;
    const f = fixture({ onRead: () => { revoked = true; } });
    const guard = async () => { checked++; assert.ok(revoked, 'guard runs after network/session prefetch'); throw Error('CLI_SESSION_CHANGED'); };
    await assert.rejects(run(f.client, guard), /CLI_SESSION_CHANGED/);
    assert.equal(checked, 1); assert.equal(f.writes().length, 0);
  });
  await test(`${name}: an authorized request submits once and legacy callers remain compatible`, async () => {
    let checks = 0; const f = fixture();
    await run(f.client, async () => { checks++; assert.equal(f.writes().length, 0); });
    assert.equal(checks, 1); assert.equal(f.writes().length, 1);
    const legacy = fixture(); await run(legacy.client, undefined); assert.equal(legacy.writes().length, 1);
  });
}
for (const [name, run] of cases.slice(0, 2)) {
  await test(`${name}: explicit stale-token retry rechecks access before its second submission`, async () => {
    let writes = 0, checks = 0;
    const f = fixture({ onWrite: () => { writes++; return Response.json({ status: 0, msg: '请刷新页面后重新操作' }); } });
    await assert.rejects(run(f.client, async () => { if (++checks === 2) throw Error('CLI_SESSION_CHANGED'); }), /CLI_SESSION_CHANGED/);
    assert.equal(checks, 2); assert.equal(writes, 1);
  });
}
await test('public-space URL rejects foreign hosts, credentials, ports and unrelated school paths before any request', async () => {
  for (const url of ['https://example.com/kongjian/kj_yuyue2.aspx', 'http://myhome.tsinghua.edu.cn.evil.example/kongjian/kj_yuyue2.aspx',
    'http://u:p@myhome.tsinghua.edu.cn/kongjian/kj_yuyue2.aspx', 'http://myhome.tsinghua.edu.cn:8080/kongjian/kj_yuyue2.aspx',
    'http://myhome.tsinghua.edu.cn/kongjian/other.aspx', 'file:///kongjian/kj_yuyue2.aspx', '//evil.example/kongjian/kj_yuyue2.aspx']) {
    const f = fixture(); await assert.rejects(f.client.kongjianBook(url, profile), /公共空间预约/); assert.equal(f.calls.length, 0);
  }
});
await test('a forged school form action cannot send the personal booking form to another origin', async () => {
  for (const action of ['https://example.com/capture', '//example.com/capture', '/other/action.aspx']) {
    const f = fixture({ action }); await assert.rejects(f.client.kongjianBook(formUrl, profile), /公共空间预约/);
    assert.equal(f.calls.length, 1); assert.equal(f.writes().length, 0);
  }
});
await test('HTTPS school confirmation pages and relative actions remain usable', async () => {
  const f = fixture(); await f.client.kongjianBook(formUrl.replace('http:', 'https:'), profile);
  assert.equal(f.writes()[0].url, formUrl.replace('http:', 'https:'));
});
await test('a cancelled-seat timeout plus a failed record lookup remains unknown, never false success', async () => {
  const previousTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => ms === 20_000 ? nativeTimeout(fn, 0, ...args) : previousTimeout(fn, ms, ...args);
  try {
    const f = fixture({ onWrite: () => new Promise(() => {}), onRead: url => {
      if (url === urls.LIBRARY_BOOK_RECORD()) throw Error('record lookup unavailable');
    } });
    await assert.rejects(f.client.cancelLibBooking('record-fixture', 'fixture-user', async () => {}), /服务端状态未知/);
    assert.equal(f.writes().length, 1);
  } finally { globalThis.setTimeout = previousTimeout; }
});
await test('venue cancellation checks access before its request; normal and legacy paths submit once', async () => {
  const calls = [];
  const client = new VenueClient({ fetch: async (url, init) => { calls.push({ url, init }); return Response.json({ code: 0 }); } });
  await assert.rejects(client.cancelReserve('fixture', async () => { throw Error('CLI_SESSION_CHANGED'); }), /CLI_SESSION_CHANGED/);
  assert.equal(calls.length, 0);
  let checks = 0; await client.cancelReserve('fixture', async () => { checks++; });
  assert.equal(checks, 1); assert.equal(calls.length, 1);
  await client.cancelReserve('fixture'); assert.equal(calls.length, 2);
});
function uninitializedRoomFixture() {
  const calls = []; let initialized = false;
  const form = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/fixture-room/0';
  const address = 'https://cab.lib.tsinghua.edu.cn/fixture-auth';
  const http = {
    lastDebug: '', lastCookieNames: '', lastFinalUrl: '',
    async request(url, init = {}) {
      calls.push({ url, method: init.method ?? 'GET' });
      if (url === urls.LIBROOM_USER_INFO()) return Response.json({ code: 0, data: initialized ? { pid: '12345', accNo: 123 } : { pid: '12345' } });
      if (url === urls.LIBROOM_AUTH_ADDRESS()) return Response.json({ code: 0, data: address });
      if (url === webvpnWrap(address)) return new Response('', { headers: { 'x-onethu-final-url': form } });
      if (url === form) return new Response('', { status: 302, headers: { location: 'https://cab.lib.tsinghua.edu.cn/callback?ticket=fixture-only' } });
      if (url.startsWith('https://oauth.tsinghua.edu.cn/')) return new Response('', { headers: { 'x-onethu-final-url': 'https://cab.lib.tsinghua.edu.cn/callback' } });
      if (url === urls.LIBROOM_UPDATE_EMAIL()) { initialized = true; return Response.json({ code: 0 }); }
      if (url === urls.LIBROOM_ROOM_INFO() || url.startsWith(urls.LIBROOM_RESOURCE_LIST()) || url.startsWith(urls.LIBROOM_RECORD()) || url.startsWith(urls.LIBROOM_FUZZY_SEARCH())) return Response.json({ code: 0, data: [] });
      throw Error('Unexpected uninitialized room request: ' + url);
    },
    async text(url, init) { return (await this.request(url, init)).text(); },
  };
  const client = new InfoClient(http); client.resetStaticSessionCaches(); return { client, calls };
}
for (const [name, read] of [
  ['list', (client, options) => client.getLibRoomInfoList('12345', options)],
  ['resources', (client, options) => client.getLibRoomResourceList('12345', '2026-10-24', 1, options)],
  ['records', (client, options) => client.getLibRoomRecords('12345', options)],
  ['fuzzyMember', (client, options) => client.fuzzySearchLibRoomMember('12345', 'fixture', options)],
]) {
  await test(`libroom.${name}: read-only initialization never binds an email address`, async () => {
    const f = uninitializedRoomFixture();
    await assert.rejects(read(f.client, { readOnlyInitialization: true }), /LIBROOM_INITIALIZATION_REQUIRED/);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
  });
}
await test('the app retains its existing automatic room initialization behavior', async () => {
  const f = uninitializedRoomFixture(); assert.deepEqual(await f.client.getLibRoomInfoList('12345'), []);
  assert.deepEqual(f.calls.filter(call => call.method === 'POST').map(call => call.url), [urls.LIBROOM_UPDATE_EMAIL()]);
});
console.log(`Reservation write boundary: ${passed} passed`);
