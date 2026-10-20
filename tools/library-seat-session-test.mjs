/** Offline ISeating session regressions. No real login, reservation or cloud access. */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "sm-crypto") return {
      url: "data:text/javascript,export const sm2={};export const sm3={};export const sm4={};",
      shortCircuit: true,
    };
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js")) {
      try { return next(specifier.slice(0, -3) + ".ts", context); } catch { /* normal resolution below */ }
    }
    return next(specifier, context);
  },
});
const { InfoClient } = await import("../packages/core/src/info/client.ts");
const { parseLibrarySession } = await import("../packages/core/src/info/librarySession.ts");
const { AuthRequiredError } = await import("../packages/core/src/http.ts");
const urls = await import("../packages/core/src/info/urls.ts");
const { webvpnWrap } = await import("../packages/core/src/crypto/webvpn.ts");
const token = "fixture-token-1234567890";
const signedIn = `<script>window.ska = {'userid':"fixture-user",'access_token':"${token}"};</script>`;
const signedOut = `<script>window.ska = {'userid':"",'access_token':""};function logout(){logoutDialog(ska.logoutApi,{'access_token': window.ska.access_token,'userid':window.ska.userid});}</script>`;
const recordHtml = `<table><tbody><tr><td>1</td><td>booking-1</td><td>北馆</td><td>2026-10-20 10:00</td><td>---</td><td>有效</td><td><button onclick="menuDel('cancel-1')">取消</button></td></tr></tbody></table>`;
let passed = 0;
async function test(name, run) { await run(); passed++; console.log("✓ " + name); }
function fixture({ confirmation = false, wrapped = false, home = () => signedIn, confirmTicket = true } = {}) {
  const calls = [];
  const ticket = "https://seat.lib.tsinghua.edu.cn/api/id_tsinghua_callback?ticket=fixture-only";
  const http = {
    lastDebug: "", lastCookieNames: "", lastFinalUrl: "",
    async request(url, init = {}) {
      const method = init.method ?? "GET";
      calls.push({ url, method, init });
      if (url === urls.LIBRARY_CAS_FORM() && wrapped) throw Error("fixture direct connection unavailable");
      if (url === urls.LIBRARY_CAS_FORM() || url === webvpnWrap(urls.LIBRARY_CAS_FORM())) {
        return confirmation
          ? new Response('<form action="/do/off/ui/auth/login/checkSingle"></form>')
          : new Response("", { status: 302, headers: { location: ticket } });
      }
      if (url.includes("/do/off/ui/auth/login/checkSingle")) {
        assert.equal(method, "POST");
        assert.equal(init.direct === true, !wrapped, "confirmation stays in the same direct/wrapped ID cookie channel");
        return confirmTicket
          ? new Response("", { status: 302, headers: { location: ticket } })
          : new Response("<html>Confirmation unavailable</html>");
      }
      if (url.startsWith("https://oauth.tsinghua.edu.cn/")) return new Response("", { headers: { "x-onethu-final-url": urls.LIBRARY_HOME() } });
      if (url === urls.LIBRARY_HOME()) return new Response(home());
      if (url === urls.LIBRARY_LIST()) return Response.json({ status: 1, data: { list: [{ id: 1, name: "北馆", isValid: 1 }] } });
      if (url === urls.LIBRARY_BOOK_RECORD()) return new Response(recordHtml);
      throw Error(`Unexpected fixture request: ${method} ${url}`);
    },
    async text(url, init) { return (await this.request(url, init)).text(); },
  };
  const client = new InfoClient(http);
  client.resetStaticSessionCaches();
  return { client, calls };
}

