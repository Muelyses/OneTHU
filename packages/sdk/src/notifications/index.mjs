import path from 'node:path';
import { createHash } from 'node:crypto';
import { NotificationError, NotificationStorage, fail } from './storage.mjs';
import { DeliveryError, NotificationProviders, WECHAT } from './providers.mjs';

export { NotificationError };
const CHANNELS = ['inbox', 'feishu', 'wechat', 'webhook'];
const TASK_BINDING = Symbol('taskNotificationBinding');
const hash = value => createHash('sha256').update(value).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function channelId(value) { if (!CHANNELS.includes(value)) fail('NOTIFICATION_UNKNOWN_CHANNEL'); return value; }
function confirm(options) { if (options?.confirm !== true) fail('NOTIFICATION_CONFIRMATION_REQUIRED'); }
function textField(value, max = 8192) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\0\r\n]/.test(value)) fail('NOTIFICATION_INVALID_CONFIGURATION');
  return value.trim();
}
function exactKeys(value, keys) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail('NOTIFICATION_INVALID_CONFIGURATION');
}
function httpsUrl(value) {
  let url;
  try { url = new URL(textField(value, 8192)); } catch { fail('NOTIFICATION_INVALID_ENDPOINT'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname) fail('NOTIFICATION_INVALID_ENDPOINT');
  return url;
}
function normalizeConfig(channel, input) {
  if (channel === 'inbox') { exactKeys(input, []); return {}; }
  if (input?.transport === 'desktop' && ['feishu', 'wechat'].includes(channel)) {
    const target = channel === 'feishu' ? 'chatId' : 'userId';
    exactKeys(input, ['transport', target]);
    return { transport: 'desktop', [target]: textField(input[target], 256) };
  }
  if (channel === 'feishu') {
    exactKeys(input, ['appId', 'appSecret', 'chatId', 'receiveIdType']);
    if (input.receiveIdType !== undefined && !['chat_id','open_id'].includes(input.receiveIdType)) fail('NOTIFICATION_INVALID_CONFIGURATION');
    return { appId: textField(input.appId, 256), appSecret: textField(input.appSecret), chatId: textField(input.chatId, 256), ...(input.receiveIdType ? {receiveIdType:input.receiveIdType} : {}) };
  }
  if (channel === 'wechat') {
    exactKeys(input, ['botToken', 'userId', 'contextToken', 'baseUrl']);
    const base = httpsUrl(input.baseUrl ?? WECHAT);
    // Only the official iLink origin receives a stored bot token. A service
    // migration requires an audited allowlist update rather than arbitrary URLs.
    if (base.origin !== WECHAT || !['', '/'].includes(base.pathname) || base.search) fail('NOTIFICATION_WECHAT_ENDPOINT_UNSUPPORTED');
    return { botToken: textField(input.botToken), userId: textField(input.userId, 256), contextToken: textField(input.contextToken, 16384), baseUrl: base.origin };
  }
  exactKeys(input, ['url', 'headers']);
  const url = httpsUrl(input.url).href;
  const headers = {};
  if (input.headers !== undefined) {
    if (!object(input.headers) || Object.keys(input.headers).length > 16) fail('NOTIFICATION_INVALID_CONFIGURATION');
    for (const [key, value] of Object.entries(input.headers)) {
      if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(key) || /^(?:host|content-length|transfer-encoding|connection|cookie|idempotency-key|proxy-.+)$/i.test(key)) fail('NOTIFICATION_UNSAFE_HEADER');
      const lower = key.toLowerCase();
      if (Object.hasOwn(headers, lower)) fail('NOTIFICATION_INVALID_CONFIGURATION');
      headers[lower] = textField(value);
    }
  }
  return { url, headers };
}
function validateMessage(value) {
  if (!object(value) || Object.keys(value).some(key => !['channel', 'text', 'title', 'idempotencyKey'].includes(key))) fail('NOTIFICATION_INVALID_MESSAGE');
  const channel = channelId(value.channel ?? 'inbox');
  if (typeof value.text !== 'string' || !value.text.trim() || Buffer.byteLength(value.text) > 12000 || value.text.includes('\0')) fail('NOTIFICATION_INVALID_MESSAGE');
  if (value.title !== undefined && (typeof value.title !== 'string' || Buffer.byteLength(value.title) > 500 || /[\0\r\n]/.test(value.title))) fail('NOTIFICATION_INVALID_MESSAGE');
  if (typeof value.idempotencyKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(value.idempotencyKey)) fail('NOTIFICATION_IDEMPOTENCY_KEY_REQUIRED');
  return { channel, text: value.text, title: value.title ?? '', idempotencyKey: value.idempotencyKey };
}
function targetIdentity(channel, config) {
  if (channel === 'feishu') return [config.transport ?? 'node', config.appId ?? '', config.chatId, ...(config.receiveIdType && config.receiveIdType !== 'chat_id' ? [config.receiveIdType] : [])];
  if (channel === 'wechat') return [config.transport ?? 'node', config.baseUrl ?? '', config.userId];
  if (channel === 'webhook') return [config.url];
  return ['local'];
}
function taskBindingId(channel, config) {
  if (channel === 'inbox') return 'inbox';
  return `${channel}:${hash(JSON.stringify(['task-notification-v1', channel, targetIdentity(channel, config)]))}`;
}
function publicReceipt(record, duplicate = false) {
  return {
    channel: record.channel, idempotencyKey: record.idempotencyKey,
    status: record.status === 'pending' ? 'unknown' : record.status,
    duplicate, createdAt: record.createdAt, updatedAt: record.updatedAt,
    code: record.status === 'pending' ? 'NOTIFICATION_PREVIOUS_DELIVERY_UNKNOWN' : record.code,
    providerMessageId: record.providerMessageId,
  };
}
function validateRecord(record, channel, key) {
  if (!object(record) || record.version !== 1 || record.channel !== channel || record.idempotencyKey !== key || !/^[a-f0-9]{64}$/.test(record.payloadHash)
    || !['pending', 'accepted', 'queued', 'stored', 'rejected', 'unknown', 'not_sent'].includes(record.status)
    || !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)
    || (record.code !== undefined && !/^[A-Z0-9_-]{1,100}$/.test(record.code))
    || (record.providerMessageId !== undefined && !/^[\w.:-]{1,256}$/.test(record.providerMessageId))) fail('NOTIFICATION_STORAGE_INVALID');
  return record;
}

