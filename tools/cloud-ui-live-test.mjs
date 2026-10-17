/**
 * App 层真实云盘冒烟（需要 SEAFILE_TOKEN）：
 * 在浏览器里用本地桥接把 Tauri 命令转到真实清华云盘，走 UI 生成云分享口令 →
 * 第二个干净的浏览器上下文导入口令 → 校验清单与文件，最后撤销并清理。
 *
 * 不在 CI 默认跑：没有 token 直接跳过/失败；不要回显 token。
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const BASE_CLOUD = 'https://cloud.tsinghua.edu.cn';
const TOKEN = process.env.SEAFILE_TOKEN ?? '';
if (!TOKEN) { console.error('缺少 SEAFILE_TOKEN'); process.exit(2); }
const AUTH = { Authorization: 'Bearer ' + TOKEN };
const repo = { id: null };
const tempFiles = new Set();
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; console.log('✓ ' + m); };

function obfuscateSecret(text) {
  const key = Buffer.from('OneTHU|seafile|remember');
  const bytes = Buffer.from(text, 'utf8');
  const out = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % key.length];
  return 'onethu-secret-v1:' + out.toString('base64');
}

async function api(url, opt = {}) {
  const r = await fetch(url, opt);
  return r;
}

async function findRepo() {
  const r = await api(BASE_CLOUD + '/api2/repos/', { headers: AUTH });
  if (!r.ok) throw new Error('repos ' + r.status);
  const repos = await r.json();
  const hit = repos.find((x) => x.name === 'OneTHU');
  if (!hit) throw new Error('缺少 OneTHU 资料库');
  repo.id = hit.id;
}

async function shareRead(args) {
  const link = args.link ?? args.path ?? '';
  const m = link.match(/\/([df])\/([^/?#]+)/);
  if (!m) throw new Error('不是有效分享链接');
  const token = m[2];
  const name = args.name ?? '';
  const dr = await api(`${BASE_CLOUD}/api/v2.1/share-links/${token}/dirents/?path=${encodeURIComponent('/')}`);
  if (!dr.ok) {
    const body = await dr.text();
    if (/not a folder/i.test(body)) {
      const r = await api(`${BASE_CLOUD}/d/${token}/files/?p=/&dl=1`);
      if (!r.ok) throw new Error('direct ' + r.status);
      return r.text();
    }
    throw new Error('dirents ' + dr.status + ' ' + body.slice(0, 120));
  }
  const j = await dr.json();
  const list = j.dirent_list ?? j.data ?? j;
  const file = list.find((e) => (e.is_dir === false || e.type === 'file' || e.kind === 'file') && (!name || (e.file_name ?? e.name) === name));
  if (!file) throw new Error('share 里没有文件');
  const fname = file.file_name ?? file.name;
  const r = await api(`${BASE_CLOUD}/d/${token}/files/?p=${encodeURIComponent('/' + fname)}&dl=1`);
  if (!r.ok) throw new Error('download ' + r.status);
  return r.text();
}

const handlers = {
  async state_read(args) {
    if (args.name === 'seafile.cfg') return JSON.stringify({ secret: obfuscateSecret(TOKEN) });
    return null;
  },
  async state_write() { return null; },
  async state_delete() { return null; },
  async seafile_repos() {
    const r = await api(BASE_CLOUD + '/api2/repos/', { headers: AUTH });
    if (!r.ok) throw new Error('repos ' + r.status);
    return (await r.json()).map((x) => ({ id: x.id, name: x.name, mtime: x.mtime ?? 0, size: x.size ?? 0 }));
  },
  async seafile_create_repo(args) {
    const r = await api(BASE_CLOUD + '/api2/repos/', {
      method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=' + encodeURIComponent(args.name),
    });
    if (!r.ok) throw new Error('create repo ' + r.status);
    return await r.json();
  },
  async seafile_mkdir(args) {
    const r = await api(`${BASE_CLOUD}/api2/repos/${args.repoId}/dir/?p=${encodeURIComponent(args.path)}`, {
      method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'operation=mkdir&create_parents=true',
    });
    if (!r.ok) throw new Error('mkdir ' + r.status);
    return null;
  },
  async write_temp_file(args) {
    /* 与 Rust 一致：返回路径 basename 就是请求的 name（不再额外前缀，否则上传文件名会变）。 */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onethu-ui-tmp-'));
    const p = path.join(dir, path.basename(String(args.name)));
    fs.writeFileSync(p, Buffer.from(args.dataBase64, 'base64'));
    tempFiles.add(p);
    return p;
  },
  async seafile_upload(args) {
    const lr = await api(`${BASE_CLOUD}/api2/repos/${args.repoId}/upload-link/?p=${encodeURIComponent(args.parentDir)}`, { headers: AUTH });
    if (!lr.ok) throw new Error('upload-link ' + lr.status);
    const link = (await lr.text()).trim().replace(/^"|"$/g, '');
    const data = fs.readFileSync(args.localPath);
    const fd = new FormData();
    fd.append('file', new Blob([data]), path.basename(args.localPath));
    fd.append('parent_dir', args.parentDir);
    fd.append('replace', args.replace ? '1' : '0');
    const up = await api(link + '?ret-json=1', { method: 'POST', headers: AUTH, body: fd });
    if (!up.ok) throw new Error('upload ' + up.status + ' ' + (await up.text()).slice(0, 120));
    return data.length;
  },
  async seafile_share(args) {
    const r = await api(BASE_CLOUD + '/api/v2.1/share-links/', {
      method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_id: args.repoId, path: args.path, expire_days: args.expireDays ?? 0, ...(args.password ? { password: args.password } : {}) }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error('share ' + r.status + ' ' + text.slice(0, 150));
    const j = JSON.parse(text);
    return { link: j.link, token: j.token };
  },
  async seafile_share_read(args) { return shareRead(args); },
  async seafile_share_delete(args) {
    const r = await api(`${BASE_CLOUD}/api/v2.1/share-links/${args.shareToken}/`, { method: 'DELETE', headers: AUTH });
    if (!r.ok) throw new Error('revoke ' + r.status);
    return null;
  },
  async seafile_delete(args) {
    const seg = args.kind === 'dir' ? 'dir' : 'file';
    const r = await api(`${BASE_CLOUD}/api2/repos/${args.repoId}/${seg}/?p=${encodeURIComponent(args.path)}`, { method: 'DELETE', headers: AUTH });
    if (!r.ok) throw new Error('delete ' + r.status);
    return null;
  },
  async nfc_available() { return { available: false, enabled: false, reason: 'test' }; },
  async nfc_read_tag() { throw new Error('desktop test'); },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/invoke') { res.writeHead(404, CORS); res.end(); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    try {
      const { cmd, args } = JSON.parse(body);
      const fn = handlers[cmd];
      if (!fn) { res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: '未桥接命令 ' + cmd })); return; }
      const value = await fn(args ?? {});
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, value }));
    } catch (e) {
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e).slice(0, 300) }));
    }
  });
});
await new Promise((r) => server.listen(5199, '127.0.0.1', r));

