# Independent Node IM gateway

```js
const gateway = createImGateway({
  dataDir, notifications,
  getAccount: () => currentReadyUsernameOrNull,
  dispatch: async (event, {signal, assertBound, reply}) => {
    // Pass signal/assertBound through the assistant to final SDK writes.
    const result = await myAssistant.run(event.text, {
      signal, beforeWrite: assertBound,
      sessionId: `${event.channel}:${event.chatId}:${event.senderId}`,
    });
    return result.text;
  },
});
await gateway.configure('feishu', {
  credentials: {appId, appSecret},
  binding: {account: '20260001', senderId: 'ou_...', chatId: 'oc_...'},
}, {confirm:true});
await gateway.start();
```

`dispatch` receives `{eventId,channel,senderId,chatId,account,text,timestamp}`.
Returning a nonempty string sends one reply. Alternatively, call `reply(text)`
explicitly and return no string. Neither tokens nor platform context are supplied
to the handler. `reply` returns the notification receipt, including unknown status.

WeChat configuration is
`{credentials:{botToken,baseUrl?,contextToken?},binding:{account,senderId}}`.
Only the current official iLink origin is accepted. An initial context is optional
for receiving. A message from the bound sender refreshes the outbound context.
The source token must already be bound; this module adds no QR login flow.

Methods: `configure(channel,config,{confirm:true})`, `remove(channel,{confirm:true})`,
`start(channel?)`, `stop(channel?)`, `status()` / `list()`, `close()`.
Configuration is separate from starting a live gateway. Startup requires that the
current logged-in account matches the explicitly bound school account. The first
message never binds a new sender. Changing a binding requires local confirmation.
Reconfiguration cancels the prior connection and in-flight handlers. `start()`
skips bindings for other accounts; explicitly starting a mismatched channel fails.
`stop()` applies to the current process; `remove()` permanently removes a binding.

Protocols:

- WeChat uses `getupdates`, the existing iLink headers, durable `get_updates_buf`,
  and the App's `-14` one-hour suspension. It cancels pending long polls on stop.
- Feishu uses `/callback/ws/endpoint`, the existing protobuf framing, ping/pong,
  bounded multipart reassembly and ACKs after durable message admission. Exact
  uint64 sequence/log IDs survive round trips. Node uses the `ws` package.
- Both use exponential reconnect backoff. Endpoint redirects are refused. Feishu
  WebSocket discoveries must use WSS on `feishu.cn` or its subdomains.

Only prebound personal text chats are accepted. Group messages, other senders,
bot echoes and unsupported media/rich message types are ignored. Event records
are persisted before dispatch; repeated deliveries and restarts do not rerun
claimed/finished/failed/cancelled events. A process crash during a handler leaves
an unknown outcome; it is deliberately not replayed automatically.

Handlers are serialized per channel with at most 64 admitted events waiting.
The default handler budget is 120 seconds, capped at 150 seconds. An account
change is checked on every admission/reply, with a one-second active-task check.
Cancellation signals and the final `assertBound` check must reach actual remote
writes; JavaScript handlers cannot be forcibly rolled back after a request.

The caller owns the enclosing SDK data-directory lock. Credentials and transport
state are private local JSON under `dataDir/im`, using the notification store's
permissions/ACL protections. Public status excludes credentials and targets.
Optional `fetch`, `webSocketFactory`, `onStatus`, `handlerTimeoutMs`, `reconnectMs`
and `pollTimeoutMs` are factory options for adapters and deterministic tests.

`node --test packages/sdk/test/im.test.mjs` runs real local HTTP/WebSocket fixtures
for filtering, replies, durable cursor/dedup, cancellation, suspension, fragments,
ACKs, reconnect and endpoint refusal. No real model/IM message has been sent.
Windows and real-account live acceptance remain outstanding.
