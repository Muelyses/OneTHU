import path from 'node:path';
import { createHash } from 'node:crypto';
import { NotificationStorage } from '../notifications/storage.mjs';
import { runWechat, runFeishu } from './transports.mjs';

const channels = ['feishu', 'wechat'];
const digest = value => createHash('sha256').update(value).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function fail(code) { throw Object.assign(new Error(code), { code }); }
function id(value, maximum = 256) { if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) fail('IM_INVALID_CONFIGURATION'); return value.trim(); }
function checkKeys(value, keys) { if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail('IM_INVALID_CONFIGURATION'); }
function channelId(channel) { if (!channels.includes(channel)) fail('IM_UNKNOWN_CHANNEL'); return channel; }
function requireConfirm(options) { if (options?.confirm !== true) fail('IM_CONFIRMATION_REQUIRED'); }
function normalize(channel, input) {
  checkKeys(input, ['credentials', 'binding']);
  const binding = input.binding; const credentials = input.credentials;
  checkKeys(binding, channel === 'feishu' ? ['account', 'senderId', 'chatId'] : ['account', 'senderId']);
  const account = id(binding.account, 32); if (!/^\d{1,32}$/.test(account)) fail('IM_INVALID_ACCOUNT');
  const bound = { account, senderId: id(binding.senderId) };
  if (channel === 'feishu') {
    bound.chatId = id(binding.chatId);
    checkKeys(credentials, ['appId', 'appSecret']);
    return { credentials: { appId: id(credentials.appId), appSecret: id(credentials.appSecret, 8192) }, binding: bound };
  }
  checkKeys(credentials, ['botToken', 'baseUrl', 'contextToken']);
  if (credentials.baseUrl !== undefined && !['https://ilinkai.weixin.qq.com', 'https://ilinkai.weixin.qq.com/'].includes(credentials.baseUrl)) fail('IM_WECHAT_ENDPOINT_UNSUPPORTED');
  return { credentials: { botToken: id(credentials.botToken, 8192), baseUrl: 'https://ilinkai.weixin.qq.com', ...(credentials.contextToken ? { contextToken: id(credentials.contextToken, 16384) } : {}) }, binding: bound };
}
const bindingKey = (channel, config) => digest(JSON.stringify([channel, config.binding.account, config.binding.senderId, config.binding.chatId ?? '']));
const stateName = channel => `ledger/${digest(`transport:${channel}`)}.json`;
function safeCode(error) { return typeof error?.code === 'string' && /^(?:IM|NOTIFICATION)_[A-Z0-9_]{1,100}$/.test(error.code) ? error.code : 'IM_HANDLER_FAILED'; }
function isEventId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value); }
function isText(value) { return typeof value === 'string' && value.trim() && Buffer.byteLength(value) <= 12000 && !value.includes('\0'); }

