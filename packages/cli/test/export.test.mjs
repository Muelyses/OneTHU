import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, realpath, writeFile, readFile, rm, access, mkdir, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { courseDirectoryName, htmlText } from "../src/export.mjs";

const entry = fileURLToPath(new URL("../bin/onethu.mjs", import.meta.url));
const hash = text => createHash("sha256").update(text).digest("hex");
const course = { id: "course-001", name: "程序设计基础 / 实验:课程" };
const semester = "2026-fall";
const resource = (id = 1) => ({ resourceRef: `learn:${hash(String(id))}`, resourceId: String(id),
  courseId: course.id, semesterId: semester, title: `课程资料 ${id}`, filename: `课程资料-${id}.txt`,
  kind: id === 1 ? "file" : "homework", size: "19 B" });
const resources = () => ({ courseId: course.id, semesterId: semester, courseName: course.name, items: [resource(1), resource(2)], count: 2,
  complete: true, enumerationComplete: true, issues: [],
  homework: [{ id: "hw1", courseId: course.id, semesterId: semester, title: "第一周作业", descriptionHtml: '<p>完成实验 &amp; 报告。</p><img src="https://example.invalid/tracker"><script>bad()</script><p>```</p>', submittedContent: "<p>提交示例</p>", deadline: "2026-11-01", complete: true }],
  notifications: [{ id: "notice1", courseId: course.id, semesterId: semester, title: "上课通知", contentHtml: "<p>地点：六教</p>", publishTime: "2026-10-24", complete: true }],
});
async function setup(t, overrides = {}) {
  const temp = await mkdtemp(join(await realpath(tmpdir()), "onethu-export-test-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const calls = [];
  const listener = http.createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); calls.push(body.params);
    const reply = result => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result })); };
    try {
      const { operation, args } = body.params;
      if (overrides.handle && await overrides.handle({ operation, args, body, response, reply, temp })) return;
      if (operation === "learn.courses") reply({ semester, rows: [course], count: 1, complete: true });
      else if (operation === "learn.resources") reply(overrides.resources ?? resources());
      else if (operation === "learn.downloadMany") {
        assert.equal(body.params.confirm, true);
        const [refs, output] = args;
        assert.ok(refs.length <= 500 && refs.length > 0);
        const results = [];
        for (const ref of refs) {
          const item = (overrides.resources ?? resources()).items.find(item => item.resourceRef === ref);
          const content = `fixture ${item.resourceId}`;
          let destination, suffix = 0;
          while (true) {
            destination = join(output, `${suffix ? `copy-${suffix}-` : ""}${item.filename}`);
            try { await writeFile(destination, content, { flag: "wx" }); break; }
            catch (error) { if (error.code !== "EEXIST") throw error; suffix++; }
          }
          results.push({ resourceRef: ref, absolutePath: destination, filename: basename(destination),
            courseId: course.id, semesterId: semester, bytes: Buffer.byteLength(content), sha256: hash(content), mime: "text/plain", reused: false });
        }
        reply({ results, failures: [], complete: true });
      } else throw new Error(`Unexpected operation ${operation}`);
    } catch (error) { response.writeHead(500); response.end("fixture failed"); throw error; }
  });
  listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  t.after(() => { listener.closeAllConnections(); listener.close(); });
  const endpoint = `http://127.0.0.1:${listener.address().port}`;
  const output = join(temp, "归档");
  return { temp, output, calls, endpoint, courseDir: join(output, courseDirectoryName(course.name, course.id, semester)) };
}
function cli(fixture, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, "--endpoint", fixture.endpoint, "learn", "export", "--output", fixture.output, ...args], {
      env: { ...process.env, ONETHU_ENDPOINT: "", ONETHU_TIMEOUT_MS: "" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject); child.on("close", code => resolve({ code, stdout, stderr, report: stdout ? JSON.parse(stdout) : undefined }));
  });
}
async function missing(file) { await assert.rejects(access(file), { code: "ENOENT" }); }

test("export defaults to read-only planning and respects explicit dry-run", async t => {
  const fixture = await setup(t);
  for (const flags of [[], ["--confirm", "--dry-run"]]) {
    const result = await cli(fixture, flags);
    assert.equal(result.code, 0); assert.equal(result.stderr, ""); assert.equal(result.report.mode, "dry-run");
    assert.equal(result.report.status, "planned"); assert.equal(result.report.courses[0].resources.length, 2);
    await missing(fixture.output);
  }
  assert.ok(fixture.calls.every(call => call.operation !== "learn.downloadMany"));
});

