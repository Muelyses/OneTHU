/** Offline account isolation regression; production policy and infoLib bindings,
 * simulated native/file transports only. No campus credentials or network. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const policy = {};
new Function("exports", compile(read("apps/desktop/src/lib/authCookieBoundary.ts")))(policy);
const source = read("apps/desktop/src/lib/infoLib.ts");
const ast = ts.createSourceFile("infoLib.ts", source, ts.ScriptTarget.Latest, true);
const boundary = ast.statements.find((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => d.name.getText(ast) === "cookieBoundary"));
const logout = ast.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === "libLogout");
const persist = ast.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === "persistGitlabSession");
const remember = ast.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === "rememberGitlabSession");
assert.ok(boundary && logout && persist && remember);
const bindings = compile(`let selfFinger3 = "old-trust"; let pendingTrust = true; let gitlabSessionValue = "old-gitlab"; let gitlabSessionRestored = false; let gitlabSessionPersistence = Promise.resolve(); ${persist.getText(ast)}\n${remember.getText(ast)}\n${boundary.getText(ast)}\n${logout.getText(ast)}\nexports.remember = rememberGitlabSession; exports.prepare = (name) => cookieBoundary.prepare(name);`);
const snapshot = (name) => ({ username: name, fingerprint: "installation-fingerprint", finger3: "old-trust", cookiesJson: name ? '{"fixture":"session"}' : "{}", savedAt: 1 });
let passed = 0;
const check = async (name, test) => { await test(); passed++; console.log(`PASS ${name}`); };
function harness({ local = snapshot("10001"), file = local, failClear = false, failStore = false, failRead = false, failDelete = false, failLogout = false, lateResponse = false, seedWriteGate = Promise.resolve() } = {}) {
  const events = [], files = new Map();
  if (file) files.set("session", JSON.stringify(file));
  files.set("gitlab.session", "old-gitlab-seed");
  let stored = local ? structuredClone(local) : null;
  let jarDirty = true;
  const session = { fingerprint: "installation-fingerprint", finger3: "old-trust" };
  const helper = { userId: "10001", password: "fixture-only", fingerGenPrint: "old-trust", logout: async () => { events.push("remote-logout"); if (failLogout) throw new Error("Offline"); } };
  const clients = { session, store: {
    loadSession: async () => { if (failRead) throw Error("Ownership storage denied"); return stored; },
    saveSession: async (value) => { if (failStore) throw new Error("Storage denied"); stored = structuredClone(value); events.push("store-owner"); },
  } };
  const exports = {};
  const dependencies = {
    createAuthCookieBoundary: policy.createAuthCookieBoundary, helper, session,
    http: { jar: { clear: () => { jarDirty = false; events.push("ts-clear"); } } },
    fileRead: async (name) => files.get(name) ?? null,
    fileWrite: async (name, value) => { if (name === "gitlab.session") { events.push("seed-write-start"); await seedWriteGate; } files.set(name, value); events.push("file-owner"); },
    fileDelete: async (name) => { events.push("delete-gitlab"); if (failDelete) throw new Error("File denied"); files.delete(name); },
    GITLAB_SESSION_FILE: "gitlab.session", GITLAB_SESSION_KEY: "gitlab", isTauri: true,
    gitlabSessionFromRes: () => "late-old-session", obfuscateSecret: value => value,
    setLibFinger3: (value) => { helper.fingerGenPrint = value; },
    libAbandonLogin: async () => events.push("abandon-login"),
    require: (name) => {
      if (name === "./clients.js") return clients;
      if (name === "@tauri-apps/api/core") return { invoke: async (command) => {
        assert.equal(command, "http_native_clear_cookies"); events.push("native-clear");
        if (lateResponse) { jarDirty = true; events.push("late-ts-write"); exports.remember("https://git.tsinghua.edu.cn/", {}); }
        if (failClear) throw new Error("Native clear failed");
      } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  new Function("exports", ...Object.keys(dependencies), bindings)(exports, ...Object.values(dependencies));
  return { ...exports, events, files, session, helper, stored: () => stored, jarDirty: () => jarDirty };
}
await check("same-account repeated login keeps native and TS cookies and trust", async () => {
  const h = harness();
  for (let i = 0; i < 3; i++) assert.equal(await h.prepare("10001"), "reused");
  assert.deepEqual(h.events, []);
  assert.equal(h.session.finger3, "old-trust");
});
await check("file snapshot restores a known cookie owner after local storage eviction", async () => {
  const h = harness({ local: null, file: snapshot("10001") });
  assert.equal(await h.prepare("10001"), "reused"); assert.deepEqual(h.events, []);
});
await check("changing accounts clears every cookie jar and the GitLab seed before recording new owner", async () => {
  const h = harness();
  assert.equal(await h.prepare("10002"), "isolated");
  assert.ok(h.events.includes("native-clear") && h.events.includes("ts-clear"));
  assert.ok(h.events.indexOf("native-clear") < h.events.indexOf("store-owner"));
  assert.equal(h.files.has("gitlab.session"), false);
  assert.equal(h.session.finger3, ""); assert.equal(h.helper.fingerGenPrint, "");
  assert.equal(h.session.fingerprint, "installation-fingerprint");
  assert.equal(h.stored().username, "10002"); assert.equal(h.stored().cookiesJson, "{}");
  assert.equal(JSON.parse(h.files.get("session")).username, "10002");
});
await check("failed account B login then webview reload cannot attribute its cookies to old account A", async () => {
  const h = harness(); await h.prepare("10002");
  const afterReload = harness({ local: h.stored(), file: JSON.parse(h.files.get("session")) });
  assert.equal(await afterReload.prepare("10002"), "reused");
  assert.equal(await afterReload.prepare("10001"), "isolated");
});
await check("unknown cookie ownership clears before starting authentication", async () => {
  const h = harness({ local: null, file: null });
  assert.equal(await h.prepare("10001"), "isolated"); assert.ok(h.events.includes("native-clear"));
});
await check("unreadable ownership cannot be treated as a missing record and reuse the other store", async () => {
  const h = harness({ failRead: true });
  assert.equal(await h.prepare("10001"), "isolated");
  assert.ok(h.events.includes("native-clear"));
});
await check("conflicting snapshots never authorize reuse", async () => {
  for (const file of [snapshot("10002"), snapshot("")]) {
    const h = harness({ file }); assert.equal(await h.prepare("10001"), "isolated");
  }
});
await check("failed native clear blocks login and never saves a new owner", async () => {
  const h = harness({ failClear: true });
  await assert.rejects(h.prepare("10002"), /Native clear failed/);
  assert.equal(h.stored().username, "10001"); assert.equal(h.session.finger3, "");
  await assert.rejects(h.prepare("10002"), /Native clear failed/);
  assert.equal(h.events.filter((x) => x === "native-clear").length, 2);
});
await check("cookie clearing still runs when the separate seed file cannot be removed", async () => {
  const h = harness({ failDelete: true });
  await assert.rejects(h.prepare("10002"), /File denied/); assert.ok(h.events.includes("native-clear"));
});
await check("native clearing fences late TS cookies and delayed GitLab seed writes before recording the next owner", async () => {
  let release;
  const seedWriteGate = new Promise(resolve => { release = resolve; });
  const h = harness({ lateResponse: true, seedWriteGate });
  let settled = false;
  const pending = h.prepare("10002").finally(() => { settled = true; });
  for (let i = 0; i < 20 && !h.events.includes("seed-write-start"); i++) await Promise.resolve();
  assert.ok(h.events.includes("seed-write-start"));
  assert.equal(settled, false);
  release();
  assert.equal(await pending, "isolated");
  assert.equal(h.jarDirty(), false);
  assert.equal(h.files.has("gitlab.session"), false);
  assert.ok(h.events.indexOf("delete-gitlab") > h.events.indexOf("seed-write-start"));
});
await check("file persistence keeps account isolation available if localStorage cannot be written", async () => {
  const h = harness({ failStore: true });
  assert.equal(await h.prepare("10002"), "isolated");
  assert.equal(JSON.parse(h.files.get("session")).username, "10002");
});
await check("remote logout failure still clears native cookies, credentials, trust and snapshots", async () => {
  const h = harness({ failLogout: true }); await h.libLogout();
  assert.ok(h.events.includes("native-clear")); assert.equal(h.helper.userId, ""); assert.equal(h.helper.password, "");
  assert.equal(h.stored().username, ""); assert.equal(h.stored().finger3, ""); assert.equal(h.stored().cookiesJson, "{}");
  assert.equal(h.session.fingerprint, "installation-fingerprint");
});
await check("logout isolates even a subsequent login to the same account", async () => {
  const h = harness(); await h.libLogout();
  assert.equal(await h.prepare("10001"), "isolated");
});
await check("failed native logout preserves signed-out intent and propagates failure", async () => {
  const h = harness({ failClear: true });
  await assert.rejects(h.libLogout(), /Native clear failed/);
  assert.equal(h.stored().username, "");
  assert.equal(h.stored().cookiesJson, "{}");
  assert.equal(JSON.parse(h.files.get("session")).username, "");
  await assert.rejects(h.prepare("10001"), /Native clear failed/);
});
await check("concurrent account changes are serialized through isolation", async () => {
  const h = harness(); const results = await Promise.all([h.prepare("10002"), h.prepare("10003")]);
  assert.deepEqual(results, ["isolated", "isolated"]); assert.equal(h.stored().username, "10003");
  assert.equal(h.events.filter((x) => x === "native-clear").length, 2);
});
console.log(`${passed} account-cookie boundary checks passed.`);
