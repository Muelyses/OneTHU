import { constants } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Small transactional files inside the private, exclusively locked runtime directory. */
export function createStore(directory: string) {
  let tail: Promise<unknown> = Promise.resolve();
  const target = (name: string) => {
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(name) || name.startsWith('.')) throw new Error('STORAGE_INVALID_NAME');
    return path.join(directory, `${name}.json`);
  };
  async function inspect(file: string) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 32 * 1024 * 1024) throw new Error('STORAGE_UNSAFE_FILE');
    return info;
  }
  async function read<T>(name: string, fallback: T): Promise<T> {
    const file = target(name);
    try {
      await inspect(file);
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try { return JSON.parse(await handle.readFile('utf8')) as T; } finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw error;
    }
  }
  async function write(name: string, value: unknown) {
    const result = tail.catch(() => undefined).then(async () => {
      const file = target(name);
      try { await inspect(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      const temporary = path.join(directory, `.write-${randomUUID()}.tmp`);
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      try {
        try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporary, file);
      }
      catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    });
    tail = result; await result;
  }
  return { read, write, flush: () => tail };
}
export type RuntimeStore = ReturnType<typeof createStore>;
