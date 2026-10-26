/** OS login registration. Updating a known LaunchAgent changes its next-login
 * configuration without terminating a resident task already running today. */
import { constants } from 'node:fs';
import { lstat, open, mkdir, rename, link, unlink, readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CliError } from './client.mjs';

const execute = promisify(execFile);
const fail = name => new CliError(name, name.replace(/_/g, ' '), 2);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const xml = value => String(value).replace(/[<>&"']/g, ch => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' }[ch]));
const unxml = value => value.replace(/&([^;]+);/g, (_, entity) => {
  const decoded = { lt:'<', gt:'>', amp:'&', quot:'"', apos:"'" }[entity];
  if (decoded === undefined) throw fail('AUTOSTART_CONFIG_UNRECOGNIZED');
  return decoded;
});

export function serviceLabel(dataDir) { return `edu.tsinghua.onethu.cli.${hash(dataDir).slice(0, 12)}`; }
function plist(label, args) {
  return `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>${xml(label)}</string><key>ProgramArguments</key><array>${args.map(x => `<string>${xml(x)}</string>`).join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict></dict></plist>`;
}
/** Accept exactly our legacy/generated schema, never an arbitrary plist which
 * happens to have a matching filename or label. No XML entity expansion. */
function readManagedPlist(text) {
  const match = /^\s*(?:<\?xml[^?]*\?>\s*)?<plist\s+version="1\.0">\s*<dict>\s*<key>Label<\/key>\s*<string>([^<]*)<\/string>\s*<key>ProgramArguments<\/key>\s*<array>((?:\s*<string>[^<]*<\/string>)*)\s*<\/array>\s*<key>RunAtLoad<\/key>\s*<true\s*\/>\s*<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\s*\/>\s*<\/dict>\s*<\/dict>\s*<\/plist>\s*$/.exec(text);
  if (!match) throw fail('AUTOSTART_CONFIG_UNRECOGNIZED');
  return { label: unxml(match[1]), args: [...match[2].matchAll(/<string>([^<]*)<\/string>/g)].map(value => unxml(value[1])) };
}
async function privateFile(file, uid) {
  let handle;
  try {
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 16_384 || before.uid !== uid || (before.mode & 0o077)) throw fail('AUTOSTART_CONFIG_UNSAFE');
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const after = await handle.stat();
    if (after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size) throw fail('AUTOSTART_CONFIG_CHANGED');
    return { text: await handle.readFile('utf8'), meta: after };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  finally { await handle?.close(); }
}
function sameFile(a, b) { return a.ino === b.ino && a.dev === b.dev && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }

/** A desktop-managed installation supplies a verified standalone Node next to
 * its runtime manifest, even when this CLI was invoked via a system Node. */
export async function serviceNode({ packageRoot, platform, arch, execPath }) {
  const candidate = path.join(packageRoot, platform === 'win32' ? 'node.exe' : 'node');
  let meta;
  try { meta = await lstat(candidate); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { await lstat(path.join(packageRoot, 'runtime.json')); }
    catch (manifestError) { if (manifestError.code === 'ENOENT') return execPath; throw manifestError; }
    throw fail('AUTOSTART_RUNTIME_INVALID');
  }
  if (!meta.isFile() || meta.isSymbolicLink() || meta.nlink !== 1) throw fail('AUTOSTART_RUNTIME_INVALID');
  try {
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'runtime.json'), 'utf8'));
    if (manifest.platform !== platform || manifest.arch !== arch || !/^[a-f0-9]{64}$/.test(manifest.nodeSha256 ?? '') || hash(await readFile(candidate)) !== manifest.nodeSha256) throw fail('AUTOSTART_RUNTIME_INVALID');
  } catch { throw fail('AUTOSTART_RUNTIME_INVALID'); }
  return candidate;
}

