/** Offline regression for stable device identity and refresh-resistant login admission.
 * Run: node tools/login-attempt-state-test.mjs
 * Executes the production functions with an isolated store; never contacts school services.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
let checks = 0;
const check = (label, fn) => { fn(); checks++; console.log(`PASS ${label}`); };

// Extract complete AST function declarations, not a hand-written copy of their bodies.
const clientsSource = read("apps/desktop/src/lib/clients.ts");
const clientsAst = ts.createSourceFile("clients.ts", clientsSource, ts.ScriptTarget.Latest, true);
const functions = ["currentFingerprint", "persist", "resumeSession"].map((name) => {
  const declaration = clientsAst.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration, `Production function ${name} must exist`);
  return declaration.getText(clientsAst);
}).join("\n");
const clientCode = ts.transpileModule(functions, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function identityHarness({ initial = null, backup = null, failSave = false } = {}) {
  let saved = initial ? structuredClone(initial) : null;
  let created = 0;
  let networkCalls = 0;
  const session = { username: "", fingerprint: "constructor-only", finger3: "" };
  const files = new Map();
  const store = {
    loadSession: async () => saved,
    saveSession: async (value) => {
      if (failSave) throw new Error("Storage unavailable");
      saved = structuredClone(value);
    },
  };
  const noNetwork = () => { networkCalls++; throw new Error("Unexpected network call in offline identity recovery"); };
  const dependencies = {
    store, session,
    makeFingerprint: () => `stable-device-${++created}`,
    info: { resetStaticSessionCaches() {}, resume: noNetwork },
    http: { jar: { serialize: () => "{}", hydrate: noNetwork } },
    fileWrite: async (name, value) => { files.set(name, value); },
    fileRead: async () => backup,
    logLine: async () => {},
    learn: { resume: noNetwork },
    loadRemembered: noNetwork,
    SESSION_FILE: "test-session",
    pendingSecret: null,
  };
  const exports = {};
  new Function("exports", ...Object.keys(dependencies), clientCode)(exports, ...Object.values(dependencies));
  return { ...exports, session, files, saved: () => saved, created: () => created, networkCalls: () => networkCalls };
}

const fresh = identityHarness();
const sent = await fresh.currentFingerprint();
fresh.session.finger3 = "trust-bound-to-stable-device";
await fresh.persist();
check("first login persists the exact fingerprint sent to authentication", () => {
  assert.equal(sent, "stable-device-1");
  assert.equal(fresh.session.fingerprint, sent);
  assert.equal(fresh.saved().fingerprint, sent);
  assert.equal(JSON.parse(fresh.files.get("test-session")).fingerprint, sent);
});

const restarted = identityHarness({ initial: fresh.saved() });
const resumed = await restarted.resumeSession();
check("a fingerprint-only snapshot restores device identity without restoring a session", () => {
  assert.equal(resumed, false);
  assert.equal(restarted.session.fingerprint, sent);
  assert.equal(restarted.session.finger3, "trust-bound-to-stable-device");
  assert.equal(restarted.networkCalls(), 0);
});
const sentAgain = await restarted.currentFingerprint();
await restarted.persist();
check("login after restart reuses the stored identity and trust pairing", () => {
  assert.equal(sentAgain, sent);
  assert.equal(restarted.created(), 0);
  assert.equal(restarted.saved().fingerprint, sent);
  assert.equal(restarted.saved().finger3, "trust-bound-to-stable-device");
});

const backup = identityHarness({ backup: JSON.stringify(fresh.saved()) });
check("file mirror can recover a fingerprint-only snapshot", () => assert.equal(backup.saved(), null));
assert.equal(await backup.resumeSession(), false);
check("file recovery restores the same identity before the no-session return", () => {
  assert.equal(backup.session.fingerprint, sent);
  assert.equal(backup.session.finger3, "trust-bound-to-stable-device");
  assert.equal(backup.saved().fingerprint, sent);
  assert.equal(backup.networkCalls(), 0);
});

const unavailableIdentityStore = identityHarness({ failSave: true });
const memoryFingerprint = await unavailableIdentityStore.currentFingerprint();
check("failed identity persistence still leaves this attempt using one fingerprint", () => {
  assert.equal(unavailableIdentityStore.session.fingerprint, memoryFingerprint);
});

const gateCode = ts.transpileModule(read("apps/desktop/src/lib/loginGate.ts"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
let moduleId = 0;
const loadGate = () => import(`data:text/javascript;base64,${Buffer.from(gateCode).toString("base64")}#${++moduleId}`);
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const realNow = Date.now;
let now = 1_800_000_000_000;
const storageKey = "onethu.login-attempt-at";
const setStorage = (storage) => Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
const memoryStorage = () => {
  const entries = new Map();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
  };
};

try {
  Date.now = () => now;
  const storage = memoryStorage();
  setStorage(storage);
  const gate = await loadGate();
  check("a fresh context allows one login", () => assert.equal(gate.loginCooldownLeftMs(), 0));
  gate.markLoginAttempt();
  check("a second attempt is rejected with a bounded remaining time", () => {
    assert.equal(gate.loginCooldownLeftMs(), 20_000);
    assert.throws(() => gate.markLoginAttempt(), (error) => error.code === "AUTH_COOLDOWN" && error.retryAfterMs === 20_000);
    assert.deepEqual([...storage.entries], [[storageKey, String(now)]]);
  });
  now += 7_500;
  check("rejected attempts do not extend the cooldown", () => {
    assert.throws(() => gate.markLoginAttempt(), (error) => error.retryAfterMs === 12_500);
    assert.equal(gate.loginCooldownLeftMs(), 12_500);
  });
  const reloaded = await loadGate();
  check("reloading the module retains the remaining cooldown through session storage", () => {
    assert.equal(reloaded.loginCooldownLeftMs(), 12_500);
    assert.throws(() => reloaded.markLoginAttempt(), (error) => error.code === "AUTH_COOLDOWN");
  });
  now += 12_499;
  check("the last millisecond remains guarded", () => assert.throws(() => reloaded.markLoginAttempt(), (error) => error.retryAfterMs === 1));
  now += 1;
  reloaded.markLoginAttempt();
  check("a new attempt is allowed at the exact expiry", () => assert.equal(reloaded.loginCooldownLeftMs(), 20_000));

  for (const corrupt of ["broken", "NaN", "Infinity", "-1", "0", "", String(now + 60_000), String(now - 60_000)]) {
    const corruptStorage = memoryStorage();
    corruptStorage.setItem(storageKey, corrupt);
    setStorage(corruptStorage);
    const isolated = await loadGate();
    check(`invalid or expired saved timestamp ${JSON.stringify(corrupt)} does not lock login`, () => {
      assert.equal(isolated.loginCooldownLeftMs(), 0);
      assert.doesNotThrow(() => isolated.markLoginAttempt());
      assert.equal(isolated.loginCooldownLeftMs(), 20_000);
    });
  }

  for (const kind of ["missing", "getter-denied", "operations-denied", "write-denied"]) {
    if (kind === "missing") setStorage(undefined);
    else if (kind === "getter-denied") Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true, get() { throw new Error("Access denied"); },
    });
    else setStorage({
      getItem() { if (kind === "operations-denied") throw new Error("Access denied"); return null; },
      setItem() { throw new Error("Storage full or denied"); },
    });
    const isolated = await loadGate();
    check(`${kind} session storage falls back to the in-memory gate`, () => {
      assert.doesNotThrow(() => isolated.markLoginAttempt());
      assert.equal(isolated.loginCooldownLeftMs(), 20_000);
      assert.throws(() => isolated.markLoginAttempt(), (error) => error.code === "AUTH_COOLDOWN");
    });
  }

  setStorage(memoryStorage());
  const clockShift = await loadGate();
  clockShift.markLoginAttempt();
  now -= 60_000;
  check("clock rollback cannot create an unbounded lockout", () => {
    assert.equal(clockShift.loginCooldownLeftMs(), 0);
    assert.doesNotThrow(() => clockShift.markLoginAttempt());
    assert.equal(clockShift.loginCooldownLeftMs(), 20_000);
  });
} finally {
  Date.now = realNow;
  if (storageDescriptor) Object.defineProperty(globalThis, "sessionStorage", storageDescriptor);
  else delete globalThis.sessionStorage;
}

console.log(`login-attempt-state-test: ${checks} checks passed (offline; no credentials or school requests)`);
