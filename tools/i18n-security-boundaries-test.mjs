/** Actual codecs and UI error functions with deliberately different translated text.
 * Network, native I/O and account state are mocked; no credentials are loaded. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
let locale = "zh";
const i18n = (key, params = {}) => `${locale}:${key}:${Object.values(params).join("|")}`;
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log("✓ " + label); };
const read = name => fs.readFileSync("apps/desktop/src/" + name, "utf8");
const source = name => ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true);
function evaluate(code, scope = {}) {
  return vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: {}, TextEncoder, TextDecoder, Uint8Array, btoa, atob, i18n, ...scope });
}
const share = source("state/vaultShare.ts");
const codecFns = share.statements.filter(node => ts.isFunctionDeclaration(node) && ["utf8Bytes", "checksum"].includes(node.name?.text));
const checksum = evaluate(codecFns.map(node => node.getText(share)).join("\n") + "\nchecksum;");
const calls = [];
const imports = {
  "../i18n/index.js": { t: i18n },
  "./cloudExchange.js": { resolveExchangeCode: async code => code },
  "./nameCard.js": { addContact: (_kind, card, note) => { calls.push(["contact", card, note]); return { ok: false, reason: "duplicate" }; } },
  "./org.js": { acceptOrgInvite: async (code, name) => { calls.push(["org", code, name]); return { ok: true }; } },
  "./vaultShare.js": { checksum, importShareCodeAsCurrent: async (code, target) => { calls.push(["vault", code, target]); return { ok: true }; } },
  "./vault.js": {},
};
const touch = {};
evaluate(read("state/touch.ts"), { exports: touch, require: name => { assert.ok(imports[name], name); return imports[name]; } });
const payload = { v: 1, kind: "onethu-touch", issuedAt: 42, from: "原始姓名", personal: { name: "好友" }, vaultCode: "ON-UNCHANGED", orgCode: "ONORG1.fixture", orgName: "原始组织" };
locale = "zh"; const code = touch.encodeTouch(payload);
const oldError = touch.decodeTouch("invalid").reason;
locale = "en";
check(touch.encodeTouch(payload) === code && code.startsWith("ONTOUCH1."), "Locale changes do not change encoded touch bytes or prefix");
check(JSON.stringify(touch.decodeTouch(code).payload) === JSON.stringify(payload), "Translated errors do not change codec decoding or user content");
check(oldError.startsWith("zh:") && touch.decodeTouch("invalid").reason.startsWith("en:"), "Touch failure messages resolve at call time");
await touch.importTouchCode(code, "真实姓名", "new");
check(calls.some(call => call[0] === "vault" && call[1] === payload.vaultCode && call[2] === "new"), "Vault import destination and existing share code remain stable");
check(calls.some(call => call[0] === "org" && call[1] === payload.orgCode && call[2] === "真实姓名"), "Organization invitation receives the original code and explicit user name");
const duplicateCode = touch.encodeTouch({ v: 1, kind: "onethu-touch", issuedAt: 1, personal: payload.personal });
const duplicate = await touch.importTouchCode(duplicateCode);
check(duplicate.ok && duplicate.duplicate && duplicate.reason.startsWith("en:"), "Machine duplicate outcome survives translated contact status");
const invalidVersion = touch.decodeTouch(touch.encodeTouch({ ...payload, v: 9 }));
check(!invalidVersion.ok && invalidVersion.reason.includes("state.touch.version"), "Version validation keeps its machine-level rejection");

const auto = source("state/seafileAuto.ts");
const getter = auto.statements.filter(ts.isVariableStatement).flatMap(node => node.declarationList.declarations).find(node => node.name.getText(auto) === "twoFactorMessage");
const twoFactorMessage = evaluate(`const ${getter.getText(auto)};\ntwoFactorMessage;`);
locale = "zh"; const oldHint = twoFactorMessage(); locale = "en";
check(oldHint.startsWith("zh:") && twoFactorMessage().startsWith("en:"), "Long-lived two-factor helper does not freeze a translated module constant");

const transport = source("lib/transport.ts");
const explainNode = transport.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "explainNetworkError");
const explain = evaluate(`let lastRawError="";\n${explainNode.getText(transport)}\nexplainNetworkError;`,
  { rawErrorText: value => String(value ?? ""), redactNetworkLog: value => value, isTauri: true });
for (const language of ["zh", "en"]) {
  locale = language;
  check(explain("too-large:2097152:1048576").includes("lib.transport.fileTooLarge:2.0 MB|1.0 MB"), language + ": native size codes retain their numeric meaning");
  check(explain("会话已失效，需要重新登录").startsWith(language + ":lib.transport.reloginAdvice"), language + ": raw native session marker remains recognized");
  check(explain("HTTP 403").startsWith(language + ":lib.transport.serverRejected"), language + ": HTTP status recognition remains independent of translations");
}
const wallp = source("state/wallpsync.ts");
const directory = wallp.statements.filter(ts.isVariableStatement).flatMap(node => node.declarationList.declarations).find(node => node.name.getText(wallp) === "DIR");
check(directory.initializer.text === "/壁纸", "Persisted remote wallpaper directory remains its original protocol value");
console.log(`i18n security boundaries: ${checks} checks passed`);
