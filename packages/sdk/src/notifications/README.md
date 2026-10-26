# Node outbound notifications

`createNotificationService({dataDir, fetch?, desktopSend?, timeoutMs?})` stores its
files under `dataDir/notifications`. The caller holds the SDK data-directory lock.
The default request timeout is 15 seconds, configurable from 50 ms to 60 seconds.
No model, QR login, inbound polling or network request starts during construction.

Methods:

- `configure(channel, config, {confirm:true,beforeWrite?})` and
  `remove(channel,{confirm:true,beforeWrite?})`.
- `list()` returns configuration/availability flags, without targets or credentials.
- `send({channel,text,title?,idempotencyKey},{confirm:true,signal?,beforeWrite?,expectedTarget?})`.
- `taskChannels()` returns `{id,channel,transport,available}` entries for configured
  task destinations. `sendTask(id,{text,title?,idempotencyKey},options)` accepts the
  same confirmation/cancellation/write guards as `send`.
- `inbox({limit?:1..500,before?:timestamp})`, and `close()`.

Channel configuration:

| Channel | Configuration |
| --- | --- |
| `inbox` | `{}`; available by default, local only |
| `feishu` | `{appId,appSecret,chatId}` for a configured Feishu application bot |
| `wechat` | `{botToken,userId,contextToken,baseUrl?}` from an existing iLink binding |
| `webhook` | `{url,headers?}`; HTTPS only, redirects refused |

Feishu uses the App's existing `tenant_access_token/internal` and
`im/v1/messages?receive_id_type=chat_id` protocol. WeChat uses the existing iLink
`sendmessage` envelope, context token, version and authentication headers. Its
current allowlist contains `https://ilinkai.weixin.qq.com`. A missing or expired
context must be refreshed by a new bound-user message or explicit configuration.
Ret/errcode `-14` reports a suspended WeChat session. There is no automatic login.

An optional `desktopSend({channel,target,text,idempotencyKey,signal})` hook supports
`{transport:'desktop',chatId}` or `{transport:'desktop',userId}` configurations.
It can delegate to the existing App `channel.send`. A void return means `queued`;
only `{accepted:true,messageId?}` means that the hook observed a provider receipt.
The existing App's Feishu queue resolves early, so a void return must stay queued.

`send` returns a receipt with `status`, `channel`, `idempotencyKey`, `duplicate`,
timestamps and optional safe error code/provider message ID. Status meanings:

- `accepted`: the provider returned a successful acknowledgement, without a read receipt.
- `stored`: written to the local inbox.
- `queued`: a desktop hook accepted it without a provider receipt.
- `rejected`: the provider explicitly refused it.
- `not_sent`: failure occurred before starting the message request.
- `unknown`: the request might have reached the provider; its outcome is unknown.

The ledger is flushed before dispatch. The same channel and idempotency key never
cause another attempt, including after restart, rejection, timeout or a crash.
Reusing a key with different text or a different configured target is an error.
An interrupted `pending` entry is returned as `unknown`. A caller may request a
new attempt using a new key only after making its own informed retry decision.
There is no internal delivery retry, including for rate limits and HTTP 5xx.

The optional `beforeWrite` guard runs after token preparation and immediately
before dispatch. `expectedTarget` is used by IM replies to refuse a changed
recipient. SDK callers should preserve cancellation and account/policy guards.

Scheduled tasks use a fixed destination ID from the SDK's `tasks.channels`
operation, rather than a channel name. `inbox` is always available with ID `inbox`.
Other IDs have the form `wechat:<SHA-256>`, `feishu:<SHA-256>` or
`webhook:<SHA-256>`. The hash binds the channel, transport and recipient, plus the
Feishu application ID or webhook URL. It excludes API keys, bot tokens and
rotating WeChat context tokens. The SDK supplies an account-specific data directory.
No recipient identifiers, endpoint URLs or credentials appear in this listing.

Save that ID in the task's `template.channels` when authorizing the task. Changing
the recipient, application or webhook URL makes the old task fail with
`TASK_NOTIFICATION_BINDING_CHANGED`; removing the destination does the same.
Refresh the ID and explicitly update/re-authorize the task to use the new target.
Bare external channel names fail with `TASK_NOTIFICATION_BINDING_REQUIRED`.
Credential rotation preserves the binding. Comparison happens inside the same
serialized section as configuration and dispatch, preventing a rebind race.
Ordinary `notifications.send` continues to select the channel's current recipient.

Configuration, ledger and inbox files are private local JSON, not encrypted.
POSIX permissions are 0700/0600; Windows uses the current user's SID and `icacls`.
Symlinks, hard-linked files and unsafe ownership/permissions fail closed. Provider
response bodies, keys, tokens and URLs are excluded from diagnostic receipts.
The configurable webhook endpoint is explicitly selected by the local operator;
the SDK does not discover or download remote notification software.

Validation: `node --test packages/sdk/test/notifications.test.mjs` exercises real
loopback HTTP transports, without sending any real Feishu/WeChat notification.
Windows installation/ACL behavior and real-account IM delivery have not been
accepted on actual Windows devices or real Feishu/WeChat accounts.
