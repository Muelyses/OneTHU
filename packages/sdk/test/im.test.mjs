import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, realpath, rm, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createNotificationService } from '../src/notifications/index.mjs';
import { createImGateway } from '../src/im/index.mjs';
import { encodeFrame, decodeFrame, headerOf } from '../src/im/feishuProto.mjs';

const yes = { confirm: true };
const wechatConfig = { credentials: { botToken: 'fixture-bot' }, binding: { account: '20260001', senderId: 'fixture-user' } };
const feishuConfig = { credentials: { appId: 'fixture-app', appSecret: 'fixture-secret' }, binding: { account: '20260001', senderId: 'ou_fixture', chatId: 'oc_fixture' } };
const wechatMessage = (id, extra = {}) => ({ message_id: id, message_type: 1, from_user_id: 'fixture-user', context_token: `context-${id}`, create_time_ms: 12345, item_list: [{ type: 1, text_item: { text: '查询课程' } }], ...extra });
function feishuEvent(id, extra = {}) { return { header: { event_id: id, event_type: 'im.message.receive_v1' }, event: { sender: { sender_type: 'user', sender_id: { open_id: 'ou_fixture' } }, message: { message_id: `msg_${id}`, chat_id: 'oc_fixture', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: '查询待办' }), create_time: '12345', ...extra } } }; }
function json(res, body) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

test('unused gateway close joins initialization before removing its data directory', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'onethu-im-close-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (let i = 0; i < 20; i++) {
    const dataDir = path.join(root, String(i));
    const gateway = createImGateway({ dataDir, notifications: { send() { throw new Error('unexpected send'); } }, getAccount: () => null, dispatch() { throw new Error('unexpected dispatch'); } });
    let initialized = false;
    gateway.storage.ready.then(() => { initialized = true; });
    const closing = gateway.close();
    assert.equal(gateway.close(), closing);
    await closing;
    assert.equal(initialized, true);
    await rm(dataDir, { recursive: true });
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(stat(dataDir), { code: 'ENOENT' });
  }
});

test('unused gateway initialization failure is observed and close still drains it', async t => {
  const dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'onethu-im-init-error-')));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await writeFile(path.join(dataDir, 'im'), 'not a directory', { mode: 0o600 });
  const gateway = createImGateway({ dataDir, notifications: { send() {} }, getAccount: () => null, dispatch() {} });
  await new Promise(resolve => setTimeout(resolve, 30));
  await assert.rejects(gateway.status(), { code: 'NOTIFICATION_STORAGE_UNSAFE_PATH' });
  await Promise.all([gateway.close(), gateway.close()]);
  assert.equal(await readFile(path.join(dataDir, 'im'), 'utf8'), 'not a directory');
});

async function until(predicate, timeout = 4000) { const start = Date.now(); while (!await predicate()) { if (Date.now() - start > timeout) throw new Error('fixture timeout'); await new Promise(resolve => setTimeout(resolve, 10)); } }
async function fixture(t, options = {}) {
  const dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'onethu-im-')));
  const requests = []; const events = []; const phases = []; const officialUrls = [];
  let account = '20260001';
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const request = { path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined, req, res }; requests.push(request);
    if (options.http) { const handled = await options.http(request, res, requests); if (handled !== false) return; }
    if (req.url === '/callback/ws/endpoint') json(res, { code: 0, data: { URL: 'wss://msg-frontier.feishu.cn/ws?service_id=7', ClientConfig: { PingInterval: 5 } } });
    else if (req.url.includes('tenant_access_token')) json(res, { code: 0, tenant_access_token: 'fixture-access' });
    else if (req.url.includes('/messages?')) json(res, { code: 0, data: { message_id: 'reply_fixture' } });
    else if (req.url.endsWith('/sendmessage')) json(res, { ret: 0, message_id: 'reply_fixture' });
    // Unhandled getupdates intentionally remains in long poll until cancellation.
  });
  const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 });
  if (options.ws) wss.on('connection', options.ws);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fetcher = (url, init) => { officialUrls.push(url); const target = new URL(url); return fetch(origin + target.pathname + target.search, init); };
  const notifications = createNotificationService({ dataDir, fetch: fetcher, timeoutMs: 2000 });
  const makeGateway = () => createImGateway({ dataDir, notifications, getAccount: async () => account,
    dispatch: options.dispatch ?? (async event => { events.push(event); return '收到'; }),
    fetch: fetcher, webSocketFactory: url => { officialUrls.push(url); return new WebSocket(origin.replace('http:', 'ws:') + '/ws'); },
    onStatus: phase => phases.push(phase), reconnectMs: 20, pollTimeoutMs: 2000, handlerTimeoutMs: 2000,
  });
  let gateway = makeGateway();
  t.after(async () => { await gateway.close(); await notifications.close(); for (const client of wss.clients) client.terminate(); await new Promise(resolve => wss.close(resolve)); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, gateway, notifications, events, requests, phases, officialUrls, setAccount: value => { account = value; }, restart: async () => { await gateway.close(); gateway = makeGateway(); return gateway; } };
}

