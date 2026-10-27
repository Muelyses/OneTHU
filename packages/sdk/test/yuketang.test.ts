import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createYuketangQueries, MemoryCookieJar } from "@onethu/core";
import { createExternalServices } from "../src/services/external.js";
import { syncDesktopYuketang } from "../src/yuketangSync.js";
import { createDesktopBridge } from "../src/desktop.js";
import { createNodeTransport } from "../src/node/transport.js";

const json = (data: unknown) => Response.json(data);
const courses = { errcode: 0, data: { list: [{ classroom_id: "a", name: "Fixture A" }, { classroom_id: "b", name: "Fixture B" }] } };
const material = (id: string) => ({ id, type: 1, classroom_id: "a", title: `Material ${id}`, content: { leaf_id: `leaf-${id}` } });
function fixture(router?: (url: string, init: RequestInit) => Promise<Response>) {
  let epoch = 0;
  const values = new Map<string, any>(), requests: { url: string; init: RequestInit }[] = [];
  const runtime: any = { session: { username: "fixture-a", state: "ready" }, epoch: () => epoch,
    assertCurrent(n: number) { if (n !== epoch) throw new Error("AUTH_SESSION_CHANGED"); },
    http: { jar: new MemoryCookieJar() }, fetch: async (url: any, init: RequestInit = {}) => {
      requests.push({ url: String(url), init });
      if (router) return router(String(url), init);
      if (String(url).includes("courses/list")) return json(courses);
      if (String(url).includes("logs/learn")) return json({ errcode: 0, data: { activities: [material("1")] } });
      throw new Error("UNEXPECTED_FIXTURE_REQUEST");
    } };
  runtime.createServiceTransport=()=>createNodeTransport({fetch:runtime.fetch,epoch:()=>epoch,assertCurrent:runtime.assertCurrent});
  const store = { read: async <T>(key: string, fallback: T): Promise<T> => structuredClone(values.get(key) ?? fallback),
    write: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); }, flush: async () => {} };
  const key = (name: string, account = runtime.session.username) => `${name}-${createHash("sha256").update(account).digest("hex").slice(0, 24)}`;
  const ctx = { signal: new AbortController().signal, deadline: Date.now() + 20_000, beforeWrite: async () => {} };
  const ops = createExternalServices(runtime, store);
  return { runtime, store, values, requests, key, ops, ctx, bump() { epoch++; },
    configure() { values.set(key("exthw"), { yuketang: { cookie: "sessionid=PRIVATE-FIXTURE", uvId: "2598" }, days: 30 }); },
    async run(method: string, args: unknown[] = []) { const op = ops.find(op => op.name === `yuketang.${method}`); assert.ok(op); return op.run(args, ctx) as Promise<any>; } };
}
test("Yuketang queries are discoverable read operations with argument schemas", () => {
  const f = fixture(), ops = f.ops.filter(op => op.name.startsWith("yuketang."));
  assert.equal(ops.length, 7);
  for (const op of ops) { assert.equal(op.mutation, false); assert.equal(op.permission, "exthw:read"); assert.match(op.description, /雨课堂/); }
  assert.equal(ops.find(op => op.name === "yuketang.homeworkDetail")!.parameters.minItems, 2);
});
test("missing rain login is explicit and status exposes the QR entry without credentials or network", async () => {
  const f = fixture(); const status = await f.run("status");
  assert.equal(status.configured, false); assert.equal(status.login.method, "qr-code");
  await assert.rejects(f.run("courses"), /YUKETANG_NOT_CONFIGURED/); assert.equal(f.requests.length, 0);
});
test("live course queries use the configured rain session and preserve classroom ids", async () => {
  const f = fixture(); f.configure(); const out = await f.run("courses");
  assert.deepEqual(out.rows.map((row: any) => row.id), ["a", "b"]); assert.equal(out.complete, true);
  assert.match(new Headers(f.requests[0].init.headers).get("cookie")!, /sessionid=PRIVATE-FIXTURE/);
  assert.ok(!JSON.stringify(out).includes("PRIVATE"));
});
test("real Node cookie reconstruction sends Rain credentials without contaminating the school jar", async()=>{
  const f=fixture(async(_url,init)=>{const cookie=new Headers(init.headers).get('cookie')??'';assert.match(cookie,/sessionid=PRIVATE-FIXTURE/);assert.match(cookie,/uv_id=2598/);return json(courses);});
  f.configure();f.runtime.http.jar.setRaw(new URL('https://id.tsinghua.edu.cn/'),'JSESSIONID=school; Path=/; Secure');
  const before=f.runtime.http.jar.serialize();
  assert.equal((await f.run('courses')).rows.length,2);
  assert.equal(f.runtime.http.jar.serialize(),before);
  assert.equal(f.runtime.http.jar.getCookies(new URL('https://pro.yuketang.cn/')).length,0);
});
test("contents scope requests to one classroom and preserve leaf ids", async () => {
  const f = fixture(); f.configure(); const out = await f.run("contents", ["a"]);
  assert.equal(out.rows[0].leafId, "leaf-1");
  assert.equal(f.requests.filter(req => req.url.includes("logs/learn/")).length, 1);
  assert.ok(!f.requests.some(req => req.url.includes("logs/learn/b")));
  await assert.rejects(f.run("contents", ["unknown"]), /YUKETANG_CLASSROOM_NOT_FOUND/);
});
test("agent content reads continue beyond the old 200-entry first page", async () => {
  const f = fixture(async url => url.includes("courses/list") ? json(courses) : json({ errcode: 0, data: { activities: url.includes("page=0&") ? Array.from({ length: 200 }, (_, i) => material(String(i))) : [material("last")] } }));
  f.configure(); const out = await f.run("contents", ["a"]);
  assert.equal(out.rows.length, 201); assert.equal(out.complete, true); assert.ok(f.requests.some(req => req.url.includes("page=1&")));
});
test("a server that repeats the first page reports incomplete data instead of looping or claiming completeness", async () => {
  const f = fixture(async url => url.includes("courses/list") ? json(courses) : json({ errcode: 0, data: { activities: Array.from({ length: 200 }, (_, i) => material(String(i))) } }));
  f.configure(); const out = await f.run("contents", ["a"]);
  assert.equal(out.rows.length, 200); assert.equal(out.complete, false); assert.equal(out.issues[0].code, "YUKETANG_PAGINATION_STALLED");
});
test("overlapping activity pages do not duplicate material rows", async () => {
  const f = fixture(async url => url.includes("courses/list") ? json(courses) : json({ errcode: 0, data: { activities: url.includes("page=0&") ? Array.from({ length: 200 }, (_, i) => material(String(i))) : [material("199"), material("200")] } }));
  f.configure(); const out = await f.run("contents", ["a"]); assert.equal(out.rows.length, 201); assert.equal(out.complete, true);
});
test("classroom failures keep available results with explicit partial provenance; expired sessions reject", async () => {
  const f = fixture(async url => {
    if (url.includes("courses/list")) return json(courses);
    if (url.includes("logs/learn/b")) throw new Error("offline");
    return json({ errcode: 0, data: { activities: [material("1")] } });
  });
  f.configure(); const out = await f.run("contents"); assert.equal(out.rows.length, 1); assert.equal(out.complete, false); assert.equal(out.issues[0].classroomId, "b");
  const expired = fixture(async url => url.includes("courses/list") ? json(courses) : new Response("expired", { status: 401 })); expired.configure();
  await assert.rejects(expired.run("contents"), /YUKETANG_SESSION_EXPIRED/);
});
test("malformed course responses do not masquerade as an empty account", async () => {
  const f = fixture(async () => json({ data: {} })); f.configure(); await assert.rejects(f.run("courses"), /YUKETANG_COURSES_UNEXPECTED/);
});
test("read guard rejects account changes before returning data", async () => {
  const f = fixture(async () => { f.bump(); return json(courses); }); f.configure(); await assert.rejects(f.run("courses"), /AUTH_SESSION_CHANGED/);
});
test("homework day horizon includes overdue assignments and bounds future deadlines explicitly", async () => {
  const now = Date.now(), day = 86400000;
  const f = fixture(async url => url.includes("courses/list") ? json(courses) : json({ errcode: 0, data: { activities: [-400, 20, 100].map(delta => ({ id: `task-${delta}`, type: 19, classroom_id: "a", title: `Task ${delta}`, content: { score_d: now + delta * day } })) } }));
  f.configure(); const out = await f.run("homework", ["a", 30]);
  assert.equal(out.rows.length, 2); assert.equal(out.pastAssignmentsIncluded, true); assert.equal(out.windowDays, 30);
  await assert.rejects(f.run("homework", ["a", 0]), /YUKETANG_INVALID_DAYS/);
});
test("zero deadline means no deadline and submission failures are reported as incomplete", async()=>{
 const f=fixture(async url=>{
  if(url.includes('courses/list'))return json(courses);
  if(url.includes('logs/learn'))return json({errcode:0,data:{activities:[{id:'zero',type:19,title:'No deadline',content:{score_d:0,leaf_type_id:'task-zero'}}]}});
  throw new Error('status endpoint unavailable');
 });
 f.configure();const result=await f.run('homework',['a']);
 assert.equal(result.rows[0].deadline,'');assert.equal(result.complete,false);
 assert.equal(result.issues[0].code,'YUKETANG_STATUS_UNAVAILABLE');
});
test("a rain session changed during a read is fenced even if the school account stays the same", async () => {
  let credential = { cookie: "sessionid=OLD" };
  const queries = createYuketangQueries({ credentials: async () => credential, check: async () => {}, fetch: async () => { credential = { cookie: "sessionid=NEW" }; return json(courses); } });
  await assert.rejects(queries.courses(), /YUKETANG_SESSION_CHANGED/);
});
test("SDK profiles do not inherit another school account's rain credentials", async () => {
  const f = fixture(); f.configure(); f.runtime.session.username = "fixture-b"; f.bump();
  assert.equal((await f.run("status")).configured, false); assert.equal(f.requests.length, 0);
});
test("homework detail and leaf detail route original ids with no submission requests", async () => {
  const f = fixture(async url => {
    if (url.includes("get_exercise_list/task-1/")) return json({ errcode: 0, data: { problems: [] } });
    if (url.includes("leaf_info/a/leaf-1/")) return json({ data: { title: "Fixture slide", leaf_type: 1, content: { body: "<p>Fixture body</p>" } } });
    throw new Error("UNEXPECTED_FIXTURE_REQUEST");
  });
  f.configure(); await f.run("homeworkDetail", ["a", "task-1"]); const leaf = await f.run("leafDetail", ["a", "leaf-1"]);
  assert.equal(leaf.title, "Fixture slide"); assert.ok(f.requests.every(req => (req.init.method ?? "GET") === "GET"));
});
test("private desktop sync preserves unrelated sources and disconnect revokes only its own session", async () => {
  const f = fixture(); f.values.set(f.key("exthw"), { tuoj: { cookie: "unrelated" } });
  const input = { credential: { cookie: "sessionid=DESKTOP", uvId: "2598" } };
  const out = await syncDesktopYuketang(f.store, "fixture-a", input, () => {}); assert.deepEqual(out, { configured: true, status: "synced" });
  assert.ok(!JSON.stringify(out).includes("DESKTOP")); assert.equal((await f.run("status")).configured, true);
  assert.equal((await syncDesktopYuketang(f.store, "fixture-a", { credential: null }, () => {})).configured, false);
  assert.equal(f.values.get(f.key("exthw")).tuoj.cookie, "unrelated");
});
test("independent CLI session conflicts and disconnects preserve its credentials", async () => {
  const f = fixture(); f.configure();
  assert.equal((await syncDesktopYuketang(f.store, "fixture-a", { credential: { cookie: "sessionid=DIFFERENT" } }, () => {})).status, "conflict");
  assert.equal((await syncDesktopYuketang(f.store, "fixture-a", { credential: null }, () => {})).status, "independent");
  assert.equal(f.values.get(f.key("exthw")).yuketang.cookie, "sessionid=PRIVATE-FIXTURE");
});
test("private sync validates secrets and rejects revoked account/policy before writes", async () => {
  const f = fixture();
  for (const credential of [{ cookie: "bad\r\nvalue" }, { cookie: "valid", token: "not-allowed" }, { cookie: "valid", uvId: "bad" }]) {
    await assert.rejects(syncDesktopYuketang(f.store, "fixture-a", { credential } as any, () => {}), /CLI_BRIDGE_INVALID/);
  }
  assert.equal(f.values.size, 0);
  const bridge = createDesktopBridge({ runtime: f.runtime, store: f.store, policy: () => ({ enabled: false } as any), exclusive: async work => work() } as any);
  await assert.rejects(bridge.yuketangSync({ expectedAccount: "fixture-a", expectedEpoch: 0, credential: { cookie: "valid" } }), /CLI_DISABLED/);
  await assert.rejects(bridge.yuketangSync({ expectedAccount: "fixture-b", expectedEpoch: 0, credential: { cookie: "valid" } }), /CLI_ACCOUNT_CHANGED/);
  assert.equal(f.values.size, 0);
});
