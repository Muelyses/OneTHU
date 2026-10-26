import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, realpath, rm, stat, readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNotificationService } from '../src/notifications/index.mjs';
import { NotificationStorage } from '../src/notifications/storage.mjs';

const yes = { confirm: true };
const feishu = { appId: 'cli_test', appSecret: 'fixture-secret', chatId: 'oc_fixture' };
const wechat = { botToken: 'fixture-token', userId: 'fixture-user', contextToken: 'fixture-context' };
const message = (channel, key = 'test:1') => ({ channel, text: '学校事务提醒', title: 'OneTHU', idempotencyKey: key });
async function fixture(t, handler, options = {}) {
  const dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'onethu-notification-')));
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const request = { path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
    requests.push(request);
    try { await handler?.(request, res, requests.length); }
    catch (error) { res.writeHead(500); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const officialUrls = [];
  const fetcher = (url, init) => { officialUrls.push(url); const target = new URL(url); return fetch(base + target.pathname + target.search, init); };
  let service = createNotificationService({ dataDir, fetch: fetcher, ...options });
  t.after(async () => { await service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, service, requests, officialUrls, restart: async () => { await service.close(); service = createNotificationService({ dataDir, fetch: fetcher, ...options }); return service; } };
}
function json(res, body, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

test('configuration requires confirmation and redacts credentials; local inbox is durable and idempotent', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.configure('feishu', feishu), { code: 'NOTIFICATION_CONFIRMATION_REQUIRED' });
  await f.service.configure('feishu', feishu, yes);
  const listed = JSON.stringify(await f.service.list());
  assert(!listed.includes(feishu.appSecret)); assert(!listed.includes(feishu.chatId));
  await assert.rejects(f.service.send(message('inbox')), { code: 'NOTIFICATION_CONFIRMATION_REQUIRED' });
  const receipt = await f.service.send(message('inbox'), yes);
  assert.equal(receipt.status, 'stored');
  assert.equal((await f.service.send(message('inbox'), yes)).duplicate, true);
  assert.equal((await f.service.inbox()).messages.length, 1);
  const service = await f.restart();
  assert.equal((await service.inbox()).messages[0].text, '学校事务提醒');
  await assert.rejects(service.send({ ...message('inbox'), text: 'Different content' }, yes), { code: 'NOTIFICATION_IDEMPOTENCY_CONFLICT' });
  assert.equal(f.requests.length, 0);
  if (process.platform !== 'win32') {
    assert.equal((await stat(path.join(f.dataDir, 'notifications'))).mode & 0o077, 0);
    assert.equal((await stat(path.join(f.dataDir, 'notifications/config.json'))).mode & 0o077, 0);
  }
});

test('Feishu performs actual token+text HTTP protocol and reuses token; no duplicate HTTP', async t => {
  const f = await fixture(t, (req, res) => req.path.includes('tenant_access_token') ? json(res, { code: 0, tenant_access_token: 'fixture-access', expire: 7200 }) : json(res, { code: 0, data: { message_id: 'om_fixture' } }));
  await f.service.configure('feishu', feishu, yes);
  const first = await f.service.send(message('feishu'), yes);
  assert.equal(first.status, 'accepted'); assert.equal(first.providerMessageId, 'om_fixture');
  await f.service.send(message('feishu'), yes);
  await f.service.send(message('feishu', 'test:2'), yes);
  assert.equal(f.requests.length, 3);
  assert.deepEqual(f.requests[0].body, { app_id: feishu.appId, app_secret: feishu.appSecret });
  assert.equal(f.requests[1].headers.authorization, 'Bearer fixture-access');
  assert.equal(f.requests[1].path, '/open-apis/im/v1/messages?receive_id_type=chat_id');
  assert.equal(f.requests[1].body.receive_id, feishu.chatId);
  assert.deepEqual(JSON.parse(f.requests[1].body.content), { text: 'OneTHU\n学校事务提醒' });
  assert(f.requests[1].body.uuid.length <= 50);
  assert(f.officialUrls.every(url => url.startsWith('https://open.feishu.cn/')));
});

test('WeChat sends the existing iLink message envelope, bound context and required headers', async t => {
  const f = await fixture(t, (_req, res) => json(res, { ret: 0, message_id: 'wechat_fixture' }));
  await f.service.configure('wechat', wechat, yes);
  const receipt = await f.service.send(message('wechat'), yes);
  assert.equal(receipt.status, 'accepted');
  const req = f.requests[0];
  assert.equal(req.path, '/ilink/bot/sendmessage');
  assert.equal(req.headers.authorizationtype, 'ilink_bot_token');
  assert.equal(req.headers.authorization, 'Bearer fixture-token');
  assert.match(Buffer.from(req.headers['x-wechat-uin'], 'base64').toString(), /^\d+$/);
  assert.equal(req.headers['ilink-app-clientversion'], '65536');
  assert.equal(req.body.msg.to_user_id, wechat.userId); assert.equal(req.body.msg.context_token, wechat.contextToken);
  assert.equal(req.body.msg.message_type, 2); assert.equal(req.body.msg.message_state, 2);
  assert.deepEqual(req.body.base_info, { channel_version: '0.1.0', bot_agent: 'OneTHU' });
  await assert.rejects(f.service.configure('wechat', { ...wechat, baseUrl: 'https://evil.invalid' }, yes), { code: 'NOTIFICATION_WECHAT_ENDPOINT_UNSUPPORTED' });
  await assert.rejects(f.service.configure('wechat', { ...wechat, contextToken: '' }, yes), { code: 'NOTIFICATION_INVALID_CONFIGURATION' });
});

test('provider rejection, expired context and token failure remain safe structured receipts', async t => {
  const f = await fixture(t, (req, res) => req.path.includes('tenant_access_token') ? json(res, { code: 10003, msg: 'SECRET FROM PROVIDER' }) : json(res, { ret: -14, errmsg: 'SECRET FROM PROVIDER' }));
  await f.service.configure('feishu', feishu, yes); await f.service.configure('wechat', wechat, yes);
  const a = await f.service.send(message('feishu'), yes); const b = await f.service.send(message('wechat'), yes);
  assert.equal(a.status, 'not_sent'); assert.equal(a.code, 'NOTIFICATION_FEISHU_TOKEN_10003');
  assert.equal(b.status, 'rejected'); assert.equal(b.code, 'NOTIFICATION_WECHAT_SESSION_SUSPENDED');
  assert(!JSON.stringify([a, b]).includes('SECRET'));
  await f.service.send(message('wechat'), yes); assert.equal(f.requests.length, 2);
});

test('timeout is unknown after dispatch, persistent across restart and never auto retried', async t => {
  const f = await fixture(t, () => {}, { timeoutMs: 70 });
  await f.service.configure('webhook', { url: 'https://notify.invalid/endpoint?secret=fixture' }, yes);
  const receipt = await f.service.send(message('webhook'), yes);
  assert.equal(receipt.status, 'unknown');
  const service = await f.restart();
  assert.equal((await service.send(message('webhook'), yes)).duplicate, true);
  assert.equal(f.requests.length, 1);
  assert(!JSON.stringify(receipt).includes('secret'));
});

test('redirects never follow, server failures are unknown and explicit 403 is rejected', async t => {
  const f = await fixture(t, (req, res) => {
    if (req.path === '/redirect') { res.writeHead(302, { Location: '/should-never-reach' }); res.end(); }
    else if (req.path === '/403') json(res, { secret: 'raw response hidden' }, 403);
    else json(res, {}, 503);
  });
  for (const [suffix, status] of [['redirect', 'unknown'], ['403', 'rejected'], ['503', 'unknown']]) {
    await f.service.configure('webhook', { url: `https://notify.invalid/${suffix}` }, yes);
    const receipt = await f.service.send(message('webhook', suffix), yes);
    assert.equal(receipt.status, status);
  }
  assert.equal(f.requests.length, 3); assert(!f.requests.some(request => request.path === '/should-never-reach'));
});

test('final write guard runs after token preparation and prevents message network call', async t => {
  const f = await fixture(t, (_req, res) => json(res, { code: 0, tenant_access_token: 'fixture-access' }));
  await f.service.configure('feishu', feishu, yes);
  let checked = false;
  const receipt = await f.service.send(message('feishu'), { ...yes, beforeWrite() { checked = true; assert.equal(f.requests.length, 1); throw new Error('PRIVATE ACCOUNT'); } });
  assert(checked); assert.equal(receipt.status, 'not_sent'); assert.equal(receipt.code, 'NOTIFICATION_WRITE_GUARD_REJECTED');
  assert.equal(f.requests.length, 1);
});

test('concurrent identical messages are serialized; webhook supplies deterministic idempotency key', async t => {
  const f = await fixture(t, (_req, res) => json(res, {}));
  await f.service.configure('webhook', { url: 'https://notify.invalid/task', headers: { Authorization: 'Bearer fixture' } }, yes);
  const results = await Promise.all(Array.from({ length: 8 }, () => f.service.send(message('webhook'), yes)));
  assert.equal(results.filter(result => result.duplicate).length, 7); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].headers['idempotency-key'], f.requests[0].body.idempotencyKey);
  assert.equal(f.requests[0].headers.authorization, 'Bearer fixture');
  await assert.rejects(f.service.configure('webhook', { url: 'http://notify.invalid' }, yes), { code: 'NOTIFICATION_INVALID_ENDPOINT' });
  await assert.rejects(f.service.configure('webhook', { url: 'https://notify.invalid', headers: { Host: 'evil' } }, yes), { code: 'NOTIFICATION_UNSAFE_HEADER' });
});