test('binding configuration requires approval, fixed sender/chat/account and status hides credentials', async t => {
  const f = await fixture(t);
  await assert.rejects(f.gateway.configure('wechat', wechatConfig), { code: 'IM_CONFIRMATION_REQUIRED' });
  await assert.rejects(f.gateway.configure('feishu', { ...feishuConfig, binding: { account: '20260001', senderId: 'ou_fixture' } }, yes), { code: 'IM_INVALID_CONFIGURATION' });
  await f.gateway.configure('wechat', wechatConfig, yes);
  const status = JSON.stringify(await f.gateway.status());
  assert(!status.includes('fixture-bot')); assert(!status.includes('fixture-user'));
  f.setAccount('20260002');
  await assert.rejects(f.gateway.start('wechat'), { code: 'IM_ACCOUNT_MISMATCH' });
  assert.equal(f.requests.length, 0);
});

test('close during asynchronous channel preparation prevents a late transport start', async t => {
  const f = await fixture(t);
  await f.gateway.configure('feishu', feishuConfig, yes);
  const original = f.notifications.configure.bind(f.notifications);
  let entered, release;
  const inside = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  f.notifications.configure = async (...args) => { entered(); await hold; return original(...args); };
  const starting = assert.rejects(f.gateway.start('feishu'), { code: 'IM_GATEWAY_CLOSED' });
  await inside;
  const closing = f.gateway.close();
  let closed = false; closing.then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  release(); await starting; await closing;
  assert.equal(f.gateway.live.size, 0);
  assert.equal(f.gateway.storage.pending.size, 0);
  assert.equal(f.requests.length, 0);
});

test('WeChat real HTTP long poll filters outsiders/bots/groups, sends bound reply and persists cursor', async t => {
  let polls = 0;
  const f = await fixture(t, { http(req, res) {
    if (!req.path.endsWith('/getupdates')) return false;
    if (++polls === 1) json(res, { ret: 0, get_updates_buf: 'cursor-after-1', msgs: [
      wechatMessage('outside', { from_user_id: 'other-person' }), wechatMessage('bot', { message_type: 2 }), wechatMessage('group', { group_id: 'group' }),
      wechatMessage('event1'), wechatMessage('event1'),
    ] });
  } });
  await f.gateway.configure('wechat', wechatConfig, yes); await f.gateway.start('wechat');
  await until(() => f.events.length === 1 && f.requests.some(req => req.path.endsWith('/sendmessage')) && polls >= 2);
  assert.equal(f.events[0].account, '20260001'); assert.equal(f.events[0].senderId, 'fixture-user'); assert.equal(f.events[0].text, '查询课程');
  assert(!JSON.stringify(f.events[0]).includes('context-'));
  const sent = f.requests.find(req => req.path.endsWith('/sendmessage'));
  assert.equal(sent.body.msg.context_token, 'context-event1'); assert.equal(sent.body.msg.to_user_id, 'fixture-user');
  assert.equal(f.requests.filter(req => req.path.endsWith('/getupdates'))[1].body.get_updates_buf, 'cursor-after-1');
  await f.gateway.stop();
  const next = await f.restart(); await next.start('wechat');
  await until(() => polls >= 3);
  assert.equal(f.requests.filter(req => req.path.endsWith('/getupdates'))[2].body.get_updates_buf, 'cursor-after-1');
  assert(f.officialUrls.every(url => url.startsWith('https://ilinkai.weixin.qq.com/')));
});