/** Fixed-owner, text-only IM gateway. Application handlers retain the final-write guard. */
export class ImGateway {
  constructor({ dataDir, notifications, getAccount, dispatch, fetch: fetcher = globalThis.fetch, webSocketFactory, onStatus, handlerTimeoutMs = 120000, reconnectMs = 1000, pollTimeoutMs = 40000 } = {}) {
    if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir) || typeof getAccount !== 'function' || typeof dispatch !== 'function' || !notifications || typeof notifications.send !== 'function') fail('IM_INVALID_OPTIONS');
    if (!Number.isSafeInteger(handlerTimeoutMs) || handlerTimeoutMs < 50 || handlerTimeoutMs > 150000 || !Number.isSafeInteger(reconnectMs) || reconnectMs < 10 || reconnectMs > 30000 || !Number.isSafeInteger(pollTimeoutMs) || pollTimeoutMs < 50 || pollTimeoutMs > 60000) fail('IM_INVALID_OPTIONS');
    this.storage = new NotificationStorage(path.join(dataDir, 'im'));
    Object.assign(this, { notifications, getAccount, dispatch, fetch: fetcher, webSocketFactory, onStatus, handlerTimeoutMs, reconnectMs, pollTimeoutMs });
    this.live = new Map(); this.phases = new Map(); this.generation = new Map(); this.queue = Promise.resolve(); this.closed = false;
  }
  async configs() {
    const stored = await this.storage.read('config.json');
    if (!stored) return {};
    if (stored.version !== 1 || !object(stored.channels) || Object.keys(stored.channels).some(channel => !channels.includes(channel))) fail('IM_STORAGE_INVALID');
    const result = {};
    for (const [channel, value] of Object.entries(stored.channels)) result[channel] = normalize(channel, value);
    return result;
  }
  exclusive(work) {
    if (this.closed) return Promise.reject(Object.assign(new Error('IM_GATEWAY_CLOSED'), { code: 'IM_GATEWAY_CLOSED' }));
    const result = this.queue.then(() => { if (this.closed) fail('IM_GATEWAY_CLOSED'); return work(); });
    this.queue = result.catch(() => {}); return result;
  }
  phase(channel, phase, code) {
    const record = { channel, phase, ...(code ? { code } : {}), at: Date.now() };
    this.phases.set(channel, record);
    try { this.onStatus?.(record); } catch { /* observers cannot break connection cleanup */ }
  }
  async status() {
    const configs = await this.configs();
    return channels.map(channel => ({ channel, configured: !!configs[channel], bound: !!configs[channel]?.binding, accountBound: !!configs[channel]?.binding.account,
      phase: this.phases.get(channel)?.phase ?? 'off', code: this.phases.get(channel)?.code, queued: this.live.get(channel)?.queued ?? 0,
      textOnly: true, contextReady: channel === 'wechat' ? !!configs[channel]?.credentials.contextToken : undefined }));
  }
  async list() { return this.status(); }
  async configure(channel, input, options = {}) {
    requireConfirm(options); channelId(channel); const config = normalize(channel, input);
    // Cancellation happens before waiting on any pending configuration write.
    await this.stop(channel);
    return this.exclusive(async () => {
      const configs = await this.configs(); configs[channel] = config;
      await this.storage.write('config.json', { version: 1, channels: configs });
      await this.storage.write(stateName(channel), { version: 1, bindingKey: bindingKey(channel, config), cursor: '', suspendUntil: 0 });
      await this.configureOutbound(channel, config);
      this.phase(channel, 'off'); return { channel, configured: true, bound: true };
    });
  }
  async configureOutbound(channel, config) {
    const beforeWrite = async () => { if (await this.getAccount() !== config.binding.account) fail('IM_ACCOUNT_MISMATCH'); };
    await beforeWrite();
    if (channel === 'feishu') await this.notifications.configure(channel, { ...config.credentials, chatId: config.binding.chatId }, { confirm: true, beforeWrite });
    else if (config.credentials.contextToken) await this.notifications.configure(channel, { ...config.credentials, userId: config.binding.senderId }, { confirm: true, beforeWrite });
    // An existing outbound target must never survive a rebind with no context.
    else await this.notifications.remove(channel, { confirm: true, beforeWrite });
  }
  async remove(channel, options = {}) {
    requireConfirm(options); channelId(channel); await this.stop(channel);
    return this.exclusive(async () => {
      const configs = await this.configs(); delete configs[channel];
      await this.storage.write('config.json', { version: 1, channels: configs });
      await this.notifications.remove(channel, { confirm: true });
      return { channel, configured: false };
    });
  }
  async start(channel) {
    if (channel !== undefined) channelId(channel);
    return this.exclusive(async () => {
      const configs = await this.configs();
      for (const selected of channel ? [channel] : channels.filter(id => configs[id])) {
        if (this.live.has(selected)) continue;
        const config = configs[selected]; if (!config) fail('IM_CHANNEL_NOT_CONFIGURED');
        if (await this.getAccount() !== config.binding.account) {
          this.phase(selected, 'blocked', 'IM_ACCOUNT_MISMATCH');
          if (channel !== undefined) fail('IM_ACCOUNT_MISMATCH');
          continue;
        }
        await this.configureOutbound(selected, config);
        if (this.closed) fail('IM_GATEWAY_CLOSED');
        const generation = (this.generation.get(selected) ?? 0) + 1; this.generation.set(selected, generation);
        const controller = new AbortController();
        const live = { controller, generation, config, queued: 0, dispatchQueue: Promise.resolve(), promise: Promise.resolve() };
        const assertBound = async () => {
          if (controller.signal.aborted || this.generation.get(selected) !== generation || this.closed) fail('IM_STOPPED');
          if (await this.getAccount() !== config.binding.account) { controller.abort(); this.phase(selected, 'blocked', 'IM_ACCOUNT_MISMATCH'); fail('IM_ACCOUNT_MISMATCH'); }
          if (controller.signal.aborted || this.generation.get(selected) !== generation || this.closed) fail('IM_STOPPED');
        };
        const state = await this.storage.read(stateName(selected)) ?? { version: 1, bindingKey: bindingKey(selected, config), cursor: '', suspendUntil: 0 };
        if (state.version !== 1 || state.bindingKey !== bindingKey(selected, config) || typeof state.cursor !== 'string' || state.cursor.length > 65536 || !Number.isFinite(state.suspendUntil)) fail('IM_STORAGE_INVALID');
        if (this.closed) fail('IM_GATEWAY_CLOSED');
        this.live.set(selected, live);
        this.phase(selected, 'connecting');
        let checking = false;
        live.watch = setInterval(() => {
          if (checking) return; checking = true;
          void assertBound().catch(() => controller.abort()).finally(() => { checking = false; });
        }, 1000);
        const context = {
          signal: controller.signal, fetch: this.fetch, webSocketFactory: this.webSocketFactory,
          assertBound, reconnectMs: this.reconnectMs, pollTimeoutMs: this.pollTimeoutMs,
          onStatus: (phase, code) => { if (!controller.signal.aborted) this.phase(selected, phase, code); },
          onState: async value => { await assertBound(); await this.storage.write(stateName(selected), { version: 1, bindingKey: bindingKey(selected, config), cursor: value.cursor ?? '', suspendUntil: value.suspendUntil ?? 0 }); },
          onMessage: event => this.accept(selected, config, live, event, assertBound),
        };
        live.promise = (selected === 'wechat' ? runWechat : runFeishu)(config, state, context)
          .catch(error => { if (!controller.signal.aborted) this.phase(selected, 'error', safeCode(error)); })
          .finally(() => { clearInterval(live.watch); if (this.live.get(selected) === live) this.live.delete(selected); });
      }
      return this.status();
    });
  }
  normalizeEvent(channel, config, raw) {
    if (channel === 'wechat') {
      if (!object(raw) || raw.message_type !== 1 || raw.from_user_id !== config.binding.senderId || raw.group_id) return null;
      if (!isEventId(raw.message_id) || !Array.isArray(raw.item_list) || raw.item_list.length > 128) return null;
      const text = raw.item_list.filter(item => item?.type === 1 && typeof item.text_item?.text === 'string').map(item => item.text_item.text).join('\n');
      if (!isText(text)) return null;
      const context = typeof raw.context_token === 'string' && raw.context_token.length <= 16384 && !/[\0\r\n]/.test(raw.context_token) ? raw.context_token : undefined;
      return { eventId: raw.message_id, channel, senderId: raw.from_user_id, chatId: raw.from_user_id, text, timestamp: Number.isFinite(raw.create_time_ms) ? raw.create_time_ms : Date.now(), context };
    }
    if (raw?.header?.event_type !== 'im.message.receive_v1' || raw?.event?.sender?.sender_type !== 'user') return null;
    const sender = raw.event.sender.sender_id?.open_id; const message = raw.event.message;
    if (sender !== config.binding.senderId || message?.chat_id !== config.binding.chatId || message.chat_type !== 'p2p' || message.message_type !== 'text') return null;
    const eventId = raw.header.event_id ?? message.message_id; if (!isEventId(eventId)) return null;
    let text; try { text = JSON.parse(message.content).text; } catch { return null; }
    if (!isText(text)) return null;
    return { eventId, channel, senderId: sender, chatId: message.chat_id, text, timestamp: Number.isFinite(Number(message.create_time)) ? Number(message.create_time) : Date.now() };
  }
  async accept(channel, config, live, raw, assertBound) {
    await assertBound();
    const event = this.normalizeEvent(channel, config, raw); if (!event) return;
    const eventHash = digest(`${bindingKey(channel, config)}\0${event.eventId}`);
    const name = `ledger/${eventHash}.json`;
    const prior = await this.storage.read(name);
    if (prior) {
      if (prior.version !== 1 || prior.eventHash !== eventHash || !['claimed', 'complete', 'failed', 'cancelled'].includes(prior.status)) fail('IM_STORAGE_INVALID');
      return;
    }
    if (live.queued >= 64) fail('IM_DISPATCH_QUEUE_FULL');
    if (channel === 'wechat' && event.context) {
      await this.exclusive(async () => {
        await assertBound();
        const configs = await this.configs();
        if (!configs[channel] || bindingKey(channel, configs[channel]) !== bindingKey(channel, config)) fail('IM_STOPPED');
        configs[channel].credentials.contextToken = event.context;
        config.credentials.contextToken = event.context;
        await this.storage.write('config.json', { version: 1, channels: configs });
        await assertBound(); await this.configureOutbound(channel, config);
      });
    }
    await assertBound();
    const record = { version: 1, eventHash, channel, status: 'claimed', receivedAt: Date.now() };
    await this.storage.write(name, record);
    const safeEvent = { eventId: event.eventId, channel, senderId: event.senderId, chatId: event.chatId, account: config.binding.account, text: event.text, timestamp: event.timestamp };
    live.queued++;
    live.dispatchQueue = live.dispatchQueue.then(async () => {
      const controller = new AbortController(); const abort = () => controller.abort();
      live.controller.signal.addEventListener('abort', abort, { once: true }); if (live.controller.signal.aborted) controller.abort();
      const timeout = setTimeout(abort, this.handlerTimeoutMs);
      let counter = 0;
      const check = async () => { if (controller.signal.aborted) fail('IM_HANDLER_CANCELLED'); await assertBound(); if (controller.signal.aborted) fail('IM_HANDLER_CANCELLED'); };
      let onAbort;
      try {
        await check();
        const reply = async text => {
          await check();
          return this.notifications.send({ channel, text, idempotencyKey: `im:${eventHash}:${counter++}` }, { confirm: true, signal: controller.signal, beforeWrite: check, expectedTarget: channel === 'feishu' ? config.binding.chatId : config.binding.senderId });
        };
        const cancelled = new Promise((_, reject) => { onAbort = () => reject(Object.assign(new Error('IM_HANDLER_CANCELLED'), { code: 'IM_HANDLER_CANCELLED' })); controller.signal.addEventListener('abort', onAbort, { once: true }); });
        const response = await Promise.race([this.dispatch(safeEvent, { signal: controller.signal, assertBound: check, reply }), cancelled]);
        if (typeof response === 'string' && response.trim()) await reply(response);
        await check(); record.status = 'complete';
      } catch (error) { record.status = controller.signal.aborted ? 'cancelled' : 'failed'; record.code = safeCode(error); }
      finally {
        clearTimeout(timeout); controller.signal.removeEventListener('abort', onAbort); live.controller.signal.removeEventListener('abort', abort);
        record.finishedAt = Date.now(); await this.storage.write(name, record); live.queued--;
      }
    }).catch(error => { this.phase(channel, 'error', safeCode(error)); live.controller.abort(); });
  }
  async stop(channel) {
    if (channel !== undefined) channelId(channel);
    const selected = channel ? [channel] : channels;
    const pending = [];
    for (const id of selected) {
      this.generation.set(id, (this.generation.get(id) ?? 0) + 1);
      const live = this.live.get(id);
      if (live) { live.controller.abort(); clearInterval(live.watch); pending.push(live.promise, live.dispatchQueue); }
      this.phase(id, 'off');
    }
    await Promise.allSettled(pending);
    return { stopped: selected };
  }
  close() {
    if (!this.closePromise) {
      this.closed = true;
      this.closePromise = (async () => {
        await this.stop();
        await this.queue;
        // Drain any start that was already preparing when close began.
        await this.stop();
        await this.storage.close();
      })();
    }
    return this.closePromise;
  }
}
export function createImGateway(options) { return new ImGateway(options); }