test('desktop void acknowledgement is queued; explicit accepted receipt is supported', async t => {
  const sent = [];
  const f = await fixture(t, undefined, { desktopSend: async event => { sent.push(event); if (sent.length > 1) return { accepted: true, messageId: 'desktop-receipt' }; } });
  await f.service.configure('feishu', { transport: 'desktop', chatId: 'oc_fixture' }, yes);
  assert.equal((await f.service.send(message('feishu'), yes)).status, 'queued');
  assert.equal((await f.service.send(message('feishu', 'second'), yes)).status, 'accepted');
  assert.equal(sent[0].target, 'oc_fixture'); assert.equal(f.requests.length, 0);
});

test('pending crash record returns unknown and configuration symlinks fail closed', async t => {
  const f = await fixture(t);
  await f.service.send(message('inbox'), yes);
  const directory = path.join(f.dataDir, 'notifications/ledger');
  const name = (await readdir(directory))[0];
  const record = JSON.parse(await readFile(path.join(directory, name), 'utf8')); record.status = 'pending';
  await writeFile(path.join(directory, name), JSON.stringify(record));
  assert.equal((await f.service.send(message('inbox'), yes)).status, 'unknown');
  const external = path.join(f.dataDir, 'outside.json'); await writeFile(external, '{}', { mode: 0o600 });
  await symlink(external, path.join(f.dataDir, 'notifications/config.json'));
  await assert.rejects(f.service.list(), { code: 'NOTIFICATION_STORAGE_UNSAFE_PATH' });
});

