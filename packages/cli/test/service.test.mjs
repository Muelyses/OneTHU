import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, lstat, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { configureAutostart, serviceLabel, serviceNode } from '../src/service.mjs';

async function fixture(t) {
  const home = await mkdtemp(path.join(tmpdir(), 'onethu-service-中文 & '));
  t.after(() => rm(home, { recursive: true, force: true }));
  const packageRoot = path.join(home, 'cli'), dataDir = path.join(home, 'profile'), calls = [];
  await mkdir(path.join(packageRoot, 'bin'), { recursive: true });
  const options = { home, packageRoot, platform: 'darwin', arch: 'arm64', uid: process.getuid?.(), execPath: '/opt/homebrew/old/node', exec: async (...args) => { calls.push(args); } };
  const file = path.join(home, 'Library', 'LaunchAgents', serviceLabel(dataDir) + '.plist');
  const install = () => configureAutostart('install', dataDir, options);
  const bundled = async () => {
    const bytes = Buffer.from('fixture node runtime');
    await writeFile(path.join(packageRoot, 'node'), bytes, { mode: 0o700 });
    await writeFile(path.join(packageRoot, 'runtime.json'), JSON.stringify({ platform: 'darwin', arch: 'arm64', nodeSha256: createHash('sha256').update(bytes).digest('hex') }));
  };
  return { home, packageRoot, dataDir, options, calls, file, install, bundled };
}
const posix = { skip: process.platform === 'win32' };

test('existing own LaunchAgent updates atomically to bundled Node without interrupting resident work', posix, async t => {
  const f = await fixture(t);
  const first = await f.install();
  assert.equal(first.applies, 'now');
  assert.equal(f.calls.length, 1);
  assert.match(await readFile(f.file, 'utf8'), /\/opt\/homebrew\/old\/node/);
  await f.bundled();
  const result = await f.install();
  assert.equal(result.updated, true); assert.equal(result.reloadRequired, true); assert.equal(result.applies, 'next-login');
  assert.equal(f.calls.length, 1, 'updating registration never bootouts or starts a competing daemon');
  const updated = await readFile(f.file, 'utf8');
  assert(!updated.includes('/opt/homebrew/old/node'));
  assert(updated.includes('/cli/node</string>'));
  assert.equal((await lstat(f.file)).mode & 0o777, 0o600);
  assert.equal((await f.install()).updated, false, 'same configuration is idempotent');
  assert.deepEqual(await readdir(path.dirname(f.file)), [path.basename(f.file)], 'no temp or lock files survive');
});

test('same filename does not authorize replacing or deleting another command/profile', posix, async t => {
  for (const replacement of ['label', 'bin', 'profile']) {
    const f = await fixture(t); await f.install();
    let text = await readFile(f.file, 'utf8');
    if (replacement === 'label') text = text.replace(serviceLabel(f.dataDir), 'edu.other.agent');
    if (replacement === 'bin') text = text.replace('/cli/bin/onethu.mjs', '/someone-else/bin/onethu.mjs');
    if (replacement === 'profile') text = text.replace('/profile</string>', '/another-profile</string>');
    await writeFile(f.file, text);
    for (const action of ['install', 'uninstall']) await assert.rejects(configureAutostart(action, f.dataDir, f.options), { code: 'AUTOSTART_CONFIG_CONFLICT' });
    assert.equal(await readFile(f.file, 'utf8'), text);
    assert.equal(f.calls.length, 1);
  }
});

test('LaunchAgent update rejects symlinks, broad permissions, and unrecognized extra actions', posix, async t => {
  const f = await fixture(t); await f.install();
  const original = await readFile(f.file, 'utf8');
  await chmod(f.file, 0o644);
  await assert.rejects(f.install(), { code: 'AUTOSTART_CONFIG_UNSAFE' });
  await chmod(f.file, 0o600);
  await writeFile(f.file, original.replace('</plist>', '<key>Program</key><string>/bin/sh</string></plist>'));
  await assert.rejects(f.install(), { code: 'AUTOSTART_CONFIG_UNRECOGNIZED' });
  const other = path.join(f.home, 'other'); await writeFile(other, original, { mode: 0o600 });
  await rm(f.file); await symlink(other, f.file);
  await assert.rejects(f.install(), { code: 'AUTOSTART_CONFIG_UNSAFE' });
  assert.equal(await readFile(other, 'utf8'), original);
});

test('a concurrent managed update fails closed instead of racing a replacement', posix, async t => {
  const f = await fixture(t); await f.install();
  const lock = path.join(path.dirname(f.file), `.${serviceLabel(f.dataDir)}.lock`);
  await writeFile(lock, '', { mode: 0o600 });
  await assert.rejects(f.install(), { code: 'AUTOSTART_BUSY' });
  assert.equal(f.calls.length, 1);
});

test('bundled Node is selected only with matching platform, architecture, and file digest', posix, async t => {
  const f = await fixture(t);
  assert.equal(await serviceNode(f.options), f.options.execPath);
  await f.bundled();
  assert.equal(await serviceNode(f.options), path.join(f.packageRoot, 'node'));
  await assert.rejects(serviceNode({ ...f.options, arch: 'x64' }), { code: 'AUTOSTART_RUNTIME_INVALID' });
  await writeFile(path.join(f.packageRoot, 'node'), 'modified');
  await assert.rejects(serviceNode(f.options), { code: 'AUTOSTART_RUNTIME_INVALID' });
  await rm(path.join(f.packageRoot, 'node'));
  await assert.rejects(serviceNode(f.options), { code: 'AUTOSTART_RUNTIME_INVALID' });
});

test('uninstall validates ownership and removes only this profile registration', posix, async t => {
  const f = await fixture(t); await f.install();
  const other = path.join(path.dirname(f.file), 'edu.other.plist'); await writeFile(other, 'other');
  assert.deepEqual(await configureAutostart('uninstall', f.dataDir, f.options), { installed: false });
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
  assert.equal(await readFile(other, 'utf8'), 'other');
  assert.deepEqual(f.calls.at(-1), ['launchctl', ['bootout', `gui/${process.getuid()}/${serviceLabel(f.dataDir)}`]]);
});