const filePath = path.join(os.tmpdir(), 'onethu-ui-share-file.txt');
fs.writeFileSync(filePath, 'file content from live cloud UI test');
tempFiles.add(filePath);
const fileHash = (await import('node:crypto')).createHash('sha256').update('file content from live cloud UI test').digest('hex');
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [];
let shareCode = '';
const cleanupPaths = new Set();
try {
  await findRepo();
  const makePage = async () => {
    const p = await browser.newPage({ viewport: { width: 1280, height: 840 } });
    p.on('pageerror', (e) => errors.push(e.message));
    await p.addInitScript(({ bridge, filePath, fileHash }) => {
      window.__TAURI_INTERNALS__ = {
        invoke: async (cmd, args) => {
          const r = await fetch(bridge + '/invoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd, args: args ?? {} }) });
          const j = await r.json();
          if (j.ok) return j.value;
          throw new Error(j.error);
        },
        transformCallback: () => 0,
        unregisterCallback: () => undefined,
      };
      localStorage.setItem('onethu.onboarded.phone', '1');
      localStorage.setItem('onethu.vaults.v1', JSON.stringify({ v: 1, activeId: 'vb.cloud', boxes: [{ id: 'vb.cloud', name: '云测试箱', items: [
        { id: 'vi.c', type: 'text', title: '云端一条', text: 'cloud payload', addedAt: 1 },
        { id: 'vi.f', type: 'file', title: 'ui-share.txt', addedAt: 2, file: { name: 'ui-share.txt', size: 35, mime: 'text/plain', hash: fileHash, cloudPath: null, stagedPath: filePath } },
      ], createdAt: 1, updatedAt: 1 }] }));
    }, { bridge: 'http://127.0.0.1:5199', filePath, fileHash });
    await p.route('**/src/state/data.ts*', async (route) => {
      const r = await route.fetch(); let b = await r.text();
      for (const n of ['useLearnData', 'useCampusData']) b = b.replace(`export function ${n}() {`, `export function ${n}() { return {data:{semester:{id:'x'},courses:[],homework:[],notifications:[],files:[],schedule:[]},state:'ready',error:null,reload:async()=>{}};`);
      await route.fulfill({ response: r, body: b });
    });
    await p.goto('http://127.0.0.1:5180/?explorer-preview=page&page=vault', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.explorer-shell');
    await p.waitForTimeout(1200);
    return p;
  };
  const p = await makePage();
  ok(await p.getByText('云测试箱').count() >= 1, 'cloud box visible');
  await p.getByRole('button', { name: '生成口令' }).click();
  await p.waitForSelector('.vault-share-code', { timeout: 20000 });
  shareCode = (await p.locator('.vault-share-code').innerText()).trim();
  ok(shareCode.startsWith('ONV2.'), 'live cloud share code is ONV2');
  const decoded = JSON.parse(Buffer.from(shareCode.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  console.log('  code has cloud ref:', Boolean(decoded.cloud), 'items:', Array.isArray(decoded.items));
  ok(await p.getByText('云分享').count() >= 1, 'UI reports cloud share mode');
  const ref = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.shareRefs.v1') || '{"refs":[]}').refs[0] ?? null);
  ok(Boolean(ref?.shareToken) && Boolean(ref?.path), 'cloud adapter recorded share ref');
  const liveDir = ref?.path ?? '';
  if (liveDir) cleanupPaths.add(liveDir);
  const listRes = await api(`${BASE_CLOUD}/api/v2.1/share-links/${ref.shareToken}/dirents/?path=${encodeURIComponent('/')}`);
  const listJson = await listRes.json();
  const liveNames = (listJson.dirent_list ?? listJson).map((e) => e.file_name ?? e.folder_name ?? e.name);
  console.log('  live names', JSON.stringify(liveNames), 'status', listRes.status);

  ok(liveNames.includes('manifest.json') && liveNames.includes('files'), 'live cloud share contains manifest + files dir');

  const p2 = await makePage();
  await p2.evaluate(() => localStorage.removeItem('onethu.vaults.v1'));
  await p2.reload({ waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('.explorer-shell'); await p2.waitForTimeout(1000);
  await p2.getByRole('button', { name: '导入口令' }).click();
  await p2.waitForSelector('.plg-form-modal');
  await p2.locator('.plg-form-modal textarea').fill(shareCode);
  await p2.getByRole('button', { name: '提交' }).click();
  await p2.waitForTimeout(3000);
  const imported = await p2.evaluate(() => JSON.parse(localStorage.getItem('onethu.vaults.v1')).boxes.flatMap((b) => b.items));
  ok(imported.length >= 1 && imported.some((i) => i.text === 'cloud payload'), 'second context imports cloud manifest');
  ok(imported.some((i) => i.type === 'file' && i.file?.name === 'ui-share.txt' && /^files\//.test(i.file?.cloudPath ?? '')), 'imported file keeps cloud path');

  /* 通过 UI 撤销云分享：应删除分享链接并递归清理目录 */
  await p.getByRole('button', { name: '撤销云分享' }).click();
  await p.waitForTimeout(2500);
  const revoked = await p.evaluate(() => JSON.parse(localStorage.getItem('onethu.shareRefs.v1') || '{"refs":[]}').refs[0]?.revokedAt ?? 0);
  ok(revoked > 0, 'UI revoke marks share ref revoked');
  if (ref?.shareToken) {
    const denied = await api(`${BASE_CLOUD}/api/v2.1/share-links/${ref.shareToken}/dirents/?path=/`);
    ok(!denied.ok, 'revoked share link is denied on live cloud');
  }
  if (liveDir) {
    const gone = await api(`${BASE_CLOUD}/api2/repos/${repo.id}/dir/?p=${encodeURIComponent(liveDir)}`);
    ok([403, 404].includes(gone.status), 'UI revoke deletes the live share directory');
  }
  ok(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.join(';') : ''));
  console.log(checks + ' live cloud UI assertions passed');
} finally {
  for (const dir of cleanupPaths) {
    try { await api(`${BASE_CLOUD}/api2/repos/${repo.id}/dir/?p=${encodeURIComponent(dir)}`, { method: 'DELETE', headers: AUTH }); } catch { /* ignore */ }
  }
  for (const f of tempFiles) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  await browser.close();
  server.close();
}
