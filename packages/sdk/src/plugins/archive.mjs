import path from 'node:path';
import { lstat, readdir } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fail, relativePath, checkPath, readRegular, MAX_FILE, MAX_TOTAL, MAX_ENTRIES } from './security.mjs';
import { validateManifest, compatibility } from './manifest.mjs';

const crcTable = Array.from({ length: 256 }, (_, i) => {
  let crc = i; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); return crc >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0;
}
function zipFiles(bytes) {
  const bad = () => fail('PLUGIN_INVALID_ZIP');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) bad();
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), centralStart = bytes.readUInt32LE(end + 16);
  if (count === 0 || count > MAX_ENTRIES || count !== bytes.readUInt16LE(end + 8) || centralStart + centralSize !== end || centralStart > end) bad();
  const files = new Map(), seen = new Set(), ranges = [];
  let cursor = centralStart, total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) bad();
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16), compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    const attributes = bytes.readUInt32LE(cursor + 38), local = bytes.readUInt32LE(cursor + 42);
    if (flags & ~0x080e || ![0, 8].includes(method) || bytes.readUInt16LE(cursor + 34) !== 0 || size > MAX_FILE || compressed > MAX_FILE || local + 30 > centralStart || cursor + 46 + nameLength + extraLength + commentLength > end) bad();
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = rawName.toString('utf8');
    if (!Buffer.from(name).equals(rawName)) bad();
    const directory = name.endsWith('/');
    const clean = relativePath(directory ? name.slice(0, -1) : name);
    if (seen.has(clean.toLowerCase())) fail('PLUGIN_DUPLICATE_PATH');
    seen.add(clean.toLowerCase());
    const unixType = (attributes >>> 16) & 0o170000;
    if (unixType && unixType !== 0o100000 && unixType !== 0o040000) fail('PLUGIN_SYMLINK_REFUSED');
    if (unixType === 0o040000 && !directory || directory && size !== 0) bad();
    if (bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) bad();
    const localNameLength = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28);
    const start = local + 30 + localNameLength + localExtra;
    if (start + compressed > centralStart || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(rawName)) bad();
    if (!(flags & 8) && (bytes.readUInt32LE(local + 14) !== crc || bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== size)) bad();
    if (ranges.some(([a,b]) => local < b && start + compressed > a)) bad();
    ranges.push([local, start + compressed]);
    total += size; if (total > MAX_TOTAL) fail('PLUGIN_PACKAGE_TOO_LARGE');
    if (!directory) {
      let content;
      try { content = method === 0 ? Buffer.from(bytes.subarray(start, start + compressed)) : inflateRawSync(bytes.subarray(start, start + compressed), { maxOutputLength: Math.max(1, size) }); } catch { bad(); }
      if (content.length !== size || crc32(content) !== crc) bad();
      files.set(clean, content);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) bad();
  return files;
}
async function directoryFiles(source) {
  const files = new Map(), seen = new Set();
  let count = 0, total = 0;
  async function visit(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (++count > MAX_ENTRIES) fail('PLUGIN_PACKAGE_TOO_LARGE');
      const rel = relativePath(prefix + entry.name), full = path.join(dir, entry.name);
      if (seen.has(rel.toLowerCase())) fail('PLUGIN_DUPLICATE_PATH'); seen.add(rel.toLowerCase());
      if (entry.isSymbolicLink()) fail('PLUGIN_SYMLINK_REFUSED');
      if (entry.isDirectory()) await visit(full, rel + '/');
      else if (entry.isFile()) {
        const content = await readRegular(full); total += content.length;
        if (total > MAX_TOTAL) fail('PLUGIN_PACKAGE_TOO_LARGE'); files.set(rel, content);
      } else fail('PLUGIN_INVALID_FILE');
    }
  }
  await visit(source);
  return files;
}
export async function readBundle(sourcePath) {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) fail('PLUGIN_ABSOLUTE_PATH_REQUIRED');
  await checkPath(sourcePath);
  const stat = await lstat(sourcePath);
  let files;
  if (stat.isDirectory()) files = await directoryFiles(sourcePath);
  else if (stat.isFile() && /\.zip$/i.test(sourcePath)) files = zipFiles(await readRegular(sourcePath));
  else fail('PLUGIN_MANIFEST_REQUIRED', 'Use a local directory or ZIP with manifest.json and its JS entry or native executable. For a legacy single JS file, copy its literal manifest into manifest.json and set entry to the JS filename; installation never evaluates source to discover a manifest.');
  const manifests = [...files.keys()].filter(name => name === 'manifest.json' || /^[^/]+\/manifest\.json$/.test(name));
  if (manifests.length !== 1) fail('PLUGIN_MANIFEST_REQUIRED');
  const prefix = manifests[0].slice(0, -'manifest.json'.length);
  if (prefix) {
    if ([...files.keys()].some(name => !name.startsWith(prefix))) fail('PLUGIN_UNSAFE_PATH');
    files = new Map([...files].map(([name, data]) => [name.slice(prefix.length), data]));
  }
  const raw = files.get('manifest.json');
  if (raw.length > 1024 * 1024) fail('PLUGIN_INVALID_MANIFEST');
  let manifest; try { manifest = JSON.parse(raw.toString('utf8')); } catch { fail('PLUGIN_INVALID_MANIFEST'); }
  manifest = validateManifest(manifest, files);
  // Refuse file/directory conflicts before creating any extraction directory.
  const names = new Set([...files.keys()].map(name => name.toLowerCase()));
  for (const name of names) {
    const components = name.split('/');
    for (let i = 1; i < components.length; i++) if (names.has(components.slice(0,i).join('/'))) fail('PLUGIN_DUPLICATE_PATH');
  }
  const hashes = [...files].sort(([a],[b]) => a.localeCompare(b)).map(([name,data]) => ({ path: name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }));
  const digest = createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
  return { manifest, files, hashes, digest, compatibility: compatibility(manifest) };
}
