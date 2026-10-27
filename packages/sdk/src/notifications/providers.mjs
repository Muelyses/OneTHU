import { randomBytes } from 'node:crypto';

const FEISHU = 'https://open.feishu.cn';
export const WECHAT = 'https://ilinkai.weixin.qq.com';
export class DeliveryError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

async function jsonResponse(response) {
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new DeliveryError('NOTIFICATION_REDIRECT_REFUSED', 'unknown'); }
  if (!response.ok) {
    await response.body?.cancel();
    // A server-side 5xx may follow successful delivery. Do not retry it.
    throw new DeliveryError(`NOTIFICATION_HTTP_${response.status}`, response.status < 500 ? 'rejected' : 'unknown');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new DeliveryError('NOTIFICATION_INVALID_RESPONSE', 'unknown');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 128 * 1024) { await reader.cancel(); throw new DeliveryError('NOTIFICATION_RESPONSE_TOO_LARGE', 'unknown'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new DeliveryError('NOTIFICATION_INVALID_RESPONSE', 'unknown'); }
}
function receiptId(value) { return typeof value === 'string' && /^[\w.:-]{1,256}$/.test(value) ? value : undefined; }
function providerCode(prefix, value) { return `${prefix}_${Number.isSafeInteger(value) ? value : 'REJECTED'}`; }

/** Protocols mirror the existing App feishu.ts and wechatProto.ts text senders. */
export class NotificationProviders {
  constructor(fetcher = globalThis.fetch, desktopSend) {
    if (typeof fetcher !== 'function') throw new TypeError('NOTIFICATION_FETCH_REQUIRED');
    this.fetch = fetcher; this.desktopSend = desktopSend; this.tokens = new Map();
  }
  clear() { this.tokens.clear(); }
  async send(channel, config, message, context) {
    const { signal, beforeSend, deliveryId } = context;
    const text = message.title ? `${message.title}\n${message.text}` : message.text;
    const post = (url, body, headers = {}) => this.fetch(url, {
      method: 'POST', redirect: 'manual', signal,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }, body: JSON.stringify(body),
    });
    if (config.transport === 'desktop') {
      if (typeof this.desktopSend !== 'function') throw new DeliveryError('NOTIFICATION_DESKTOP_CHANNEL_UNAVAILABLE', 'not_sent');
      await beforeSend();
      const receipt = await this.desktopSend({ channel, target: channel === 'feishu' ? config.chatId : config.userId, text, idempotencyKey: deliveryId, signal });
      // App's current Feishu send() resolves when queued, before its HTTP result.
      return receipt?.accepted === true ? { status: 'accepted', providerMessageId: receiptId(receipt.messageId) } : { status: 'queued' };
    }
    if (channel === 'feishu') {
      let token = this.tokens.get(config.appId);
      if (!token || token.secret !== config.appSecret || token.expiresAt <= Date.now()) {
        try {
          const result = await jsonResponse(await post(`${FEISHU}/open-apis/auth/v3/tenant_access_token/internal`, { app_id: config.appId, app_secret: config.appSecret }));
          if (result?.code !== 0 || typeof result.tenant_access_token !== 'string' || !result.tenant_access_token || result.tenant_access_token.length > 8192) throw new DeliveryError(providerCode('NOTIFICATION_FEISHU_TOKEN', result?.code), 'not_sent');
          token = { value: result.tenant_access_token, secret: config.appSecret, expiresAt: Date.now() + Math.max(1, Math.min(7200, Number(result.expire) || 7200) - 120) * 1000 };
          this.tokens.set(config.appId, token);
        } catch (error) {
          // No message request has been started, irrespective of token response.
          throw new DeliveryError(error instanceof DeliveryError ? error.code : 'NOTIFICATION_FEISHU_TOKEN_UNAVAILABLE', 'not_sent');
        }
      }
      await beforeSend();
      const result = await jsonResponse(await post(`${FEISHU}/open-apis/im/v1/messages?receive_id_type=${config.receiveIdType ?? 'chat_id'}`, {
        receive_id: config.chatId, msg_type: 'text', content: JSON.stringify({ text }), uuid: deliveryId.slice(0, 50),
      }, { Authorization: `Bearer ${token.value}` }));
      if (typeof result?.code !== 'number') throw new DeliveryError('NOTIFICATION_INVALID_RESPONSE', 'unknown');
      if (result.code !== 0) throw new DeliveryError(providerCode('NOTIFICATION_FEISHU', result.code), 'rejected');
      return { status: 'accepted', providerMessageId: receiptId(result.data?.message_id) };
    }
    if (channel === 'wechat') {
      await beforeSend();
      const result = await jsonResponse(await post(`${config.baseUrl}/ilink/bot/sendmessage`, {
        msg: {
          from_user_id: '', to_user_id: config.userId, client_id: `onethu:${deliveryId}`,
          message_type: 2, message_state: 2,
          item_list: [{ type: 1, text_item: { text } }], context_token: config.contextToken,
        },
        base_info: { channel_version: '0.1.0', bot_agent: 'OneTHU' },
      }, {
        Authorization: `Bearer ${config.botToken}`, AuthorizationType: 'ilink_bot_token',
        'X-WECHAT-UIN': Buffer.from(randomBytes(4).readUInt32BE(0).toString()).toString('base64'),
        'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': '65536',
      }));
      if (result?.ret === -14 || result?.errcode === -14) throw new DeliveryError('NOTIFICATION_WECHAT_SESSION_SUSPENDED', 'rejected');
      if (Number.isSafeInteger(result?.errcode) && result.errcode !== 0) throw new DeliveryError(providerCode('NOTIFICATION_WECHAT', result.errcode), 'rejected');
      if (!Number.isSafeInteger(result?.ret)) throw new DeliveryError('NOTIFICATION_INVALID_RESPONSE', 'unknown');
      if (result.ret !== 0) throw new DeliveryError(providerCode('NOTIFICATION_WECHAT', result.ret), 'rejected');
      return { status: 'accepted', providerMessageId: receiptId(result.message_id) };
    }
    if (channel === 'webhook') {
      await beforeSend();
      const response = await post(config.url, { source: 'OneTHU', idempotencyKey: deliveryId, title: message.title || undefined, text: message.text }, { ...config.headers, 'Idempotency-Key': deliveryId });
      await response.body?.cancel();
      if (response.status >= 300 && response.status < 400) throw new DeliveryError('NOTIFICATION_REDIRECT_REFUSED', 'unknown');
      if (!response.ok) throw new DeliveryError(`NOTIFICATION_HTTP_${response.status}`, response.status < 500 ? 'rejected' : 'unknown');
      return { status: 'accepted' };
    }
    throw new DeliveryError('NOTIFICATION_CHANNEL_UNAVAILABLE', 'not_sent');
  }
}
