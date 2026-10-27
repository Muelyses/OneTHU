import { execFileSync } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
execFileSync(process.execPath,[fileURLToPath(new URL('../../sdk/scripts/build.mjs',import.meta.url))],{stdio:'inherit'});
const out=new URL('../dist/sdk/',import.meta.url);
// scripts/../ is the package root; the SDK bundle has no workspace dependency.
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
await cp(new URL('../../sdk/dist/',import.meta.url),out,{recursive:true});
await mkdir(new URL('../LICENSES/',import.meta.url),{recursive:true});
await cp(new URL('../../../LICENSES/THIRD-PARTY.md',import.meta.url),new URL('../LICENSES/THIRD-PARTY.md',import.meta.url));
process.stdout.write('OneTHU CLI contains the independent SDK and plugin worker.\n');
