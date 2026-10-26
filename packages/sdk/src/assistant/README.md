# SDK personal assistant

`createAssistant({store,fetch?,listOperations,dispatch,getAccount,provider?})`
implements a bounded OpenAI-compatible tool loop. It starts no model or IM request
until `run` is called. The caller supplies the private SDK store and operation
router; shell execution and arbitrary JavaScript execution are absent.

Methods:

- `configure(config,{confirm:true})`: local configuration, per school account.
- `status()`: flags, provider/model, budgets and allowed-operation count; no API key
  or endpoint URL. Availability describes configuration, not a health probe.
- `run(text,{signal?,beforeWrite?,sessionId?})`: returns
  `{text,tools,usage,turns,complete,stopReason,sessionId,errorCode?}`.
- `clear(sessionId='default',{confirm:true})`: clear that account's short session.
- `close()`: cancel active model/tool requests and wait for their wrappers to end.

Custom model configuration:

```js
await assistant.configure({
  baseUrl: 'https://your-model-provider.example/v1',
  apiKey: '...', model: 'your-model', language: 'zh-CN',
}, {confirm:true});
```

The endpoint uses `/chat/completions`; configure the base URL without that suffix.
HTTPS is required for remote hosts. HTTP loopback URLs support local models.
Redirects are refused so Authorization cannot move to a different endpoint.
The API key is stored in the private local SDK store. It is not encrypted by this
module. User text and the allowed tool data used in an answer go to the configured
model provider; select that endpoint with this data flow in mind.

An optional `provider:'madmodel'` configuration uses an injected
`provider(body,{signal,beforeWrite,model})` callback. It must return a standard
chat-completions JSON response and preserve the final guard/cancellation. Without
the callback, status reports unavailable and `run` fails explicitly. This module
does not implement independent MadModel login or imply a working school session.

`listOperations()` returns the actual operation descriptors, including `localOnly`
and `mutation`; hiding those flags before this boundary weakens filtering.
By default only read operations are offered to the model. Optional
`allowedOperations:[...]` explicitly selects a different set. All `localOnly`
operations and `auth.*`, `config.*`, `agent.*`, `assistant.*` stay unavailable.
Unknown/GUI-only operations cannot be selected. An allowlist authorizes exposure,
not an operation: `dispatch(operation,args,{signal,beforeWrite})` must route through
the SDK with source `agent` and its automatic/per-request permission policy.

The two model tools are `onethu_catalog` (bounded catalog/schema inspection) and
`onethu_call` (one operation with positional `args`). Calls are serial. The runtime
still validates business arguments. After a permission/confirmation denial, further
writes in the same run are refused. Every tool result is marked external untrusted
data; common secret fields and credential query parameters are redacted. Results
are truncated explicitly when too large. Prompt instructions inside returned
pages or documents do not authorize actions.

Default limits: 6 model turns, 12 tools, 2,048 output tokens per round, 24,000 total
tokens, 120 seconds overall, 60 seconds per model request. Configurable caps are
12 turns, 32 tools, 8,192 output tokens and 200,000 total tokens. The total-token
count uses provider usage when available and a conservative byte estimate
otherwise; it is a processing bound, not a provider billing guarantee. Input,
history, response bodies and tool data also have independent byte limits.

An interrupted model response after successful tools returns their audit records
and `complete:false`. Missing text, token/tool limits and partial provider stops
are never marked complete. Request cancellation and account changes prevent later
tools and memory writes. Actual SDK adapters must preserve the guard through to
their final remote submission; an already submitted request cannot be undone.

Memory is isolated by account and `sessionId`, stores at most 20 user/assistant
text messages with brief tool status receipts, and omits raw tool responses and
tool arguments. IM callers should choose `channel:chat:sender` session IDs.
Reconfiguration and clearing memory cancel active runs for that account.

`node --test packages/sdk/test/assistant.test.mjs` uses loopback HTTP and self-made
model fixtures. It covers the full tool loop, permissions, account/session memory,
redirect refusal, aborts, size/budget limits, partial failures and injected providers.
No real model request, paid call or external IM message was used for these tests.
Windows device behavior, live model-provider calls and real-account Feishu/WeChat
conversations remain unverified. In particular, a configured gateway or model
status does not establish successful live delivery or a healthy model endpoint.
