/** Executes the production app session guard with simulated transport.
 * Run: node tools/session-probe-policy-test.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("../apps/desktop/src/lib/infoLib.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("infoLib.ts", source, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === "libEnsureSession");
assert.ok(fn);
const compiled = ts.transpileModule(fn.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let passed = 0;
async function test(name, run) { await run(); console.log(`PASS ${++passed} ${name}`); }
function fixture({ credentials = true, cooldown = 0, verified = false, verificationError = null, nativeError = null, status = 200, body = "XSRF-TOKEN=fixture;" } = {}) {
  let verifies = 0, probes = 0, logins = 0;
  const exports = {};
  const deps = {
    libHydrateCredentials: async () => credentials,
    loginCooldownLeftMs: () => cooldown,
    verifyAndReLogin: async () => { verifies++; if (verificationError) throw verificationError; return verified; },
    nativeFetch: async () => { probes++; if (nativeError) throw nativeError; return new Response(body, { status }); },
    libLogin: async () => { logins++; throw Error("Must not replay credentials"); },
    helper: { userId: "fixture-account", fingerprint: "fixture-device" },
    inflight: { settled: true, username: "old-account", password: "old-password" },
    http: { jar: { setFromResponse() {} } }, log: async () => {},
  };
  new Function("exports", ...Object.keys(deps), compiled)(exports, ...Object.values(deps));
  return { run: exports.libEnsureSession, counts: () => ({ verifies, probes, logins }) };
}
await test("a healthy or recovered verified session needs no fallback probe", async () => {
  for (const verified of [false, true]) {
    const f = fixture({ verified }); assert.equal(await f.run(), true);
    assert.deepEqual(f.counts(), { verifies: 1, probes: 0, logins: 0 });
  }
});
await test("verification failures retain their cause and cannot enter another login path", async () => {
  for (const error of [new TypeError("offline"), Object.assign(Error("503"), { status: 503 }), Object.assign(Error("wrong account"), { code: "AUTH_SESSION_CONFLICT" }), Error("2FA required")]) {
    const f = fixture({ verificationError: error });
    await assert.rejects(f.run(), e => e === error);
    assert.deepEqual(f.counts(), { verifies: 1, probes: 0, logins: 0 });
  }
});
await test("no-credential and cooldown paths use only a read-only probe", async () => {
  for (const opts of [{ credentials: false }, { cooldown: 1000 }]) {
    for (const [body, ready] of [["XSRF-TOKEN=fixture;", true], ["<main>WebVPN unavailable</main>", false], ["", false]]) {
      const f = fixture({ ...opts, body }); assert.equal(await f.run(), ready);
      assert.deepEqual(f.counts(), { verifies: 0, probes: 1, logins: 0 });
    }
  }
});
await test("fallback 401 remains recoverable by the user; service errors retain their status", async () => {
  const expired = fixture({ credentials: false, status: 401 });
  assert.equal(await expired.run(), false);
  for (const status of [403, 429, 500, 502, 503, 504]) {
    const f = fixture({ credentials: false, status });
    await assert.rejects(f.run(), error => error.status === status);
    assert.equal(f.counts().logins, 0);
  }
  const error = new TypeError("fixture timeout");
  const f = fixture({ credentials: false, nativeError: error });
  await assert.rejects(f.run(), e => e === error);
  assert.equal(f.counts().logins, 0);
});
console.log(`${passed} production session-guard scenarios passed.`);