test("confirmed single-course export archives content, verifies files and reuses only intact hashes", async t => {
  const fixture = await setup(t);
  await mkdir(fixture.courseDir, { recursive: true });
  const note = join(fixture.courseDir, "自己的笔记.md"); await writeFile(note, "Keep my notes");
  const result = await cli(fixture, ["--course", course.id, "--semester", semester, "--confirm"]);
  assert.equal(result.code, 0, result.stderr); assert.equal(result.report.complete, true); assert.equal(result.report.counts.downloaded, 2);
  assert.deepEqual(fixture.calls[0].args, [semester]);
  const archive = result.report.courses[0];
  const content = JSON.parse(await readFile(join(archive.directory, ".onethu-export", result.report.runId, "content.json"), "utf8"));
  assert.equal(content.homework[0].descriptionHtml, resources().homework[0].descriptionHtml);
  const markdown = await readFile(archive.contentPath, "utf8");
  assert.match(markdown, /完成实验 & 报告/); assert.match(markdown, /地点：六教/); assert.match(markdown, /提交示例/);
  assert.ok(!markdown.includes("bad()")); assert.ok(!markdown.includes("tracker"));
  for (const item of archive.resources) {
    assert.equal(hash(await readFile(join(archive.directory, item.file.relativePath))), item.file.sha256);
  }
  const manifest = JSON.parse(await readFile(archive.manifestPath, "utf8")); assert.equal(manifest.resources.length, 2);
  assert.equal((JSON.parse(await readFile(result.report.reportPath, "utf8"))).complete, true);
  const callsBefore = fixture.calls.filter(call => call.operation === "learn.downloadMany").length;
  const rerun = await cli(fixture, ["--confirm"]);
  assert.equal(rerun.code, 0, rerun.stderr); assert.equal(rerun.report.counts.downloaded, 0); assert.equal(rerun.report.counts.reused, 2);
  assert.notEqual(rerun.report.runId, result.report.runId);
  assert.equal(fixture.calls.filter(call => call.operation === "learn.downloadMany").length, callsBefore);
  const modified = join(archive.directory, archive.resources[0].file.relativePath);
  await writeFile(modified, "user edited this file");
  const third = await cli(fixture, ["--confirm"]);
  assert.equal(third.code, 0, third.stderr); assert.equal(third.report.counts.downloaded, 1); assert.equal(third.report.counts.reused, 1);
  assert.equal(await readFile(modified, "utf8"), "user edited this file");
  assert.equal(await readFile(note, "utf8"), "Keep my notes");
  assert.notEqual(third.report.courses[0].resources[0].file.relativePath, archive.resources[0].file.relativePath);
});

test("incomplete enumeration keeps available content and reports exit 5, including dry-run", async t => {
  const incomplete = { ...resources(), complete: false, enumerationComplete: false, issues: [{ code: "LEARN_HOMEWORK_ENUMERATION_UNVERIFIED" }] };
  const fixture = await setup(t, { resources: incomplete });
  const plan = await cli(fixture);
  assert.equal(plan.code, 5); assert.equal(plan.report.complete, false); await missing(fixture.output);
  const result = await cli(fixture, ["--confirm"]);
  assert.equal(result.code, 5); assert.equal(JSON.parse(result.stderr).error.code, "EXPORT_PARTIAL");
  assert.equal(result.report.status, "partial"); assert.equal(result.report.counts.downloaded, 2);
  assert.ok(result.report.courses[0].issues.some(item => item.code === "LEARN_HOMEWORK_ENUMERATION_UNVERIFIED"));
  const onDisk = JSON.parse(await readFile(result.report.reportPath, "utf8")); assert.equal(onDisk.complete, false);
});

test("missing detail content is reported instead of claiming a complete archive", async t => {
  const legacy = resources(); delete legacy.homework;
  const fixture = await setup(t, { resources: legacy });
  const result = await cli(fixture, ["--confirm"]);
  assert.equal(result.code, 5); assert.ok(result.report.courses[0].issues.some(item => item.code === "EXPORT_CONTENT_MISSING"));
});

