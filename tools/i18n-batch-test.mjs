import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkBatch, hashSource, dataStructure } from "./i18n/batch.mjs";
import { i18nDictionaryGuard } from "./i18n/vite-guard.mjs";
import { readDataFile } from "./i18n/dictionary.mjs";
const source = { label: "中文", messages: { a: "保存 {name}", b: "取消" } };
const before = { label: "English", messages: { a: "", b: "Cancel" } };
const target = { label: "English", messages: { a: "Save {name}", b: "Cancel" } };
const batch = { sourceHash: hashSource(source.messages), messages: [{ key: "a", source: "保存 {name}" }] };
const targetFile = "apps/desktop/src/i18n/locales/en-US.ts";
const sample = { source, before, target, batch, targetFile, changedFiles: [targetFile] };
assert.deepEqual(checkBatch(sample), []);
for (const patch of [
  { target: { ...target, messages: { ...target.messages, a: "" } } },
  { target: { ...target, messages: { ...target.messages, a: "Save {other}" } } },
  { target: { ...target, messages: { ...target.messages, a: "Save {name} {name}" } } },
  { target: { ...target, messages: { ...target.messages, b: "Changed" } } },
  { target: { ...target, label: "Changed" } },
  { batch: { ...batch, sourceHash: "stale" } },
  { batch: { ...batch, messages: [{ key: "a", source: "旧源文" }] } },
  { batch: { ...batch, messages: [...batch.messages, ...batch.messages] } },
  { changedFiles: [targetFile, "apps/desktop/src/App.tsx"] },
  { sameStructure: false },
]) assert(checkBatch({ ...sample, ...patch }).length);
assert.equal(hashSource({ b: "取消", a: "保存 {name}" }), batch.sourceHash);
assert.equal(dataStructure('export default {messages:{"a":"旧"}}'),dataStructure('export default {messages:{"a":"New"}}'));
assert.equal(dataStructure('export default {"messages":{"a":"旧"}}'),dataStructure('export default {"messages":{"a":"New"}}'));
assert.notEqual(dataStructure('export default {messages:{"a":"旧"}}'),dataStructure('export default {messages:{"b":"New"}}'));
const viteGuard=i18nDictionaryGuard();
const localePath="/workspace/apps/desktop/src/i18n/locales/en-US.ts";
assert.equal(viteGuard.transform('export default {label:"English",messages:{a:"Safe"}};',localePath),null);
assert.throws(()=>viteGuard.transform('export default {label:"English",messages:{a:(()=>globalThis.secret)()}};',localePath));
assert.throws(()=>viteGuard.transform('export default {label:"English",messages:{a:1}};',localePath));
assert.throws(()=>viteGuard.transform('export default {label:"English",messages:"invalid"};',localePath));
assert.equal(viteGuard.transform('const normalAppCode=()=>1;',"/workspace/apps/desktop/src/App.tsx"),null);
console.log("Translation batch guard: valid values, ten rejected mutations, read-only structure, stable source hash ✓");

// Exercise the real generated (quoted-property) dictionary and Git-based CLI.
// Synthetic values check engineering boundaries, not translation quality.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "onethu-i18n-batch-cli-"));
try {
  const dir = path.join(fixture, "apps/desktop/src/i18n/locales");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(fixture, "empty-hooks"));
  for (const locale of ["zh-CN", "en-US"]) fs.copyFileSync(`apps/desktop/src/i18n/locales/${locale}.ts`, path.join(dir, `${locale}.ts`));
  fs.copyFileSync("docs/i18n/batches/001.json", path.join(fixture, "batch.json"));
  const git = (...args) => execFileSync("git", args, { cwd: fixture, stdio: "pipe" });
  git("init", "--quiet");
  git("add", "apps", "batch.json");
  git("-c", "user.name=OneTHU test", "-c", "user.email=fixture@invalid", "-c", "commit.gpgsign=false",
    "-c", `core.hooksPath=${path.join(fixture, "empty-hooks")}`, "commit", "--quiet", "-m", "Translation fixture");
  const file = path.join(dir, "en-US.ts"), beforeText = fs.readFileSync(file, "utf8");
  const before = readDataFile(file), batch = JSON.parse(fs.readFileSync(path.join(fixture, "batch.json"), "utf8"));
  const messages = { ...before.messages };
  for (const row of batch.messages) messages[row.key] = `TEST ${row.source}`;
  // Rewrite message values line-by-line so the fixture does not depend on the
  // dictionary file matching canonical JSON.stringify formatting exactly.
  const writeTarget = values => {
    const lines = beforeText.split("\n");
    for (const [key, value] of Object.entries(values)) {
      const exact = `    ${JSON.stringify(key)}: `;
      const i = lines.findIndex(line => line.startsWith(exact));
      assert.notEqual(i, -1, `Fixture dictionary must contain key ${key}`);
      const trailing = lines[i].trimEnd().endsWith(",") ? "," : "";
      lines[i] = `    ${JSON.stringify(key)}: ${JSON.stringify(value)}${trailing}`;
    }
    const next = lines.join("\n");
    assert.notEqual(next, beforeText, "Generated dictionary fixture must actually change values");
    fs.writeFileSync(file, next);
  };
  const cli = () => spawnSync(process.execPath, [
    fileURLToPath(new URL("./i18n/check.mjs", import.meta.url)),
    "--locale", "en-US", "--batch", "batch.json", "--base", "HEAD",
  ], { cwd: fixture, encoding: "utf8" });
  writeTarget(messages);
  const accepted = cli();
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  const outside = Object.keys(messages).find(key => !batch.messages.some(row => row.key === key));
  writeTarget({ ...messages, [outside]: "Changed outside this batch" });
  const rejected = cli();
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Out-of-batch edit/);
  writeTarget(messages);
  fs.appendFileSync(file, "\n// Structural edit\n");
  const structural = cli();
  assert.equal(structural.status, 1);
  assert.match(structural.stderr, /Only messages string values may change/);
  console.log("Real generated dictionary + isolated Git CLI: translated batch accepted; outside-key and structural edits rejected ✓");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