test('persisted claimed event after restart is never executed a second time', async t => {
  let polls = 0;
  const f = await fixture(t, { http(req, res) {
    if (!req.path.endsWith('/getupdates')) return false;
    if (++polls === 1 || polls === 3) json(res, { ret: 0, get_updates_buf: `cursor-${polls}`, msgs: [wechatMessage('once')] });
  } });
  await f.gateway.configure('wechat', wechatConfig, yes); await f.gateway.start();
  await until(() => f.events.length === 1 && polls >= 2 && f.requests.some(req => req.path.endsWith('/sendmessage')));
  await f.gateway.stop();
  const ledger = path.join(f.dataDir, 'im/ledger');
  for (const name of await readdir(ledger)) {
    const record = JSON.parse(await readFile(path.join(ledger, name), 'utf8'));
    if (record.eventHash) { record.status = 'claimed'; await writeFile(path.join(ledger, name), JSON.stringify(record)); }
  }
  const gateway = await f.restart(); await gateway.start(); await until(() => polls >= 4);
  assert.equal(f.events.length, 1); assert.equal(f.requests.filter(req => req.path.endsWith('/sendmessage')).length, 1);
});

test('account change interrupts active processing and final reply guard prevents cross-account output', async t => {
  let entered; const ready = new Promise(resolve => { entered = resolve; });
  let release; const blocked = new Promise(resolve => { release = resolve; });
  let ctx;
  let polls = 0;
  const f = await fixture(t, { http(req, res) { if (!req.path.endsWith('/getupdates')) return false; if (++polls === 1) json(res, { ret: 0, msgs: [wechatMessage('switch')], get_updates_buf: 'next' }); },
    dispatch: async (_event, context) => { ctx = context; entered(); await blocked; await context.reply('must not send'); },
  });
  await f.gateway.configure('wechat', wechatConfig, yes); await f.gateway.start(); await ready;
  f.setAccount('20260002'); await assert.rejects(ctx.assertBound(), { code: 'IM_ACCOUNT_MISMATCH' }); release();
  await until(() => ctx.signal.aborted);
  await f.gateway.stop(); assert.equal(f.requests.filter(req => req.path.endsWith('/sendmessage')).length, 0);
});

test('WeChat -14 persists a suspension and does not spin or reauthenticate', async t => {
  const f = await fixture(t, { http(req, res) { if (!req.path.endsWith('/getupdates')) return false; json(res, { ret: -14 }); } });
  await f.gateway.configure('wechat', wechatConfig, yes); await f.gateway.start();
  await until(() => f.phases.some(phase => phase.phase === 'suspended'));
  await f.gateway.stop(); const next = await f.restart(); await next.start();
  await until(() => f.phases.filter(phase => phase.phase === 'suspended').length >= 2);
  assert.equal(f.requests.length, 1);
});

