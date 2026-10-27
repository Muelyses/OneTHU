/** Optional Node persistence. The browser task entry never imports this module. */
import { mkdir, open, readFile, rename, rm, realpath, lstat, chmod } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createTaskManager } from "./index.js";
import type { TaskManagerPorts, TaskState } from "./types.js";

export async function createFileTaskStorage(dataDir: string): Promise<TaskManagerPorts["storage"]> {
  if (!path.isAbsolute(dataDir)) throw new Error("TASK_DATA_DIRECTORY_ABSOLUTE_REQUIRED");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const root = await realpath(dataDir), file = path.join(root, "tasks.json"), lock = path.join(root, "tasks.lock");
  const token = randomUUID(); let lockFile;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { lockFile = await open(lock, "wx", 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if ((await lstat(lock)).isSymbolicLink()) throw new Error("TASK_STATE_SYMLINK");
      let old: { pid?: number; token?: string };
      try { old = JSON.parse(await readFile(lock, "utf8")); } catch { throw new Error("TASK_LOCK_INVALID"); }
      if (!Number.isSafeInteger(old.pid) || old.pid! <= 0) throw new Error("TASK_LOCK_INVALID");
      try { process.kill(old.pid!, 0); throw new Error("TASK_STORAGE_ALREADY_OPEN"); }
      catch (probe) { if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw new Error("TASK_STORAGE_ALREADY_OPEN"); }
      const again = JSON.parse(await readFile(lock, "utf8"));
      if (again.token !== old.token) throw new Error("TASK_STORAGE_ALREADY_OPEN");
      await rm(lock);
    }
  }
  if (!lockFile) throw new Error("TASK_STORAGE_ALREADY_OPEN");
  await lockFile.writeFile(JSON.stringify({ pid: process.pid, token })); await lockFile.sync();
  let closed = false;
  const check = () => { if (closed) throw new Error("TASK_STORAGE_CLOSED"); };
  return {
    async load() {
      check();
      try {
        const meta = await lstat(file);
        if (!meta.isFile() || meta.isSymbolicLink() || meta.size > 32 * 1024 * 1024) throw new Error("TASK_STATE_INVALID");
        await chmod(file, 0o600);
        return JSON.parse(await readFile(file, "utf8")) as TaskState;
      } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    },
    async save(state) {
      check();
      const content = JSON.stringify(state);
      if (Buffer.byteLength(content) > 32 * 1024 * 1024) throw new Error("TASK_STORAGE_LIMIT");
      const temp = path.join(root, `.tasks-${token}-${randomUUID()}.tmp`);
      const out = await open(temp, "wx", 0o600);
      try { await out.writeFile(content); await out.sync(); await out.close(); check(); await rename(temp, file); }
      finally { await out.close().catch(() => undefined); await rm(temp, { force: true }); }
    },
    async close() {
      if (closed) return; closed = true; await lockFile!.close();
      try { const saved = JSON.parse(await readFile(lock, "utf8")); if (saved.token === token) await rm(lock); } catch { /* lock has already been removed */ }
    },
  };
}
export async function createFileTaskManager(options: Omit<TaskManagerPorts, "storage"> & { dataDir: string }) {
  const { dataDir, ...ports } = options, storage = await createFileTaskStorage(dataDir);
  try { return await createTaskManager({ ...ports, storage }); }
  catch (error) { await storage.close?.(); throw error; }
}
