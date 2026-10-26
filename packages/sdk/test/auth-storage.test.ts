import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, chmod, mkdir, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openSessionStorage } from '../src/node/storage.js';

const snapshot = () => ({version:1 as const,device:{fingerprint:'a'.repeat(32),account:'12345678'},session:{username:'12345678',fingerprint:'a'.repeat(32),cookiesJson:'[]',savedAt:1}});
async function temporary(t:any){const dir=await mkdtemp(path.join(os.tmpdir(),'onethu-sdk-auth-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('private storage persists only supported fields and survives a process lifetime',async t=>{
  const dir=path.join(await temporary(t),'nested','profile');const store=await openSessionStorage(dir);
  await store.save({...snapshot(),password:'never-save-fixture-password'} as any);
  const raw=await readFile(path.join(dir,'session.json'),'utf8');assert.equal(raw.includes('password'),false);
  assert.equal(JSON.stringify(await store.load()),raw);await store.close();
  const again=await openSessionStorage(dir);assert.equal((await again.load())?.device.fingerprint,'a'.repeat(32));await again.close();
  if(process.platform!=='win32'){assert.equal((await stat(dir)).mode&0o777,0o700);assert.equal((await stat(path.join(dir,'session.json'))).mode&0o777,0o600);}
});
test('a held lock excludes a second writer and releases on close',async t=>{
  const dir=await temporary(t);const first=await openSessionStorage(dir);
  await assert.rejects(openSessionStorage(dir,10),{code:'AUTH_SESSION_BUSY'});await first.close();
  const second=await openSessionStorage(dir,10);await second.close();
});
test('dead owner lock is reclaimed; malformed lock fails closed',async t=>{
  const dir=await temporary(t),lock=path.join(dir,'.session.lock');await mkdir(lock,{mode:0o700});
  await writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:2147483647,nonce:'old'}),{mode:0o600});
  const store=await openSessionStorage(dir,10);await store.close();
  await mkdir(lock,{mode:0o700});await writeFile(path.join(lock,'owner.json'),'{}',{mode:0o600});
  await assert.rejects(openSessionStorage(dir,10),{code:'AUTH_SESSION_BUSY'});
});
test('storage rejects symlinks, permissive secrets and account mismatches',async t=>{
  const dir=await temporary(t);const store=await openSessionStorage(dir);
  const bad=snapshot();bad.session.username='88888888';await assert.rejects(store.save(bad),{code:'AUTH_STORAGE_INVALID'});
  await store.save(snapshot());await store.close();
  if(process.platform!=='win32'){
    await chmod(path.join(dir,'session.json'),0o644);const locked=await openSessionStorage(dir);await assert.rejects(locked.load(),{code:'AUTH_STORAGE_PERMISSIONS'});await locked.close();
    const alias=dir+'-alias';await symlink(dir,alias);t.after(()=>rm(alias,{force:true}));await assert.rejects(openSessionStorage(alias),{code:'AUTH_STORAGE_UNSAFE_PATH'});
  }
});
test('concurrent stale-lock recovery leaves exactly one live owner',async t=>{
  const dir=await temporary(t),lock=path.join(dir,'.session.lock');await mkdir(lock,{mode:0o700});await writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:2147483647,nonce:'dead-owner'}),{mode:0o600});
  const outcomes=await Promise.allSettled([openSessionStorage(dir,80),openSessionStorage(dir,80),openSessionStorage(dir,80)]);
  const winners=outcomes.filter((r):r is PromiseFulfilledResult<Awaited<ReturnType<typeof openSessionStorage>>>=>r.status==='fulfilled');assert.equal(winners.length,1);await winners[0]!.value.save(snapshot());await winners[0]!.value.close();
});