export async function configureAutostart(action, dataDir, options = {}) {
  const { platform = process.platform, arch = process.arch, home = homedir(), uid = process.getuid?.(), execPath = process.execPath,
    packageRoot = fileURLToPath(new URL('..', import.meta.url)), exec = execute } = options;
  if (!['install', 'uninstall'].includes(action) || typeof dataDir !== 'string' || !dataDir || /[\x00-\x1f]/.test(dataDir)) throw fail('AUTOSTART_ARGUMENT_INVALID');
  const label = serviceLabel(dataDir), bin = path.join(packageRoot, 'bin', 'onethu.mjs');
  if (platform === 'darwin') {
    const dir = path.join(home, 'Library', 'LaunchAgents'), file = path.join(dir, label + '.plist'), domain = `gui/${uid}`;
    await mkdir(dir, { recursive: true });
    const directory = await lstat(dir);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== uid || (directory.mode & 0o022)) throw fail('AUTOSTART_DIRECTORY_UNSAFE');
    const lockFile = path.join(dir, `.${label}.lock`);
    let lock;
    try { lock = await open(lockFile, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw fail('AUTOSTART_BUSY'); throw error; }
    try {
      const existing = await privateFile(file, uid);
      if (existing) {
        const previous = readManagedPlist(existing.text);
        // A known Node location may change; the command/profile may not.
        if (previous.label !== label || previous.args.length !== 6 || !path.isAbsolute(previous.args[0]) || previous.args[1] !== bin || previous.args[2] !== 'daemon' || previous.args[3] !== 'serve' || previous.args[4] !== '--data-dir' || previous.args[5] !== dataDir) throw fail('AUTOSTART_CONFIG_CONFLICT');
      }
      if (action === 'uninstall') {
        if (!existing) return { installed: false };
        await exec('launchctl', ['bootout', `${domain}/${label}`]).catch(() => undefined);
        if (!sameFile(existing.meta, await lstat(file))) throw fail('AUTOSTART_CONFIG_CHANGED');
        await unlink(file);
        return { installed: false };
      }
      const node = await serviceNode({ packageRoot, platform, arch, execPath });
      const content = plist(label, [node, bin, 'daemon', 'serve', '--data-dir', dataDir]);
      if (existing?.text !== content) {
        const temporary = path.join(dir, `.${label}.${randomBytes(8).toString('hex')}.tmp`);
        const handle = await open(temporary, 'wx', 0o600);
        try {
          await handle.writeFile(content); await handle.sync(); await handle.close();
          if (existing) {
            if (!sameFile(existing.meta, await lstat(file))) throw fail('AUTOSTART_CONFIG_CHANGED');
            await rename(temporary, file);
          } else { await link(temporary, file); await unlink(temporary); }
        } finally { await handle.close().catch(() => undefined); await unlink(temporary).catch(() => undefined); }
      }
      if (!existing) await exec('launchctl', ['bootstrap', domain, file]);
      // Existing registrations stay loaded with their current process. The new
      // file is read at next login; callers may explicitly reload when idle.
      return { installed: true, manager: 'launchd', label, updated: !!existing && existing.text !== content, reloadRequired: !!existing, applies: existing ? 'next-login' : 'now' };
    } finally { await lock.close(); await unlink(lockFile); }
  }
  if (platform === 'win32') {
    if (action === 'uninstall') { await exec('schtasks.exe', ['/Delete', '/TN', label, '/F']); return { installed: false }; }
    const node = await serviceNode({ packageRoot, platform, arch, execPath });
    const quote = s => '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
    const command = [node, bin, 'daemon', 'serve', '--data-dir', dataDir].map(quote).join(' ');
    await exec('schtasks.exe', ['/Create', '/TN', label, '/SC', 'ONLOGON', '/TR', command, '/RL', 'LIMITED']);
    return { installed: true, manager: 'Task Scheduler', label };
  }
  throw new CliError('AUTOSTART_PLATFORM_UNSUPPORTED', 'Autostart installation supports macOS and Windows. Use daemon serve with your process manager.', 2);
}
