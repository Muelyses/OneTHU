/**
 * 作业「必须带附件」预检护栏（R21c，用户实录：提交收到
 * `TJZY-ERR {"result":"error","msg":"请上传附件","object":null}`）。
 *
 * 判定只信服务端（作业 JSON 无可靠标志位）：被拒 → 记下该作业 → 之后本地拦下，
 * 不再白跑一趟；带附件提交成功则清除（老师可能改了要求）。
 *
 * 本测试对记忆模块是**行为测试**（stub localStorage），对页面是接线断言。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* ---------- [1] 记忆模块行为（先装 localStorage 桩） ---------- */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};
const { clearNeedFile, isNeedFile, markNeedFile } = await import("../apps/desktop/src/state/learnAttachmentReq.ts");

assert.equal(isNeedFile("h1"), false, "初始不应记住任何作业");
markNeedFile("h1");
assert.equal(isNeedFile("h1"), true, "被拒后必须记住");
assert.equal(isNeedFile("h2"), false, "不得波及其他作业");
markNeedFile("h1");
const key = [...store.keys()].find((k) => k.includes("needFile"));
assert.ok(key, "必须落在本地存储键上");
assert.equal(JSON.parse(store.get(key)).filter((x) => x === "h1").length, 1, "重复标记必须幂等");
clearNeedFile("h1");
assert.equal(isNeedFile("h1"), false, "带附件提交成功后必须清除（要求以最新为准）");

/* 上限：只留最近 200 条 */
for (let i = 0; i < 260; i++) markNeedFile(`h${i}`);
const ids = JSON.parse(store.get(key));
assert.equal(ids.length, 200, "本地记忆上限 200 条（防止无限膨胀）");
assert.equal(ids[ids.length - 1], "h259", "保留的是最近的");
assert.equal(isNeedFile("h0"), false, "最旧的应被挤出");

/* 坏数据不崩 */
store.set(key, "{not json");
assert.equal(isNeedFile("h259"), false, "损坏的存储按空处理，不得抛错");
store.set(key, JSON.stringify({ a: 1 }));
assert.equal(isNeedFile("h259"), false, "非数组按空处理");

/* ---------- [2] 页面接线 ---------- */
const page = readFileSync(new URL("../apps/desktop/src/pages/learn/AssignmentDetailPage.tsx", import.meta.url), "utf8");
assert.ok(page.includes("isNeedFile(h.id)"), "提交前必须查本地记忆");
assert.ok(page.includes("markNeedFile(h.id)"), "服务端拒绝后必须记录");
assert.ok(page.includes("clearNeedFile(h.id)"), "成功提交后必须清除");
const submit = page.slice(page.indexOf("const doSubmit"), page.indexOf("const doRemove"));
const guardAt = submit.indexOf("isNeedFile(h.id)");
const callAt = submit.indexOf("learn.submitHomework");
assert.ok(guardAt > 0 && guardAt < callAt, "预检必须发生在发请求之前（拦在本地）");
assert.ok(/本作业要求必须带附件/.test(submit), "拦下时必须说明原因");
assert.ok(/请上传附件/.test(submit) && /markNeedFile/.test(submit), "服务端原文须转成可行动提示并记录");
assert.ok(page.includes('className="exthw-note is-warn"'), "附件区必须有可见提示行");

console.log("learn-need-file-test: 全部断言通过（记忆行为 + 上限 + 容错 + 预检先于请求 + 成功清除）");
