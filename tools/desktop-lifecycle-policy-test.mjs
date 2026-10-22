/** Compile and execute the actual desktop lifecycle policy without a GUI/account.
 * Tauri's native adapters and Windows single-instance IPC still need device QA.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sources = [
  '../apps/desktop/src-tauri/src/desktop_lifecycle_policy.rs',
  '../apps/desktop/src-tauri/vendor/tauri-plugin-single-instance/src/secondary_launch.rs',
].map(path => fileURLToPath(new URL(path, import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), 'onethu-lifecycle-test-'));
const binary = join(temp, process.platform === 'win32' ? 'policy-test.exe' : 'policy-test');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', timeout: 120_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal ?? result.status})`);
}

try {
  for (const source of sources) {
    run('rustc', ['--edition=2021', '--test', source, '-o', binary]);
    run(binary, []);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
