#!/usr/bin/env node
/** Offline request-level checks for automatic CAS recovery.
 * Run: node --import tsx tools/cas-recovery-trust-test.mjs
 * Uses generated SM2 keys and synthetic HTTP; no campus account or network. */
import assert from "node:assert/strict";
import { generateKeyPair, decrypt } from "../packages/core/src/crypto/sm2.ts";
import { submitCasLogin, CAS_LOGIN_CHECK, parseCasFormHtml } from "../packages/core/src/auth/cas.ts";
import { InfoClient } from "../packages/core/src/info/client.ts";
import { AuthRequiredError } from "../packages/core/src/http.ts";
import { webvpnWrap } from "../packages/core/src/crypto/webvpn.ts";

globalThis.fetch = async () => { throw Error("Real HTTP is forbidden in this test"); };
const keys = generateKeyPair();
const credentials = { username: "123456", password: "fixture-only", fingerprint: "fixture-device", finger3: "fixture-existing-trust" };
const formUrl = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/fixture/0";
const formHtml = `<form id="theform" action="${CAS_LOGIN_CHECK}">
  <div id="sm2publicKey">${keys.publicKey}</div>
  <input type="hidden" name="singleLogin" value="on">
  <input type="hidden" name="deviceName" value="old-choice">
  <input type="hidden" name="csrf" value="fixture-csrf">
  <input type="hidden" name="sig" value="fixture-signature">
</form>`;
let passed = 0;
async function test(name, run) { await run(); console.log(`ok ${++passed} ${name}`); }
function assertNoImplicitConsent(body) {
  assert.equal(body.has("singleLogin"), false);
  assert.equal(body.has("deviceName"), false);
}
function assertCredentialBody(body) {
  assertNoImplicitConsent(body);
  assert.equal(body.get("i_user"), credentials.username);
  assert.equal(decrypt(body.get("i_pass"), keys.privateKey), credentials.password);
  assert.equal(body.get("fingerPrint"), credentials.fingerprint);
}

for (const viaWebVPN of [false, true]) {
  await test(`CAS ${viaWebVPN ? "wrapped" : "direct"} strips echoed consent while preserving form fields`, async () => {
    const form = parseCasFormHtml(formHtml, viaWebVPN);
    const before = structuredClone(form);
    const calls = [];
    const http = {
      async text(url, init) { calls.push({ url, ...init }); return "登录成功"; },
      async request() { throw Error("Unexpected callback"); },
    };
    assert.deepEqual(await submitCasLogin(http, credentials, form, { direct: !viaWebVPN }), { kind: "done" });
    assert.equal(calls.length, 1);
    const body = calls[0].body;
    assertNoImplicitConsent(body);
    assert.equal(body.get("csrf"), "fixture-csrf");
    assert.equal(body.get("sig"), "fixture-signature");
    assert.equal(body.get("i_user"), credentials.username);
    assert.equal(decrypt(body.get(viaWebVPN ? "sm2pass" : "i_pass"), keys.privateKey), credentials.password);
    if (!viaWebVPN) assert.equal(body.get("fingerPrint"), credentials.fingerprint);
    assert.deepEqual(form, before, "caller-owned parsed fields remain intact");
  });
}
await test("CAS still exposes the original 2FA challenge after one credential submission", async () => {
  let requests = 0;
  const http = {
    async text(_url, init) {
      requests++;
      assertNoImplicitConsent(init.body);
      return '<title>二次认证</title><form action="/fixture-verify" id="otpForm"><input type="hidden" name="sig" value="fixture-otp"></form>';
    },
  };
  const out = await submitCasLogin(http, credentials, parseCasFormHtml(formHtml, false));
  assert.equal(requests, 1);
  assert.equal(out.kind, "need2fa");
  assert.equal(out.otpForm.action, "/fixture-verify");
  assert.equal(out.otpForm.fields.sig, "fixture-otp");
});

function infoFixture({ wrapped = false, fallback = false, twoFactor = false } = {}) {
  const posts = [];
  const http = {
    lastDebug: "", lastCookieNames: "", lastFinalUrl: "",
    async text(url) {
      if (wrapped && url === formUrl) throw Error("Fixture direct-network failure");
      assert.equal(url, wrapped ? webvpnWrap(formUrl) : formUrl);
      return formHtml;
    },
    async request(url, init) {
      assert.equal(init.method, "POST");
      assert.equal(url, wrapped ? webvpnWrap(CAS_LOGIN_CHECK) : CAS_LOGIN_CHECK);
      assert.equal(init.direct === true, !wrapped);
      posts.push(init.body);
      if (twoFactor) return new Response("<title>二次认证</title>");
      if (fallback && posts.length === 1) return new Response("<main>Service callback unavailable</main>");
      return new Response("", { status: 302, headers: { location: "https://fixture.tsinghua.edu.cn/callback?ticket=fixture-only" } });
    },
  };
  const client = new InfoClient(http);
  client.setIdCredentials(() => credentials);
  return { client, posts };
}
for (const wrapped of [false, true]) {
  await test(`InfoClient ${wrapped ? "wrapped" : "direct"} recovery reuses trust without implicit consent`, async () => {
    const { client, posts } = infoFixture({ wrapped });
    // Repeated recovery checks the actual outgoing requests, not a source string.
    for (let i = 0; i < 3; i++) assert.equal(await client.ensureDirectIdLogin(formUrl), true);
    assert.equal(posts.length, 3);
    for (const body of posts) {
      assertCredentialBody(body);
      assert.equal(body.get("fingerGenPrint"), credentials.finger3);
      assert.equal(body.get("fingerGenPrint3"), credentials.finger3);
      assert.equal(body.get("csrf"), "fixture-csrf");
      assert.equal(body.get("sig"), "fixture-signature");
    }
  });
}
await test("InfoClient minimal fallback preserves the existing trust credential", async () => {
  const { client, posts } = infoFixture({ fallback: true });
  assert.equal(await client.ensureDirectIdLogin(formUrl), true);
  assert.equal(posts.length, 2);
  for (const body of posts) {
    assertCredentialBody(body);
    assert.equal(body.get("fingerGenPrint"), credentials.finger3);
  }
  assert.equal(posts[0].get("sig"), "fixture-signature");
  assert.equal(posts[1].has("sig"), false, "the existing minimal fallback field set remains minimal");
});
await test("InfoClient 2FA requires user interaction and never enters a second credential attempt", async () => {
  const { client, posts } = infoFixture({ twoFactor: true });
  await assert.rejects(client.ensureDirectIdLogin(formUrl), AuthRequiredError);
  assert.equal(posts.length, 1);
  assertCredentialBody(posts[0]);
});
console.log(`${passed} CAS recovery trust scenarios passed (offline).`);
