/** Execute actual adapter methods/PluginCard handlers with isolated transport and translation fixtures. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const seed = JSON.parse(readFileSync("docs/i18n/gui-completion-seed.json", "utf8")).messages;
let locale = "zh-CN", checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const t = (key, params = {}) => {
  const value = seed[key]?.[locale] ?? key;
  return value.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
};
const load = (path, mocks, extra = "") => {
  const js = ts.transpileModule(readFileSync(path, "utf8") + extra, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("require", "exports", js)(name => {
    if (!(name in mocks)) throw Error("Unmocked module (network forbidden): " + name);
    return mocks[name];
  }, exports);
  return exports;
};
let qrStatus = "wait";
const logs = [], requests = [];
const wechat = load("apps/desktop/src/im/wechat.ts", {
  "../i18n/index.js": { t },
  "../lib/clients.js": { logLine: async line => logs.push(line) },
  "./store.js": { patchImConfig: async () => { throw Error("No login confirmation is expected"); } },
  "./registry.js": { reportChannelStatus: () => {} },
  "./wechatProto.js": {
    ILINK_API_BASE: "https://example.invalid",
    fetchBotQrcode: async () => ({ qrcode: "fixture-only", qrcode_img_content: "fixture-only" }),
    pollQrcodeStatus: async () => ({ status: qrStatus }),
  },
});
const channel = new wechat.WechatChannel(() => null);
check(channel.label === seed["im.wechat.channelLabel"]["zh-CN"], "WeChat initial label is Chinese");
locale = "en-US";
check(channel.label === seed["im.wechat.channelLabel"]["en-US"], "Existing WeChat adapter label follows locale without recreation");
check(channel.probe().missing === seed["im.wechat.scanRequired"]["en-US"], "Unconfigured WeChat display message is localized");
await wechat.wechatLoginStart();
const expected = { wait: "wait", scaned: "scaned", need_verifycode: "needVerifyCode", expired: "expired", verify_code_blocked: "verifyBlocked", binded_redirect: "bound", scaned_but_redirect: "redirect" };
for (const [status, key] of Object.entries(expected)) {
  qrStatus = status;
  const result = await wechat.wechatLoginPoll();
  check(result.status === status && !result.done && result.note === seed[`im.wechat.qr.${key}`]["en-US"], "QR protocol value stays unchanged; display localized: " + status);
}
locale = "zh-CN"; qrStatus = "wait";
check((await wechat.wechatLoginPoll()).note === seed["im.wechat.qr.wait"]["zh-CN"], "Active QR session uses new locale on next poll");
check(logs[0] === "[IM] 微信扫码登录已发起", "Log wording remains unchanged");
wechat.wechatLoginCancel();

let reply = { code: 1 };
const store = { loadImConfig: async () => ({ channels: { feishu: { appId: "fixture-id", appSecret: "fixture-only" } } }), configSnapshot: () => ({ channels: {} }) };
const feishu = load("apps/desktop/src/im/feishu.ts", {
  "../i18n/index.js": { t },
  "../lib/transport.js": { tauriFetch: async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify(reply)); } },
  "../lib/clients.js": { logLine: async () => {} },
  "./store.js": store, "./registry.js": { reportChannelStatus: () => {} }, "./feishuProto.js": {},
}, "\nexport const __testPrivate = { feishuToken, discoverEndpoint };");
check(feishu.feishuChannel.label === seed["im.feishu.channelLabel"]["zh-CN"], "Feishu initial label is Chinese");
locale = "en-US";
check(feishu.feishuChannel.label === seed["im.feishu.channelLabel"]["en-US"], "Existing Feishu adapter label follows locale");
// Existing outer translations are not in this seed; capture their actual fallback parameters.
const paramsSeen = [];
const tf = (key, params) => { if (params) paramsSeen.push(params); return t(key, params); };
const feishuFallback = load("apps/desktop/src/im/feishu.ts", {
  "../i18n/index.js": { t: tf },
  "../lib/transport.js": { tauriFetch: async () => new Response(JSON.stringify(reply)) },
  "../lib/clients.js": { logLine: async () => {} },
  "./store.js": store, "./registry.js": {}, "./feishuProto.js": {},
}, "\nexport const __testPrivate = { feishuToken, discoverEndpoint };");
await assert.rejects(feishuFallback.__testPrivate.feishuToken());
check(paramsSeen.at(-1).value2 === seed["im.feishu.checkAppCredentials"]["en-US"], "Token failure uses translated local fallback");
await assert.rejects(feishuFallback.__testPrivate.discoverEndpoint());
check(paramsSeen.at(-1).value === seed["im.feishu.checkConnectionPermissions"]["en-US"], "Endpoint failure uses translated local fallback");
reply = { code: 1, msg: "Unchanged upstream message" };
await assert.rejects(feishuFallback.__testPrivate.discoverEndpoint());
check(paramsSeen.at(-1).value === reply.msg, "Upstream error text is preserved");
const reg = load("apps/desktop/src/im/feishuReg.ts", {
  "../i18n/index.js": { t },
  "../lib/clients.js": { http: { request: async (url, init) => { requests.push({ url, init }); return new Response('{"error":"example_error"}'); } } },
});
const result = await reg.pollFeishuRegistration({ deviceCode: "fixture-only" });
check(result.status === "error" && result.note === "example_error: Unknown reason", "Registration failure fallback is localized without translating server code");
check(new URLSearchParams(requests.at(-1).init.body).get("action") === "poll", "Registration protocol body is unchanged");

// Extract the production handlers rather than restating their state transitions.
const source = readFileSync("apps/desktop/src/pages/Plugins.tsx", "utf8");
const ast = ts.createSourceFile("Plugins.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Map();
function walk(node) {
  if (ts.isVariableDeclaration(node) && ["checkUpdate", "updateNow"].includes(node.name.getText(ast))) handlers.set(node.name.getText(ast), node.initializer.getText(ast));
  ts.forEachChild(node, walk);
}
walk(ast);
for (const name of ["checkUpdate", "updateNow"]) {
  const states = [];
  const body = ts.transpileModule(`const handler=${handlers.get(name)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const deps = { rec: { repo: "fixture", manifest: {} }, m: { id: "fixture", kind: "js" }, setRepoCheck: state => states.push(state), i18n: t, parseRepoInput: () => ({}), fetchRemoteManifestFromRepoRef: async () => { throw Error("Offline fixture"); }, fetchEntryFromRepo: async () => { throw Error("Offline fixture"); } };
  const handler = new Function(...Object.keys(deps), body + ";return handler;")(...Object.values(deps));
  await handler("2.0.0");
  check(states[0].busy && !states[0].failed, name + ": starts with non-error pending state");
  check(!states.at(-1).busy && states.at(-1).failed, name + ": failure is explicit and releases busy");
}
check(source.includes('tone={checkLineFailed ? "error" : "quiet"}') && !source.includes('checkLine.includes("失败'), "Plugin tone uses semantic failure, not translated sentence matching");
console.log(`GUI i18n completion: ${checks} checks passed (actual methods, isolated dependencies, no network).`);