test("a failed detail keeps its available body and explicit incompleteness", async t => {
  const fallback = resources(); fallback.homework[0].complete = false;
  const fixture = await setup(t, { resources: fallback });
  const result = await cli(fixture, ["--confirm"]);
  assert.equal(result.code, 5); assert.ok(result.report.courses[0].issues.some(item => item.code === "EXPORT_CONTENT_INCOMPLETE"));
  assert.match(await readFile(result.report.courses[0].contentPath, "utf8"), /完成实验/);
});

test("wrong semester or course attribution is rejected without download", async t => {
  for (const changed of [ { ...resources(), semesterId: "wrong" }, { ...resources(), items: [{ ...resource(), courseId: "wrong" }], count: 1 } ]) {
    const fixture = await setup(t, { resources: changed });
    const result = await cli(fixture, ["--confirm"]);
    assert.equal(result.code, 5); assert.ok(result.report.courses[0].issues.some(item => item.code === "INVALID_EXPORT_RESPONSE"));
    assert.ok(fixture.calls.every(call => call.operation !== "learn.downloadMany"));
    await missing(fixture.courseDir);
  }
});

test("export splits a 501-resource course into two individually confirmed batches", async t => {
  const many = { ...resources(), items: Array.from({ length: 501 }, (_, i) => resource(i)), count: 501 };
  const fixture = await setup(t, { resources: many });
  const result = await cli(fixture, ["--confirm"]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(fixture.calls.filter(call => call.operation === "learn.downloadMany").map(call => call.args[0].length), [500, 1]);
  assert.equal(result.report.counts.downloaded, 501);
});

test("a failed download batch is retained in the report without retrying writes", async t => {
  const fixture = await setup(t, { handle: async ({ operation, body, response }) => {
    if (operation !== "learn.downloadMany") return false;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "Confirmation declined", data: { code: "CLI_CONFIRMATION_DECLINED" } } })); return true;
  } });
  const result = await cli(fixture, ["--confirm"]);
  assert.equal(result.code, 5); assert.equal(result.report.counts.failed, 2);
  assert.equal(fixture.calls.filter(call => call.operation === "learn.downloadMany").length, 1);
  assert.ok(result.report.courses[0].resources.every(item => item.status === "failed"));
  await access(result.report.courses[0].contentPath); await access(result.report.reportPath);
});

test("a batch timeout produces a partial disk report and is never retried", async t => {
  const fixture = await setup(t, { handle: async ({ operation }) => operation === "learn.downloadMany" });
  const result = await cli(fixture, ["--confirm", "--timeout", "100"]);
  assert.equal(result.code, 5); assert.equal(result.report.counts.failed, 2);
  assert.equal(fixture.calls.filter(call => call.operation === "learn.downloadMany").length, 1);
  assert.ok(result.report.courses[0].resources.every(item => item.error.code === "TIMEOUT"));
  assert.equal(result.report.courses[0].timedOut, true);
  assert.deepEqual(result.report.courses[0].remainingResourceRefs, resources().items.map(item => item.resourceRef));
  await access(result.report.reportPath);
});