await test("empty anonymous literals and logout JS are not authentication tokens", () => {
  assert.equal(parseLibrarySession(signedOut), null);
  assert.equal(parseLibrarySession('logout({"access_token": window.ska.access_token}); next("unrelated-long-string");'), null);
  assert.equal(parseLibrarySession('<script src="access_token.js"></script>'), null);
});
await test("supported quoted object and ska assignment forms retain the matching user", () => {
  assert.deepEqual(parseLibrarySession(signedIn), { token, userId: "fixture-user" });
  assert.deepEqual(parseLibrarySession(`<script>window.ska.access_token = '${token}'; window.ska.userid = 'another-user';</script>`), { token, userId: "another-user" });
  assert.deepEqual(parseLibrarySession(`{"access_token":"${token}","userid":"double-quoted-user"}`), { token, userId: "double-quoted-user" });
  assert.deepEqual(parseLibrarySession(`window.ska = { access_token: '${token}', userid: 'bare-key-user' };`), { token, userId: "bare-key-user" });
  assert.equal(parseLibrarySession(`window.ska = { access_token: window.sessionToken, userid: window.sessionUser };`), null);
});
await test("an existing ID confirmation session works without any in-memory password", async () => {
  const f = fixture({ confirmation: true });
  const rows = await f.client.getLibBookRecords();
  assert.equal(rows[0].id, "booking-1");
  assert.equal(rows[0].delId, "cancel-1");
  assert.equal(f.calls.filter(c => c.url.includes("checkSingle")).length, 1);
  assert.equal(f.calls.filter(c => c.url === urls.LIBRARY_HOME()).length, 1, "verified home token is reused by records");
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1, "only confirmation, never a password login or reservation");
  assert.ok(!f.client.lastDebug.includes(token) && !f.client.lastDebug.includes("fixture-user"));
});
await test("ID direct-network failure keeps the confirmation POST in the wrapped channel", async () => {
  const f = fixture({ confirmation: true, wrapped: true });
  assert.equal((await f.client.getLibBookRecords()).length, 1);
  const confirmation = f.calls.find(c => c.method === "POST");
  assert.ok(confirmation.url.startsWith("https://webvpn.tsinghua.edu.cn/"));
});
await test("an anonymous but healthy public library list cannot mark the account signed in", async () => {
  const f = fixture({ home: () => signedOut });
  await assert.rejects(f.client.getLibBookRecords(), AuthRequiredError);
  assert.equal(f.calls.filter(c => c.url === urls.LIBRARY_BOOK_RECORD()).length, 0);
  assert.equal(f.calls.filter(c => c.url === urls.LIBRARY_HOME()).length, 2, "recovery is bounded to two attempts");
  assert.equal(InfoClient.libToken, "");
});
await test("a delayed SSO session is recovered once and never submits a reservation", async () => {
  let reads = 0;
  const f = fixture({ home: () => ++reads === 1 ? signedOut : signedIn });
  const [a, b] = await Promise.all([f.client.getLibBookRecords(), f.client.getLibraryList()]);
  assert.equal(a.length, 1); assert.equal(b.length, 1);
  assert.equal(reads, 2, "concurrent queries share the SSO retry");
  assert.equal(f.calls.filter(c => /\/spaces\/.+\/book|\/profile\/books/.test(c.url)).length, 0);
  assert.equal(f.calls.filter(c => c.url === urls.LIBRARY_CAS_FORM()).length, 2);
});
await test("failed ID confirmation remains a bounded authentication error without credential fallback", async () => {
  const f = fixture({ confirmation: true, confirmTicket: false, home: () => signedOut });
  await assert.rejects(f.client.getLibBookRecords(), AuthRequiredError);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 2);
  assert.equal(f.calls.filter(c => c.url.endsWith("/auth/login/check")).length, 0);
});
for (const scope of ["dorm", "libroom"]) for (const shape of ["redirect", "anchor", "confirm", "confirm-wrapped"]) {
  await test(`shared CAS path: ${scope} supports ${shape} without fetching seat tokens`, async () => {
    const calls = [];
    const formUrl = scope === "dorm" ? urls.DORM_CAS_FORM() : "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/fixture-room/0";
    const service = scope === "dorm" ? urls.ELE_REMAINDER() : "https://cab.lib.tsinghua.edu.cn/callback";
    const ticketUrl = `${service}?ticket=fixture-only`;
    const authAddress = "https://cab.lib.tsinghua.edu.cn/fixture-auth";
    const wrapped = shape === "confirm-wrapped";
    let ready = false;
    const http = {
      lastDebug: "", lastCookieNames: "", lastFinalUrl: "",
      async request(url, init = {}) {
        calls.push({ url, method: init.method ?? "GET" });
        if (wrapped && url === formUrl) throw Error("fixture direct failure");
        if (url === formUrl || url === webvpnWrap(formUrl)) {
          if (shape === "redirect") return new Response("", { status: 302, headers: { location: ticketUrl } });
          if (shape === "anchor") return new Response(`<a href="${ticketUrl}">continue</a>`);
          return new Response('<form action="/do/off/ui/auth/login/checkSingle"></form>');
        }
        if (url.includes("/do/off/ui/auth/login/checkSingle")) {
          assert.equal(init.method, "POST");
          assert.equal(init.direct === true, !wrapped);
          return new Response("", { status: 302, headers: { location: ticketUrl } });
        }
        if (url.startsWith("https://oauth.tsinghua.edu.cn/")) {
          ready = true;
          return new Response("", { headers: { "x-onethu-final-url": service } });
        }
        if (url === urls.ELE_REMAINDER()) return new Response(ready ? "fixture dorm signed in" : "net_Default_LoginCtrl1_txtUserName");
        if (url === urls.LIBROOM_USER_INFO()) return Response.json(ready ? { code: 0, data: { pid: "fixture-user", accNo: 123 } } : { code: 401, message: "login required" });
        if (url === urls.LIBROOM_AUTH_ADDRESS()) return Response.json({ code: 0, data: authAddress });
        if (url === webvpnWrap(authAddress)) return new Response("", { headers: { "x-onethu-final-url": formUrl } });
        throw Error("Unexpected shared CAS request: " + url);
      },
      async text(url, init) { return (await this.request(url, init)).text(); },
    };
    const client = new InfoClient(http);
    client.resetStaticSessionCaches();
    await client.forceEnsure(scope, scope === "libroom" ? "fixture-user" : undefined);
    assert.ok(ready);
    assert.equal(calls.filter(c => c.url === urls.LIBRARY_HOME()).length, 0);
    assert.equal(calls.filter(c => c.method === "POST").length, shape.startsWith("confirm") ? 1 : 0);
  });
}
console.log(`${passed} library seat session scenarios passed`);
