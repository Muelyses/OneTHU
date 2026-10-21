/** 分享引用账本：去重记录、有效引用/过期、撤销后只删无引用的文件。 */
import { dom, resetDom } from './dom-stub.mjs';
import assert from 'node:assert/strict';
import { rememberShare, markShareRevoked, activeShareRefs, expiredShareRefs, unreferencedFilesOf, hashReferenced, shareRefsSnapshot } from '../apps/desktop/src/state/shareRefs.ts';
resetDom();
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('✓ ' + m); };
const now = Date.now();
const a = rememberShare({ shareUrl: 'https://cloud/d/a/', shareToken: 'ta', repoId: 'r1', path: '/Vault/shares/a', files: [
  { hash: 'h1', path: 'files/x' }, { hash: 'h2', path: 'files/y' },
], expiresAt: now + 86400_000 });
const b = rememberShare({ shareUrl: 'https://cloud/d/b/', shareToken: 'tb', repoId: 'r1', path: '/Vault/shares/b', files: [
  { hash: 'h1', path: 'files/x' },
], expiresAt: now + 86400_000 });
ok(shareRefsSnapshot().refs.length === 2, 'two share refs recorded');
ok(activeShareRefs(now).length === 2, 'both active');
ok(hashReferenced('h1', now) && hashReferenced('h2', now), 'hashes referenced');
const un = unreferencedFilesOf(a.id, now).map((f) => f.path);
ok(un.length === 1 && un[0] === 'files/y', 'only unshared file is collectable when another ref shares x');
markShareRevoked(a.id);
ok(unreferencedFilesOf(b.id, now).some((f) => f.path === 'files/x'), 'after revoke, x is no longer referenced elsewhere');
rememberShare({ shareUrl: 'https://cloud/d/b/', shareToken: 'tb', repoId: 'r1', path: '/Vault/shares/b', files: [{ hash: 'h1', path: 'files/x' }] });
ok(shareRefsSnapshot().refs.length === 2, 'same shareUrl updates instead of duplicating');
const c = rememberShare({ shareUrl: 'https://cloud/d/c/', shareToken: 'tc', repoId: 'r1', path: '/Vault/shares/c', files: [], expiresAt: now - 1 });
ok(expiredShareRefs(now).some((r) => r.id === c.id), 'expired ref detected');
ok(!activeShareRefs(now).some((r) => r.id === c.id), 'expired ref is not active');
console.log(n + ' share-ref assertions passed');
