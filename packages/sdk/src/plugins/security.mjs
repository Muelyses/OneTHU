import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

export class PluginError extends Error {
  constructor(code, message = code) { super(message); this.code = code; }
}
export function fail(code, message) { throw new PluginError(code, message); }
export const MAX_FILE = 64 * 1024 * 1024;
export const MAX_TOTAL = 256 * 1024 * 1024;
export const MAX_ENTRIES = 4096;
export function pluginId(value) {
  if (typeof value !== 'string' || value.length > 100 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value)) fail('PLUGIN_INVALID_ID');
  return value;
}
export function relativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 512 || value.normalize('NFC') !== value || /[\\\x00-\x1f\x7f:]/.test(value) || value.startsWith('/')) fail('PLUGIN_UNSAFE_PATH');
  for (const part of value.split('/')) {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || /[<>"|?*]/.test(part)) fail('PLUGIN_UNSAFE_PATH');
  }
  return value;
}
export async function checkPath(target, allowMissing = false) {
  if (!path.isAbsolute(target)) fail('PLUGIN_ABSOLUTE_PATH_REQUIRED');
  const parsed = path.parse(target);
  let current = parsed.root;
  const components = path.resolve(target).slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < components.length; i++) {
    current = path.join(current, components[i]);
    let stat;
    try { stat = await lstat(current); } catch (error) {
      if (allowMissing && error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) fail('PLUGIN_SYMLINK_REFUSED');
    if (i < components.length - 1 && !stat.isDirectory()) fail('PLUGIN_UNSAFE_PATH');
  }
}
export async function ensureDir(target) {
  await checkPath(target, true);
  await mkdir(target, { recursive: true, mode: 0o700 });
  await checkPath(target);
}
export async function readRegular(target, limit = MAX_FILE) {
  await checkPath(target);
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink > 1 || stat.size > limit) fail('PLUGIN_INVALID_FILE');
    const bytes = await handle.readFile();
    if (bytes.length > limit) fail('PLUGIN_PACKAGE_TOO_LARGE');
    return bytes;
  } finally { await handle.close(); }
}
export async function writeNew(target, data, mode = 0o600) {
  await checkPath(target, true);
  const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), mode);
  try { await handle.writeFile(data); } finally { await handle.close(); }
}
export async function writeJson(target, value) {
  await ensureDir(path.dirname(target));
  await checkPath(target, true);
  const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`;
  await writeNew(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, target);
}
export function requireConfirm(options) {
  if (options?.confirm !== true) fail('PLUGIN_CONFIRMATION_REQUIRED', 'Review this local plugin and pass confirm: true. JS and native plugins execute trusted local code; this host is not an OS sandbox.');
}