/** Outbound notifications only; creates no polling connection or QR login. */
export class NotificationService {
  constructor({ dataDir, fetch: fetcher, desktopSend, timeoutMs = 15000 } = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 60000) fail('NOTIFICATION_INVALID_TIMEOUT');
    if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) fail('NOTIFICATION_STORAGE_ABSOLUTE_PATH_REQUIRED');
    this.storage = new NotificationStorage(path.join(dataDir, 'notifications'));
    this.providers = new NotificationProviders(fetcher, desktopSend);
    this.timeoutMs = timeoutMs; this.queue = Promise.resolve(); this.closed = false;
    this.active = null; this.lastSendAt = 0;
  }
  exclusive(work) {
    if (this.closed) return Promise.reject(new NotificationError('NOTIFICATION_SERVICE_CLOSED'));
    const next = this.queue.then(() => { if (this.closed) fail('NOTIFICATION_SERVICE_CLOSED'); return work(); });
    this.queue = next.catch(() => {}); return next;
  }
  async configs() {
    const stored = await this.storage.read('config.json');
    if (stored === null) return { inbox: {} };
    if (!object(stored) || stored.version !== 1 || !object(stored.channels) || Object.keys(stored.channels).some(channel => !CHANNELS.includes(channel))) fail('NOTIFICATION_STORAGE_INVALID');
    const result = { inbox: {} };
    for (const [channel, config] of Object.entries(stored.channels)) result[channel] = normalizeConfig(channel, config);
    return result;
  }
  async list() {
    if (this.closed) fail('NOTIFICATION_SERVICE_CLOSED');
    const configs = await this.configs();
    return CHANNELS.map(channel => ({
      channel, configured: !!configs[channel], transport: configs[channel]?.transport ?? (channel === 'inbox' ? 'local' : 'node'),
      targetConfigured: !!configs[channel],
      available: !configs[channel] ? false : configs[channel].transport !== 'desktop' || typeof this.providers.desktopSend === 'function',
      contextRequired: channel === 'wechat',
    }));
  }
  async taskChannels() {
    return this.exclusive(async () => {
      const configs = await this.configs();
      return CHANNELS.filter(channel => configs[channel]).map(channel => ({
        id: taskBindingId(channel, configs[channel]), channel,
        transport: configs[channel].transport ?? (channel === 'inbox' ? 'local' : 'node'),
        available: configs[channel].transport !== 'desktop' || typeof this.providers.desktopSend === 'function',
      }));
    });
  }
  async configure(channel, input, options = {}) {
    confirm(options); channelId(channel);
    const config = normalizeConfig(channel, input);
    return this.exclusive(async () => {
      const configs = await this.configs(); configs[channel] = config;
      await options.beforeWrite?.();
      await this.storage.write('config.json', { version: 1, channels: configs });
      this.providers.clear();
      return { channel, configured: true, transport: config.transport ?? (channel === 'inbox' ? 'local' : 'node') };
    });
  }
  async remove(channel, options = {}) {
    confirm(options); channelId(channel);
    if (channel === 'inbox') fail('NOTIFICATION_INBOX_ALWAYS_AVAILABLE');
    return this.exclusive(async () => {
      const configs = await this.configs(); delete configs[channel];
      await options.beforeWrite?.();
      await this.storage.write('config.json', { version: 1, channels: configs }); this.providers.clear();
      return { channel, configured: false };
    });
  }
  async send(input, options = {}) {
    confirm(options);
    const message = validateMessage(input);
    return this.exclusive(async () => {
      if (options.signal?.aborted) fail('NOTIFICATION_ABORTED');
      const configs = await this.configs(); const config = configs[message.channel];
      // Keep resolution inside the same queue as configure/remove and dispatch.
      // A task must never inherit a channel's newly selected recipient.
      if (options[TASK_BINDING] !== undefined && (!config || options[TASK_BINDING] !== taskBindingId(message.channel, config))) fail('TASK_NOTIFICATION_BINDING_CHANGED');
      if (!config) fail('NOTIFICATION_CHANNEL_NOT_CONFIGURED');
      if (options.expectedTarget !== undefined && options.expectedTarget !== (message.channel === 'feishu' ? config.chatId : message.channel === 'wechat' ? config.userId : message.channel === 'webhook' ? config.url : 'local')) fail('NOTIFICATION_TARGET_CHANGED');
      const deliveryId = hash(`${message.channel}\0${message.idempotencyKey}`);
      const name = `ledger/${deliveryId}.json`;
      const payloadHash = hash(JSON.stringify([message.channel, message.text, message.title, targetIdentity(message.channel, config)]));
      const prior = await this.storage.read(name);
      if (prior) {
        validateRecord(prior, message.channel, message.idempotencyKey);
        if (prior.payloadHash !== payloadHash) fail('NOTIFICATION_IDEMPOTENCY_CONFLICT');
        return publicReceipt(prior, true);
      }
      const record = { version: 1, channel: message.channel, idempotencyKey: message.idempotencyKey, payloadHash, status: 'pending', createdAt: Date.now(), updatedAt: Date.now() };
      await this.storage.write(name, record);
      const controller = new AbortController(); this.active = controller;
      const onAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted || this.closed) controller.abort();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      timer.unref?.();
      let started = false;
      const beforeSend = async () => {
        if (controller.signal.aborted || this.closed) throw new DeliveryError('NOTIFICATION_ABORTED', 'not_sent');
        try { await options.beforeWrite?.(); } catch { throw new DeliveryError('NOTIFICATION_WRITE_GUARD_REJECTED', 'not_sent'); }
        if (controller.signal.aborted || this.closed) throw new DeliveryError('NOTIFICATION_ABORTED', 'not_sent');
        started = true; this.lastSendAt = Date.now();
      };
      try {
        let result;
        if (message.channel === 'inbox') {
          await beforeSend();
          await this.storage.write(`inbox/${deliveryId}.json`, { version: 1, ...message, id: deliveryId, createdAt: record.createdAt });
          result = { status: 'stored' };
        } else {
          // Serial sending respects the existing App's conservative 4/s pace.
          const delay = Math.max(0, 250 - (Date.now() - this.lastSendAt));
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          if (controller.signal.aborted) throw new DeliveryError('NOTIFICATION_ABORTED', 'not_sent');
          let rejectAbort;
          const aborted = new Promise((_, reject) => { rejectAbort = () => reject(new DeliveryError('NOTIFICATION_ABORTED', started ? 'unknown' : 'not_sent')); controller.signal.addEventListener('abort', rejectAbort, { once: true }); });
          try {
            result = await Promise.race([this.providers.send(message.channel, config, message, { signal: controller.signal, beforeSend, deliveryId }), aborted]);
          } finally { controller.signal.removeEventListener('abort', rejectAbort); }
        }
        record.status = result.status;
        if (result.providerMessageId) record.providerMessageId = result.providerMessageId;
      } catch (error) {
        record.status = error instanceof DeliveryError ? error.status : started ? 'unknown' : 'not_sent';
        record.code = error instanceof DeliveryError ? error.code : started ? 'NOTIFICATION_DELIVERY_UNKNOWN' : 'NOTIFICATION_NOT_SENT';
      } finally {
        clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); this.active = null;
      }
      record.updatedAt = Date.now();
      await this.storage.write(name, record);
      return publicReceipt(record);
    });
  }
  async sendTask(bindingId, input, options = {}) {
    confirm(options);
    const match = typeof bindingId === 'string' && /^(feishu|wechat|webhook):[a-f0-9]{64}$/.exec(bindingId);
    const channel = bindingId === 'inbox' ? 'inbox' : match?.[1];
    if (!channel) fail('TASK_NOTIFICATION_BINDING_REQUIRED');
    if (!object(input) || Object.keys(input).some(key => !['text', 'title', 'idempotencyKey'].includes(key))) fail('NOTIFICATION_INVALID_MESSAGE');
    return this.send({ ...input, channel }, { ...options, [TASK_BINDING]: bindingId });
  }
  async inbox({ limit = 50, before } = {}) {
    if (this.closed) fail('NOTIFICATION_SERVICE_CLOSED');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || (before !== undefined && !Number.isFinite(before))) fail('NOTIFICATION_INVALID_QUERY');
    const records = [];
    for (const name of await this.storage.inboxNames()) {
      const record = await this.storage.read(`inbox/${name}`);
      if (!record || record.version !== 1 || record.channel !== 'inbox' || record.id !== name.slice(0, -5) || !Number.isFinite(record.createdAt)) fail('NOTIFICATION_STORAGE_INVALID');
      validateMessage({ channel: record.channel, text: record.text, title: record.title, idempotencyKey: record.idempotencyKey });
      if (before === undefined || record.createdAt < before) records.push(record);
    }
    records.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    return { messages: records.slice(0, limit), hasMore: records.length > limit };
  }
  close() {
    if (!this.closePromise) {
      this.closed = true; this.active?.abort();
      this.closePromise = (async () => {
        await this.queue;
        await this.storage.close();
        this.providers.clear();
      })();
    }
    return this.closePromise;
  }
}
export function createNotificationService(options) { return new NotificationService(options); }