test('close aborts a hanging sender without retry and prevents subsequent use', async t => {
  let received;
  const ready = new Promise(resolve => { received = resolve; });
  const f = await fixture(t, () => received());
  await f.service.configure('webhook', { url: 'https://notify.invalid/task' }, yes);
  const sending = f.service.send(message('webhook'), yes); await ready;
  await f.service.close();
  assert.equal((await sending).status, 'unknown');
  await assert.rejects(f.service.send(message('inbox'), yes), { code: 'NOTIFICATION_SERVICE_CLOSED' });
});

test('credential writes use final owner guards and replies reject changed targets', async t => {
  const f = await fixture(t, (_req, res) => json(res, { ret: 0 }));
  await assert.rejects(f.service.configure('wechat', wechat, { ...yes, beforeWrite() { throw Object.assign(new Error('changed'), { code: 'ACCOUNT_CHANGED' }); } }), { code: 'ACCOUNT_CHANGED' });
  assert.equal((await f.service.list()).find(row => row.channel === 'wechat').configured, false);
  await f.service.configure('wechat', wechat, yes);
  await assert.rejects(f.service.send(message('wechat'), { ...yes, expectedTarget: 'other-user' }), { code: 'NOTIFICATION_TARGET_CHANGED' });
  assert.equal(f.requests.length, 0);
});

