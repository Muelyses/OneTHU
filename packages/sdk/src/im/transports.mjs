import { randomBytes } from 'node:crypto';
import { decodeFrame, encodeFrame, headerOf, pingFrame } from './feishuProto.mjs';

function error(code) { return Object.assign(new Error(code), { code }); }
export function sleep(ms, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true });
  });
}
async function jsonRequest(fetcher, url, init, signal, timeoutMs = 40000) {
  const controller = new AbortController(); const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs); timer.unref?.();
  try {
    const response = await fetcher(url, { ...init, redirect: 'manual', signal: controller.signal });
    if (!response.ok) { await response.body?.cancel(); throw error(`IM_HTTP_${response.status}`); }
    const reader = response.body?.getReader(); if (!reader) throw error('IM_INVALID_RESPONSE');
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length; if (size > 1024 * 1024) { await reader.cancel(); throw error('IM_RESPONSE_TOO_LARGE'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw error('IM_INVALID_RESPONSE'); }
  } catch (e) { if (e?.code && /^IM_[A-Z0-9_]+$/.test(e.code)) throw e; throw error(signal.aborted ? 'IM_STOPPED' : 'IM_NETWORK_UNAVAILABLE'); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
function jsonPost(body, headers = {}) { return { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }; }
function backoff(base, attempt) { return Math.min(30000, base * 2 ** Math.min(attempt, 8)); }

export async function runWechat(config, state, context) {
  const { signal, fetch, onMessage, onState, onStatus, assertBound, reconnectMs = 1000, pollTimeoutMs = 40000 } = context;
  let attempt = 0;
  while (!signal.aborted) {
    try {
      await assertBound();
      if ((state.suspendUntil ?? 0) > Date.now()) { onStatus('suspended', 'IM_WECHAT_SESSION_SUSPENDED'); await sleep(Math.min(5000, state.suspendUntil - Date.now()), signal); continue; }
      const result = await jsonRequest(fetch, `${config.credentials.baseUrl}/ilink/bot/getupdates`, jsonPost({
        get_updates_buf: state.cursor ?? '', base_info: { channel_version: '0.1.0', bot_agent: 'OneTHU' },
      }, {
        Authorization: `Bearer ${config.credentials.botToken}`, AuthorizationType: 'ilink_bot_token',
        'X-WECHAT-UIN': Buffer.from(randomBytes(4).readUInt32BE(0).toString()).toString('base64'),
        'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': '65536',
      }), signal, pollTimeoutMs);
      if (signal.aborted) break;
      await assertBound();
      if (result?.ret === -14 || result?.errcode === -14) {
        state.suspendUntil = Date.now() + 60 * 60 * 1000; await onState(state); continue;
      }
      if ((result?.ret !== undefined && result.ret !== 0) || (result?.errcode !== undefined && result.errcode !== 0)) throw error('IM_WECHAT_PROVIDER_REJECTED');
      if (!Array.isArray(result?.msgs ?? []) || (result.msgs?.length ?? 0) > 1000 || (result.get_updates_buf !== undefined && (typeof result.get_updates_buf !== 'string' || result.get_updates_buf.length > 65536))) throw error('IM_INVALID_RESPONSE');
      for (const item of result.msgs ?? []) { if (signal.aborted) break; await onMessage(item); }
      if (signal.aborted) break;
      if (typeof result.get_updates_buf === 'string') state.cursor = result.get_updates_buf;
      state.suspendUntil = 0; await onState(state); attempt = 0; onStatus('online');
      // Some gateways return an empty result immediately instead of long polling.
      await sleep(250, signal);
    } catch (e) {
      if (signal.aborted) break;
      if (e?.code === 'IM_ACCOUNT_MISMATCH') { onStatus('blocked', e.code); return; }
      onStatus('reconnecting', safeCode(e)); await sleep(backoff(reconnectMs, attempt++), signal);
    }
  }
}
function safeCode(value) { return typeof value?.code === 'string' && /^IM_[A-Z0-9_]{1,80}$/.test(value.code) ? value.code : 'IM_CONNECTION_ERROR'; }
export async function defaultWebSocketFactory(url) {
  const { default: WebSocket } = await import('ws');
  return new WebSocket(url, { maxPayload: 1024 * 1024, handshakeTimeout: 15000, followRedirects: false, perMessageDeflate: false });
}
function wsUrl(value) {
  let url; try { url = new URL(value); } catch { throw error('IM_FEISHU_ENDPOINT_INVALID'); }
  if (url.protocol !== 'wss:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || !(url.hostname === 'feishu.cn' || url.hostname.endsWith('.feishu.cn'))) throw error('IM_FEISHU_ENDPOINT_INVALID');
  return url;
}
async function feishuConnection(config, context) {
  const { fetch, signal, webSocketFactory = defaultWebSocketFactory, onMessage, onStatus, assertBound } = context;
  await assertBound();
  const found = await jsonRequest(fetch, 'https://open.feishu.cn/callback/ws/endpoint', jsonPost({ AppID: config.credentials.appId, AppSecret: config.credentials.appSecret }, { locale: 'zh' }), signal, 15000);
  if (found?.code !== 0 || typeof found?.data?.URL !== 'string') throw error('IM_FEISHU_DISCOVERY_FAILED');
  const endpoint = wsUrl(found.data.URL);
  const service = Number(endpoint.searchParams.get('service_id') ?? '0');
  if (!Number.isSafeInteger(service) || service < 0 || service > 2147483647) throw error('IM_FEISHU_ENDPOINT_INVALID');
  await assertBound(); if (signal.aborted) return;
  const ws = await webSocketFactory(endpoint.href);
  await new Promise((resolve, reject) => {
    let finished = false; let ping; let lastPong = Date.now(); let chain = Promise.resolve(); let queued = 0;
    const fragments = new Map();
    const finish = cause => {
      if (finished) return; finished = true;
      clearTimeout(openTimer); clearInterval(ping); signal.removeEventListener('abort', abort);
      ws.removeAllListeners?.('message'); ws.removeAllListeners?.('close'); ws.removeAllListeners?.('open'); ws.removeAllListeners?.('error');
      ws.on?.('error', () => {}); ws.terminate?.(); fragments.clear();
      // Wait for durable event claims before leaving this connection generation.
      void chain.catch(() => {}).then(() => cause ? reject(cause) : resolve());
    };
    const abort = () => finish();
    const openTimer = setTimeout(() => finish(error('IM_FEISHU_OPEN_TIMEOUT')), 15000);
    function schedulePing(seconds) {
      clearInterval(ping);
      const interval = Math.max(5, Math.min(120, Number(seconds) || 120)) * 1000;
      ping = setInterval(() => {
        if (Date.now() - lastPong > interval * 2 + 15000) { finish(error('IM_FEISHU_HEARTBEAT_TIMEOUT')); return; }
        try { ws.send(pingFrame(service)); } catch { finish(error('IM_FEISHU_SEND_FAILED')); }
      }, interval);
    }
    function ack(frame) {
      if (finished || signal.aborted) return;
      ws.send(encodeFrame({ seqId: frame.seqId, logId: frame.logId, service: frame.service, method: frame.method,
        headers: [...frame.headers.filter(header => ['type', 'message_id', 'trace_id'].includes(header.key)), { key: 'biz_rt', value: '1' }],
        payload: new TextEncoder().encode('{"code":200}'),
      }));
    }
    async function frameInput(data) {
      if (finished || signal.aborted) return;
      const frame = decodeFrame(data);
      if (frame.method === 0) {
        lastPong = Date.now();
        try { const value = JSON.parse(new TextDecoder().decode(frame.payload)); if (value.PingInterval) schedulePing(value.PingInterval); } catch { /* a pong can have no config */ }
        return;
      }
      if (frame.method !== 1) return;
      const type = headerOf(frame, 'type');
      if (type !== 'event') { ack(frame); return; }
      if (frame.payloadEncoding && !['json', ''].includes(frame.payloadEncoding)) throw error('IM_FEISHU_ENCODING_UNSUPPORTED');
      let payload = frame.payload ?? new Uint8Array();
      const sum = Number(headerOf(frame, 'sum') ?? '1'); const seq = Number(headerOf(frame, 'seq') ?? '0');
      if (!Number.isSafeInteger(sum) || sum < 1 || sum > 64 || !Number.isSafeInteger(seq) || seq < 0 || seq >= sum) throw error('IM_INVALID_FRAME');
      if (sum > 1) {
        const id = headerOf(frame, 'message_id'); if (!id) throw error('IM_INVALID_FRAME');
        for (const [key, item] of fragments) if (item.expiresAt < Date.now()) fragments.delete(key);
        let item = fragments.get(id);
        if (!item) { if (fragments.size >= 32) throw error('IM_FRAGMENT_LIMIT'); item = { parts: new Array(sum).fill(null), total: 0, expiresAt: Date.now() + 5000 }; fragments.set(id, item); }
        if (item.parts.length !== sum) throw error('IM_INVALID_FRAME');
        if (item.parts[seq]) { if (!Buffer.from(item.parts[seq]).equals(payload)) throw error('IM_INVALID_FRAME'); }
        else { item.parts[seq] = payload; item.total += payload.length; }
        if (item.total > 1024 * 1024) throw error('IM_FRAGMENT_LIMIT');
        if (item.parts.some(part => part === null)) return;
        payload = Buffer.concat(item.parts); fragments.delete(id);
      }
      let event; try { event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)); } catch { throw error('IM_INVALID_EVENT'); }
      await assertBound(); await onMessage(event); ack(frame);
    }
    ws.on('open', () => { clearTimeout(openTimer); lastPong = Date.now(); schedulePing(found.data.ClientConfig?.PingInterval); onStatus('online'); });
    ws.on('message', data => {
      if (++queued > 64) { finish(error('IM_FRAME_QUEUE_FULL')); return; }
      chain = chain.then(() => frameInput(data)).catch(e => { finish(e); }).finally(() => queued--);
    });
    ws.on('error', () => finish(error('IM_FEISHU_SOCKET_ERROR')));
    ws.on('close', () => finish(signal.aborted ? undefined : error('IM_FEISHU_SOCKET_CLOSED')));
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
}
export async function runFeishu(config, _state, context) {
  let attempt = 0;
  while (!context.signal.aborted) {
    try { await feishuConnection(config, context); attempt = 0; }
    catch (e) {
      if (context.signal.aborted) break;
      if (e?.code === 'IM_ACCOUNT_MISMATCH') { context.onStatus('blocked', e.code); return; }
      context.onStatus('reconnecting', safeCode(e));
    }
    if (!context.signal.aborted) await sleep(backoff(context.reconnectMs ?? 1000, attempt++), context.signal);
  }
}
