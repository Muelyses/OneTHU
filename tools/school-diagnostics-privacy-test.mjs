/** Synthetic canaries only; real response bodies stay available to callers but never diagnostics. */
import assert from "node:assert/strict";
import { HttpClient } from "../packages/core/src/http.ts";
import { LearnClient } from "../packages/core/src/learn/client.ts";
import { parseXkCatalogPage, xkParseDebug } from "../packages/core/src/zhjwxk/client.ts";

let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const marker = "PRIVATE_FIXTURE_CANARY";
globalThis.fetch = async () => { throw Error("Real network forbidden"); };
const clean = (values, label) => check(!JSON.stringify(values).includes(marker), label);
const diagnostics = client => ["lastDebug", "lastCsrfDebug", "lastPageDetailDebug", "lastGroupsDebug", "lastBbsListDebug", "lastBbsThreadDebug"].map(key => client[key]);
const learn = http => { const client = new LearnClient(http); client.applyCsrf(marker); return client; };

for (const [type, body] of [
  ["text/html", `<html><input name="_csrf" value="${marker}"><p>${marker}</p></html>`],
  ["application/json", JSON.stringify({ title: marker, answer: marker })],
  ["text/plain", marker],
  ["text/html", `<html>__vpn_hostname_data ${marker}</html>`],
]) {
  const logs = [];
  const http = new HttpClient({ fetch: async () => new Response(body, { headers: { "content-type": type, "x-onethu-final-url": `https://example.invalid/private/${marker}?ticket=${marker}` } }) });
  http.debug = line => logs.push(line);
  const response = await http.text(`https://example.invalid/${marker}?_csrf=${marker}`);
  check(response === body, type + ": caller still receives original response");
  clean([http.lastDebug, ...logs], type + ": neither response nor URL leaks into diagnostics");
  check(/type=\w+ status=200 len=\d+/.test(http.lastDebug), type + ": useful structural summary remains");
}
{
  let requests = 0;
  const http = new HttpClient({ fetch: async () => new Response(requests++ === 0 ? `<html><form action="j_spring_security_check">${marker}</form></html>` : marker, { headers: { "content-type": "text/html" } }) });
  http.onAuthRequired(async () => {});
  await http.text(`https://example.invalid/?ticket=${marker}`);
  clean([http.lastDebug], "Relogin replay diagnostics also contain no response or query");
}
{
  const client = new LearnClient({ text: async () => `<input name="_csrf" value="${marker}"><p>${marker}</p>` });
  check(await client.resume(), "CSRF extraction still works");
  clean(diagnostics(client), "CSRF diagnostic stores type and length only");
}
{
  const logs = [];
  const client = new LearnClient({ text: async () => { throw Error(`Failed ${marker}?ticket=${marker}`); }, debug: line => logs.push(line) });
  await client.resume();
  clean([...diagnostics(client), ...logs], "Request exception diagnostics cannot echo secret URL or upstream body");
}
for (const response of [
  `<html><h1>HTTP Status 500</h1>${marker}</html>`,
  JSON.stringify({ result: "error", msg: marker }),
  marker,
]) {
  const client = learn({ postForm: async () => response });
  check(!(await client.submitHomework(marker, { content: marker })).ok, "Unconfirmed submission stays unsuccessful");
  clean(diagnostics(client), "Submission error diagnostic does not persist answer/response");
}
{
  const logs = [];
  const client = learn({ debug: line => logs.push(line), json: async () => ({ object: [{ zyid: marker, bt: marker, jsm: marker, nr: btoa(marker) }] }) });
  const homework = await client.getAllHomework([marker]);
  check(homework.length === 3 && homework[0].title === marker, "Homework data remains intact");
  clean(logs, "Homework logging omits course IDs, names and content");
}
{
  const logs = [];
  const raw = `<html><p>${marker}</p><script>function loadpage(){location='?ticket=${marker}'}</script><div class="pager">${marker}</div></html>`;
  const client = learn({
    debug: line => logs.push(line), text: async () => raw,
    json: async () => ({ object: [], result: marker }),
    request: async url => new Response(url.includes("bqList") || url.includes("PageList") ? JSON.stringify({ object: [], note: marker }) : raw),
  });
  await client.getBbsBoards(marker);
  clean(diagnostics(client), "Empty board response summary omits body");
  await client.getBbsThreads(marker, { bqid: marker, kind: "yb", start: 0 });
  clean(diagnostics(client), "Empty thread list summary omits body and board identity");
  await client.getBbsThread(marker, marker);
  clean([...diagnostics(client), ...logs], "Thread parser diagnostics omit title, author, content and script/query");
  await client.getCourseGroups(marker);
  clean(diagnostics(client), "Empty group parser diagnostics omit page and JSON text");
}
{
  const logs = [];
  xkParseDebug.onOddTeacher = (...args) => logs.push(args);
  const heads = ["Course Code", "Course Name", "Instructor", "Section", "Credits", "Department", "Undergraduate Capacity", "Undergraduate Vacancies", "Graduate Capacity", "Graduate Vacancies", "Time and Location"];
  const values = ["TEST123", marker, "3", "1", "2", "Example Department", "80", "12", "20", "5", "Tuesday 08:00-09:35"];
  const html = `<table><tr class="trr1">${heads.map(x => `<th>${x}</th>`).join("")}</tr><tr class="trr2">${values.map(x => `<td>${x}</td>`).join("")}</tr></table>`;
  parseXkCatalogPage(html);
  check(logs.length === 1, "Odd teacher structural diagnostic was exercised");
  clean(logs, "Odd teacher diagnostics do not include original row or course title");
  delete xkParseDebug.onOddTeacher;
}
console.log(`School diagnostic privacy: ${checks} checks passed (synthetic canaries, no network).`);