test('task channel IDs are durable recipient bindings and omit rotating credentials', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.service.taskChannels(), [{ id: 'inbox', channel: 'inbox', transport: 'local', available: true }]);
  await f.service.configure('feishu', feishu, yes);
  await f.service.configure('wechat', wechat, yes);
  await f.service.configure('webhook', { url: 'https://notify.invalid/task?key=private', headers: { Authorization: 'Bearer initial' } }, yes);
  const initial = await f.service.taskChannels();
  for (const row of initial.filter(row => row.channel !== 'inbox')) assert.match(row.id, new RegExp(`^${row.channel}:[a-f0-9]{64}$`));
  const publicText = JSON.stringify(initial);
  for (const hidden of ['private', 'notify.invalid', feishu.appId, feishu.chatId, wechat.userId, wechat.contextToken]) assert(!publicText.includes(hidden));
  await f.service.configure('feishu', { ...feishu, appSecret: 'rotated-secret' }, yes);
  await f.service.configure('wechat', { ...wechat, botToken: 'rotated-token', contextToken: 'rotated-context' }, yes);
  await f.service.configure('webhook', { url: 'https://notify.invalid/task?key=private', headers: { Authorization: 'Bearer rotated' } }, yes);
  assert.deepEqual(await f.service.taskChannels(), initial);
  const service = await f.restart();
  assert.deepEqual(await service.taskChannels(), initial);
  assert.equal(f.requests.length, 0);
});

test('task delivery rejects recipient/app/endpoint rebinding and legacy names before network access', async t => {
  const f = await fixture(t, (_req, res) => json(res, { ret: 0 }));
  const initialConfigs = { feishu, wechat, webhook: { url: 'https://notify.invalid/first' } };
  const changes = [
    ['feishu', { ...feishu, chatId: 'oc_other' }],
    ['feishu', { ...feishu, appId: 'cli_other' }],
    ['wechat', { ...wechat, userId: 'another-user' }],
    ['webhook', { url: 'https://notify.invalid/second' }],
  ];
  for (const [channel, changed] of changes) {
    await f.service.configure(channel, initialConfigs[channel], yes);
    const binding = (await f.service.taskChannels()).find(row => row.channel === channel).id;
    await f.service.configure(channel, changed, yes);
    const taskMessage = { text: 'private task result', idempotencyKey: `task:${channel}` };
    await assert.rejects(f.service.sendTask(binding, taskMessage, yes), { code: 'TASK_NOTIFICATION_BINDING_CHANGED' });
    await assert.rejects(f.service.sendTask(channel, taskMessage, yes), { code: 'TASK_NOTIFICATION_BINDING_REQUIRED' });
  }
  assert.equal(f.requests.length, 0);
  // The ordinary send API still intentionally selects the current channel target.
  assert.equal((await f.service.send(message('wechat'), yes)).status, 'accepted');
  assert.equal(f.requests[0].body.msg.to_user_id, 'another-user');
});

test('task binding resolution is serialized with reconfiguration and removed channels fail closed', async t => {
  const f = await fixture(t);
  await f.service.configure('wechat', wechat, yes);
  const binding = (await f.service.taskChannels()).find(row => row.channel === 'wechat').id;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const configuring = f.service.configure('wechat', { ...wechat, userId: 'new-recipient' }, { ...yes, beforeWrite: () => gate });
  const refused = assert.rejects(f.service.sendTask(binding, { text: 'old recipient only', idempotencyKey: 'task:race' }, yes), { code: 'TASK_NOTIFICATION_BINDING_CHANGED' });
  release(); await configuring; await refused;
  const current = (await f.service.taskChannels()).find(row => row.channel === 'wechat').id;
  await f.service.remove('wechat', yes);
  await assert.rejects(f.service.sendTask(current, { text: 'removed', idempotencyKey: 'task:removed' }, yes), { code: 'TASK_NOTIFICATION_BINDING_CHANGED' });
  assert.deepEqual(await f.service.taskChannels(), [{ id: 'inbox', channel: 'inbox', transport: 'local', available: true }]);
  assert.equal(f.requests.length, 0);
});

