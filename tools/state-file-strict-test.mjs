#!/usr/bin/env node
/** Execute the production helper declarations with an isolated native bridge/storage. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts.createSourceFile('clients.ts', readFileSync('apps/desktop/src/lib/clients.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const names = new Set(['fileRead', 'fileWrite', 'fileDelete']);
const declarations = source.statements.filter(n => ts.isFunctionDeclaration(n) && names.has(n.name?.text)).map(n => n.getText(source)).join('\n');
let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const rejects = async (fn, label) => { await assert.rejects(fn, /mock I\/O|mock quota/, label); checks++; };
let invoke = async () => { throw new Error('mock I/O'); };
globalThis.__stateFileBridge = { invoke: (...args) => invoke(...args) };
async function load(native) {
  const js = ts.transpileModule(`const isTauri = ${native};\n${declarations}`, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText.replaceAll('await import("@tauri-apps/api/core")', 'globalThis.__stateFileBridge');
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const native = await load(true);
eq(await native.fileRead('test'), null, 'legacy callers retain best-effort read');
await native.fileWrite('test', '{}'); checks++;
await native.fileDelete('test'); checks++;
await rejects(() => native.fileRead('test', { strict: true }), 'native I/O read error propagates');
await rejects(() => native.fileWrite('test', '{}', { strict: true }), 'native I/O write error propagates');
await rejects(() => native.fileDelete('test', { strict: true }), 'native I/O delete error propagates');
invoke = async () => null;
eq(await native.fileRead('missing', { strict: true }), null, 'native NotFound remains a normal missing file');
const files = new Map();
globalThis.localStorage = { getItem: k => files.get(k) ?? null, setItem: (k, v) => { files.set(k, v); }, removeItem: k => { files.delete(k); } };
const web = await load(false);
await web.fileWrite('calendar', 'actual durable content', { strict: true });
eq(await web.fileRead('calendar', { strict: true }), 'actual durable content', 'browser strict writes really persist');
eq(await web.fileRead('calendar'), null, 'legacy browser helper behavior unchanged');
await web.fileDelete('calendar', { strict: true });
eq(await web.fileRead('calendar', { strict: true }), null, 'browser strict delete clears persisted value');
globalThis.localStorage.setItem = () => { throw new Error('mock quota'); };
await rejects(() => web.fileWrite('calendar', '{}', { strict: true }), 'quota errors cannot masquerade as durable writes');
console.log(`state file strict: ${checks} checks passed`);