test("server deadline retains verified successes and reports timed-out and unstarted refs without retry", async t => {
  const many = { ...resources(), items: Array.from({ length: 501 }, (_, i) => resource(i)), count: 501 };
  const fixture = await setup(t, { resources: many, handle: async ({ operation, args, reply, body }) => {
    if (operation !== "learn.downloadMany") return false;
    assert.ok(body.params.deadlineUnixMs > Date.now());
    const [refs, output] = args;
    const content = "completed fixture";
    const destination = join(output, "completed.txt");
    await writeFile(destination, content, { flag: "wx" });
    reply({ results: [{ resourceRef: refs[0], absolutePath: destination, courseId: course.id, semesterId: semester,
      bytes: Buffer.byteLength(content), sha256: hash(content), reused: false }],
      failures: refs.slice(1).map((ref, i) => ({ resourceRef: ref, code: i === 0 ? "LEARN_DOWNLOAD_DEADLINE_EXCEEDED" : "LEARN_DOWNLOAD_NOT_ATTEMPTED_DEADLINE" })),
      remaining: refs.slice(1), timedOut: true, complete: false, enumerationComplete: false });
    return true;
  } });
  const result = await cli(fixture, ["--confirm"]);
  assert.equal(result.code, 5); assert.equal(result.report.status, "partial");
  assert.equal(result.report.counts.downloaded, 1); assert.equal(result.report.counts.failed, 500);
  assert.equal(fixture.calls.filter(call => call.operation === "learn.downloadMany").length, 1);
  const saved = result.report.courses[0];
  assert.equal(saved.timedOut, true);
  assert.deepEqual(saved.remainingResourceRefs, many.items.slice(1).map(item => item.resourceRef));
  assert.equal(saved.downloadBatches[0].remaining.length, 499);
  assert.equal(saved.resources[1].error.code, "LEARN_DOWNLOAD_DEADLINE_EXCEEDED");
  assert.equal(saved.resources[2].error.code, "LEARN_DOWNLOAD_NOT_ATTEMPTED_DEADLINE");
  assert.equal(saved.resources[500].error.code, "EXPORT_BATCH_NOT_ATTEMPTED");
  const manifest = JSON.parse(await readFile(saved.manifestPath, "utf8"));
  assert.deepEqual(manifest.remainingResourceRefs, saved.remainingResourceRefs);
  assert.equal(await readFile(join(saved.directory, saved.resources[0].file.relativePath), "utf8"), "completed fixture");
});

test("remaining refs must be unique failed refs from the requested batch", async t => {
  for (const remaining of [[resource(99).resourceRef], [resource(1).resourceRef, resource(1).resourceRef]]) {
    const fixture = await setup(t, { handle: async ({ operation, args, reply }) => {
      if (operation !== "learn.downloadMany") return false;
      reply({ results: [], failures: args[0].map(resourceRef => ({ resourceRef, code: "LEARN_DOWNLOAD_NOT_ATTEMPTED_DEADLINE" })), remaining, complete: false });
      return true;
    } });
    const result = await cli(fixture, ["--confirm"]);
    assert.equal(result.code, 5);
    assert.ok(result.report.courses[0].issues.some(item => item.code === "INVALID_EXPORT_RESPONSE"));
    assert.equal(fixture.calls.filter(call => call.operation === "learn.downloadMany").length, 1);
  }
});

test("a course lookup failure still produces a reviewable confirmed export report", async t => {
  const fixture = await setup(t, { handle: async ({ operation, response }) => {
    if (operation !== "learn.courses") return false;
    response.writeHead(403); response.end("secret server body"); return true;
  } });
  const result = await cli(fixture, ["--confirm"]);
  assert.equal(result.code, 5); assert.equal(result.report.courses.length, 0);
  assert.ok(result.report.issues.some(item => item.code === "LOCAL_SERVICE_DISABLED"));
  assert.ok(!result.stdout.includes("secret server body")); await access(result.report.reportPath);
});

test("download bytes and SHA must match the actual local file", async t => {
  const fixture = await setup(t, { handle: async ({ operation, args, reply }) => {
    if (operation !== "learn.downloadMany") return false;
    const target = join(args[1], "corrupt.txt"); await writeFile(target, "unexpected", { flag: "wx" });
    reply({ results: args[0].map(ref => ({ resourceRef: ref, courseId: course.id, semesterId: semester, absolutePath: target, bytes: 10, sha256: hash("different!") })), failures: [], complete: true }); return true;
  } });
  const result = await cli(fixture, ["--confirm"]);
  assert.equal(result.code, 5); assert.equal(result.report.counts.downloaded, 0); assert.equal(result.report.counts.failed, 2);
  assert.ok(result.report.courses[0].resources.every(item => item.error.code === "INVALID_EXPORT_RESPONSE"));
});

test("unreturned batch entries and unexpected paths cannot count as successes", async t => {
  const fixture = await setup(t, { handle: async ({ operation, args, reply, temp }) => {
    if (operation !== "learn.downloadMany") return false;
    reply({ results: [{ resourceRef: args[0][0], courseId: course.id, semesterId: semester,
      absolutePath: join(temp, "outside.txt"), bytes: 0, sha256: hash("") }], failures: [], complete: true }); return true;
  } });
  const result = await cli(fixture, ["--confirm"]);
  assert.equal(result.code, 5); assert.equal(result.report.counts.failed, 2);
  assert.deepEqual(result.report.courses[0].resources.map(item => item.error.code), ["INVALID_EXPORT_RESPONSE", "EXPORT_DOWNLOAD_MISSING"]);
});