test('bound task sends preserve confirmation, idempotency and final account guards', async t => {
  const f = await fixture(t, (_req, res) => json(res, { ret: 0 }));
  const input = { text: 'task result', idempotencyKey: 'task:inbox' };
  await assert.rejects(f.service.sendTask('inbox', input), { code: 'NOTIFICATION_CONFIRMATION_REQUIRED' });
  assert.equal((await f.service.sendTask('inbox', input, yes)).status, 'stored');
  assert.equal((await f.service.sendTask('inbox', input, yes)).duplicate, true);
  await f.service.configure('wechat', wechat, yes);
  const binding = (await f.service.taskChannels()).find(row => row.channel === 'wechat').id;
  const blocked = await f.service.sendTask(binding, { ...input, idempotencyKey: 'task:blocked' }, { ...yes, beforeWrite() { throw new Error('account changed'); } });
  assert.equal(blocked.status, 'not_sent'); assert.equal(blocked.code, 'NOTIFICATION_WRITE_GUARD_REJECTED');
  assert.equal(f.requests.length, 0);
  await f.service.configure('wechat', { ...wechat, botToken: 'rotated-token', contextToken: 'rotated-context' }, yes);
  assert.equal((await f.service.sendTask(binding, input, yes)).status, 'accepted');
  assert.equal(f.requests[0].body.msg.to_user_id, wechat.userId);
  assert.equal(f.requests[0].body.msg.context_token, 'rotated-context');
});

test('immediate notification close drains initialization before the owner removes its directory', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'onethu-notification-close-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (let i = 0; i < 20; i++) {
    const dataDir = path.join(root, String(i));
    const service = createNotificationService({ dataDir });
    let initialized = false;
    service.storage.ready.then(() => { initialized = true; });
    const closing = service.close();
    assert.equal(service.close(), closing);
    await closing;
    assert.equal(initialized, true);
    assert.equal(service.storage.pending.size, 0);
    await rm(dataDir, { recursive: true });
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(stat(dataDir), { code: 'ENOENT' });
  }
});

test('initialization rejection is observed without use and remains visible to callers', async t => {
  const dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'onethu-notification-init-error-')));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await writeFile(path.join(dataDir, 'notifications'), 'not a directory', { mode: 0o600 });
  const service = createNotificationService({ dataDir });
  // Let the asynchronous initialization fail before any API call observes it.
  // The test runner treats an unhandled rejection as a test failure.
  await new Promise(resolve => setTimeout(resolve, 30));
  await assert.rejects(service.list(), { code: 'NOTIFICATION_STORAGE_UNSAFE_PATH' });
  await Promise.all([service.close(), service.close()]);
  assert.equal(await readFile(path.join(dataDir, 'notifications'), 'utf8'), 'not a directory');
});

test('storage close drains in-flight filesystem work and rejects new operations', async t => {
  const dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'onethu-notification-io-close-')));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const storage = new NotificationStorage(path.join(dataDir, 'store'));
  let finished = false;
  const writing = storage.write('config.json', { version: 1, channels: {} }).then(() => { finished = true; });
  await storage.close();
  assert.equal(finished, true); await writing;
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'store/config.json'), 'utf8')).version, 1);
  await assert.rejects(storage.read('config.json'), { code: 'NOTIFICATION_STORAGE_CLOSED' });
  await rm(dataDir, { recursive: true });
});

test('desktop Feishu open_id is sent with its own target type and cannot inherit a chat_id grant',async t=>{
  const f=await fixture(t,(req,res)=>req.path.includes('tenant_access_token')?json(res,{code:0,tenant_access_token:'fixture',expire:7200}):json(res,{code:0,data:{message_id:'om_openid'}}));
  await f.service.configure('feishu',{...feishu,chatId:'ou_fixture',receiveIdType:'open_id'},yes);
  const first=(await f.service.taskChannels()).find(row=>row.channel==='feishu');
  await f.service.send(message('feishu','open-id'),yes);
  assert.equal(f.requests[1].path,'/open-apis/im/v1/messages?receive_id_type=open_id');assert.equal(f.requests[1].body.receive_id,'ou_fixture');
  await f.service.configure('feishu',{...feishu,chatId:'ou_fixture',receiveIdType:'chat_id'},yes);
  assert.notEqual((await f.service.taskChannels()).find(row=>row.channel==='feishu').id,first.id);
  await assert.rejects(f.service.configure('feishu',{...feishu,receiveIdType:'email'},yes),{code:'NOTIFICATION_INVALID_CONFIGURATION'});
});
