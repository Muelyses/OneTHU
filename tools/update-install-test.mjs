#!/usr/bin/env node
/** Actual installDownloaded implementation; fake IPC only. Never launches an installer. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const path = 'apps/desktop/src/lib/updater.ts';
const source = readFileSync(path, 'utf8');
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'installDownloaded');
assert.ok(declaration);
const fixture = { platform: 'macos', calls: [], error: null };
globalThis.__updateInstallFixture = {
  invoke: async (command, args) => { fixture.calls.push({ command, args }); if (fixture.error) throw fixture.error; },
  platformKey: () => fixture.platform,
  logLine: async () => undefined,
  i18n: key => key,
};
const compiled = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const moduleText = 'const {invoke,platformKey,logLine,i18n}=globalThis.__updateInstallFixture;\n' + compiled;
const { installDownloaded } = await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString('base64')}`);
let checks = 0;
for (const platform of ['macos', 'windows', 'linux', 'android']) {
  fixture.platform = platform; fixture.calls = [];
  const out = await installDownloaded('/isolated/update/package');
  assert.equal(out.ok, true); checks++;
  assert.deepEqual(fixture.calls, [{ command: 'updater_open_installer', args: { path: '/isolated/update/package' } }]); checks++;
}
fixture.calls = [];
assert.equal((await installDownloaded('')).ok, false); checks++;
assert.equal(fixture.calls.length, 0); checks++;
fixture.error = new Error('isolated integrity failure');
const rejected = await installDownloaded('/isolated/update/changed');
assert.equal(rejected.ok, false); checks++;
assert.equal(rejected.error, 'isolated integrity failure'); checks++;
assert.equal(fixture.calls.length, 1); checks++;
assert.equal(fixture.calls[0].command, 'updater_open_installer'); checks++;
console.log(`update install: ${checks} isolated IPC checks passed; no installer launched`);