test("symlinks in output ancestors and course destinations are refused", async t => {
  const fixture = await setup(t);
  const outside = join(fixture.temp, "outside"); await mkdir(outside);
  await symlink(outside, fixture.output, "junction");
  const result = await cli(fixture, ["--confirm"]);
  assert.equal(result.code, 2); assert.equal(JSON.parse(result.stderr).error.code, "EXPORT_SYMLINK_REFUSED");
  assert.equal(fixture.calls.length, 0); assert.deepEqual(await readdir(outside), []);
  await rm(fixture.output); await mkdir(fixture.output); await symlink(outside, fixture.courseDir, "junction");
  const nested = await cli(fixture, ["--confirm"]);
  assert.equal(nested.code, 5); assert.ok(nested.report.courses[0].issues.some(item => item.code === "EXPORT_SYMLINK_REFUSED"));
  assert.deepEqual(await readdir(outside), []); assert.ok(fixture.calls.every(call => call.operation !== "learn.downloadMany"));
});

test("a symlink substituted for a saved resource is rejected on the next run", async t => {
  const fixture = await setup(t);
  const first = await cli(fixture, ["--confirm"]); assert.equal(first.code, 0);
  const file = join(fixture.courseDir, first.report.courses[0].resources[0].file.relativePath);
  const outside = join(fixture.temp, "outside.txt"); await writeFile(outside, "private note");
  await rm(file); await symlink(outside, file);
  const second = await cli(fixture, ["--confirm"]);
  assert.equal(second.code, 5); assert.ok(second.report.courses[0].issues.some(item => item.code === "EXPORT_SYMLINK_REFUSED"));
  assert.equal(await readFile(outside, "utf8"), "private note");
});

test("a tampered manifest cannot reuse files outside the course directory", async t => {
  const fixture = await setup(t);
  const first = await cli(fixture, ["--confirm"]); assert.equal(first.code, 0);
  const saved = first.report.courses[0];
  const manifest = JSON.parse(await readFile(saved.manifestPath, "utf8"));
  manifest.resources[0].file.relativePath = "../../outside.txt";
  const outside = join(fixture.temp, "outside.txt"); await writeFile(outside, "fixture 1");
  await writeFile(saved.manifestPath, JSON.stringify(manifest));
  const second = await cli(fixture, ["--confirm"]);
  assert.equal(second.code, 0); assert.equal(second.report.counts.downloaded, 1); assert.equal(second.report.counts.reused, 1);
  assert.equal(await readFile(outside, "utf8"), "fixture 1");
});

test("export path and course selectors are validated", async t => {
  const fixture = await setup(t);
  const invalid = await cli({ ...fixture, output: "relative/path" }, ["--confirm"]);
  assert.equal(invalid.code, 2); assert.equal(JSON.parse(invalid.stderr).error.code, "INVALID_EXPORT_ARGUMENT");
  const wrongCourse = await cli(fixture, ["--course", "missing"]);
  assert.equal(wrongCourse.code, 5); assert.ok(wrongCourse.report.issues.some(item => item.code === "LEARN_COURSE_NOT_FOUND"));
  await missing(fixture.output);
});

test("course names are stable single components for Chinese, reserved names and traversal", () => {
  for (const name of ["CON", "nul.txt", "AUX ", "LPT1", "COM¹.txt", "../a/b\\c", "...", "课程 ".repeat(100), "a\u202eb", "x:<y>|?*"]) {
    const folder = courseDirectoryName(name, course.id, semester);
    assert.ok(!/[<>:"/\\|?*\x00-\x1f\u202a-\u202e]/.test(folder));
    assert.ok(!/^(?:con|nul|aux|prn|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(folder));
    assert.ok(Buffer.byteLength(folder) <= 114); assert.ok(!folder.endsWith("."));
    assert.equal(folder, courseDirectoryName(name, course.id, semester));
  }
  assert.match(courseDirectoryName("程序设计", course.id, semester), /^程序设计--/);
  assert.notEqual(courseDirectoryName("程序设计", course.id, semester), courseDirectoryName("程序设计", "another", semester));
  assert.equal(htmlText("<p>&#x1f600; &lt;x&gt;</p><style>hidden</style>"), "😀 <x>");
});