test('Feishu actual WebSocket handles fragments, exact 64-bit ACKs, bound text and deduplication', async t => {
  const acks = [];
  const largeId = 18446744073709551614n;
  const f = await fixture(t, { ws(socket) {
    socket.on('message', bytes => { const frame = decodeFrame(bytes); if (frame.method === 1) acks.push(frame); });
    const send = (event, messageId, fragments = 1) => {
      const data = new TextEncoder().encode(JSON.stringify(event));
      for (let seq = 0; seq < fragments; seq++) {
        const start = Math.floor(data.length * seq / fragments); const end = Math.floor(data.length * (seq + 1) / fragments);
        socket.send(encodeFrame({ seqId: largeId, logId: largeId - 1n, service: 7, method: 1, headers: [
          { key: 'type', value: 'event' }, { key: 'message_id', value: messageId }, { key: 'sum', value: String(fragments) }, { key: 'seq', value: String(seq) },
        ], payload: data.subarray(start, end) }));
      }
    };
    send(feishuEvent('outside', { chat_id: 'another-chat' }), 'wire-outside');
    send(feishuEvent('owner'), 'wire-owner', 2);
    send(feishuEvent('owner'), 'wire-owner-repeat');
  } });
  await f.gateway.configure('feishu', feishuConfig, yes); await f.gateway.start('feishu');
  await until(() => f.events.length === 1 && acks.length === 3 && f.requests.some(req => req.path.includes('/messages?')));
  assert.equal(f.events[0].eventId, 'owner'); assert.equal(f.events[0].chatId, 'oc_fixture');
  assert.equal(acks[1].seqId, largeId); assert.equal(acks[1].logId, largeId - 1n);
  assert.equal(headerOf(acks[1], 'message_id'), 'wire-owner');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(acks[1].payload)), { code: 200 });
  assert.deepEqual(f.requests[0].body, { AppID: 'fixture-app', AppSecret: 'fixture-secret' });
  await f.gateway.stop();
});

test('Feishu reconnect discovers a fresh endpoint; no raw endpoint/credentials in status', async t => {
  let connections = 0;
  const f = await fixture(t, { ws(socket) { connections++; if (connections === 1) socket.close(); } });
  await f.gateway.configure('feishu', feishuConfig, yes); await f.gateway.start();
  await until(() => connections >= 2);
  assert(f.requests.filter(req => req.path === '/callback/ws/endpoint').length >= 2);
  const status = JSON.stringify(await f.gateway.status()); assert(!status.includes('fixture-secret')); assert(!status.includes('wss:'));
});

test('untrusted Feishu WebSocket discovery endpoints are rejected before opening sockets', async t => {
  let connections = 0;
  const f = await fixture(t, { http(req, res) { if (req.path !== '/callback/ws/endpoint') return false; json(res, { code: 0, data: { URL: 'wss://evil.invalid/leak?secret=do-not-log' } }); }, ws() { connections++; } });
  await f.gateway.configure('feishu', feishuConfig, yes); await f.gateway.start();
  await until(() => f.phases.some(phase => phase.code === 'IM_FEISHU_ENDPOINT_INVALID'));
  assert.equal(connections, 0); assert(!JSON.stringify(f.phases).includes('do-not-log'));
});

test('protobuf validates lengths/types and supports uint64 round trip without precision loss', () => {
  const frame = { seqId: 18446744073709551615n, logId: 9007199254740993n, service: 7, method: 1, headers: [{ key: 'type', value: 'event' }], payload: Uint8Array.of(1, 2) };
  const decoded = decodeFrame(encodeFrame(frame)); assert.equal(decoded.seqId, frame.seqId); assert.equal(decoded.logId, frame.logId);
  for (const input of [Uint8Array.of(8, 128), Uint8Array.of(42, 10, 1), Uint8Array.of(13, 0), Uint8Array.of(0)]) assert.throws(() => decodeFrame(input));
  assert.throws(() => decodeFrame(new Uint8Array(1024 * 1024 + 1)), { code: 'IM_INVALID_FRAME' });
});

test('starting all gateways skips another account binding and starts the matching account', async t => {
  const f = await fixture(t);
  await f.gateway.configure('feishu', feishuConfig, yes);
  f.setAccount('20260002');
  await f.gateway.configure('wechat', { ...wechatConfig, binding: { ...wechatConfig.binding, account: '20260002' } }, yes);
  await f.gateway.start();
  await until(() => f.requests.some(req => req.path.endsWith('/getupdates')));
  const status = await f.gateway.status();
  assert.equal(status.find(row => row.channel === 'feishu').code, 'IM_ACCOUNT_MISMATCH');
  assert(!f.requests.some(req => req.path === '/callback/ws/endpoint'));
});
