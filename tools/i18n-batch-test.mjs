import assert from "node:assert/strict";
import { checkBatch, hashSource, dataStructure } from "./i18n/batch.mjs";
import { i18nDictionaryGuard } from "./i18n/vite-guard.mjs";
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
assert.notEqual(dataStructure('export default {messages:{"a":"旧"}}'),dataStructure('export default {messages:{"b":"New"}}'));
const viteGuard=i18nDictionaryGuard();
const path="/workspace/apps/desktop/src/i18n/locales/en-US.ts";
assert.equal(viteGuard.transform('export default {label:"English",messages:{a:"Safe"}};',path),null);
assert.throws(()=>viteGuard.transform('export default {label:"English",messages:{a:(()=>globalThis.secret)()}};',path));
assert.throws(()=>viteGuard.transform('export default {label:"English",messages:{a:1}};',path));
assert.throws(()=>viteGuard.transform('export default {label:"English",messages:"invalid"};',path));
assert.equal(viteGuard.transform('const normalAppCode=()=>1;',"/workspace/apps/desktop/src/App.tsx"),null);
console.log("Translation batch guard: valid values, ten rejected mutations, read-only structure, stable source hash ✓");
