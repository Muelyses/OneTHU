/**
 * 清华云盘 live 冒烟（需要 SEAFILE_TOKEN；会创建并清理临时目录，不触碰现有文件）。
 *
 * 覆盖：
 * ① account/repos 可用、OneTHU 资料库存在；
 * ② 建目录 + 上传 manifest；
 * ③ 目录分享（vaultCloud 首选路径）→ 匿名 dirent_list 能列出 manifest；
 * ④ 匿名下载 /d/<token>/files/?p=/manifest.json&dl=1 内容一致；
 * ⑤ 撤销分享 → 匿名访问应失败；
 * ⑥ 文件分享（vaultCloud 退化路径）→ 匿名 dirents 形状；
 * ⑦ 清理临时目录。
 *
 * 用法：SEAFILE_TOKEN=xxx node tools/cloud-smoke-live.mjs
 * 注意：不要在日志/截图里回显 token。
 */
const BASE = 'https://cloud.tsinghua.edu.cn';
const TOKEN = process.env.SEAFILE_TOKEN ?? '';
if (!TOKEN) { console.error('缺少 SEAFILE_TOKEN'); process.exit(2); }
const H = { Authorization: 'Bearer ' + TOKEN };
let pass = 0;
const step = async (name, fn) => {
  const t = Date.now();
  try { const r = await fn(); pass++; console.log('✓', name, `${Date.now() - t}ms`, r ?? ''); return r; }
  catch (e) { console.error('✗', name, String(e).slice(0, 400)); throw e; }
};
const dir = '/LiveSmoke-' + Date.now().toString(36);
let repoId = null;
const shares = [];
const cleanup = async () => {
  for (const t of shares) await fetch(`${BASE}/api/v2.1/share-links/${t}/`, { method: 'DELETE', headers: H }).catch(() => {});
  if (repoId) await fetch(`${BASE}/api2/repos/${repoId}/dir/?p=${encodeURIComponent(dir)}`, { method: 'DELETE', headers: H }).catch(() => {});
};
try {
  const repos = await step('account/repos', async () => {
    const r = await fetch(BASE + '/api2/repos/', { headers: H });
    if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 200));
    return r.json();
  });
  const repo = repos.find((x) => x.name === 'OneTHU');
  if (!repo) throw new Error('没有 OneTHU 资料库（先在应用里创建/连接）');
  repoId = repo.id;
  await step('mkdir ' + dir, async () => {
    const r = await fetch(`${BASE}/api2/repos/${repoId}/dir/?p=${encodeURIComponent(dir)}`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'operation=mkdir&create_parents=true',
    });
    if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 300));
  });
  const content = JSON.stringify({ v: 1, kind: 'vault-share', name: 'live smoke', items: [] });
  await step('upload manifest', async () => {
    const lr = await fetch(`${BASE}/api2/repos/${repoId}/upload-link/?p=${encodeURIComponent(dir)}`, { headers: H });
    if (!lr.ok) throw new Error('upload-link ' + lr.status);
    const link = (await lr.text()).trim().replace(/^"|"$/g, '');
    const fd = new FormData();
    fd.append('file', new Blob([content], { type: 'application/json' }), 'manifest.json');
    fd.append('parent_dir', dir);
    fd.append('replace', '1');
    const up = await fetch(link + '?ret-json=1', { method: 'POST', headers: H, body: fd });
    if (!up.ok) throw new Error(up.status + ' ' + (await up.text()).slice(0, 300));
  });
  const makeShare = async (path) => {
    const r = await fetch(BASE + '/api/v2.1/share-links/', {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_id: repoId, path, expire_days: 1 }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(r.status + ' ' + text.slice(0, 300));
    const j = JSON.parse(text);
    shares.push(j.token);
    return j;
  };
  const dirShare = await step('share directory', async () => makeShare(dir));
  console.log('  link shape /d/<token>/:', /^https:\/\/cloud\.tsinghua\.edu\.cn\/d\/[^/]+\/$/.test(dirShare.link));
  const list = await step('anonymous dirent_list', async () => {
    const r = await fetch(`${BASE}/api/v2.1/share-links/${dirShare.token}/dirents/?path=${encodeURIComponent('/')}`);
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const arr = j.dirent_list ?? j.data ?? j;
    if (!Array.isArray(arr)) throw new Error('unexpected dirents shape: ' + JSON.stringify(j).slice(0, 200));
    return arr.map((x) => `${x.file_name ?? x.name}:${x.is_dir ? 'dir' : 'file'}`).join(',');
  });
  if (!list.includes('manifest.json')) throw new Error('share dir does not list manifest.json');
  const dl = await step('anonymous download', async () => {
    const r = await fetch(`${BASE}/d/${dirShare.token}/files/?p=${encodeURIComponent('/manifest.json')}&dl=1`);
    if (!r.ok) throw new Error(r.status);
    return r.text();
  });
  if (dl !== content) throw new Error('downloaded manifest differs');
  await step('revoke directory share', async () => {
    const r = await fetch(`${BASE}/api/v2.1/share-links/${dirShare.token}/`, { method: 'DELETE', headers: H });
    if (!r.ok) throw new Error(r.status);
    shares.splice(shares.indexOf(dirShare.token), 1);
  });
  await step('revoked share denied', async () => {
    const r = await fetch(`${BASE}/api/v2.1/share-links/${dirShare.token}/dirents/?path=/`);
    if (r.ok) throw new Error('revoked link still readable');
  });
  const fileShare = await step('share file (fallback path)', async () => makeShare(`${dir}/manifest.json`));
  console.log('  file link shape /f/<token>/:', /^https:\/\/cloud\.tsinghua\.edu\.cn\/f\/[^/]+\/$/.test(fileShare.link));
  await step('file share dirents rejected as expected', async () => {
    const r = await fetch(`${BASE}/api/v2.1/share-links/${fileShare.token}/dirents/?path=/`);
    const body = await r.text();
    if (r.ok) throw new Error('file share unexpectedly exposes dirents');
    if (!/not a folder/i.test(body)) throw new Error('unexpected file-share error: ' + body.slice(0, 160));
    return '400 not-a-folder (expected)';
  });
  const fileDirect = await step('file share direct download', async () => {
    const r = await fetch(`${BASE}/d/${fileShare.token}/files/?p=/&dl=1`);
    if (!r.ok) throw new Error(r.status);
    return r.text();
  });
  if (fileDirect !== content) throw new Error('file-share direct content differs');
  console.log(`LIVE CLOUD SMOKE PASSED (${pass} steps)`);
} finally {
  await cleanup();
}
